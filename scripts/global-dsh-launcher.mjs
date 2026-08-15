import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url))
const repo = join(scriptDirectory, '..', '..', 'deepseek-harness')
const entry = join(repo, 'apps', 'cli', 'lib', 'bin.js')
const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  windowsHide: false,
})

if (result.error !== undefined) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
