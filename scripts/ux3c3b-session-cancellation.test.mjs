import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

// Load the actual typed coordinator (not a copy of its implementation).
// Use the existing esbuild transform, as in the accepted UX2 test suite.
const source = readFileSync(new URL('../src/renderer/src/unified-session-core.ts', import.meta.url), 'utf8')
const result = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' })
const { UnifiedSessionCoordinator } = await import('data:text/javascript;base64,' + Buffer.from(result.code).toString('base64'))

const caps = { watch: true, controller: true, voice: false, controllerMode: 'shared' }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function transport(overrides = {}) {
  const calls = []
  const base = {
    hostController: async () => 'CONTROLLER-OFFER-ABC',
    guestController: async () => 'CONTROLLER-ANSWER-XYZ',
    acceptController: async () => {},
    stopController: () => { calls.push('stopController') },
    hostVoice: async () => 'VOICE-OFFER-ABC',
    guestVoice: async () => 'VOICE-ANSWER-XYZ',
    acceptVoice: async () => {},
    stopVoice: () => { calls.push('stopVoice') },
    setHostVoicePermissions: () => {},
  }
  return { calls, ...base, ...overrides }
}

test('reset stops pending host controller before its asynchronous offer resolves', async () => {
  const gate = deferred(), calls = []
  const t = transport({
    hostController: () => { calls.push('start'); return gate.promise },
    stopController: () => calls.push('stop'),
  })
  const core = new UnifiedSessionCoordinator(t)
  const attempt = core.createInvitation(caps)
  assert.equal(core.snapshot().phase, 'creating')
  core.reset()
  assert.equal(core.snapshot().phase, 'idle')
  assert.deepEqual(calls, ['start', 'stop'], 'local stop is immediate, not after broker completion')
  await assert.rejects(core.createInvitation(caps), /End the existing session setup/)
  gate.resolve('CONTROLLER-OFFER-ABC')
  await assert.rejects(attempt, /cancelled/)
  assert.deepEqual(calls, ['start', 'stop', 'stop'], 'late created peer is closed again')
  assert.equal(core.snapshot().phase, 'idle', 'late completion must not reopen the session')
  const fresh = await core.createInvitation(caps)
  assert.ok(fresh.startsWith('CAPTURELINK-SESSION-V1:'))
})

test('reset during guest voice negotiation closes controller and microphone/voice both now and after late completion', async () => {
  const h = new UnifiedSessionCoordinator(transport())
  const invitation = await h.createInvitation({ ...caps, voice: true })
  const gate = deferred(), calls = []
  const g = new UnifiedSessionCoordinator(transport({
    stopController: () => calls.push('stopController'),
    stopVoice: () => calls.push('stopVoice'),
    guestVoice: () => { calls.push('startVoice'); return gate.promise },
  }))
  const attempt = g.joinInvitation(invitation, true)
  for (let i = 0; i < 10 && !calls.includes('startVoice'); i++) await new Promise(resolve => setImmediate(resolve))
  assert.ok(calls.includes('startVoice'), 'voice negotiation must actually be pending')
  assert.equal(g.snapshot().phase, 'joining')
  g.reset()
  assert.ok(calls.includes('stopController'))
  assert.ok(calls.includes('stopVoice'))
  gate.resolve('VOICE-ANSWER-XYZ')
  await assert.rejects(attempt, /cancelled/)
  assert.equal(calls.filter(x => x === 'stopVoice').length, 2)
  assert.equal(g.snapshot().phase, 'idle')
})

test('reset while host accepts a controller answer cannot turn a revoked session negotiated', async () => {
  const host = new UnifiedSessionCoordinator(transport({
    acceptController: () => gate.promise,
    stopController: () => calls.push('stopController'),
  }))
  const gate = deferred(), calls = []
  const invitation = await host.createInvitation(caps)
  const reply = await new UnifiedSessionCoordinator(transport()).joinInvitation(invitation, false)
  const attempt = host.acceptResponse(reply)
  assert.equal(host.snapshot().phase, 'accepting')
  host.reset()
  assert.equal(host.snapshot().phase, 'idle')
  assert.equal(calls.filter(x => x === 'stopController').length, 1)
  gate.resolve()
  await assert.rejects(attempt, /cancelled/)
  assert.equal(calls.filter(x => x === 'stopController').length, 2)
  assert.equal(host.snapshot().phase, 'idle')
})

test('transport failure after reset never overwrites idle with failed', async () => {
  const gate = deferred()
  const core = new UnifiedSessionCoordinator(transport({ hostController: () => gate.promise }))
  const attempt = core.createInvitation(caps)
  core.reset()
  gate.reject(new Error('delayed peer failure'))
  await assert.rejects(attempt)
  assert.equal(core.snapshot().phase, 'idle')
})

test('failed controller shutdown still attempts voice shutdown and reports unconfirmed teardown', async () => {
  const calls = []
  const core = new UnifiedSessionCoordinator(transport({
    stopController: () => { calls.push('controller'); throw new Error('simulated close error') },
    stopVoice: () => calls.push('voice'),
  }))
  await core.createInvitation({ ...caps, voice: true })
  assert.throws(() => core.reset(), /shutdown could not be confirmed/)
  assert.deepEqual(calls, ['controller', 'voice'])
  assert.equal(core.snapshot().phase, 'idle')
})

test('failed host voice setup rolls back only the completed controller', async () => {
  const t = transport({ hostVoice: async () => { throw new Error('simulated voice failure') } })
  const core = new UnifiedSessionCoordinator(t)
  await assert.rejects(core.createInvitation({ ...caps, voice: true }), /simulated voice failure/)
  assert.equal(core.snapshot().phase, 'failed')
  assert.deepEqual(t.calls, ['stopController'])
})

test('synchronous host voice failure does not create false voice ownership', async () => {
  const t = transport({ hostVoice: () => { throw new Error('voice unavailable') } })
  const core = new UnifiedSessionCoordinator(t)
  await assert.rejects(core.createInvitation({ ...caps, voice: true }), /voice unavailable/)
  assert.deepEqual(t.calls, ['stopController'])
})

test('normal reset calls only owned friend transport teardown', async () => {
  const t = transport()
  const core = new UnifiedSessionCoordinator(t)
  await core.createInvitation(caps)
  core.reset()
  assert.deepEqual(t.calls, ['stopController'])
})

// Tiny controlled DOM adapter tests the *actual* hosted UI module without
// inventing browser/WebRTC behavior or requiring an Electron instance.
const hostedSource = readFileSync(new URL('../src/renderer/src/hosted-session-ux.ts', import.meta.url), 'utf8')
const hostedJs = transformSync(hostedSource, { loader: 'ts', format: 'esm', target: 'es2022' })
const { installHostedSessionUx } = await import('data:text/javascript;base64,' + Buffer.from(hostedJs.code).toString('base64'))

class FakeElement {
  constructor(id = '') { this.id = id; this.children = new Map(); this.handlers = new Map(); this.hidden = false; this.disabled = false; this.value = ''; this.open = false; this.textContent = '' }
  querySelector(selector) {
    if (!this.children.has(selector)) this.children.set(selector, new FakeElement(selector))
    return this.children.get(selector)
  }
  setAttribute() {}
  before() {}
  append() {}
  focus() {}
  select() {}
  addEventListener(event, callback) {
    const listeners = this.handlers.get(event) ?? []
    listeners.push(callback); this.handlers.set(event, listeners)
  }
  fire(event) {
    for (const callback of this.handlers.get(event) ?? []) callback({
      currentTarget: this, preventDefault() {}, stopPropagation() {}
    })
  }
  showModal() { this.open = true }
  close() { this.open = false }
}

async function inFakeDom(run, captureLink, coordinator) {
  const priorWindow = globalThis.window, priorDocument = globalThis.document
  let tick = null, hostedNode = null
  globalThis.window = {
    captureLink,
    setInterval(fn) { tick = fn; return 7 },
    clearInterval() { tick = null },
  }
  globalThis.document = {
    createElement(tag) {
      const node = new FakeElement(tag)
      if (tag === 'section') hostedNode = node
      return node
    }
  }
  try {
    const changes = []
    const ux = installHostedSessionUx(new FakeElement('overlay'), coordinator,
      () => caps, () => {}, active => changes.push(active))
    await run({ ux, getHosted: () => hostedNode, getTick: () => tick, changes })
  } finally {
    if (priorWindow === undefined) delete globalThis.window
    else globalThis.window = priorWindow
    if (priorDocument === undefined) delete globalThis.document
    else globalThis.document = priorDocument
  }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('broker revocation closes local friend media before a stalled network end request', async () => {
  const request = deferred()
  const steps = []
  const captureLink = {
    hostedCreate: async () => ({ inviteCode: 'A'.repeat(43) }),
    hostedSnapshot: async () => { throw new Error('not_found') },
    hostedEnd: () => { steps.push('brokerEnd'); return request.promise },
  }
  const coordinator = {
    snapshot: () => ({ phase: 'idle' }),
    reset: () => { steps.push('closeFriends') },
  }
  await inFakeDom(async ({ ux, getHosted, getTick, changes }) => {
    getHosted().querySelector('#clux3-create').fire('click')
    await flush()
    assert.equal(ux.isActive(), true)
    assert.equal(typeof getTick(), 'function')
    getTick()()
    await flush()
    assert.equal(ux.isActive(), false)
    assert.equal(getTick(), null)
    assert.deepEqual(steps, ['closeFriends', 'brokerEnd'])
    assert.deepEqual(changes, [true, false])
    request.resolve({ ended: true })
    await flush()
  }, captureLink, coordinator)
})

test('late invitation completion from an ended generation cannot reset the next session', async () => {
  const old = deferred()
  let created = 0, stopped = 0
  const captureLink = {
    hostedCreate: () => ++created === 1 ? old.promise : Promise.resolve({ inviteCode: 'B'.repeat(43) }),
    hostedEnd: async () => ({ ended: true }),
  }
  const coordinator = { snapshot: () => ({ phase: 'idle' }), reset: () => { stopped++ } }
  await inFakeDom(async ({ ux, getHosted }) => {
    getHosted().querySelector('#clux3-create').fire('click')
    await flush()
    await ux.end()
    assert.equal(stopped, 1)
    getHosted().querySelector('#clux3-create').fire('click')
    await flush()
    assert.equal(ux.isActive(), true)
    old.resolve({ inviteCode: 'A'.repeat(43) })
    await flush()
    assert.equal(stopped, 1, 'stale promise must not shut down the new session')
    assert.equal(ux.isActive(), true)
    await ux.end()
  }, captureLink, coordinator)
})
