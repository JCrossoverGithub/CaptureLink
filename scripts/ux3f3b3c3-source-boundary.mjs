/** UX3F-3B3C3: renderer-only test selector, no new main trust surface. */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pins = Object.freeze({
  "services/signaling/src/public-v2-server.mjs": "2b96be4f2073d9aa9075554df6840d617092eb593e756f1e6430e503cbb32e0f",
  "src/main/capturelink-online-electron.mjs": "065b1f70ed2804411e7bfeb55606df63b9ba5706efbe0a410a29862c45fd05fc",
  "src/main/capturelink-online-https-host-candidate.mjs": "f67cb169ea465943c727d4249f0344cb92a4b0f09dfc0b45b78844d5fb571bda",
  "src/main/capturelink-online-https-session-candidate.mjs": "2b219f7764613f002adc745ec5823b93c2ac3c9b35a6555e84d4addd9c4678df",
  "src/main/capturelink-online-session-bridge.mjs": "98606a5fbdba2f23111f94d2ced148547134856a9b85aeeaba5b500f37630f43",
  "src/main/capturelink-signaling-mode-arbiter.mjs": "26d8876087635e5e3ae8c979d9f1087594def04af2110d60fc9eb75600e520e5",
  "src/main/hosted-signaling-bridge.mjs": "7b1bafb049d69989553bebcc4b6f87b09624fe7ff469bd9fb5a05de4245d9374",
  "src/main/index.ts": "770f9cb8bc9cc2417f2489b0c1eee2bcbe54007d5b0d00a3ee8b73adb41a4949",
  "src/preload/index.ts": "c53caff49ec5af81d9e39c2fd7fbe7458dfa8091dd0194681675e92575055246",
  "src/renderer/src/env.d.ts": "e1fa364b980db861edc7cd7d125192f78c6500fc1fe5090b0aeb9ec9bcf40179",
  "src/renderer/src/hosted-session-ux.ts": "d7fe1af1215921a938418999cf8994af583783e39031e4f8b5d0abfa59a609d1",
  "src/renderer/src/main.ts": "d345ce9529fc4050b022d09ec409b29cd09e9de771b5308546a842935e20e3b8",
  "src/renderer/src/renderer-signaling-mode-gate.d.mts": "0c76dc70269a27eb14cb0606f406080c8c9cbe03b57f6669761d8cd050e95e23",
  "src/renderer/src/renderer-signaling-mode-gate.mjs": "f6b0bfe41ed8c526c161b2947ece2eaa9260ba6b416acbb11fc14087a56b40a4",
  "src/renderer/src/unified-session-core.ts": "200d955912b1ced79b6f46203cf3467601e091290d415241272d685f689126dd",
  "src/renderer/src/unified-session-ux.ts": "129f765c65a7918a79db8488d46b32513ab69a974a4334508728b5d14bb9edad"
})
for (const [name, hash] of Object.entries(pins)) {
  const file = readFileSync(resolve(root, name), 'utf8').replace(/\r\n/g, '\n')
  if (createHash('sha256').update(file).digest('hex') !== hash) {
    throw new Error(`STOP: UX3F-3B3C3 protected source changed: ${name}`)
  }
}
const hosted = readFileSync(resolve(root, 'src/renderer/src/hosted-session-ux.ts'), 'utf8')
const main = readFileSync(resolve(root, 'src/main/index.ts'), 'utf8')
const preload = readFileSync(resolve(root, 'src/preload/index.ts'), 'utf8')
const candidate = readFileSync(resolve(root, 'src/main/capturelink-online-https-session-candidate.mjs'), 'utf8')
const gate = readFileSync(resolve(root, 'src/renderer/src/renderer-signaling-mode-gate.mjs'), 'utf8')
const unified = readFileSync(resolve(root, 'src/renderer/src/unified-session-ux.ts'), 'utf8')
for (const required of [
  'modeArea.hidden = !status.enabled',
  'onlineSessionStatus()',
  'const gate = createRendererSignalingModeGate(legacyBackend, onlineBackend)',
  'const closingBackend = gate.release()',
  'const stoppedLocally = resetTransports()',
  'const failedBackend = gate.release()',
  'gate.begin()',
  "manual.append(manualFlow)",
  'name was entered by the guest and has NOT been verified',
  'coordinator.joinInvitation(wire, guestMicConsent)',
  'coordinator.acceptResponse(answer.payload)',
  'No public endpoint is available.',
]) if (!hosted.includes(required)) throw new Error(`STOP: renderer boundary missing: ${required}`)
for (const required of ['hostedCreate(', 'hostedJoin(', 'hostedEnd(',
  'onlineSessionCreate(', 'onlineSessionJoin(', 'onlineSessionEnd(']) {
  if (!hosted.includes(required)) throw new Error(`STOP: signaling adapter missing ${required}`)
}
if (hosted.indexOf('const stoppedLocally = resetTransports()') > hosted.indexOf('try { await closingBackend?.end()')) {
  throw new Error('STOP: transport cleanup must precede network closure')
}
for (const required of ["current = selected", "if (current ||", "onlineAllowed", "current = null", "selected = 'legacy'"]) {
  if (!gate.includes(required)) throw new Error(`STOP: mode selection unsafe: ${required}`)
}
if (!main.includes("!app.isPackaged && process.platform === 'win32'") ||
    !main.includes('authorizedHostedFrame(event)') ||
    !main.includes("signalingMode.claim('online'") ||
    !main.includes("signalingMode.claim('legacy'") ||
    !candidate.includes('UX3F3B3A_TEST_ORIGIN') ||
    main.includes('https://signal.capturelink.io/') ||
    !unified.includes('confirmDialog.showModal()') ||
    !unified.includes('await hostedUx.end()') ||
    /\b(?:accessToken|refreshToken|clientSecret|codeVerifier|jwks)\b/.test(preload + hosted)) {
  throw new Error('STOP: protected main IPC, authentication, UI or test origin weakened')
}
console.log('PASS: UX3F-3B3C3 renderer-only explicit development mode, local-first end, Auth0 and .test boundaries pinned')
