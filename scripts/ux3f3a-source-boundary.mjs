/** UX3F-3A: prove existing Xbox, private pilot, desktop and v2 remain untouched.
 * Hash canonical Git LF content: Windows checkout CRLF is not a source change.
 * This is an addition-only gate; it does not approve shipping live OAuth.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const expected = Object.freeze({
  'src/main/index.ts': 'f4af9d555598237bc1fd86ee70a6b96c270c568b3330edb415732cd408c5cb66',
  'src/main/hosted-signaling-bridge.mjs': '7b1bafb049d69989553bebcc4b6f87b09624fe7ff469bd9fb5a05de4245d9374',
  'src/main/ux3c3d-pilot-enrollment.mjs': '760720d3e5d793c3403d0d1f7a993753b0d3d127697dbce5833d88ba39fbb37f',
  'src/main/ux3c-signaling-client.mjs': '77ce4f90cfe4c84757326b7f49c9d5ce963aa4f8f389db0e9439dc05c9e7ca5d',
  'src/main/xbox/consoles.ts': 'f80077483a2c580281bea86bf914b73a1fc5db59c402c662303abadb0c0ef1e0',
  'src/main/xbox/xhome.ts': '6a2349a38cb07c464f6b987001ed64e5497203e1d59b543f4991fe1867351692',
  'src/preload/index.ts': 'a9a0051b835b7834ad619ea7feb0f9e775fbd62c6080a91df2f8ce009ba0d6ed',
  'src/renderer/src/env.d.ts': '0fb5b9877c444384a1a05153f88efa46e0dbd680697ae557d01c4edf35279f43',
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
console.log('PASS: UX3F-3A Xbox auth, v1 pilot, v2 broker, preload and renderer unchanged')
