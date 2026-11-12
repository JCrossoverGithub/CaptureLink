import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const ux = read('src/renderer/src/unified-session-ux.ts')
const css = read('src/renderer/src/styles.css')
const main = read('src/renderer/src/main.ts')
const hostedUx = read('src/renderer/src/hosted-session-ux.ts')

for (const needle of [
  'Invite a friend', 'Join a friend', 'Your session',
  'id="clux2-home"', 'id="clux2-options"', 'id="clux2-setup"', 'id="clux2-session"',
  'id="clux2-watch"', 'id="clux2-voice"', 'id="clux2-controller"',
  'id="clux2-continue"', 'id="clux2-next-step"', 'id="clux2-done"',
  'id="clux1-legacy-slot"', 'role="dialog"', 'aria-modal="true"',
  'Manual fallback: exchange one private invitation and one response',
  "details.className = 'clux2-advanced'", 'moveIntoAdvanced(',
  "const flowRole", // or flow-role field declaration below
]) {
  if (needle === 'const flowRole') continue // declared with `let` for state transitions
  assert.ok(ux.includes(needle), `Missing UX1b flow contract: ${needle}`)
}
assert.ok(ux.includes("let flowRole: FlowRole = 'invite'"), 'Explicit host and guest guidance is required')
assert.ok(ux.includes('Select at least one activity.'), 'At least one capability must be selected')
assert.ok(ux.includes("original.dispatchEvent(new Event('change'"), 'Legacy recovery controller selection must reach original handler')
assert.ok(ux.includes("if (channel === 'controller' && host && !options.getState().controllerPeer)"), 'Do not rewrite mode for an active controller session')
assert.ok(ux.includes("document.body.classList.add('clux1-drawer-open')"), 'Drawer open state missing')
assert.ok(ux.includes("event.key === 'Escape'"), 'Escape-to-close missing')
assert.ok(ux.includes("event.shiftKey"), 'Keyboard focus trap missing')
assert.ok(css.includes('.clux2-page[hidden]'), 'Wizard hidden pages must be hidden')
assert.ok(css.includes('.clux1-drawer[data-clux1-role="invite"] #clux2-setup .shared-voice-role'), 'Host must not see guest microphone controls')
assert.ok(css.includes('.clux1-drawer[data-clux1-role="join"] #clux2-setup .shared-voice-role'), 'Guest must not see host microphone controls')
assert.ok(css.includes('#clux2-setup .clux2-advanced'), 'Advanced controls must remain accessible')
assert.ok(main.includes('installSharedSessionHub()') && main.includes('installUnifiedSessionUx({'), 'Preserve V1.5 implementation and mount')
for (const forbidden of ['new RTCPeerConnection', '.replaceTrack(', 'getUserMedia(', 'sendXboxControllerState(', '.getXboxStreamToken(']) {
  assert.ok(!ux.includes(forbidden), `UX layer must not take ownership of transport: ${forbidden}`)
}
assert.ok(hostedUx.includes('manual.append(manualFlow)'), 'Manual UX2 flow must retain original DOM and listeners')
assert.ok(hostedUx.includes('Use manual invitation instead (fallback)'), 'Manual fallback must remain discoverable')
console.log('PASS: UX1b Friend shell retained with UX2 unified flow, role isolation, legacy recovery, and preserved V1.5 transports')
