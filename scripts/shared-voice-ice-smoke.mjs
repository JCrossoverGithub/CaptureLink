// Self-contained offline smoke tests for copy/paste ICE snapshot handling.
// Run via Windows: node scripts/shared-voice-ice-smoke.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'

const source = readFileSync(new URL('../src/renderer/src/voice-sharing/ice-gathering.ts', import.meta.url), 'utf8')
const compiled = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
const mod = { exports: {} }
runInNewContext(compiled, { module: mod, exports: mod.exports, setTimeout, clearTimeout })
const { gatherVoiceIceSnapshot, voiceIceCandidateTypes } = mod.exports

const host = 'a=candidate:1 1 udp 123 192.168.1.2 51000 typ host generation 0\r\n'
const srflx = 'a=candidate:2 1 udp 123 203.0.113.10 52000 typ srflx raddr 192.168.1.2 rport 51000\r\n'
const base = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'
class FakePeer extends EventTarget {
  constructor(sdp, state = 'gathering') {
    super()
    this.localDescription = { sdp }
    this.iceGatheringState = state
    this.signalingState = 'stable'
  }
  fire(type) { this.dispatchEvent(new Event(type)) }
}
assert.deepEqual(Array.from(voiceIceCandidateTypes(base + host + srflx)), ['host', 'srflx'])
{
  const peer = new FakePeer(base + host, 'complete')
  const value = await gatherVoiceIceSnapshot(peer, { minWaitMs: 5, maxWaitMs: 30 })
  assert.equal(value.partial, false)
  assert.deepEqual(Array.from(value.candidateTypes), ['host'])
}
{
  const peer = new FakePeer(base + host)
  const value = await gatherVoiceIceSnapshot(peer, { minWaitMs: 10, maxWaitMs: 35 })
  assert.equal(value.partial, true)
  assert.deepEqual(Array.from(value.candidateTypes), ['host'])
}
{
  const peer = new FakePeer(base + host)
  const work = gatherVoiceIceSnapshot(peer, { minWaitMs: 20, maxWaitMs: 100 })
  setTimeout(() => { peer.localDescription.sdp += srflx; peer.fire('icecandidate') }, 8)
  const value = await work
  assert.equal(value.partial, true)
  assert.deepEqual(Array.from(value.candidateTypes), ['host', 'srflx'])
}
{
  const peer = new FakePeer(base)
  await assert.rejects(gatherVoiceIceSnapshot(peer, { minWaitMs: 10, maxWaitMs: 35 }), /No ICE candidates/)
}
{
  const peer = new FakePeer(base)
  const work = gatherVoiceIceSnapshot(peer, { minWaitMs: 10, maxWaitMs: 50 })
  peer.signalingState = 'closed'
  peer.fire('signalingstatechange')
  await assert.rejects(work, /cancelled/)
}
console.log('PASS: ICE complete, STUN partial, LAN partial, no-candidate, and cancellation scenarios')
