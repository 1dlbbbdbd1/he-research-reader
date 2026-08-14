const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, desktopCapturer, nativeImage } = require('electron')
const { configureDesktopRuntime } = require('../electron/desktop-runtime.cjs')
const { PolicyEngine } = require('../electron/workbench/policy-engine.cjs')
const { ToolRegistry } = require('../electron/workbench/tool-registry.cjs')
const { applyRedactions } = require('../electron/workbench/desktop-capture.cjs')

process.env.RESEARCH_READER_ISOLATED_DESKTOP_TEST = '1'
configureDesktopRuntime(app)

const projectRoot = path.resolve(__dirname, '..')
const testRoot = path.join(projectRoot, '.reader-cache', `desktop-input-smoke-${Date.now()}-${process.pid}`)
fs.mkdirSync(testRoot, { recursive: true })
app.setPath('userData', path.join(testRoot, 'user-data'))

function wait(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)) }

async function main() {
  await app.whenReady()
  const title = 'H Agent Input Smoke'
  const window = new BrowserWindow({ width: 520, height: 360, show: false, webPreferences: { contextIsolation: true, sandbox: true } })
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><title>${title}</title><style>html,body{height:100%;margin:0}button{width:100%;height:100%;border:0;font:700 24px system-ui;background:#efeaff;color:#21184d}</style><button id="target">等待受控点击</button><script>document.querySelector('#target').addEventListener('click',event=>{event.currentTarget.textContent='受控点击已验证';event.currentTarget.style.background='#d8f7e4';document.body.dataset.clicked='yes'})</script>`)}`)
  window.setAlwaysOnTop(true, 'screen-saver')
  window.show()
  window.focus()
  await wait(700)

  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 800, height: 600 } })
  const source = sources.find(candidate => candidate.name === title)
  if (!source) throw new Error('未找到受控测试窗口。')
  const desktopAdapter = {
    async captureWindow(input = {}) {
      const current = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 800, height: 600 } })).find(candidate => candidate.id === input.sourceId)
      if (!current) throw new Error('受控测试窗口已变化。')
      const redacted = applyRedactions(current.thumbnail, input.redactions, nativeImage)
      return { sourceId: current.id, title: current.name, imageDataUrl: redacted.image.toDataURL(), persisted: false, redactionCount: redacted.redactionCount }
    },
  }
  const tools = new ToolRegistry({
    policyEngine: new PolicyEngine(),
    desktopAdapter,
    officeScriptPath: '',
    desktopInputScriptPath: path.join(projectRoot, 'scripts', 'desktop-input.ps1'),
  })
  const bounds = window.getBounds()
  const input = {
    application: 'controlled-test', sourceId: source.id, expectedTitle: title,
    action: { type: 'click', x: Math.round(bounds.width / 2), y: Math.round(bounds.height / 2) },
  }
  const grant = { applications: ['controlled-test'], allowScreenshots: true }
  const unredacted = await desktopAdapter.captureWindow({ sourceId: source.id })
  const redacted = await desktopAdapter.captureWindow({ sourceId: source.id, redactions: [{ x: 0, y: 0, width: 120, height: 80 }] })
  if (redacted.redactionCount !== 1 || redacted.imageDataUrl === unredacted.imageDataUrl) throw new Error('敏感区域遮蔽验证未通过。')
  const blocked = await tools.execute('desktop.performAction', input, grant)
  if (blocked.requiresHighRiskConfirmation !== true) throw new Error('桌面动作未先进入二次确认。')
  const result = await tools.execute('desktop.performAction', input, grant, { highRiskApproved: true })
  const clicked = await window.webContents.executeJavaScript("document.body.dataset.clicked === 'yes'")
  if (!clicked || !result.performed || !result.visualChanged || result.screenshotsPersisted !== false) throw new Error('点击前后验证未通过。')
  process.stdout.write(`${JSON.stringify({ confirmationRequired: true, controlledWindowClicked: clicked, titleVerified: result.title === title, visualChanged: result.visualChanged, redactionApplied: redacted.redactionCount === 1, screenshotsPersisted: result.screenshotsPersisted })}\n`)
  window.destroy()
}

const hardTimeout = setTimeout(() => {
  process.stderr.write('受控桌面输入烟测内部超时。\n')
  app.exit(2)
}, 25000)

main().then(() => {
  clearTimeout(hardTimeout)
  app.exit(0)
}).catch(error => {
  clearTimeout(hardTimeout)
  process.stderr.write(`${error.stack || error.message}\n`)
  app.exit(1)
})
