import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const localPackage = JSON.parse(readFileSync('package.json', 'utf8'))
const packageName = localPackage.name
const profilePackagePath = join(homedir(), '.dsh', 'profiles', 'tui', 'package.json')
const profilePackage = JSON.parse(readFileSync(profilePackagePath, 'utf8'))

profilePackage.dependencies ??= {}
delete profilePackage.dependencies['@deepseek-ai/dsh-tui']
profilePackage.dependencies[packageName] = `link:${process.cwd().replaceAll('\\', '/')}`

const profile = profilePackage.dsh?.profile
if (profile === undefined || !Array.isArray(profile.bundles)) {
  throw new Error('Expected dsh.profile.bundles in the tui profile package.json')
}

profile.bundles = profile.bundles.map((bundle) => bundle === '@deepseek-ai/dsh-tui' ? packageName : bundle)

writeFileSync(profilePackagePath, `${JSON.stringify(profilePackage, undefined, 2)}\n`)
console.log(`tui profile now uses ${packageName} from ${process.cwd()}`)
