const fs = require('node:fs')
const path = require('node:path')

const SKILL_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/
const MAX_SKILL_BYTES = 64 * 1024
const skillRoot = path.resolve(__dirname, '../../skills')
const cache = new Map()

function scalar(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*["']?([^\\r\\n"']+)["']?\\s*$`, 'm'))
  return match?.[1]?.trim()
}

function parseSkillDocument(raw, expectedId) {
  const match = String(raw || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/)
  if (!match) throw new Error(`科研 Skill ${expectedId} 缺少有效 YAML frontmatter。`)
  const name = scalar(match[1], 'name')
  const description = scalar(match[1], 'description')
  const version = scalar(match[1], 'version') || scalar(match[1], 'skill-version') || '1.0.0'
  if (name !== expectedId) throw new Error(`科研 Skill 目录 ${expectedId} 与 name 不一致。`)
  if (!description) throw new Error(`科研 Skill ${expectedId} 缺少 description。`)
  const instructions = match[2].trim()
  const title = instructions.match(/^#\s+(.+)$/m)?.[1]?.trim() || name
  return { id: expectedId, name, title, description, version, instructions }
}

function loadBundledSkill(idValue) {
  const id = String(idValue || '').trim()
  if (!SKILL_ID_PATTERN.test(id)) throw new Error('科研 Skill ID 无效。')
  if (cache.has(id)) return cache.get(id)
  const directory = path.resolve(skillRoot, id)
  if (path.dirname(directory) !== skillRoot) throw new Error('科研 Skill 路径超出内置方法库。')
  const filePath = path.join(directory, 'SKILL.md')
  if (!fs.existsSync(filePath)) throw new Error(`科研 Skill ${id} 未随应用提供。`)
  const stat = fs.statSync(filePath)
  if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) throw new Error(`科研 Skill ${id} 文件无效或过大。`)
  const skill = Object.freeze(parseSkillDocument(fs.readFileSync(filePath, 'utf8'), id))
  cache.set(id, skill)
  return skill
}

function describeBundledSkill(id) {
  const skill = loadBundledSkill(id)
  return { id: skill.id, name: skill.name, title: skill.title, description: skill.description, version: skill.version }
}

const SKILL_ROUTES = Object.freeze([
  { id: 'xiaohe-experiment-intake', pattern: /实验记录|实验日志|散乱|零散笔记/i },
  { id: 'xiaohe-research-cycle', pattern: /立项|开题|导师|研究思路|找.{0,4}思路|课题规划/i },
  { id: 'xiaohe-statistics-review', pattern: /统计|显著|p\s*(值|value)|样本量|效应量|置信区间|数据分析|结果解读|因果|回归|方差|检验/i },
  { id: 'xiaohe-literature-evidence', pattern: /检索|搜索|查找|文献综述|相关文献|多文献|论文对比|文献对比|研究现状/i },
  { id: 'xiaohe-paper-evidence', pattern: /精读|读懂|阅读|总结.{0,8}(论文|文献)|论文.{0,8}总结|复现|可复现|提取.{0,8}(论文|文献)/i },
  { id: 'xiaohe-scientific-writing', pattern: /写作|论文|摘要|引言|讨论|提纲|润色|投稿|审稿回复|组会|周报|汇报|报告/i },
])

function selectBundledSkill(objective) {
  const value = String(objective || '').trim()
  return SKILL_ROUTES.find(route => route.pattern.test(value))?.id || 'xiaohe-research-design'
}

module.exports = { MAX_SKILL_BYTES, describeBundledSkill, loadBundledSkill, parseSkillDocument, selectBundledSkill, skillRoot }
