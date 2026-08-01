const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const productName = '小何的科研阅读助手'

test('desktop shell uses the approved product name everywhere users see it', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')

  assert.equal(packageJson.productName, productName)
  assert.equal(packageJson.build.productName, productName)
  assert.equal(packageJson.build.nsis.shortcutName, productName)
  assert.match(main, new RegExp(`title: '${productName}'`))
  assert.match(html, new RegExp(`<title>${productName}</title>`))
  assert.match(ui, new RegExp(`<span>${productName}</span>`))
})

test('Windows release workflow collects the renamed artifacts and title', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-windows.yml'), 'utf8')

  assert.match(workflow, /\^XiaoHeResearchReader-\(Setup\|Portable\)-\.\+-x64\\\.exe\$/)
  assert.doesNotMatch(workflow, /\^ResearchReader-\(Setup\|Portable\)/)
  assert.match(workflow, new RegExp(`--title "${productName} \\$env:GITHUB_REF_NAME"`))
})

test('desktop renderer has an explicit content security policy', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || ''

  assert.match(policy, /default-src 'self'/)
  assert.match(policy, /script-src 'self'/)
  assert.match(policy, /connect-src 'self' http: https:/)
  assert.match(policy, /object-src 'none'/)
  assert.doesNotMatch(policy, /unsafe-eval/)
})

test('desktop shell uses the approved H orbit brand assets', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const svg = fs.readFileSync(path.join(root, 'brand', 'xiaohe-logo-mark.svg'), 'utf8')
  const icon = fs.readFileSync(path.join(root, 'build', 'icon.ico'))

  assert.equal(packageJson.build.win.icon, 'build/icon.ico')
  assert.ok(packageJson.build.extraResources.some(resource => resource.from === 'build/icon.ico' && resource.to === 'brand/icon.ico'))
  assert.match(main, /process\.resourcesPath, 'brand', 'icon\.ico'/)
  assert.match(main, /'build', 'icon\.ico'/)
  assert.match(html, /\/brand\/xiaohe-app-icon\.svg/)
  assert.match(ui, /import xiaoheLogoMark from '\.\.\/brand\/xiaohe-logo-mark\.svg'/)
  assert.match(ui, /<img src=\{xiaoheLogoMark\}/)
  assert.doesNotMatch(ui, /GraduationCap/)
  assert.match(svg, /#101A4B/)
  assert.match(svg, /#4B2CFF/)
  const allowedColors = new Set(['#4B2CFF', '#6A3CFF', '#875BFF', '#101A4B', '#FBFAF7'])
  assert.ok([...svg.matchAll(/#[0-9A-F]{6}/gi)].every(match => allowedColors.has(match[0].toUpperCase())))
  assert.deepEqual([...icon.subarray(0, 4)], [0, 0, 1, 0])
  assert.ok(icon.readUInt16LE(4) >= 7)
})

test('PDF selection can be pinned into the research Agent conversation', () => {
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')

  assert.match(ui, /function addSelectionToAgent\(\)/)
  assert.match(ui, /setAgentSelection\(selection\)/)
  assert.match(ui, /onClick=\{addSelectionToAgent\}>[^<]*<MessageSquareText[^>]*\/>添加到对话<\/button>/)
  assert.match(ui, /selection: agentSelection \? \{/)
  assert.match(ui, /已添加到对话/)
  assert.match(ui, /aria-label="移除对话选区"/)
})
