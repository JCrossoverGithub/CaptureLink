/** UX3F-3B3C2: only approved dev Electron main, preload and declaration surfaces changed. */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pinned = Object.freeze({
  'src/main/index.ts': '770f9cb8bc9cc2417f2489b0c1eee2bcbe54007d5b0d00a3ee8b73adb41a4949',
  'src/preload/index.ts': 'c53caff49ec5af81d9e39c2fd7fbe7458dfa8091dd0194681675e92575055246',
  'src/renderer/src/env.d.ts': 'e1fa364b980db861edc7cd7d125192f78c6500fc1fe5090b0aeb9ec9bcf40179',
  'src/main/capturelink-online-session-bridge.mjs': '98606a5fbdba2f23111f94d2ced148547134856a9b85aeeaba5b500f37630f43',
  'src/main/capturelink-online-session-bridge.d.mts': '23e4169f25f3575fc03026d0d69e24c0f9d20ae61f7d1566f1722acd63f7ae8d',
  'src/main/capturelink-signaling-mode-arbiter.mjs': '26d8876087635e5e3ae8c979d9f1087594def04af2110d60fc9eb75600e520e5',
  'src/main/capturelink-signaling-mode-arbiter.d.mts': '3fefc3b1457cd08673b17045f3160138304843eeba597d75cf5a0354deac2660',
  'src/renderer/src/hosted-session-ux.ts': '24a0e4acf5e45c0ce1542ab9b0e69c91ec9076490409ac7ef1dab67fdda298c2',
  'src/renderer/src/main.ts': 'd345ce9529fc4050b022d09ec409b29cd09e9de771b5308546a842935e20e3b8',
  'src/main/capturelink-online-electron.mjs': '065b1f70ed2804411e7bfeb55606df63b9ba5706efbe0a410a29862c45fd05fc',
  'src/main/capturelink-online-https-session-candidate.mjs': '2b219f7764613f002adc745ec5823b93c2ac3c9b35a6555e84d4addd9c4678df',
  'src/main/capturelink-online-https-host-candidate.mjs': 'f67cb169ea465943c727d4249f0344cb92a4b0f09dfc0b45b78844d5fb571bda',
  'src/main/hosted-signaling-bridge.mjs': '7b1bafb049d69989553bebcc4b6f87b09624fe7ff469bd9fb5a05de4245d9374',
  'src/main/capturelink-online-dev-config.mjs': '239b941100adc6289990bf7c6de2b477e49104a36966abf8439ac3cdf37dcfd9',
  'src/main/ux3c-signaling-client.mjs': '77ce4f90cfe4c84757326b7f49c9d5ce963aa4f8f389db0e9439dc05c9e7ca5d',
  'services/signaling/src/public-v2-server.mjs': '2b96be4f2073d9aa9075554df6840d617092eb593e756f1e6430e503cbb32e0f',
  'services/signaling/src/public-authorization-policy.mjs': '4d536af5a625f984c59643c81b5e55c6857ce5efa0ce221054114b734791ad44',
})
for (const [path, hash] of Object.entries(pinned)) {
  const actual = createHash('sha256')
    .update(readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex')
  if (actual !== hash) throw new Error(`UX3F-3B3C2 unexpected source mutation: ${path}`)
}
const main = readFileSync(resolve(root, 'src/main/index.ts'), 'utf8')
const preload = readFileSync(resolve(root, 'src/preload/index.ts'), 'utf8')
const renderer = readFileSync(resolve(root, 'src/renderer/src/hosted-session-ux.ts'), 'utf8')
const candidate = readFileSync(resolve(root, 'src/main/capturelink-online-https-session-candidate.mjs'), 'utf8')
for (const required of [
  "!app.isPackaged && process.platform === 'win32'",
  '!app.isPackaged && !localGuestTest',
  'safeStorage.isEncryptionAvailable()',
  'authorizedHostedFrame(event)',
  "signalingMode.claim('legacy'",
  "signalingMode.claim('online'",
  'onlineSession!.authenticatedHostAdapter(accessToken)',
]) if (!main.includes(required)) throw new Error(`UX3F-3B3C2 main boundary weakened: ${required}`)
for (const required of ['onlineSessionCreate','onlineSessionJoin','onlineSessionApprove',
  'onlineSessionEnd','onlineSessionSend','onlineSessionMessages']) {
  if (!preload.includes(required) || renderer.includes(required))
    throw new Error(`UX3F-3B3C2 preload/renderer boundary weakened: ${required}`)
}
if (!candidate.includes('UX3F3B3A_TEST_ORIGIN') ||
    /\b(?:accessToken|refreshToken|clientSecret|codeVerifier|jwks)\b/.test(preload) ||
    main.includes('https://signal.capturelink.io/')) {
  throw new Error('UX3F-3B3C2 secrets, origin, or dev-only boundary weakened')
}
console.log('PASS: UX3F-3B3C2 dev-only exact-frame IPC, exclusive modes, frozen pilot/renderer/broker and .test origin')
