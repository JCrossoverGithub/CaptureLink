/** UX3F-3B1: preserve accepted Xbox, v1 pilot, v2 broker, desktop IPC and vault.
 * UX3F-3B2 reconciles the four previously pinned Electron settings/IPC paths
 * after reviewed, isolated Auth0 and UX3F-3B3B offline main-only host wiring. The broker, Xbox,
 * vault, and pilot identities remain pinned to their original accepted hashes.
 * Git line-ending normalization avoids false positives on Windows checkout.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const files = [
  'src/main/index.ts',
  'src/preload/index.ts',
  'src/renderer/src/main.ts',
  'src/main/capturelink-online-vault.mjs',
  'src/main/hosted-signaling-bridge.mjs',
  'src/main/ux3c-signaling-client.mjs',
  'src/main/ux3c3d-pilot-enrollment.mjs',
  'src/main/xbox/xhome.ts',
  'services/signaling/src/server.mjs',
  'services/signaling/src/client.mjs',
  'services/signaling/src/public-v2-server.mjs',
  'services/signaling/src/public-authorization-policy.mjs',
]
const expected = Object.freeze({
  'src/main/index.ts': ('ce15d9dd48cf5b69cbe165530f1d2a9f' + 'e4917104d1dbb63d49391fd878b7b31b'),
  'src/preload/index.ts': 'e7d731a606d764366fbbd170b75bcc57d96f91bd4b90ef7ee0c73ee1b881eddb',
  'src/renderer/src/main.ts': 'd345ce9529fc4050b022d09ec409b29cd09e9de771b5308546a842935e20e3b8',
  'src/main/capturelink-online-vault.mjs': 'f3aad046e9031a3caf787eba6c5b57b8308debd900cba3e7773f8e64a796ce38',
  'src/main/hosted-signaling-bridge.mjs': '7b1bafb049d69989553bebcc4b6f87b09624fe7ff469bd9fb5a05de4245d9374',
  'src/main/ux3c-signaling-client.mjs': '77ce4f90cfe4c84757326b7f49c9d5ce963aa4f8f389db0e9439dc05c9e7ca5d',
  'src/main/ux3c3d-pilot-enrollment.mjs': '760720d3e5d793c3403d0d1f7a993753b0d3d127697dbce5833d88ba39fbb37f',
  'src/main/xbox/xhome.ts': '6a2349a38cb07c464f6b987001ed64e5497203e1d59b543f4991fe1867351692',
  'services/signaling/src/server.mjs': '1c85fdc44c1471d52247ea1f1aacf13da91fd9b2caa9155b4727198ad10b36a5',
  'services/signaling/src/client.mjs': '951b159e5671a04341e35872326b74e2e3825435e95e03e3038e3ba2b84364f9',
  'services/signaling/src/public-v2-server.mjs': '2b96be4f2073d9aa9075554df6840d617092eb593e756f1e6430e503cbb32e0f',
  'services/signaling/src/public-authorization-policy.mjs': '4d536af5a625f984c59643c81b5e55c6857ce5efa0ce221054114b734791ad44',
})
for (const path of files) {
  const actual = createHash('sha256')
    .update(readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex')
  if (actual !== expected[path]) {
    console.error(`FAIL: UX3F-3B1 protected source changed: ${path}`)
    process.exit(1)
  }
}
console.log('PASS: UX3F-3B1 Xbox/v1/v2/vault preserved; UX3F-3B2 Electron auth reconciliation approved')
