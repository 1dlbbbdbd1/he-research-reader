const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

async function checkDeepResearchUi(window, workspace, workbench, screenshotRoot) {
  await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('.composer-icon')?.click()
    await new Promise(resolve => setTimeout(resolve, 80))
    ;[...document.querySelectorAll('.composer-plus-menu button')].find(item => item.textContent.includes('科研工作流库'))?.click()
    await new Promise(resolve => setTimeout(resolve, 100))
    const deep = [...document.querySelectorAll('.workflow-library-card')].find(item => item.textContent.includes('深度文献研究'))
    if (!deep || deep.disabled) throw new Error('深度文献研究入口不可用')
    deep.click()
    await new Promise(resolve => setTimeout(resolve, 100))
    const input = document.querySelector('.agent-composer > textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '深度研究界面验收')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 80))
    document.querySelector('.composer-send').click()
    const started = Date.now()
    while (Date.now() - started < 8000 && ![...document.querySelectorAll('.agent-run-card')].some(item => item.textContent.includes('深度研究界面验收'))) await new Promise(resolve => setTimeout(resolve, 50))
  })()`, true)
  const run = workbench.listRuns().find(item => item.objective === '深度研究界面验收')
  if (!run || workbench.getRun(run.id).conversationWorkflowId !== 'deep-literature-research') throw new Error('界面没有建立深度研究任务')
  const metadata = { resultId: crypto.randomUUID(), resultType: 'deep_research', version: 1, reviewState: 'draft', content: '# 隔离界面验收报告\n\n|主张|来源|\n|---|---|\n|测试材料|[Crossref](https://api.crossref.org)|\n\n![外部图片应被忽略](https://example.invalid/image.png)\n\n这是界面样例，用于检查来源链接、阅读和编辑。', data: {}, sourceLinks: [] }
  workspace.database.prepare("INSERT INTO agent_artifacts(id,run_id,kind,label,metadata_json,created_at) VALUES (?,?,'report',?,?,?)").run(crypto.randomUUID(), run.id, '深度研究界面样例', JSON.stringify(metadata), new Date().toISOString())
  await window.webContents.executeJavaScript(`(async () => {
    ;[...document.querySelectorAll('.agent-run-card')].find(item => item.textContent.includes('深度研究界面验收')).click()
    const started = Date.now()
    while (Date.now() - started < 8000 && !document.querySelector('.research-report-preview')) await new Promise(resolve => setTimeout(resolve, 50))
    document.querySelector('.research-report-preview summary').click()
  })()`, true)
  const checks = []
  window.webContents.debugger.attach('1.3')
  try {
    for (const [width, height] of [[1024, 768], [1600, 900], [2560, 1440], [3840, 2160]]) {
      await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await new Promise(resolve => setTimeout(resolve, 120))
      const metrics = await window.webContents.executeJavaScript(`(() => {
        const preview = document.querySelector('.research-report-preview')
        preview.scrollIntoView({ block: 'center' })
        const link = preview.querySelector('a')
        const button = document.querySelector('.editable-result .workbench-primary')
        const style = getComputedStyle(button)
        return { width: innerWidth, height: innerHeight, table: Boolean(preview.querySelector('table')), sourceLink: link?.getAttribute('href') === 'https://api.crossref.org' && link.target === '_blank', noRemoteImages: !preview.querySelector('img'), editor: Boolean(document.querySelector('textarea[aria-label="深度研究界面样例编辑内容"]')), confirmReadable: style.color === 'rgb(255, 255, 255)' && style.backgroundColor === 'rgb(104, 75, 176)', noOverflow: document.documentElement.scrollWidth <= innerWidth && preview.scrollWidth <= preview.clientWidth + 1 }
      })()`)
      checks.push(metrics)
      if (screenshotRoot) fs.writeFileSync(path.join(screenshotRoot, `deep-research-${width}x${height}.png`), (await window.capturePage()).toPNG())
    }
  } finally { await window.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride'); window.webContents.debugger.detach() }
  if (checks.some(item => !item.table || !item.sourceLink || !item.noRemoteImages || !item.editor || !item.noOverflow || !item.confirmReadable)) throw new Error(`深度研究界面验收失败：${JSON.stringify(checks)}`)
  return checks
}
module.exports = { checkDeepResearchUi }
