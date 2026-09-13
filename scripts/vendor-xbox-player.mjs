import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDirectory, '..')

const sourceDirectory = join(
  repoRoot,
  'third_party',
  'xbox-xcloud-player'
)

const sourceBundle = join(
  sourceDirectory,
  'xCloudPlayer.min.js'
)

const sourceMetadata = join(
  sourceDirectory,
  'SOURCE.json'
)

const destinationDirectory = join(
  repoRoot,
  'src',
  'renderer',
  'public',
  'vendor'
)

const destinationBundle = join(
  destinationDirectory,
  'xCloudPlayer.min.js'
)

if (!existsSync(sourceBundle)) {
  throw new Error(
    `Vendored xbox-xcloud-player bundle is missing: ${sourceBundle}`
  )
}

if (!existsSync(sourceMetadata)) {
  throw new Error(
    `xbox-xcloud-player metadata is missing: ${sourceMetadata}`
  )
}

const metadata = JSON.parse(
  await readFile(sourceMetadata, 'utf8')
)

const bundle = await readFile(sourceBundle)

const actualHash = createHash('sha256')
  .update(bundle)
  .digest('hex')

if (
  typeof metadata.sha256 !== 'string' ||
  metadata.sha256.toLowerCase() !== actualHash
) {
  throw new Error(
    'Vendored xbox-xcloud-player bundle does not match SOURCE.json SHA-256.'
  )
}

await mkdir(destinationDirectory, {
  recursive: true
})

await copyFile(
  sourceBundle,
  destinationBundle
)

console.log(
  `[CaptureLink] Vendored ${metadata.name}@${metadata.version}`
)

console.log(
  `[CaptureLink] Verified SHA-256: ${actualHash}`
)

console.log(
  `[CaptureLink] Player bundle: ${destinationBundle}`
)
