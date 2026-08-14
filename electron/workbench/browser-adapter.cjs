const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

function installedBrowser() {
  const candidates = [
    { name: 'Microsoft Edge', executablePath: path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { name: 'Microsoft Edge', executablePath: path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { name: 'Google Chrome', executablePath: path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { name: 'Google Chrome', executablePath: path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe') },
  ]
  return candidates.find(candidate => candidate.executablePath && fs.existsSync(candidate.executablePath))
}

class BrowserAdapter {
  constructor({ profilePath }) {
    this.profilePath = profilePath
    this.context = undefined
    this.page = undefined
  }

  async #ensure() {
    if (this.context && this.page && !this.page.isClosed()) return this.page
    const browser = installedBrowser()
    if (!browser) throw new Error('没有检测到可用的 Microsoft Edge 或 Google Chrome。')
    fs.mkdirSync(this.profilePath, { recursive: true })
    this.context = await chromium.launchPersistentContext(this.profilePath, {
      executablePath: browser.executablePath,
      headless: false,
      acceptDownloads: true,
      viewport: { width: 1360, height: 850 },
      args: ['--no-first-run', '--no-default-browser-check'],
    })
    this.page = this.context.pages()[0] || await this.context.newPage()
    return this.page
  }

  async open(url) {
    const page = await this.#ensure()
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    return { url: page.url(), title: await page.title(), status: response?.status() }
  }

  async read(maxCharacters = 120000) {
    const page = await this.#ensure()
    const content = await page.locator('body').innerText({ timeout: 15000 })
    const maximum = Math.min(300000, Math.max(1000, Number(maxCharacters) || 120000))
    return { url: page.url(), title: await page.title(), text: content.slice(0, maximum), truncated: content.length > maximum }
  }

  async click(selector) {
    const page = await this.#ensure()
    await page.locator(String(selector || '')).first().click({ timeout: 15000 })
    await page.waitForTimeout(250)
    return { url: page.url(), title: await page.title() }
  }

  async fill(selector, value) {
    const page = await this.#ensure()
    await page.locator(String(selector || '')).first().fill(String(value ?? ''), { timeout: 15000 })
    return { url: page.url(), title: await page.title(), filled: true }
  }

  async download(selector, outputPath) {
    const page = await this.#ensure()
    const downloadEvent = page.waitForEvent('download', { timeout: 45000 })
    await page.locator(String(selector || '')).first().click({ timeout: 15000 })
    const download = await downloadEvent
    await download.saveAs(outputPath)
    return { url: page.url(), suggestedFilename: download.suggestedFilename(), path: outputPath }
  }

  async currentUrl() {
    const page = await this.#ensure()
    return page.url()
  }

  async close() {
    if (this.context) await this.context.close()
    this.context = undefined
    this.page = undefined
    return { closed: true }
  }
}

module.exports = { BrowserAdapter, installedBrowser }
