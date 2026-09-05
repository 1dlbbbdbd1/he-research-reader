const fs = require('node:fs')
const path = require('node:path')

async function checkResearchCycleUi(window, screenshotRoot) {
  await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('.selected-workflow button')?.click()
    const button = [...document.querySelectorAll('.research-cycle-shortcuts button')].find(item => item.textContent === '整理记录')
    if (!button) throw new Error('缺少实验整理快捷入口')
    button.click()
    await new Promise(resolve => setTimeout(resolve, 120))
    const input = document.querySelector('textarea[aria-label="原始科研材料"]')
    if (!input) throw new Error('缺少原始材料输入框')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '运行 A：seed=7，第一次失败。\\n运行 B：参数未记录，误差 0.12。\\n待确认：两次数据集是否相同。')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`, true)
  const checks = []
  window.webContents.debugger.attach('1.3')
  try {
    for (const [width, height] of [[1024, 768], [1600, 900], [2560, 1440], [3840, 2160]]) {
      await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await new Promise(resolve => setTimeout(resolve, 180))
      const metrics = await window.webContents.executeJavaScript(`(() => {
        const root = document.querySelector('.agent-chat-page')
        const composer = document.querySelector('.agent-composer')
        const input = document.querySelector('textarea[aria-label="原始科研材料"]')
        const send = document.querySelector('.composer-send').getBoundingClientRect()
        const box = composer.getBoundingClientRect()
        const fonts = [...composer.querySelectorAll('button,textarea,small,summary,label')].filter(item => item.getBoundingClientRect().height > 0).map(item => parseFloat(getComputedStyle(item).fontSize))
        return { width: innerWidth, height: innerHeight, shortcuts: document.querySelectorAll('.research-cycle-shortcuts button').length,
          noOverflow: document.documentElement.scrollWidth <= innerWidth && composer.scrollWidth <= composer.clientWidth + 1,
          composerFits: box.top >= 0 && box.bottom <= innerHeight + 1,
          sendVisible: send.top >= 0 && send.bottom <= innerHeight,
          inputVisible: input.getBoundingClientRect().height >= 90,
          minFont: Math.min(...fonts), materialPreserved: input.value.includes('第一次失败'),
          rootScrollable: root.scrollHeight >= root.clientHeight }
      })()`)
      checks.push(metrics)
      if (screenshotRoot) fs.writeFileSync(path.join(screenshotRoot, `experiment-intake-${width}x${height}.png`), (await window.capturePage()).toPNG())
    }
  } finally {
    await window.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
    window.webContents.debugger.detach()
    await window.webContents.executeJavaScript(`document.querySelector('.selected-workflow button')?.click()`)
  }
  if (checks.some(item => !item.noOverflow || !item.composerFits || !item.sendVisible || !item.inputVisible || item.minFont < 13 || !item.materialPreserved || item.shortcuts !== 7)) throw new Error(`科研流程界面验收失败：${JSON.stringify(checks)}`)
  return checks
}
module.exports = { checkResearchCycleUi }
