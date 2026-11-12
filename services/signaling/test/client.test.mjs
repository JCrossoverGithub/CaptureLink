import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createSignalingServer } from '../src/server.mjs'
import { LocalSignalingClient, SignalingClientError, hostSession, guestSession } from '../src/client.mjs'

const WATCH = { watch: true, voice: false, controller: false, controllerMode: 'shared' }
const CONTROLLER = { watch: true, voice: false, controller: true, controllerMode: 'shared' }
const VOICE = { watch: false, voice: true, controller: false, controllerMode: 'shared' }
const COMBINED = { watch: true, voice: true, controller: true, controllerMode: 'player2' }
const wire = obj => 'CAPTURELINK-SESSION-V1:' + Buffer.from(JSON.stringify(obj)).toString('base64url')
const unwire = data => JSON.parse(Buffer.from(data.split(':')[1], 'base64url'))
const off = perms => {
  const transports = {}
  if (perms.controller) transports.controller = 'controller-offer-123456'
  if (perms.voice || (perms.watch && !perms.controller)) transports.voice = 'voice-offer-123456'
  return wire({ kind: 'invite', version: 1, sessionId: randomUUID(), createdAt: Date.now(), permissions: perms, transports })
}
const answer = offer => {
  const input = unwire(offer)
  return wire({ kind: 'response', version: 1, sessionId: input.sessionId,
    transports: Object.fromEntries(Object.keys(input.transports).map(k => [k, `${k}-answer-123456`])) })
}
function fakeHost() {
  return {
    created: 0, accepted: 0, resets: 0, response: null,
    async createInvitation(perms) { this.created++; return off(perms) },
    async acceptResponse(reply) { this.accepted++; this.response = unwire(reply) },
    reset() { this.resets++ },
  }
}
function fakeGuest() {
  return {
    joined: 0, resets: 0, permissions: null, mic: null,
    async joinInvitation(offer, mic) { this.joined++; this.mic = mic; this.permissions = unwire(offer).permissions; return answer(offer) },
    reset() { this.resets++ },
  }
}
async function harness(t) {
  const app = createSignalingServer()
  const endpoint = await app.listen()
  t.after(() => app.close())
  return { host: () => new LocalSignalingClient({ endpoint }), guest: () => new LocalSignalingClient({ endpoint }) }
}
function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
for (const p of [WATCH, CONTROLLER, VOICE, COMBINED]) {
  test(`client orchestration: ${JSON.stringify(p)}`, async t => {
    const h = await harness(t), host = h.host(), guest = h.guest(), invite = deferred()
    const hostImpl = fakeHost(), guestImpl = fakeGuest()
    let approvals = 0
    const hp = hostSession(host, hostImpl, p, {
      presentInvite: code => { invite.resolve(code) },
      approveGuest: () => { approvals++; return true },
      intervalMs: 50,
      timeoutMs: 8000,
    })
    const code = await invite.promise
    assert.match(code, /^[A-Za-z0-9_-]{43}$/)
    const gp = guestSession(guest, guestImpl, code, p.voice, { intervalMs: 50, timeoutMs: 8000 })
    const [hResult, gResult] = await Promise.all([hp, gp])
    assert.equal(hResult.phase, 'negotiated')
    assert.equal(gResult.phase, 'response-sent')
    assert.equal(hostImpl.created, 1)
    assert.equal(hostImpl.accepted, 1)
    assert.equal(guestImpl.joined, 1)
    assert.equal(approvals, 1)
    assert.deepEqual(guestImpl.permissions, p)
    assert.equal(guestImpl.mic, p.voice)
    assert.equal(hostImpl.response.kind, 'response')
    await host.end()
    await guest.end().catch(() => {}) // closed by host
  })
}

test('no host auto-approval; rejection prevents all coordinator operations', async t => {
  const h = await harness(t), host = h.host(), guest = h.guest(), d = deferred(), hostImpl = fakeHost(), guestImpl = fakeGuest()
  const hp = hostSession(host, hostImpl, COMBINED, {
    presentInvite: code => d.resolve(code),
    approveGuest: () => false,
    intervalMs: 50,
    timeoutMs: 5000,
  })
  const gp = guestSession(guest, guestImpl, await d.promise, false, { intervalMs: 50, timeoutMs: 5000 })
  await assert.rejects(hp, err => err.code === 'host_rejected')
  await assert.rejects(gp, err => ['host_rejected','not_found'].includes(err.code))
  assert.equal(hostImpl.created, 0)
  assert.equal(guestImpl.joined, 0)
  assert.equal(host.role, null)
})

test('unapproved guest cannot access offers; client does not leak tokens in errors', async t => {
  const h = await harness(t), host = h.host(), guest = h.guest()
  const created = await host.create(CONTROLLER)
  const joined = await guest.join(created.inviteCode)
  assert.equal(joined.status, 'pending')
  await assert.rejects(guest.messages(), e => e instanceof SignalingClientError && e.code === 'not_approved' && e.status === 403)
  await assert.rejects(guest.send('response', off(CONTROLLER)), e => e.code === 'invalid_signaling_envelope' || e.code === 'not_approved')
  await assert.rejects(guest.approve(joined.guestId), e => e.code === 'wrong_role')
  await host.end()
})

test('endpoint pins loopback (no LAN, HTTPS remote or URL credentials)', () => {
  for (const endpoint of [
    'http://localhost:8787', 'http://0.0.0.0:8787', 'http://192.168.1.9:8787',
    'https://example.org', 'http://127.0.0.1:8787/other',
    'http://user:pass@127.0.0.1:8787', 'http://127.0.0.1:8787/?token=private',
  ]) assert.throws(() => new LocalSignalingClient({ endpoint }), e => e.code === 'endpoint_not_loopback')
  assert.equal(new LocalSignalingClient().role, null)
})

test('role isolation, one-use code and revoke erase local credential', async t => {
  const h = await harness(t), host = h.host(), guest = h.guest(), other = h.guest()
  const created = await host.create(WATCH)
  await guest.join(created.inviteCode)
  await assert.rejects(other.join(created.inviteCode), e => e.code === 'invitation_unavailable')
  await assert.rejects(host.create(WATCH), e => e.code === 'session_already_started')
  await assert.rejects(host.send('response', 'CAPTURELINK-SESSION-V1:abcdefghi'), e => e.code === 'wrong_direction')
  await host.end()
  assert.equal(host.role, null)
  await assert.rejects(guest.snapshot(), e => e.code === 'not_joined' || e.code === 'not_found')
})

test('cancellation interrupts an idle pending host poll and closes server session', async t => {
  const h = await harness(t), host = h.host(), controller = new AbortController()
  const d = deferred()
  const hp = hostSession(host, fakeHost(), WATCH, {
    presentInvite: code => d.resolve(code),
    approveGuest: () => { throw new Error('must not approve without user') },
    signal: controller.signal,
    intervalMs: 100,
    timeoutMs: 5000,
  })
  await d.promise
  controller.abort()
  await assert.rejects(hp, e => e.code === 'cancelled')
  assert.equal(host.role, null)
})

test('mic consent is a required local boolean, not inferred from host permissions', async t => {
  const h = await harness(t), guest = h.guest()
  await assert.rejects(guestSession(guest, fakeGuest(), 'X'.repeat(43), 'yes'), e => e.code === 'mic_consent_required')
  assert.equal(guest.role, null)
})

test('denied / invalid permission input prevents session creation', async t => {
  const h = await harness(t), host = h.host()
  await assert.rejects(host.create({ ...COMBINED, watch: false }), e => e.code === 'invalid_permissions')
  await assert.rejects(host.create({ ...COMBINED, extra: true }), e => e.code === 'invalid_permissions')
  assert.equal(host.role, null)
})

test('network errors are sanitized and cannot contain private response bodies', async () => {
  const client = new LocalSignalingClient({ fetchImpl: async () => { throw new Error('Bearer SECRET SDP 192.168.0.1') } })
  await assert.rejects(client.create(WATCH), e => e.code === 'network_unavailable' && !e.message.includes('SECRET'))
})
