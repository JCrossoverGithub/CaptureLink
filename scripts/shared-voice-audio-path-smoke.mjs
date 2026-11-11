/**
 * Diagnostics regression. No raw RTCStatsReport data may enter the exported
 * report; records can contain private network addresses and connection IDs.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'

const source = readFileSync(new URL('../src/renderer/src/voice-sharing/audio-path-stats.ts', import.meta.url), 'utf8')
const compiled = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
const mod = { exports: {} }
runInNewContext(compiled, { module: mod, exports: mod.exports, Date, Math })
const { AudioPathStats, formatAudioPathSample } = mod.exports
const tracker = new AudioPathStats()
const audio = (packets, bytes, energy = 0, duration = 0) => new Map([['sensitive-ssrc-127', {
  type: 'outbound-rtp', kind: 'audio', packetsSent: packets, bytesSent: bytes,
  totalAudioEnergy: energy, totalSamplesDuration: duration,
  localCandidateId: '192.0.2.1',
  remoteCandidateId: 'private-ice-candidate',
  codecId: 'secret',
  ssrc: 10000
}]])
const first = tracker.read('guest', audio(4, 80, 0.01, 0.1), 'outbound', 100)
assert.equal(first.state, 'sampling')
assert.equal(first.packetsDelta, null)
const next = tracker.read('guest', audio(14, 280, 0.03, 0.2), 'outbound', 1000)
assert.equal(next.state, 'packets-moving')
assert.equal(next.packetsDelta, 10)
assert.equal(next.bytesDelta, 200)
assert.ok(Math.abs(next.audioLevel - Math.sqrt(0.2)) < 0.00001)
const safeJson = JSON.stringify(next) + formatAudioPathSample(next)
for (const secret of ['192.0.2.1', 'private-ice-candidate', 'secret', '10000', 'sensitive-ssrc']) {
  assert.equal(safeJson.includes(secret), false, 'diagnostic output must omit all RTC source identifiers')
}
assert.equal(tracker.read('guest', audio(14, 280), 'outbound', 1800).state, 'no-new-packets')
assert.equal(tracker.read('guest', audio(1, 1), 'outbound', 2400).state, 'sampling', 'counter reset must re-baseline')
assert.equal(tracker.read('guest', null, 'outbound').state, 'unavailable')
const inbound = new Map([['inbound-rtp', {
  type: 'inbound-rtp', mediaType: 'audio', packetsReceived: 26, bytesReceived: 500,
  audioLevel: 0.3
}]])
assert.equal(tracker.read('host', inbound, 'inbound', 10).state, 'sampling')
const steady = tracker.read('host', inbound, 'inbound', 1000)
assert.equal(steady.audioLevel, 0.3)
assert.equal(steady.state, 'no-new-packets')
assert.equal(tracker.read('host', new Map(), 'inbound').state, 'unavailable')
tracker.clear()
assert.equal(tracker.read('guest', audio(9, 100), 'outbound').state, 'sampling')
console.log('PASS: audio RTP sampling, energy deltas, counter resets, unsupported stats, sensitive data omission')
