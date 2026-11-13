/** UX3F-3A: prove existing Xbox, private pilot, desktop and v2 remain untouched.
 * Hash canonical Git LF content: Windows checkout CRLF is not a source change.
 * UX3F-3B2 intentionally reconciled Electron main/preload/renderer/status declarations
 * for development-only Auth0 UI and UX3F-3B3B offline main-only host factory. Legacy broker and Xbox paths remain frozen.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const expected = Object.freeze({
  'src/main/index.ts': ('ce15d9dd48cf5b69cbe165530f1d2a9f' + 'e4917104d1dbb63d49391fd878b7b31b'),
  'src/main/hosted-signaling-bridge.mjs': '7b1bafb049d69989553bebcc4b6f87b09624fe7ff469bd9fb5a05de4245d9374',
  'src/main/ux3c3d-pilot-enrollment.mjs': '760720d3e5d793c3403d0d1f7a993753b0d3d127697dbce5833d88ba39fbb37f',
  'src/main/ux3c-signaling-client.mjs': '77ce4f90cfe4c84757326b7f49c9d5ce963aa4f8f389db0e9439dc05c9e7ca5d',
  'src/main/xbox/consoles.ts': 'f80077483a2c580281bea86bf914b73a1fc5db59c402c662303abadb0c0ef1e0',
  'src/main/xbox/xhome.ts': '6a2349a38cb07c464f6b987001ed64e5497203e1d59b543f4991fe1867351692',
  'src/preload/index.ts': 'e7d731a606d764366fbbd170b75bcc57d96f91bd4b90ef7ee0c73ee1b881eddb',
  'src/renderer/src/env.d.ts': '34489a45ae2dff268b6bc928cb758893f1841f7ca1172f659c2bda605a01ba01',
  'src/renderer/src/hosted-session-ux.ts': '24a0e4acf5e45c0ce1542ab9b0e69c91ec9076490409ac7ef1dab67fdda298c2',
  'src/renderer/src/unified-session-ux.ts': '129f765c65a7918a79db8488d46b32513ab69a974a4334508728b5d14bb9edad',
  'services/signaling/src/server.mjs': '1c85fdc44c1471d52247ea1f1aacf13da91fd9b2caa9155b4727198ad10b36a5',
  'services/signaling/src/client.mjs': '951b159e5671a04341e35872326b74e2e3825435e95e03e3038e3ba2b84364f9',
  'services/signaling/src/public-v2-server.mjs': '2b96be4f2073d9aa9075554df6840d617092eb593e756f1e6430e503cbb32e0f',
  'services/signaling/src/public-authorization-policy.mjs': '4d536af5a625f984c59643c81b5e55c6857ce5efa0ce221054114b734791ad44',
})
for (const [file, digest] of Object.entries(expected)) {
  const content = readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n')
  const actual = createHash('sha256').update(content).digest('hex')
  if (actual !== digest) {
    console.error(`FAIL: UX3F-3A protected source changed: ${file}`)
    process.exit(1)
  }
}
console.log('PASS: UX3F-3A Xbox/pilot/v2 preserved; UX3F-3B2 Electron auth reconciliation approved')
