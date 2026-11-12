import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const ux = read('src/renderer/src/unified-session-ux.ts')
const main = read('src/renderer/src/main.ts')
const css = read('src/renderer/src/styles.css')

for (const needle of [
  'Play on my Xbox', 'Join a friend', 'Invite friend',
  "overlay.id = 'clux1-drawer-overlay'", 'role="dialog"', 'aria-modal="true"',
  'event.key === \'Escape\'', 'event.key !== \'Tab\'',
  'legacySlot.append(hub)',
  'extras.append(rail)'
]) assert.ok(ux.includes(needle), `Missing UX1a contract: ${needle}`)

assert.ok(main.includes('installUnifiedSessionUx({'), 'Missing UX1a integration')
assert.ok(main.includes('unifiedSessionUx?.refresh()'), 'Missing session status refresh')
assert.ok(css.includes('.clux1-drawer-overlay[hidden]'), 'Drawer hidden state must be enforced')
assert.ok(css.includes('capturelink-friend-session'), 'Friend video aspect-ratio preservation missing')
assert.ok(css.includes('capturelink-native-fullscreen'), 'Fullscreen protection missing')
for (const banned of ['new RTCPeerConnection', '.replaceTrack(', 'getUserMedia(', '.getXboxStreamToken(', 'sendXboxControllerState(']) {
  assert.ok(!ux.includes(banned), `UX module must not own transport or microphone: ${banned}`)
}
console.log('PASS: UX1a entry actions, drawer accessibility, existing V1.5 DOM reuse, transport boundaries, fullscreen and friend video CSS')
