import test from 'node:test'
import assert from 'node:assert/strict'
import { createCaptureLinkSignalingModeArbiter } from '../../../src/main/capturelink-signaling-mode-arbiter.mjs'

test('start operation synchronously reserves its mode and prevents second sessions', async () => {
  const mode = createCaptureLinkSignalingModeArbiter()
  let entered = false
  let finish
  const pending = mode.claim('legacy', () => {
    entered = true
    return new Promise(resolve => { finish = resolve })
  })
  assert.equal(entered, true)
  assert.equal(mode.mode(), 'legacy')
  assert.throws(() => mode.claim('online', async () => null), /session_already_started/)
  assert.throws(() => mode.claim('legacy', async () => null), /session_already_started/)
  mode.active('legacy')
  assert.throws(() => mode.active('online'), /not_joined/)
  mode.release('online')
  assert.equal(mode.mode(), 'legacy')
  finish('done')
  assert.equal(await pending, 'done')
  assert.equal(mode.mode(), 'legacy')
  mode.release('legacy')
  assert.equal(mode.mode(), null)
})

test('late failure cannot accidentally unlock a subsequent online session', async () => {
  const mode = createCaptureLinkSignalingModeArbiter()
  let rejectOld
  const old = mode.claim('legacy', () => new Promise((_, reject) => { rejectOld = reject }))
  mode.release('legacy')
  const next = mode.claim('online', () => Promise.resolve({ active: true }))
  rejectOld(new Error('legacy cancellation'))
  await assert.rejects(old, /legacy cancellation/)
  assert.deepEqual(await next, { active: true })
  assert.equal(mode.mode(), 'online')
  mode.release('online')
  assert.equal(mode.mode(), null)
})

test('synchronous and asynchronous failed creates release only their own ticket', async () => {
  const mode = createCaptureLinkSignalingModeArbiter()
  assert.throws(() => mode.claim('online', () => { throw new Error('bad input') }), /bad input/)
  assert.equal(mode.mode(), null)
  await assert.rejects(mode.claim('legacy', async () => { throw new Error('network') }), /network/)
  assert.equal(mode.mode(), null)
  assert.throws(() => mode.claim('invalid', async () => {}), /session_already_started/)
})
