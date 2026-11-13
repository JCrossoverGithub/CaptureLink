import test from 'node:test'
import assert from 'node:assert/strict'
import { createRendererSignalingModeGate } from '../../../src/renderer/src/renderer-signaling-mode-gate.mjs'

function backend(name) {
  return Object.freeze({
    create: () => name, join: () => name, snapshot: () => name,
    approve: () => name, send: () => name, messages: () => name, end: () => name,
  })
}

test('local is default; online requires trusted dev capability', () => {
  const legacy = backend('local'), online = backend('online')
  const gate = createRendererSignalingModeGate(legacy, online)
  assert.equal(gate.mode(), 'legacy')
  assert.throws(() => gate.select('online'), /signaling_mode_unavailable/)
  assert.equal(gate.begin(), legacy)
  assert.equal(gate.active(), true)
  assert.equal(gate.release(), legacy)
  assert.equal(gate.current(), null)
})

test('online is explicit, frozen through session, and never falls back on failed start', () => {
  const legacy = backend('local'), online = backend('online')
  const gate = createRendererSignalingModeGate(legacy, online)
  gate.allowOnline(true)
  gate.select('online')
  assert.equal(gate.begin(), online)
  assert.throws(() => gate.select('legacy'), /signaling_mode_unavailable/)
  assert.throws(() => gate.begin(), /signaling_mode_unavailable/)
  gate.allowOnline(false)
  assert.equal(gate.current(), online)
  assert.equal(gate.release(), online)
  assert.equal(gate.mode(), 'online')
  assert.throws(() => gate.begin(), /signaling_mode_unavailable/)
  gate.allowOnline(false)
  assert.equal(gate.mode(), 'legacy')
  assert.equal(gate.begin(), legacy)
})

test('invalid modes and invalid trusted status fail closed', () => {
  const gate = createRendererSignalingModeGate(backend('local'), backend('online'))
  assert.throws(() => gate.allowOnline('true'), /signaling_mode_unavailable/)
  assert.throws(() => gate.select('__proto__'), /signaling_mode_unavailable/)
  assert.throws(() => gate.select(null), /signaling_mode_unavailable/)
  assert.throws(() => createRendererSignalingModeGate({}, backend('online')), /signaling_mode_unavailable/)
})

test('mode locking releases ownership synchronously, independent of asynchronous network cleanup', async () => {
  const gate = createRendererSignalingModeGate(backend('local'), backend('online'))
  gate.allowOnline(true)
  gate.select('online')
  const b = gate.begin()
  assert.equal(b.create(), 'online')
  const closing = gate.release()
  assert.equal(gate.active(), false)
  gate.select('legacy')
  assert.equal(gate.begin().create(), 'local')
  assert.equal(closing.end(), 'online')
  assert.equal(gate.current().create(), 'local')
})
