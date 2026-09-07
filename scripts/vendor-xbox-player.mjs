import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDirectory, '..')
const defaultSource = resolve(repoRoot, '..', 'XboxLink', '.reference', 'xbox-xcloud-player')
const sourceRoot = resolve(process.env.CAPTURELINK_XBOX_PLAYER_SOURCE || defaultSource)
const sourceBundle = join(sourceRoot, 'dist', 'assets', 'xCloudPlayer.min.js')
const sourcePackage = join(sourceRoot, 'package.json')
const destinationDirectory = join(repoRoot, 'src', 'renderer', 'public', 'vendor')
const destinationBundle = join(destinationDirectory, 'xCloudPlayer.min.js')
const noticePath = join(repoRoot, 'third_party', 'xbox-xcloud-player', 'SOURCE.json')

if (!existsSync(sourceBundle)) {
  throw new Error(
    `Known-good xbox-xcloud-player bundle not found at ${sourceBundle}. ` +
    'Build the preserved XboxLink reference first, or set CAPTURELINK_XBOX_PLAYER_SOURCE.'
  )
}

if (!existsSync(sourcePackage)) {
  throw new Error(`xbox-xcloud-player package metadata not found at ${sourcePackage}`)
}

const packageJson = JSON.parse(await readFile(sourcePackage, 'utf8'))

await mkdir(destinationDirectory, { recursive: true })
await mkdir(dirname(noticePath), { recursive: true })
await copyFile(sourceBundle, destinationBundle)

await writeFile(
  noticePath,
  `${JSON.stringify({
    name: packageJson.name,
    version: packageJson.version,
    license: packageJson.license,
    repository: packageJson.repository,
    sourcePath: sourceRoot,
    generatedAt: new Date().toISOString()
  }, null, 2)}\n`
)

console.log(`[CaptureLink] Vendored ${packageJson.name}@${packageJson.version}`)
console.log(`[CaptureLink] Player bundle: ${destinationBundle}`)
