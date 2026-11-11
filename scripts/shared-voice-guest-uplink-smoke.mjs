// Narrow source-derived harness for the Xbox guest-only transport. Offline only:
// tests permission-side effects and lifecycle, NOT Xbox SDP compatibility.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'

const main = readFileSync(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8')
const start = main.indexOf('async function ensureGuestXboxUplink(): Promise<boolean> {')
const end = main.indexOf('// Voice sharing uses the already-negotiated Xbox sender.', start)
assert.ok(start > 0 && end > start, 'guest-only transport functions must exist')
const functions = main.slice(start, end)
const js = transformSync(functions, { loader: 'ts', format: 'cjs', target: 'es2022' }).code

function runScenario() {
  let physicalCaptureCount = 0
  let stopCount = 0
  let negotiationCount = 0
  let releasedCount = 0
  const mixed = { kind: 'audio', id: 'mixed', readyState: 'live' }
  const physical = { kind: 'audio', id: 'physical', readyState: 'live', stop() { this.readyState = 'ended' } }
  const sender = { track: null, async replaceTrack(track) { this.track = track } }
  const player = {
    _channels: { chat: {
      _micStream: null,
      stopMicrophone() { stopCount++; this._micStream?.getTracks().forEach(track => track.stop()); this._micStream = null; sender.track = null }
    } },
    _peerConnection: { addTrack(track) { sender.track = track; return sender } },
    async createOffer() { return { sdp: 'fake-sdp-offer' } },
    setRemoteOffer(answer) { assert.equal(answer, 'fake-sdp-answer'); negotiationCount++ }
  }
  let contexts = []
  class FakeAudioContext {
    state = 'suspended'
    constructor() { contexts.push(this) }
    createMediaStreamDestination() {
      const track = { kind: 'audio', readyState: 'live', id: 'synthetic', stop() { this.readyState = 'ended' } }
      return { stream: { active: true, getTracks: () => [track], getAudioTracks: () => [track] } }
    }
    createGain() { return { gain: { value: 1 }, connect(node) { return node } } }
    createConstantSource() { return { offset: { value: 0 }, connect(node) { return node }, start() {}, stop() {} } }
    async resume() { this.state = 'running' }
    async close() { this.state = 'closed'; releasedCount++ }
  }
  const ctx = {
    AudioContext: FakeAudioContext,
    console: { warn() {} }, setTimeout, clearTimeout,
    activePlayer: player, webRtcConnected: true, microphoneActive: false,
    microphonePending: false, guestVoicePending: false, guestVoiceGeneration: 0,
    guestVoiceTransport: null, hostCaptureStream: null, sharedVoiceXboxUplink: null,
    sharedVoice: { onXboxMicrophoneStarted() {} },
    window: { captureLink: { async exchangeXboxChatSdp(sdp) { assert.equal(sdp, 'fake-sdp-offer'); return { sdp: 'fake-sdp-answer' } } } },
    stopMicrophone() { stopCount++ },
    navigator: { mediaDevices: { getUserMedia() { physicalCaptureCount++; throw new Error('physical host mic MUST NOT open') } } },
  }
  // Declarations are global context slots: simulates exactly the functions' existing bindings.
  runInNewContext(js + '\nthis.ensure = ensureGuestXboxUplink; this.release = releaseGuestXboxUplink;', ctx)
  const sandbox = ctx
  return { ctx, sandbox, player, sender, physical, contexts, stats: () => ({ stopCount, negotiationCount, physicalCaptureCount, releasedCount }) }
}
const a = runScenario()
assert.equal(await a.sandbox.ensure(), true)
assert.equal(a.stats().physicalCaptureCount, 0, 'host capture never requested for guest-only transport')
assert.equal(a.ctx.microphoneActive, false, 'host mic state remains off')
assert.equal(a.ctx.guestVoiceTransport.track.id, 'synthetic')
assert.equal(a.sender.track.id, 'synthetic')
assert.equal(a.stats().negotiationCount, 1)
assert.equal(await a.sandbox.ensure(), true, 'repeated activation reuses current Xbox transport')
assert.equal(a.stats().negotiationCount, 1)
// Guest stream is mixed by the voice controller. Release shuts down the silent transport.
a.sender.track = { kind: 'audio', id: 'mixed', readyState: 'live' }
await a.sandbox.release()
assert.equal(a.ctx.guestVoiceTransport, null)
assert.equal(a.stats().stopCount, 1)
assert.equal(a.stats().releasedCount, 1)
assert.equal(a.sender.track, null)
// When the host mic was subsequently enabled, restore it without closing its capture.
const b = runScenario()
await b.sandbox.ensure()
b.ctx.microphoneActive = true
b.ctx.hostCaptureStream = { getAudioTracks: () => [b.physical], getTracks: () => [b.physical] }
b.sender.track = { kind: 'audio', id: 'mixed', readyState: 'live' }
await b.sandbox.release()
assert.equal(b.sender.track, b.physical)
assert.equal(b.player._channels.chat._micStream, b.ctx.hostCaptureStream)
assert.equal(b.stats().stopCount, 0)
assert.equal(b.stats().releasedCount, 1)
// A host microphone re-enabled during an ordinary (non-synthetic) guest mix is
// recovered when the guest leaves, even if the original audio track ended.
const c = runScenario()
c.ctx.microphoneActive = true
c.ctx.hostCaptureStream = { getAudioTracks: () => [c.physical], getTracks: () => [c.physical] }
c.ctx.sharedVoiceXboxUplink = { player: c.player, sender: c.sender, track: { readyState: 'ended' } }
await c.sandbox.release()
assert.equal(c.sender.track, c.physical)
assert.equal(c.player._channels.chat._micStream, c.ctx.hostCaptureStream)
assert.equal(c.stats().stopCount, 0)
console.log('PASS: synthetic Xbox microphone, no host device permission, single negotiation, guest-only teardown, host restoration (synthetic and ordinary uplinks)')
