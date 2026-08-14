const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const productName = '小何的科研助手'

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

test('Windows package metadata uses the XiaoHeResearchAssistant artifact family', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.match(packageJson.build.artifactName, /^XiaoHeResearchAssistant-/)
  assert.match(packageJson.build.nsis.artifactName, /^XiaoHeResearchAssistant-Setup-/)
  assert.match(packageJson.build.portable.artifactName, /^XiaoHeResearchAssistant-Portable-/)
})

test('research cockpit is backed by optional workspace APIs and has no demo thesis', () => {
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  assert.match(ui, /function ResearchDashboard\(/)
  assert.match(ui, /getResearchWorkspace\?:/)
  assert.match(ui, /saveResearchProject\?:/)
  assert.match(ui, /saveResearchRecord\?:/)
  assert.match(ui, /recordType: ResearchRecordType/)
  assert.doesNotMatch(ui, /<h1>柔顺装配控制<\/h1>/)
  assert.doesNotMatch(ui, /论文绿/)
})

test('appearance draft drives the preview palette before settings are saved', () => {
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'src', 'functional.css'), 'utf8')
  assert.match(ui, /const previewAccent =/)
  assert.match(ui, /'--ui-accent': previewAccent\.main/)
  assert.match(ui, /'--ui-paper': previewSurface\.paper/)
  assert.match(css, /\.settings-modal > footer/)
})

test('first use requires AI setup and existing folder creation offers PDF management', () => {
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  assert.match(ui, /aiOnboardingRequired/)
  assert.match(ui, /首次使用必须保存可用的 API Key/)
  assert.match(ui, /测试只发送固定的“OK”指令，不发送研究内容/)
  assert.match(ui, /渲染界面、研究库、导出文件、README 和源码都不会得到明文密钥/)
  assert.match(ui, /MinerU 转 Markdown 在本机完成，不依赖 AI/)
  assert.match(ui, /一键管理发现的 \{existingPaperCount\} 篇 PDF/)
  assert.match(main, /existingPaperCount: existingPapers\.length/)
  assert.match(main, /manageExistingPapers/)
})

test('Research Vault v2 可在界面重建投影并通过受限 IPC 打开当前研究库', () => {
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  assert.match(ui, /重建用户可读投影/)
  assert.match(ui, /只覆盖带 \.generated 的文件/)
  assert.match(preload, /rebuildPortableVault: \(\) => ipcRenderer\.invoke\('workspace:rebuild-portable-vault'\)/)
  assert.match(preload, /openCurrentVaultFolder: \(\) => ipcRenderer\.invoke\('workspace:open-vault-folder'\)/)
  assert.match(main, /workspaceService\.rebuildVaultProjections\(\)/)
  assert.match(main, /shell\.openPath\(current\.path\)/)
})

test('持久化 Agent Planner、Memory 和逐步确认通过受限 IPC 接入真实面板', () => {
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  assert.match(ui, /这次任务的步骤/)
  assert.match(ui, /继续已确认的步骤/)
  assert.match(ui, /长期记忆/)
  assert.match(ui, /写入研究库，必须确认/)
  assert.match(preload, /proposeAgentPlan: input => ipcRenderer\.invoke\('agent:propose-plan', input\)/)
  assert.match(preload, /reviewAgentStep: input => ipcRenderer\.invoke\('agent:review-step', input\)/)
  assert.match(preload, /executeAgentPlan: input => ipcRenderer\.invoke\('agent:execute-plan', input\)/)
  assert.match(main, /researchAgentService\.reviewStep\(input\)/)
  assert.match(main, /researchAgentService\.executePlan\(input\)/)
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

test('problem feedback offers GitHub Issue and email routes through allowed external links', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')

  assert.match(ui, /问题反馈/)
  assert.match(ui, /https:\/\/github\.com\/1dlbbbdbd1\/he-research-reader\/issues\/new\/choose/)
  assert.match(ui, /mailto:hzh1144@163\.com/)
  assert.match(ui, /提交前请移除论文原文、API 密钥、私人路径等敏感信息/)
  assert.match(main, /url\.protocol === 'https:' \|\| url\.protocol === 'mailto:'/)
  assert.match(main, /if \(isAllowedExternalUrl\(url\)\) void shell\.openExternal\(url\)/)
})

test('GB/T 引用使用受限剪贴板 IPC，并在导入结果、资料库和阅读器复用同一控件', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8')
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const controls = fs.readFileSync(path.join(root, 'src', 'features', 'citations', 'CitationControls.tsx'), 'utf8')

  assert.match(main, /ipcMain\.handle\('clipboard:write-text'/)
  assert.match(preload, /writeClipboardText: input => ipcRenderer\.invoke\('clipboard:write-text', input\)/)
  assert.match(ui, /<CitationImportPanel/)
  assert.ok((ui.match(/<CitationButton/g) || []).length >= 2)
  assert.match(controls, /下方文本可直接选中并手动复制/)
  assert.match(controls, /已按现有确认字段降级生成，没有补造缺失信息/)
})

test('结构化阅读器通过最小 IPC 追加版本，并提供原始 MD、人工调整和恢复入口', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8')
  const ui = fs.readFileSync(path.join(root, 'src', 'features', 'reader', 'VersionedStructuredReading.tsx'), 'utf8')

  for (const channel of ['structured-reading:get', 'structured-reading:generate', 'structured-reading:save-adjustment', 'structured-reading:restore']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`))
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`))
  }
  assert.match(ui, />整理稿</)
  assert.match(ui, />原始 MD</)
  assert.match(ui, /调整结构/)
  assert.match(ui, /恢复此版/)
  assert.match(ui, /保存会创建新版本；不会修改原始 Markdown/)
})

test('今日科研通过受限现场 IPC 恢复五项真实上下文，并保留课题工作面为二级入口', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8')
  const app = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const today = fs.readFileSync(path.join(root, 'src', 'TodayResearch.tsx'), 'utf8')
  const resume = fs.readFileSync(path.join(root, 'src', 'research-resume.mjs'), 'utf8')

  for (const channel of ['research-resume:get', 'research-resume:begin', 'research-resume:save']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`))
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`))
  }
  assert.match(app, /title: '今日科研'/)
  assert.match(app, /title: '课题与实验'/)
  assert.match(app, /label="科研工作区"/)
  assert.match(app, /active === 'research-workspace'/)
  assert.equal((today.match(/data-today-answer=/g) || []).length, 5)
  assert.match(today, /继续上次工作/)
  assert.match(today, /记录进展\/问题/)
  assert.match(today, /查看今日研究任务/)
  assert.match(today, /formatResearchAbsence\(resume\.previousActiveAt\)/)
  assert.match(resume, /终于回来了/)
})

test('统一科研任务复用旧来源，并通过人工确认、回写和历史入口形成完整闭环', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8')
  const app = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const tasks = fs.readFileSync(path.join(root, 'src', 'ResearchTasks.tsx'), 'utf8')

  for (const channel of ['research-task:list', 'research-task:create', 'research-task:update']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`))
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`))
  }
  assert.match(app, /title: '研究任务'/)
  assert.match(app, /onCreateTaskFromAnnotation/)
  assert.match(tasks, /完成并回写来源/)
  assert.equal((tasks.match(/value: '(today|inbox|waiting|deferred|later|completed|abandoned)'/g) || []).length, 7)
  assert.match(tasks, /AI 建议确认前不是正式任务/)
  assert.match(tasks, /确认进入任务/)
  assert.match(tasks, /返回来源/)
  assert.match(tasks, /变更历史/)
  assert.match(tasks, /没有结果.*方向不匹配.*暂时放弃/)
})

test('翻译阅读在阅读器内提供跨页范围、引擎边界、修正文、锁定、术语和单段重试', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8')
  const app = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const bilingual = fs.readFileSync(path.join(root, 'src', 'BilingualDocument.tsx'), 'utf8')

  for (const channel of ['reading-translation-cache:get', 'reading-translation-cache:save', 'reading-translation-terms:list', 'reading-translation-terms:save', 'reading-translation-terms:delete']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`))
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`))
  }
  assert.match(app, /prepareTranslationSelection/)
  assert.match(app, /跨页 p\./)
  assert.match(app, /确认发送当前选区/)
  assert.match(app, /Provider：/)
  assert.match(bilingual, /本地 Argos/)
  assert.match(bilingual, /云端 AI/)
  assert.match(bilingual, /只看原文/)
  assert.match(bilingual, /只看译文/)
  assert.match(bilingual, /修正提取文本/)
  assert.match(bilingual, /锁定译文/)
  assert.match(bilingual, /单独重试/)
  assert.match(bilingual, /当前文献术语表/)
  assert.match(bilingual, /PDF 与 MinerU 原始 Markdown 未被修改/)
  assert.match(bilingual, /getStructuredReading/)
  assert.match(bilingual, /structuredBlocksToBilingualMarkdown/)
  assert.match(bilingual, /翻译顺序来自/)
})

test('派生阅读视图隔离崩溃、限制长文首屏渲染并保留可恢复操作', () => {
  const boundary = fs.readFileSync(path.join(root, 'src', 'features', 'reader', 'ReaderViewBoundary.tsx'), 'utf8')
  const structured = fs.readFileSync(path.join(root, 'src', 'features', 'reader', 'VersionedStructuredReading.tsx'), 'utf8')
  const readerCss = fs.readFileSync(path.join(root, 'src', 'reader.css'), 'utf8')
  const structuredCss = fs.readFileSync(path.join(root, 'src', 'structured-reading.css'), 'utf8')

  assert.match(boundary, /getDerivedStateFromError/)
  assert.match(boundary, /componentDidCatch/)
  assert.match(boundary, /重试当前视图/)
  assert.match(boundary, /返回 PDF 原文/)
  assert.match(structured, /STRUCTURED_RENDER_CHUNK = 80/)
  assert.match(structured, /IntersectionObserver/)
  assert.match(readerCss, /\.bilingual-reader\s*\{[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*auto;/)
  assert.match(structuredCss, /\.versioned-structured-reader\s*\{[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*auto;/)
})

test('版面对照使用可访问的可调面板、默认收起目录并提供单侧专注', () => {
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const structured = fs.readFileSync(path.join(root, 'src', 'features', 'reader', 'VersionedStructuredReading.tsx'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'src', 'reader.css'), 'utf8')

  assert.match(ui, /react-resizable-panels/)
  assert.match(ui, /<ResizableSeparator/)
  assert.match(ui, /resizeTargetMinimumSize=\{\{ fine: 18, coarse: 32 \}\}/)
  assert.match(ui, /reader-parallel-layout-v1/)
  assert.match(ui, />专注 PDF</)
  assert.match(ui, />专注整理稿</)
  assert.match(ui, /parallelOutlineOpen \? '隐藏目录' : '显示目录'/)
  assert.match(structured, /presentation = 'full'/)
  assert.match(structured, /showToc && current\.toc\.length/)
  assert.match(css, /\.reader-parallel-divider/)
  assert.match(css, /\.reader-parallel-toolbar/)
})

test('界面缩放使用语义字号而非 CSS zoom，样式表不再声明 13px 以下正文', () => {
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const cssFiles = fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.css'))
  const microType = []
  for (const name of cssFiles) {
    const css = fs.readFileSync(path.join(root, 'src', name), 'utf8')
    for (const match of css.matchAll(/font-size:\s*([0-9.]+)px/g)) {
      if (Number(match[1]) < 13) microType.push(`${name}:${match[0]}`)
    }
    for (const match of css.matchAll(/font:\s*(?:[1-9]00\s+)?([0-9.]+)px(?=[/\s])/g)) {
      if (Number(match[1]) < 13) microType.push(`${name}:${match[0]}`)
    }
  }

  assert.doesNotMatch(ui, /zoom:\s*effectiveUIScale/)
  assert.match(ui, /'--ui-text-xs': scaledText\(13\)/)
  assert.match(ui, /'--ui-control-min-height'/)
  assert.deepEqual(microType, [])
})

test('空课题与空复盘使用内容收敛布局，不再生成固定高度的长短空框', () => {
  const commandCenter = fs.readFileSync(path.join(root, 'src', 'ResearchCommandCenter.tsx'), 'utf8')
  const review = fs.readFileSync(path.join(root, 'src', 'ResearchReviewWorkspace.tsx'), 'utf8')
  const functionalCss = fs.readFileSync(path.join(root, 'src', 'functional.css'), 'utf8')
  const reviewCss = fs.readFileSync(path.join(root, 'src', 'research-review.css'), 'utf8')

  assert.match(commandCenter, /research-command-grid \$\{milestones\.length \? 'has-milestones' : 'is-empty'\}/)
  assert.match(functionalCss, /\.research-command-grid\.is-empty\s*\{\s*grid-template-columns:\s*1fr;/)
  assert.match(functionalCss, /\.research-command-grid\.is-empty \.research-next-panel\s*\{[^}]*grid-template-columns:\s*repeat\(2,/)
  assert.match(functionalCss, /\.research-command-grid\.is-empty \.research-guided-empty\s*\{[^}]*min-height:\s*0;/)

  assert.match(review, /research-output-grid \$\{reports\.length \? 'has-items' : 'is-empty'\}/)
  assert.match(reviewCss, /\.research-output-grid\.is-empty\s*\{\s*grid-template-columns:\s*1fr;/)
  assert.match(reviewCss, /\.research-output-grid\.is-empty \.research-output-list\s*\{[^}]*grid-template-columns:/)
  assert.doesNotMatch(reviewCss, /\.research-output-list, \.research-report-studio, \.research-claim-studio\s*\{[^}]*min-height:\s*600px;/)
  assert.match(reviewCss, /\.research-report-placeholder\s*\{\s*min-height:\s*280px;/)
})

test('Zotero 增量边界和四类可迁移 Markdown 通过最小 IPC 接入真实页面', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8')
  const app = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const commandCenter = fs.readFileSync(path.join(root, 'src', 'ResearchCommandCenter.tsx'), 'utf8')
  const reports = fs.readFileSync(path.join(root, 'src', 'ResearchReviewWorkspace.tsx'), 'utf8')

  for (const channel of ['zotero-sync:capabilities', 'zotero-sync:preview', 'zotero-sync:apply', 'portable-markdown:export', 'review:confirm']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`))
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`))
  }
  assert.match(main, /properties: \['openDirectory', 'createDirectory'\]/)
  assert.match(app, /kind: 'reading_card'/)
  assert.match(app, /exportPortableMarkdown\('review_document'/)
  assert.match(app, /exportPortableMarkdown\('experiment_retrospective'/)
  assert.match(app, /exportPortableMarkdown\('research_report'/)
  assert.match(app, /人工确认/)
  assert.match(app, /可迁移 Markdown/)
  assert.match(commandCenter, /导出复盘/)
  assert.match(reports, /可迁移 Markdown/)
})

test('弹窗统一支持 Escape、Tab 焦点圈和焦点恢复，阅读器不再被 620px 高度截断', () => {
  const keyboard = fs.readFileSync(path.join(root, 'src', 'use-dialog-keyboard.ts'), 'utf8')
  const today = fs.readFileSync(path.join(root, 'src', 'TodayResearch.tsx'), 'utf8')
  const commandCenter = fs.readFileSync(path.join(root, 'src', 'ResearchCommandCenter.tsx'), 'utf8')
  const tasks = fs.readFileSync(path.join(root, 'src', 'ResearchTasks.tsx'), 'utf8')
  const citations = fs.readFileSync(path.join(root, 'src', 'features', 'citations', 'CitationControls.tsx'), 'utf8')
  const readerCss = fs.readFileSync(path.join(root, 'src', 'reader.css'), 'utf8')

  assert.match(keyboard, /event\.key === 'Escape'/)
  assert.match(keyboard, /event\.key !== 'Tab'/)
  assert.match(keyboard, /last\.focus\(\)/)
  assert.match(keyboard, /previousFocusRef\.current\?\.focus\(\)/)
  for (const source of [today, commandCenter, tasks, citations]) {
    assert.match(source, /useDialogKeyboard/)
  }
  assert.doesNotMatch(readerCss, /max-height:\s*min\(620px,\s*calc\(100vh/)
  assert.match(readerCss, /\.research-reader\s*\{[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*0;/)
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

test('Windows package includes Word, translation PDF and causal Python executors', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  for (const file of ['office-word-workflow.ps1', 'office-translation-export.ps1', 'causal-analysis.py']) {
    const resource = packageJson.build.extraResources.find(item => item.from === `scripts/${file}`)
    assert.deepEqual(resource, { from: `scripts/${file}`, to: `scripts/${file}` })
    assert.ok(fs.existsSync(path.join(root, resource.from)))
  }
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

test('知识图谱与 Evidence Card 通过受限 IPC 接入可复核工作区', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8')
  const app = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const workspace = fs.readFileSync(path.join(root, 'src', 'KnowledgeGraphWorkspace.tsx'), 'utf8')

  for (const channel of ['knowledge:get-graph', 'knowledge:review-edge', 'evidence-card:list', 'evidence-card:update']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`))
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`))
  }
  assert.match(app, /title: '知识图谱'/)
  assert.match(app, /<KnowledgeGraphWorkspace/)
  assert.match(workspace, /Evidence Card/)
  assert.match(workspace, /AI 建议/)
  assert.match(workspace, /确认/)
  assert.match(workspace, /拒绝/)
  assert.match(workspace, /原文（只读）/)
})

test('插件、主题与 LaTeX 高级路线在设置和写作页面拥有真实能力门', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8')
  const app = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const review = fs.readFileSync(path.join(root, 'src', 'ResearchReviewWorkspace.tsx'), 'utf8')
  const theme = fs.readFileSync(path.join(root, 'src', 'theme.css'), 'utf8')

  assert.ok(packageJson.build.files.includes('plugins/**/*'))
  for (const channel of ['plugin:list', 'plugin:install', 'plugin:uninstall', 'review:export-latex']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`))
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`))
  }
  assert.match(main, /requireCapability\('latex', 'writing\.latex-package'/)
  assert.match(app, /可信内置插件/)
  assert.match(app, /plugin\.installed \? '卸载' : '安装'/)
  assert.match(app, /明暗主题/)
  assert.match(app, /\['light', 'Light Theme'\]/)
  assert.match(app, /\['dark', 'Dark Theme'\]/)
  assert.match(app, /LaTeX \/ PDF/)
  assert.match(theme, /\.app-shell\[data-theme='dark'\]/)
})

test('迁移快照校验与显式回滚入口作为正式产品资料交付', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const script = fs.readFileSync(path.join(root, 'scripts', 'restore-migration-backup.ps1'), 'utf8')
  const guide = fs.readFileSync(path.join(root, 'docs', 'migration', 'v1-rollback.md'), 'utf8')

  assert.match(app, /升级前恢复快照/)
  assert.match(app, /SHA-256/)
  assert.match(script, /\[switch\]\$Force/)
  assert.match(script, /FileShare\]::None/)
  assert.match(script, /rollback-rescue/)
  assert.match(guide, /restore-migration-backup\.ps1/)
  assert.match(guide, /-Force/)
})

test('Agent 对话拥有完整科研工作流库、模型选择和按需项目预览', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'src', 'workbench.css'), 'utf8')
  const workflows = fs.readFileSync(path.join(root, 'electron', 'workbench', 'conversation-workflows.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8')

  assert.match(css, /\.workbench-page\{[^}]*height:100%;[^}]*min-height:0;[^}]*overflow-x:hidden;[^}]*overflow-y:auto;/)
  assert.match(css, /\.workbench-page::\-webkit-scrollbar/)
  assert.match(css, /\.agent-chat-page\{/)
  assert.match(css, /\.agent-composer\{/)
  assert.match(css, /\.project-drawer-backdrop\{/)
  for (const workflow of ['查找相应的文献', '文献分析总结', '实验方法指定总结', '实验技能教学']) assert.match(workflows, new RegExp(workflow))
  for (const workflow of ['研究问题与假设梳理', '实验方案设计', '多文献对比矩阵', '可复现性检查', '数据分析方案', '论文提纲与写作计划', '组会汇报与阶段复盘', '结果解读与讨论']) assert.match(workflows, new RegExp(workflow))
  assert.match(app, /listWorkbenchConversationWorkflows/)
  assert.match(app, /科研工作流库/)
  assert.match(app, /专项执行/)
  assert.match(app, /CapabilityWorkflowFields/)
  assert.match(app, /全部科研流程仍可从对话框的工作流库随时使用/)
  assert.match(app, /项目记忆/)
  assert.match(app, /aria-label="选择模型"/)
  assert.match(app, /listAgentSessions/)
  assert.match(app, /listWorkbenchProjectFiles/)
  assert.match(app, /discoverWorkspacePdfSources/)
  assert.match(app, /扫描项目 PDF/)
  assert.match(app, /原文件不会被移动或修改/)
  assert.match(main, /workspace:discover-project-pdfs/)
  assert.match(preload, /workspace:discover-project-pdfs/)
})
