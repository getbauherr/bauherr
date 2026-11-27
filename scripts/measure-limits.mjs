import { execFileSync } from 'node:child_process'

const [lines = 270, fn = 50, cx = 9, len = 120] = process.argv.slice(2).map(Number)
const rules = {
  'max-lines': ['error', { max: lines - 1, skipBlankLines: true }],
  'max-lines-per-function': ['error', { max: fn - 1, skipBlankLines: true }],
  complexity: ['error', { max: cx - 1 }],
  'max-len': ['error', { code: len }],
}
const args = ['eslint', '.', '-f', 'json', '--no-warn-ignored']
for (const [name, value] of Object.entries(rules)) args.push('--rule', `${name}: ${JSON.stringify(value)}`)
let out
try {
  out = execFileSync('pnpm', ['exec', ...args], { maxBuffer: 1 << 28, encoding: 'utf8' })
} catch (e) {
  out = e.stdout
}
const counts = {}
for (const file of JSON.parse(out)) {
  for (const m of file.messages) {
    if (!rules[m.ruleId]) continue
    const key = m.ruleId
    counts[key] = (counts[key] ?? 0) + 1
    console.log(`${key}\t${file.filePath.replace(`${process.cwd()}/`, '')}:${m.line}\t${m.message}`)
  }
}
console.log(JSON.stringify(counts))
