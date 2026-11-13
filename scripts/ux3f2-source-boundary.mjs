/** UX3F-2: accepted offline-v2 guard. Reject changes to v1, pilot, policy, manual UX; UX3F-3B3B reconciles main-only Electron host wiring. */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expected = Object.freeze({
  'services/signaling/src/server.mjs': '1c85fdc44c1471d52247ea1f1aacf13da91fd9b2caa9155b4727198ad10b36a5',
  'services/signaling/src/client.mjs': '951b159e5671a04341e35872326b74e2e3825435e95e03e3038e3ba2b84364f9',
  'services/signaling/src/protocol.mjs': 'fab9db6887b895249d2297ad3b4cea69cbb4fef836ae46c1055f326682d6f085',
  'services/signaling/src/pilot-admission.mjs': 'ceae7e86d90536802bbb698c8fc936f88e576a1df16577aea0d7fd685ff17b14',
  'services/signaling/src/pilot-runtime.mjs': '10b24487fe0f631423b6b4612bc4fcd765105e5adff0f0644de692f2a1937ada',
  'services/signaling/src/public-authorization-policy.mjs': '4d536af5a625f984c59643c81b5e55c6857ce5efa0ce221054114b734791ad44',
  'src/main/index.ts': ('770f9cb8bc9cc2417f2489b0c1eee2bc' + 'be54007d5b0d00a3ee8b73adb41a4949'),
  'src/main/hosted-signaling-bridge.mjs': '7b1bafb049d69989553bebcc4b6f87b09624fe7ff469bd9fb5a05de4245d9374',
  'src/main/ux3c-signaling-client.mjs': '77ce4f90cfe4c84757326b7f49c9d5ce963aa4f8f389db0e9439dc05c9e7ca5d',
  'src/main/ux3c3d-pilot-enrollment.mjs': '760720d3e5d793c3403d0d1f7a993753b0d3d127697dbce5833d88ba39fbb37f',
  'src/renderer/src/hosted-session-ux.ts': '24a0e4acf5e45c0ce1542ab9b0e69c91ec9076490409ac7ef1dab67fdda298c2',
  'src/renderer/src/unified-session-ux.ts': '129f765c65a7918a79db8488d46b32513ab69a974a4334508728b5d14bb9edad',
})
for (const [file, digest] of Object.entries(expected)) {
  // Ignore checkout LF/CRLF differences, not source-content changes.
  const content = readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n')
  const actual = createHash('sha256').update(content).digest('hex')
  if (actual !== digest) {
    console.error(`FAIL: UX3F-2 protected source changed: ${file}`)
    process.exit(1)
  }
}
console.log('PASS: UX3F-2 v1/pilot/policy preserved; UX3F-3B2 auth and 3B3C2 offline IPC reconciliation approved')
