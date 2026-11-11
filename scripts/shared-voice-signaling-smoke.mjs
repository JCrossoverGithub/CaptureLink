// Does not open microphones, connect to Xbox, or start network sessions.
// Run with: node scripts/shared-voice-signaling-smoke.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'

const source = readFileSync(resolve('src/renderer/src/voice-sharing/signaling.ts'), 'utf8')
const compilation = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
const module = { exports: {} }
runInNewContext(compilation, {
  module, exports: module.exports, atob, btoa, Error, JSON
}, { timeout: 1000 })
const { encodeVoiceSignal, decodeVoiceSignal } = module.exports

const id = 'b17306a1-9e0c-4b50-8488-dcb1033cb689'
const sdp = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
for (const type of ['offer', 'answer']) {
  const signal = { version: 1, type, id, sdp }
  assert.deepEqual(JSON.parse(JSON.stringify(decodeVoiceSignal(encodeVoiceSignal(signal)))), signal)
}
for (const invalid of [
  '', 'CAPTURELINK-DIRECT-V1:abc',
  encodeVoiceSignal({ version: 1, type: 'offer', id: 'bad', sdp }),
  encodeVoiceSignal({ version: 1, type: 'answer', id, sdp: 'invalid' }),
  encodeVoiceSignal({ version: 2, type: 'offer', id, sdp }),
  'CAPTURELINK-VOICE-V1:' + 'a'.repeat(130_000)
]) {
  assert.throws(() => decodeVoiceSignal(invalid))
}
console.log('PASS: voice signal round-trip, size guard, bad session/version/SDP input')
