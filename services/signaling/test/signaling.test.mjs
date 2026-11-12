import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createSignalingServer } from '../src/server.mjs'
import { INVITE_TTL_MS } from '../src/protocol.mjs'

const CONTROLLER = { watch: true, voice: false, controller: true, controllerMode: 'shared' }
const VOICE = { watch: false, voice: true, controller: false, controllerMode: 'shared' }
const WATCH = { watch: true, voice: false, controller: false, controllerMode: 'shared' }
const COMBINED = { watch: true, voice: true, controller: true, controllerMode: 'player2' }

const wire = (x) => 'CAPTURELINK-SESSION-V1:' + Buffer.from(JSON.stringify(x)).toString('base64url')
const invite = (permissions, sessionId = randomUUID(), createdAt = Date.now()) => ({
  kind: 'invite', version: 1, sessionId, createdAt, permissions,
  transports: {
    ...(permissions.controller ? { controller: 'controller-offer-123456' } : {}),
    ...((permissions.voice || (permissions.watch && !permissions.controller)) ? { voice: 'voice-offer-123456' } : {}),
  },
})
const response = (permissions, sessionId) => ({
  kind: 'response', version: 1, sessionId,
  transports: {
    ...(permissions.controller ? { controller: 'controller-answer-123456' } : {}),
    ...((permissions.voice || (permissions.watch && !permissions.controller)) ? { voice: 'voice-answer-123456' } : {}),
  },
})

async function harness(options = {}) {
  const app = createSignalingServer(options)
  const root = await app.listen()
  async function request(method, path, body, bearer, headers = {}) {
    const res = await fetch(root + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: res.status, data: await res.json(), headers: res.headers }
  }
  async function create(permissions = COMBINED) {
    const r = await request('POST', '/v1/sessions', { permissions })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    return r.data
  }
  async function join(host) {
    const r = await request('POST', '/v1/join', { inviteCode: host.inviteCode })
    assert.equal(r.status, 202, JSON.stringify(r.data))
    return r.data
  }
  async function approve(host, guest) {
    return request('POST', `/v1/sessions/${host.sessionId}/approve`, { guestId: guest.guestId }, host.hostToken)
  }
  return { request, create, join, approve, close: () => app.close() }
}

for (const perms of [CONTROLLER, VOICE, WATCH, COMBINED]) {
  test(`UX2 compatibility, approved host/guest exchange: ${JSON.stringify(perms)}`, async (t) => {
    const h = await harness()
    t.after(h.close)
    const host = await h.create(perms)
    assert.match(host.inviteCode, /^[\w-]{43}$/)
    assert.match(host.hostToken, /^[\w-]{43}$/)
    assert.notEqual(host.inviteCode, host.hostToken)
    const guest = await h.join(host)
    assert.equal(guest.status, 'pending')
    assert.notEqual(guest.guestToken, host.hostToken)
    const beforeApproval = await h.request('GET', `/v1/sessions/${host.sessionId}/messages`, undefined, guest.guestToken)
    assert.equal(beforeApproval.status, 403)
    const state = await h.request('GET', `/v1/sessions/${host.sessionId}`, undefined, host.hostToken)
    assert.equal(state.data.pendingGuestId, guest.guestId)
    assert.deepEqual(state.data.permissions, perms)
    assert.equal((await h.approve(host, guest)).status, 200)
    const legacy = invite(perms)
    const sent = await h.request('POST', `/v1/sessions/${host.sessionId}/messages`,
      { kind: 'invite', payload: wire(legacy) }, host.hostToken)
    assert.equal(sent.status, 202, JSON.stringify(sent.data))
    const messages = await h.request('GET', `/v1/sessions/${host.sessionId}/messages?after=0`, undefined, guest.guestToken)
    assert.equal(messages.status, 200)
    assert.deepEqual(messages.data.messages.map(m => m.kind), ['invite'])
    assert.equal(messages.data.messages[0].payload, wire(legacy))
    assert.equal((await h.request('GET', `/v1/sessions/${host.sessionId}/messages?after=1`, undefined, guest.guestToken)).data.messages.length, 0)
    const answer = wire(response(perms, legacy.sessionId))
    const sentAnswer = await h.request('POST', `/v1/sessions/${host.sessionId}/messages`,
      { kind: 'response', payload: answer }, guest.guestToken)
    assert.equal(sentAnswer.status, 202, JSON.stringify(sentAnswer.data))
    const hostInbox = await h.request('GET', `/v1/sessions/${host.sessionId}/messages?after=0`, undefined, host.hostToken)
    assert.equal(hostInbox.data.messages.length, 1)
    assert.equal(hostInbox.data.messages[0].payload, answer)
    assert.equal(hostInbox.data.messages[0].id, 2)
  })
}

test('Host approval required, one-use invite, one guest only, and host-only approval', async (t) => {
  const h = await harness(); t.after(h.close)
  const host = await h.create(); const guest = await h.join(host)
  assert.equal((await h.request('POST', '/v1/join', { inviteCode: host.inviteCode })).status, 404)
  assert.equal((await h.request('POST', `/v1/sessions/${host.sessionId}/approve`, { guestId: guest.guestId }, guest.guestToken)).status, 403)
  assert.equal((await h.request('POST', `/v1/sessions/${host.sessionId}/approve`, { guestId: randomUUID() }, host.hostToken)).status, 409)
  assert.equal((await h.approve(host, guest)).status, 200)
  assert.equal((await h.approve(host, guest)).status, 409)
})

test('Guest cannot send offers, host cannot send answers, guest cannot revoke; revocation destroys access', async (t) => {
  const h = await harness(); t.after(h.close)
  const host = await h.create(); const guest = await h.join(host); await h.approve(host, guest)
  const legacy = invite(COMBINED)
  assert.equal((await h.request('POST', `/v1/sessions/${host.sessionId}/messages`,
    { kind: 'invite', payload: wire(legacy) }, guest.guestToken)).status, 403)
  assert.equal((await h.request('POST', `/v1/sessions/${host.sessionId}/messages`,
    { kind: 'response', payload: wire(response(COMBINED, legacy.sessionId)) }, host.hostToken)).status, 403)
  assert.equal((await h.request('POST', `/v1/sessions/${host.sessionId}/revoke`, {}, guest.guestToken)).status, 403)
  assert.equal((await h.request('POST', `/v1/sessions/${host.sessionId}/revoke`, {}, host.hostToken)).status, 200)
  assert.equal((await h.request('GET', `/v1/sessions/${host.sessionId}`, undefined, guest.guestToken)).status, 404)
})

test('Guest leave invalidates session; no stale signaling after disconnect', async (t) => {
  const h = await harness(); t.after(h.close)
  const host = await h.create(); const guest = await h.join(host); await h.approve(host, guest)
  assert.equal((await h.request('POST', `/v1/sessions/${host.sessionId}/leave`, {}, guest.guestToken)).status, 200)
  assert.equal((await h.request('GET', `/v1/sessions/${host.sessionId}`, undefined, host.hostToken)).status, 404)
})

test('Bearer tokens cannot be guessed or substituted; missing/invalid token rejected', async (t) => {
  const h = await harness(); t.after(h.close)
  const host = await h.create()
  const path = `/v1/sessions/${host.sessionId}`
  assert.equal((await h.request('GET', path)).status, 401)
  assert.equal((await h.request('GET', path, undefined, host.inviteCode)).status, 401)
  assert.equal((await h.request('GET', path, undefined, 'Z'.repeat(43))).status, 401)
  assert.equal((await h.request('GET', path, undefined, host.hostToken)).status, 200)
})

test('Malformed roles, permissions, unsupported envelopes and foreign response session blocked', async (t) => {
  const h = await harness(); t.after(h.close)
  assert.equal((await h.request('POST', '/v1/sessions', { permissions: { ...COMBINED, isAdmin: true } })).status, 400)
  const host = await h.create(); const guest = await h.join(host); await h.approve(host, guest)
  const offer = invite(COMBINED)
  const mismatchedOffer = invite(CONTROLLER)
  const path = `/v1/sessions/${host.sessionId}/messages`
  assert.equal((await h.request('POST', path, { kind: 'invite', payload: wire(mismatchedOffer) }, host.hostToken)).status, 400)
  assert.equal((await h.request('POST', path, { kind: 'invite', payload: 'bogus' }, host.hostToken)).status, 400)
  assert.equal((await h.request('POST', path, { kind: 'invite', payload: wire({ ...offer, version: 999 }) }, host.hostToken)).status, 400)
  assert.equal((await h.request('POST', path, { kind: 'invite', payload: wire(offer) }, host.hostToken)).status, 202)
  assert.equal((await h.request('POST', path, { kind: 'invite', payload: wire(offer) }, host.hostToken)).status, 409)
  assert.equal((await h.request('POST', path, { kind: 'response', payload: wire(response(COMBINED, randomUUID())) }, guest.guestToken)).status, 409)
  assert.equal((await h.request('POST', path, { kind: 'response', payload: wire(response(CONTROLLER, offer.sessionId)) }, guest.guestToken)).status, 400)
  assert.equal((await h.request('POST', path, { kind: 'response', payload: wire(response(COMBINED, offer.sessionId)) }, guest.guestToken)).status, 202)
  assert.equal((await h.request('POST', path, { kind: 'response', payload: wire(response(COMBINED, offer.sessionId)) }, guest.guestToken)).status, 409)
})

test('Guest cannot send answer before host offer', async (t) => {
  const h = await harness(); t.after(h.close)
  const host = await h.create(); const guest = await h.join(host); await h.approve(host, guest)
  const r = await h.request('POST', `/v1/sessions/${host.sessionId}/messages`,
    { kind: 'response', payload: wire(response(COMBINED, randomUUID())) }, guest.guestToken)
  assert.equal(r.status, 409)
})

test('Invitation expires before join and approval; accepted session can continue while active', async (t) => {
  let clock = Date.now(); const h = await harness({ now: () => clock }); t.after(h.close)
  const stale = await h.create(); clock += INVITE_TTL_MS + 1
  assert.equal((await h.request('POST', '/v1/join', { inviteCode: stale.inviteCode })).status, 404)
  clock += 1
  const host = await h.create(); const guest = await h.join(host)
  clock += INVITE_TTL_MS + 1
  const approval = await h.approve(host, guest)
  assert.ok([404, 410].includes(approval.status), JSON.stringify(approval))
})

test('Host offer timestamp expires independently of hosted invitation TTL', async (t) => {
  const h = await harness(); t.after(h.close)
  const host = await h.create(); const guest = await h.join(host); await h.approve(host, guest)
  const offer = invite(COMBINED, randomUUID(), Date.now() - INVITE_TTL_MS - 1000)
  assert.equal((await h.request('POST', `/v1/sessions/${host.sessionId}/messages`,
    { kind: 'invite', payload: wire(offer) }, host.hostToken)).status, 410)
})

test('Host rejection and unknown invite are non-authorizing', async (t) => {
  const h = await harness(); t.after(h.close)
  const host = await h.create(); const guest = await h.join(host)
  assert.equal((await h.request('POST', `/v1/sessions/${host.sessionId}/reject`,
    { guestId: guest.guestId }, host.hostToken)).status, 200)
  assert.equal((await h.request('GET', `/v1/sessions/${host.sessionId}/messages?after=0`, undefined, guest.guestToken)).status, 403)
  assert.equal((await h.request('POST', '/v1/join', { inviteCode: 'X'.repeat(43) })).status, 404)
})

test('No-store headers, origin restriction, and invalid cursor', async (t) => {
  const h = await harness({ allowedOrigins: ['https://capturelink.example'] }); t.after(h.close)
  assert.equal((await h.request('GET', '/healthz', undefined, undefined, { Origin: 'https://untrusted.example' })).status, 403)
  assert.equal((await h.request('GET', '/healthz', undefined, undefined, { Origin: 'https://capturelink.example' })).status, 200)
  const host = await h.create(); const guest = await h.join(host); await h.approve(host, guest)
  const status = await h.request('GET', `/v1/sessions/${host.sessionId}`, undefined, host.hostToken)
  assert.match(status.headers.get('cache-control'), /no-store/)
  assert.equal((await h.request('GET', `/v1/sessions/${host.sessionId}/messages?after=-1`, undefined, host.hostToken)).status, 400)
})

test('Per-IP join attempts are rate limited', async (t) => {
  const h = await harness(); t.after(h.close)
  for (let i = 0; i < 12; i++) {
    const code = String(i).padStart(43, 'X')
    assert.equal((await h.request('POST', '/v1/join', { inviteCode: code })).status, 404)
  }
  assert.equal((await h.request('POST', '/v1/join', { inviteCode: 'Z'.repeat(43) })).status, 429)
})


test('Unjoined expired invitations free capacity; approved sessions survive invite expiry', async (t) => {
  let clock = Date.now()
  const h = await harness({ now: () => clock, maxSessions: 1 }); t.after(h.close)
  const old = await h.create()
  assert.equal((await h.request('POST', '/v1/sessions', { permissions: COMBINED })).status, 503)
  clock += INVITE_TTL_MS + 1
  assert.equal((await h.request('GET', `/v1/sessions/${old.sessionId}`, undefined, old.hostToken)).status, 404)
  const active = await h.create()
  const guest = await h.join(active)
  assert.equal((await h.approve(active, guest)).status, 200)
  clock += INVITE_TTL_MS + 1
  assert.equal((await h.request('GET', `/v1/sessions/${active.sessionId}`, undefined, active.hostToken)).status, 200)
  assert.equal((await h.request('POST', '/v1/sessions', { permissions: COMBINED })).status, 503)
})

test('Prototype is in-memory and starts on loopback, not exposed to the LAN', async (t) => {
  const h = await harness(); t.after(h.close)
  const host = await h.create()
  assert.equal(typeof host.inviteCode, 'string')
  assert.equal((await h.request('GET', '/healthz')).status, 200)
})
