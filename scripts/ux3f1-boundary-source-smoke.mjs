/** Offline source-boundary audit for UX3F-1. Run at accepted a1a83ea baseline. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = text => createHash('sha256').update(text).digest('hex')

// From verified UX3F-0 SOURCE_MANIFEST.json. Source must be byte-for-byte
// identical to accepted pilot; this is deliberately stricter than a normal test.
const unchanged = Object.freeze({
  'services/signaling/src/server.mjs': '1c85fdc44c1471d52247ea1f1aacf13da91fd9b2caa9155b4727198ad10b36a5',
  'services/signaling/src/pilot-admission.mjs': 'ceae7e86d90536802bbb698c8fc936f88e576a1df16577aea0d7fd685ff17b14',
  'services/signaling/src/pilot-runtime.mjs': '10b24487fe0f631423b6b4612bc4fcd765105e5adff0f0644de692f2a1937ada',
  'services/signaling/src/client.mjs': '951b159e5671a04341e35872326b74e2e3825435e95e03e3038e3ba2b84364f9',
  'services/signaling/src/protocol.mjs': 'fab9db6887b895249d2297ad3b4cea69cbb4fef836ae46c1055f326682d6f085',
  'src/main/index.ts': 'f4af9d555598237bc1fd86ee70a6b96c270c568b3330edb415732cd408c5cb66',
  'src/main/hosted-signaling-bridge.mjs': '7b1bafb049d69989553bebcc4b6f87b09624fe7ff469bd9fb5a05de4245d9374',
  'src/main/ux3c3d-pilot-enrollment.mjs': '760720d3e5d793c3403d0d1f7a993753b0d3d127697dbce5833d88ba39fbb37f',
  'src/renderer/src/hosted-session-ux.ts': '24a0e4acf5e45c0ce1542ab9b0e69c91ec9076490409ac7ef1dab67fdda298c2',
  'src/renderer/src/unified-session-ux.ts': '129f765c65a7918a79db8488d46b32513ab69a974a4334508728b5d14bb9edad',
})

for (const [path, expected] of Object.entries(unchanged)) {
  const got = sha256(readFileSync(resolve(root, path)))
  if (got !== expected) throw new Error(`v1/manual boundary modified: ${path}`)
}
const source = readFileSync(resolve(root, 'services/signaling/src/public-authorization-policy.mjs'), 'utf8')
if (/\b(?:fetch\s*\(|https?:\/\/|createServer\s*\(|listen\s*\(|node:(?:http|https|net|tls))/.test(source)) {
  throw new Error('UX3F-1 policy may not own network transport or embed origins')
}
console.log('PASS: UX3F-1 offline module; v1 pilot, enrollment, desktop and manual UX2 source unchanged')
