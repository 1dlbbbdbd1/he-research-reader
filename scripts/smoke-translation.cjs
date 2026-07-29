const path = require('node:path')
const { localTranslationStatus, translateLocally } = require('../electron/local-translation.cjs')

async function main() {
  const projectRoot = path.join(__dirname, '..')
  const options = {
    projectRoot,
    runtimeRoot: path.join(projectRoot, '.runtime', 'translation'),
    bridgeScript: path.join(projectRoot, 'scripts', 'argos-bridge.py'),
    from: 'en',
    to: 'zh',
  }
  const status = await localTranslationStatus(options)
  if (!status.available) throw new Error(status.message)
  const source = 'The experimental results demonstrate that the proposed method improves robustness under uncertain contact conditions.'
  const result = await translateLocally({ ...options, text: source })
  if (!result.text?.trim() || result.text === source) throw new Error('本地翻译没有返回有效中文结果。')
  console.log(JSON.stringify({ status, source, translation: result.text }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
