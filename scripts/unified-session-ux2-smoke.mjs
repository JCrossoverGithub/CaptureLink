import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const source = read('src/renderer/src/unified-session-core.ts')
const js = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code
const { UnifiedSessionCoordinator, decodeUnifiedEnvelope } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

function transport(fail = '') {
  const calls = []
  const maybe = async (name, result) => {
    calls.push(name)
    if (name === fail) throw new Error('simulated failure; no raw signaling logged')
    return result
  }
  return {
    calls,
    hostController: mode => maybe(`hostController:${mode}`, 'CONTROLLER-OFFER-ABC'),
    guestController: offer => maybe('guestController', 'CONTROLLER-ANSWER-XYZ'),
    acceptController: response => maybe('acceptController'),
    stopController: () => calls.push('stopController'),
    hostVoice: () => maybe('hostVoice', 'VOICE-OFFER-ABC'),
    guestVoice: (offer, mic, playback) => maybe(`guestVoice:${mic}/${playback}`, 'VOICE-ANSWER-XYZ'),
    acceptVoice: response => maybe('acceptVoice'),
    setHostVoicePermissions: caps => calls.push(`permission:${caps.voice}/${caps.watch}`),
    stopVoice: () => calls.push('stopVoice')
  }
}

// Combined controller + voice + media, with one reply and an explicit host-only grant.
{
  const h = transport(), g = transport()
  const host = new UnifiedSessionCoordinator(h), guest = new UnifiedSessionCoordinator(g)
  const caps = { controller: true, watch: true, voice: true, controllerMode: 'shared' }
  const invite = await host.createInvitation(caps)
  assert.equal(decodeUnifiedEnvelope(invite).kind, 'invite')
  assert.deepEqual(h.calls, ['hostController:shared', 'hostVoice', 'permission:true/false'])
  const answer = await guest.joinInvitation(invite, true)
  assert.deepEqual(g.calls, ['guestController', 'guestVoice:true/false'])
  await host.acceptResponse(answer)
  assert.equal(host.snapshot().phase, 'negotiated')
  assert.ok(host.snapshot().message.includes('Wait for transport'))
  assert.deepEqual(h.calls.slice(-2), ['acceptController', 'acceptVoice'])
  assert.equal(guest.snapshot().phase, 'response-ready')
  await assert.rejects(() => host.acceptResponse(answer), /Create a host invitation first/)
}

// Controller-only needs no audio/mic path. Controller implies watching gameplay.
{
  const h = transport(), host = new UnifiedSessionCoordinator(h)
  const invite = await host.createInvitation({ controller: true, watch: true, voice: false, controllerMode: 'player2' })
  assert.deepEqual(h.calls, ['hostController:player2'])
  assert.ok(!decodeUnifiedEnvelope(invite).transports.voice)
}

// Watch-only joins silently: guest microphone capture must not be requested.
{
  const h = transport(), g = transport()
  const caps = { controller: false, watch: true, voice: false, controllerMode: 'shared' }
  const invite = await new UnifiedSessionCoordinator(h).createInvitation(caps)
  await new UnifiedSessionCoordinator(g).joinInvitation(invite, false)
  assert.deepEqual(g.calls, ['guestVoice:false/true'])
  assert.deepEqual(h.calls, ['hostVoice', 'permission:false/true'])
}

// Guest voice is opt-in; missing consent never touches transport.
{
  const h = transport(), g = transport()
  const invite = await new UnifiedSessionCoordinator(h).createInvitation({ controller: false, watch: false, voice: true, controllerMode: 'shared' })
  await assert.rejects(() => new UnifiedSessionCoordinator(g).joinInvitation(invite, false), /microphone sharing explicitly/)
  assert.deepEqual(g.calls, [])
}

// Explicit rollback on partial failure.
{
  const h = transport('hostVoice'), core = new UnifiedSessionCoordinator(h)
  await assert.rejects(() => core.createInvitation({ controller: true, watch: true, voice: true, controllerMode: 'shared' }), /simulated failure/)
  assert.equal(core.snapshot().phase, 'failed')
  assert.ok(h.calls.includes('stopController'), 'Completed controller work must roll back')
  assert.ok(!h.calls.includes('stopVoice'), 'Coordinator must not stop an unowned/failed voice transport')
}

// A response generated within the invite window must not be accepted
// after the host's 15-minute deadline. Pending transports are released.
{
  const h = transport(), g = transport()
  const host = new UnifiedSessionCoordinator(h)
  const caps = { controller: true, watch: true, voice: false, controllerMode: 'shared' }
  const realNow = Date.now
  try {
    const start = 1_700_000_000_000
    Date.now = () => start
    const invite = await host.createInvitation(caps)
    const reply = await new UnifiedSessionCoordinator(g).joinInvitation(invite, false)
    Date.now = () => start + 15 * 60_000 + 1
    await assert.rejects(() => host.acceptResponse(reply), /Invitation expired/)
    assert.equal(host.snapshot().phase, 'failed')
    assert.ok(h.calls.includes('stopController'), 'Expired session must release controller')
    assert.ok(!h.calls.includes('acceptController'), 'Expired response must never be accepted')
  } finally {
    Date.now = realNow
  }
}

// Reject other-session reply, bad invitation, unsupported/expired/malformed codes.
{
  const h1 = new UnifiedSessionCoordinator(transport())
  const h2 = new UnifiedSessionCoordinator(transport())
  const caps = { controller: true, watch: true, voice: false, controllerMode: 'shared' }
  const one = await h1.createInvitation(caps)
  const two = await h2.createInvitation(caps)
  const answer = await new UnifiedSessionCoordinator(transport()).joinInvitation(one, false)
  await assert.rejects(() => h2.acceptResponse(answer), /another session/)
  assert.throws(() => decodeUnifiedEnvelope(one, Date.now() + 20*60_000), /expired/)
  assert.throws(() => decodeUnifiedEnvelope('CAPTURELINK-SESSION-V1:@@@'), /encoding/)
  assert.throws(() => decodeUnifiedEnvelope('CAPTURELINK-SESSION-V2:abc'), /not a valid/)
  assert.throws(() => decodeUnifiedEnvelope('X'.repeat(1_000_001)), /not a valid/)
  const decoded = decodeUnifiedEnvelope(two)
  assert.equal(decoded.permissions.controller, true)
  assert.throws(() => decodeUnifiedEnvelope(one.slice(0,-1)), /corrupted|invalid|not a valid|encoding/)
}

const ux = read('src/renderer/src/unified-session-ux.ts')
const main = read('src/renderer/src/main.ts')
const voice = read('src/renderer/src/voice-sharing/voice-session.ts')
const css = read('src/renderer/src/styles.css')
const hostedUx = read('src/renderer/src/hosted-session-ux.ts')
for (const needle of [
  'coordinator: UnifiedSessionCoordinator', 'createInvitation(caps)', 'joinInvitation(', 'acceptResponse(',
  'clux2-unified-flow', 'clux2-unified-host', 'clux2-unified-guest',
  'clux2-legacy-details', 'clux2-guest-mic-consent', 'Manual fallback: exchange one private invitation and one response'
]) assert.ok(ux.includes(needle), `Unified UX missing ${needle}`)
for (const needle of ['new UnifiedSessionCoordinator(', 'createUnifiedControllerHostOffer', 'acceptUnifiedControllerGuestAnswer',
  'joinUnifiedControllerHostOffer', 'coordinator: unifiedSessionCoordinator']) assert.ok(main.includes(needle), `Main bridge missing ${needle}`)
for (const needle of ['createUnifiedHostOffer()', 'joinUnifiedHostOffer(', 'setUnifiedHostPermissions(',
  'if (allowMicrophone) {', 'context.createMediaStreamDestination()', 'session.silentGuestContext']) {
  assert.ok(voice.includes(needle), `Voice bridge missing ${needle}`)
}
assert.ok(!ux.includes('new RTCPeerConnection(') && !ux.includes('getUserMedia('), 'UI must not own the media transport')
assert.ok(css.includes('#clux2-unified-flow[hidden]'), 'Unified status hidden rules missing')
assert.ok(hostedUx.includes('manual.append(manualFlow)'), 'Manual UX2 flow must retain original DOM and listeners')
assert.ok(hostedUx.includes('Use manual invitation instead (fallback)'), 'Manual fallback must remain discoverable')
console.log('PASS: UX2 one-envelope flow, separate transport permissions, watch-only silent guest, reply binding, rollback and UI contracts')
