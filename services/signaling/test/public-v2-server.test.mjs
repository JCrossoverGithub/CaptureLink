/** UX3F-2 G2 hermetic HTTP acceptance: localhost fixture only, no OAuth provider/network deploy. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { get as httpGet } from 'node:http'
import { createPublicV2SignalingServer } from '../src/public-v2-server.mjs'
import { INVITE_TTL_MS, SESSION_TTL_MS } from '../src/protocol.mjs'

const WATCH = { watch: true, voice: false, controller: false, controllerMode: 'shared' }
const SHARED = { watch: true, voice: true, controller: true, controllerMode: 'shared' }
const AT = 1_800_000_000_000
const ISSUER = 'https://identity.capturelink.test'
const AUDIENCE = 'capturelink-online'
const cap = () => Buffer.alloc(32, 7).toString('base64url')
const wire = value => 'CAPTURELINK-SESSION-V1:' + Buffer.from(JSON.stringify(value)).toString('base64url')
const offer = (perms, id = randomUUID(), time = AT) => ({ kind: 'invite', version: 1,
  sessionId: id, createdAt: time, permissions: perms,
  transports: {
    ...(perms.controller ? { controller: 'controller-offer-abcdefg' } : {}),
    ...((perms.voice || (perms.watch && !perms.controller)) ? { voice: 'voice-offer-abcdefg' } : {}),
  },
})
const answer = (perms, id) => ({ kind: 'response', version: 1, sessionId: id,
  transports: {
    ...(perms.controller ? { controller: 'controller-answer-abcdefg' } : {}),
    ...((perms.voice || (perms.watch && !perms.controller)) ? { voice: 'voice-answer-abcdefg' } : {}),
  },
})

async function fixture(t, options = {}) {
  let ms = AT
  const accounts = new Map([['alpha', true], ['beta', true]])
  const claims = new Map([
    ['alpha-token', { iss: ISSUER, aud: AUDIENCE, sub: 'alpha', exp: AT / 1000 + 1800, scope: ['sessions:create'] }],
    ['beta-token', { iss: ISSUER, aud: AUDIENCE, sub: 'beta', exp: AT / 1000 + 1800, scope: ['sessions:create'] }],
    ['weak-token', { iss: ISSUER, aud: AUDIENCE, sub: 'alpha', exp: AT / 1000 + 1800, scope: [] }],
    ['bad-issuer', { iss: 'https://attacker.test', aud: AUDIENCE, sub: 'alpha', exp: AT / 1000 + 1800, scope: ['sessions:create'] }],
    ['bad-audience', { iss: ISSUER, aud: 'other', sub: 'alpha', exp: AT / 1000 + 1800, scope: ['sessions:create'] }],
    ['expired', { iss: ISSUER, aud: AUDIENCE, sub: 'alpha', exp: AT / 1000 - 1, scope: ['sessions:create'] }],
  ])
  const broker = createPublicV2SignalingServer({
    verifyHostAccessToken: async token => claims.get(token) || null,
    isHostActive: async id => accounts.get(id) === true,
    expectedIssuer: ISSUER,
    expectedAudience: AUDIENCE,
    now: () => ms,
    ...(options.limits ? { limits: options.limits } : {}),
  })
  const root = await broker.listen()
  t.after(async () => { await broker.close() })
  async function request(method, path, data, token, headers = {}) {
    const response = await fetch(root + path, {
      method,
      headers: {
        ...(data === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  async function create(user = 'alpha-token', perms = WATCH) {
    const result = await request('POST', '/v2/sessions', { permissions: perms }, user)
    assert.equal(result.status, 201, JSON.stringify(result.body))
    return result.body
  }
  async function join(host, displayName = 'Friend') {
    return request('POST', '/v2/join', { inviteCode: host.inviteCode, displayName })
  }
  const sessionPath = host => `/v2/sessions/${host.sessionId}`
  return { broker, root, request, create, join, sessionPath, accounts, claims,
    setTime(value) { ms = value }, time() { return ms } }
}

async function prepared(t, perms = WATCH) {
  const h = await fixture(t)
  const host = await h.create('alpha-token', perms)
  const guestResponse = await h.join(host, 'Alex')
  assert.equal(guestResponse.status, 202, JSON.stringify(guestResponse.body))
  return { h, host, guest: guestResponse.body, path: h.sessionPath(host) }
}

test('factory requires server-side verifiers, proper audience and bounded budgets', () => {
  assert.throws(() => createPublicV2SignalingServer({}), /invalid_v2_broker_configuration/)
  assert.throws(() => createPublicV2SignalingServer({
    verifyHostAccessToken: () => null, isHostActive: () => true,
    expectedIssuer: ISSUER, expectedAudience: AUDIENCE, limits: { unknown: 10 },
  }), /invalid_v2_broker_configuration/)
  assert.throws(() => createPublicV2SignalingServer({
    verifyHostAccessToken: () => null, isHostActive: () => true,
    expectedIssuer: ISSUER, expectedAudience: AUDIENCE, limits: { maxSessions: 0 },
  }), /invalid_v2_limits/)
})

test('HTTP listener is loopback-only and cannot expose its own public entry point', async t => {
  const h = await fixture(t)
  assert.equal(h.broker.address().address, '127.0.0.1')
  const health = await h.request('GET', '/healthz')
  assert.equal(health.status, 200)
  assert.deepEqual(health.body, { status: 'ok' })
  assert.match(health.headers.get('cache-control'), /no-store/)
  assert.equal((await h.request('GET', '/v1/sessions')).status, 404)
  assert.equal((await h.request('GET', '/v2/installations')).status, 404)
})

test('no client-supplied roles or universal admission: create requires trusted valid scoped host', async t => {
  const h = await fixture(t)
  for (const token of [null, 'fake-token', 'bad-issuer', 'bad-audience', 'expired']) {
    const r = await h.request('POST', '/v2/sessions', { permissions: WATCH, role: 'host' }, token)
    assert.equal(r.status, 400)
    const accurate = await h.request('POST', '/v2/sessions', { permissions: WATCH }, token)
    assert.equal(accurate.status, 401)
    assert.deepEqual(accurate.body, { error: 'unauthorized' })
  }
  const denied = await h.request('POST', '/v2/sessions', { permissions: WATCH }, 'weak-token')
  assert.equal(denied.status, 403)
  assert.equal(denied.body.error, 'insufficient_scope')
  h.accounts.set('alpha', false)
  const inactive = await h.request('POST', '/v2/sessions', { permissions: WATCH }, 'alpha-token')
  assert.equal(inactive.status, 403)
  assert.equal(inactive.body.error, 'account_inactive')
})

test('host gets independent 256-bit one-use invite and scoped host capability, no client admission', async t => {
  const h = await fixture(t)
  const host = await h.create()
  assert.match(host.hostSessionToken, /^[\w-]{43}$/)
  assert.match(host.inviteCode, /^[\w-]{43}$/)
  assert.notEqual(host.hostSessionToken, host.inviteCode)
  assert.equal(host.version, 2)
  assert.equal(host.inviteExpiresAt, AT + INVITE_TTL_MS)
  assert.equal(host.sessionExpiresAt, AT + SESSION_TTL_MS)
  const invalid = await h.request('POST', '/v2/sessions', { permissions: WATCH }, host.hostSessionToken)
  assert.equal(invalid.status, 401)
})

test('anonymous guest joins once, obtains pending-only capability, host sees unverified label', async t => {
  const { h, host, guest, path } = await prepared(t)
  assert.match(guest.guestSessionToken, /^[\w-]{43}$/)
  assert.notEqual(host.hostSessionToken, guest.guestSessionToken)
  assert.equal(guest.status, 'pending')
  const replay = await h.join(host)
  assert.equal(replay.status, 404)
  assert.equal(replay.body.error, 'invitation_unavailable')
  const status = await h.request('GET', path, undefined, host.hostSessionToken)
  assert.equal(status.status, 200)
  assert.equal(status.body.pendingGuestId, guest.guestId)
  assert.equal(status.body.guestDisplayName, 'Alex')
  const guestSnapshot = await h.request('GET', path, undefined, guest.guestSessionToken)
  assert.equal(guestSnapshot.body.pendingGuestId, null)
  assert.equal(guestSnapshot.body.guestDisplayName, null)
  assert.equal(guestSnapshot.body.status, 'pending')
  const before = await h.request('GET', `${path}/messages`, undefined, guest.guestSessionToken)
  assert.equal(before.status, 403)
  assert.equal(before.body.error, 'not_approved')
})

test('two simultaneous guests redeem one invitation at most once', async t => {
  const h = await fixture(t)
  const host = await h.create()
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => h.join(host, `Friend ${i}`)))
  assert.equal(results.filter(r => r.status === 202).length, 1)
  assert.equal(results.filter(r => r.status === 404 || r.status === 429).length, 7)
})

test('host-only explicit approval: guest cannot self-approve or forge guestId', async t => {
  const { h, host, guest, path } = await prepared(t)
  assert.equal((await h.request('POST', `${path}/approve`, { guestId: guest.guestId }, guest.guestSessionToken)).status, 403)
  assert.equal((await h.request('POST', `${path}/approve`, { guestId: randomUUID() }, host.hostSessionToken)).status, 409)
  const approvals = await Promise.all(Array.from({ length: 2 }, () =>
    h.request('POST', `${path}/approve`, { guestId: guest.guestId }, host.hostSessionToken)))
  assert.deepEqual(approvals.map(r => r.status).sort(), [200,409])
  assert.equal((await h.request('GET', path, undefined, guest.guestSessionToken)).body.status, 'approved')
  assert.equal((await h.request('POST', `${path}/reject`, { guestId: guest.guestId }, host.hostSessionToken)).status, 409)
})

test('approved guest exchanges valid V1 WebRTC envelopes without touching media', async t => {
  const { h, host, guest, path } = await prepared(t, SHARED)
  const approved = await h.request('POST', `${path}/approve`, { guestId: guest.guestId }, host.hostSessionToken)
  assert.equal(approved.status, 200)
  const sdpId = randomUUID()
  const inviteWire = wire(offer(SHARED, sdpId))
  const responseWire = wire(answer(SHARED, sdpId))
  assert.equal((await h.request('POST', `${path}/messages`,
    { kind: 'response', payload: responseWire }, guest.guestSessionToken)).status, 409)
  assert.equal((await h.request('POST', `${path}/messages`,
    { kind: 'invite', payload: inviteWire }, guest.guestSessionToken)).status, 403)
  const sent = await h.request('POST', `${path}/messages`,
    { kind: 'invite', payload: inviteWire }, host.hostSessionToken)
  assert.equal(sent.status, 202)
  assert.equal((await h.request('POST', `${path}/messages`,
    { kind: 'invite', payload: inviteWire }, host.hostSessionToken)).status, 409)
  const received = await h.request('GET', `${path}/messages?after=0`, undefined, guest.guestSessionToken)
  assert.equal(received.status, 200)
  assert.deepEqual(received.body.messages.map(m => m.kind), ['invite'])
  assert.equal(received.body.messages[0].payload, inviteWire)
  assert.equal((await h.request('POST', `${path}/messages`,
    { kind: 'response', payload: wire(answer(SHARED, randomUUID())) }, guest.guestSessionToken)).status, 409)
  assert.equal((await h.request('POST', `${path}/messages`,
    { kind: 'response', payload: responseWire }, guest.guestSessionToken)).status, 202)
  const answerResult = await h.request('GET', `${path}/messages?after=0`, undefined, host.hostSessionToken)
  assert.equal(answerResult.body.messages[0].payload, responseWire)
  assert.equal((await h.request('POST', `${path}/messages`,
    { kind: 'response', payload: responseWire }, guest.guestSessionToken)).status, 409)
})

test('permissions are immutable, malformed and foreign payloads cannot become offers', async t => {
  const { h, host, guest, path } = await prepared(t)
  await h.request('POST', `${path}/approve`, { guestId: guest.guestId }, host.hostSessionToken)
  assert.equal((await h.request('POST', `${path}/messages`,
    { kind: 'invite', payload: wire(offer(SHARED)) }, host.hostSessionToken)).status, 400)
  assert.equal((await h.request('POST', `${path}/messages`,
    { kind: 'invite', payload: 'camera video bytes' }, host.hostSessionToken)).status, 400)
  assert.equal((await h.request('POST', `${path}/messages`,
    { kind: 'invite', payload: wire(offer(WATCH)), role: 'host' }, host.hostSessionToken)).status, 400)
})

test('invitations expire and cannot be approved after expiry; approved sessions survive invite expiry', async t => {
  const h = await fixture(t)
  const host = await h.create()
  h.setTime(AT + INVITE_TTL_MS)
  assert.equal((await h.join(host)).status, 404)
  const another = await h.create('beta-token')
  const join = await h.join(another)
  assert.equal(join.status, 202)
  h.setTime(AT + INVITE_TTL_MS * 2)
  assert.equal((await h.request('POST', `${h.sessionPath(another)}/approve`,
    { guestId: join.body.guestId }, another.hostSessionToken)).status, 404)
})

test('approved session survives invite expiry but ends at session expiration', async t => {
  const h = await fixture(t)
  const host = await h.create()
  const guest = (await h.join(host)).body
  const path = h.sessionPath(host)
  assert.equal((await h.request('POST', `${path}/approve`, { guestId: guest.guestId }, host.hostSessionToken)).status, 200)
  h.setTime(AT + INVITE_TTL_MS + 1)
  assert.equal((await h.request('GET', path, undefined, host.hostSessionToken)).status, 200)
  h.setTime(AT + SESSION_TTL_MS)
  assert.equal((await h.request('GET', path, undefined, guest.guestSessionToken)).status, 404)
})

test('account disabled invalidates guest and host session access, operator revocation removes state', async t => {
  const { h, host, guest, path } = await prepared(t)
  h.accounts.set('alpha', false)
  assert.equal((await h.request('GET', path, undefined, host.hostSessionToken)).status, 403)
  assert.equal((await h.request('GET', path, undefined, guest.guestSessionToken)).status, 404)
  assert.equal(await h.broker.revokeAccount('alpha'), 0)
  assert.equal((await h.request('GET', path, undefined, host.hostSessionToken)).status, 404)
})

test('role-bound revoke and leave immediately destroy session authority', async t => {
  const { h, host, guest, path } = await prepared(t)
  assert.equal((await h.request('POST', `${path}/revoke`, undefined, guest.guestSessionToken)).status, 403)
  assert.equal((await h.request('POST', `${path}/leave`, undefined, host.hostSessionToken)).status, 403)
  assert.equal((await h.request('POST', `${path}/leave`, undefined, guest.guestSessionToken)).status, 200)
  assert.equal((await h.request('GET', path, undefined, host.hostSessionToken)).status, 404)
})

test('session capability is never valid for another session, and invitation does not grant session access', async t => {
  const h = await fixture(t)
  const first = await h.create()
  const second = await h.create()
  assert.equal((await h.request('GET', h.sessionPath(first), undefined, second.hostSessionToken)).status, 401)
  assert.equal((await h.request('GET', h.sessionPath(first), undefined, first.inviteCode)).status, 401)
  assert.equal((await h.request('POST', '/v2/sessions', { permissions: WATCH }, first.hostSessionToken)).status, 401)
})

test('unauthorized guest inputs are uniform and denied even with spoofed role/name', async t => {
  const h = await fixture(t)
  const host = await h.create()
  for (const value of [cap(), host.hostSessionToken, 'a'.repeat(43)]) {
    const attempt = await h.request('POST', '/v2/join', { inviteCode: value, displayName: 'Test' })
    assert.equal(attempt.status, 404)
    assert.equal(attempt.body.error, 'invitation_unavailable')
  }
  const invalid = await h.request('POST', '/v2/join',
    { inviteCode: host.inviteCode, displayName: 'Friend', role: 'approved' })
  assert.equal(invalid.status, 404)
  const unexpected = await h.request('POST', '/v2/join',
    { inviteCode: host.inviteCode, displayName: 'Friend' }, 'fake-token')
  assert.equal(unexpected.status, 400)
  const actual = await h.join(host)
  assert.equal(actual.status, 202)
})

test('invalid guest name cannot consume valid code', async t => {
  const h = await fixture(t)
  const host = await h.create()
  const wrong = await h.join(host, '<script>')
  assert.equal(wrong.status, 400)
  assert.equal(wrong.body.error, 'invalid_display_name')
  assert.equal((await h.join(host)).status, 202)
})

test('anonymous join throttling is bounded and forged forwarding headers are rejected', async t => {
  const h = await fixture(t, { limits: { joinPerSocketPerMinute: 2, joinPerCodePerMinute: 2 } })
  const host = await h.create()
  assert.equal((await h.request('POST', '/v2/join',
    { inviteCode: 'a'.repeat(43), displayName: 'Friend' }, undefined,
    { 'x-forwarded-for': '203.0.113.1' })).status, 400)
  for (let i = 0; i < 2; i++) assert.equal((await h.join({ inviteCode: cap() })).status, 404)
  assert.equal((await h.join(host)).status, 429)
})

test('create quotas separate accounts, capacity and per-user active session limits', async t => {
  const h = await fixture(t, { limits: { maxSessions: 2, maxSessionsPerHost: 1 } })
  await h.create('alpha-token')
  const duplicate = await h.request('POST', '/v2/sessions', { permissions: WATCH }, 'alpha-token')
  assert.equal(duplicate.status, 429)
  await h.create('beta-token')
  assert.equal((await h.request('POST', '/v2/sessions', { permissions: WATCH }, 'beta-token')).status, 503)
})

test('invalid request parsing, host header, origin and forwarded metadata fail closed', async t => {
  const h = await fixture(t)
  assert.equal((await h.request('GET', '/v2/sessions', undefined, null,
    { Origin: 'https://attacker.example' })).status, 403)
  assert.equal((await h.request('GET', '/healthz', undefined, null,
    { 'x-real-ip': '198.51.100.8' })).status, 400)
  assert.equal((await h.request('POST', '/v2/sessions', { permissions: WATCH },
    'alpha-token', { 'x-capturelink-admission': 'Bearer example' })).status, 400)
  const wrong = await h.request('POST', '/v2/sessions', { permissions: WATCH }, 'alpha-token',
    { 'content-type': 'text/plain' })
  assert.equal(wrong.status, 415)
  assert.equal((await h.request('GET', '/v2/sessions?access_token=secret')).status, 400)
  assert.equal((await h.request('GET', '/v2/sessions/not-a-uuid')).status, 404)
  assert.equal((await h.request('POST', '/v2/sessions', { permissions: { ...WATCH, watch: false, controller: true } },
    'alpha-token')).status, 400)
})

test('request body is bounded before any session creation', async t => {
  const h = await fixture(t)
  const oversized = 'z'.repeat(1_210_000)
  const response = await h.request('POST', '/v2/sessions', { permissions: WATCH, junk: oversized }, 'alpha-token')
  assert.equal(response.status, 413)
  const host = await h.create()
  assert.ok(host.sessionId)
})

test('all access disappears after broker restart, without reusing invitation or session capability', async t => {
  const h = await fixture(t)
  const host = await h.create()
  const guest = (await h.join(host)).body
  const other = await fixture(t)
  assert.equal((await other.request('GET', h.sessionPath(host), undefined, host.hostSessionToken)).status, 404)
  assert.equal((await other.join(host)).status, 404)
  assert.equal((await other.request('GET', h.sessionPath(host), undefined, guest.guestSessionToken)).status, 404)
})

test('verifier exceptions and unexpected errors never reflect submitted credentials', async t => {
  const h = await fixture(t)
  h.claims.set('throw-token', null)
  const result = await h.request('POST', '/v2/sessions', { permissions: WATCH }, 'throw-token')
  assert.equal(result.status, 401)
  assert.equal(JSON.stringify(result.body).includes('throw-token'), false)
})

test('host can explicitly reject an invitation and guest cannot access signaling', async t => {
  const { h, host, guest, path } = await prepared(t)
  assert.equal((await h.request('POST', `${path}/reject`,
    { guestId: guest.guestId }, host.hostSessionToken)).status, 200)
  const snapshot = await h.request('GET', path, undefined, guest.guestSessionToken)
  assert.equal(snapshot.status, 200)
  assert.equal(snapshot.body.status, 'rejected')
  assert.equal((await h.request('GET', `${path}/messages`, undefined, guest.guestSessionToken)).status, 403)
  assert.equal((await h.join(host)).status, 404)
})

test('GET messages reject unbounded, repeated, negative and unrelated query fields', async t => {
  const { h, host, guest, path } = await prepared(t)
  await h.request('POST', `${path}/approve`, { guestId: guest.guestId }, host.hostSessionToken)
  for (const q of ['?after=-1', '?after=1000000000', '?after=0&after=1', '?after=0&secret=yes', '?after=garbage']) {
    const result = await h.request('GET', `${path}/messages${q}`, undefined, guest.guestSessionToken)
    assert.equal(result.status, 400, `${q} -> ${result.status}`)
  }
})

test('host and guest rights stay bound across accounts, sessions and role-claimed HTTP bodies', async t => {
  const h = await fixture(t)
  const alice = await h.create('alpha-token')
  const bob = await h.create('beta-token')
  const joined = (await h.join(alice)).body
  const path = h.sessionPath(alice)
  assert.equal((await h.request('POST', `${path}/approve`,
    { guestId: joined.guestId }, bob.hostSessionToken)).status, 401)
  assert.equal((await h.request('POST', `${path}/approve`,
    { guestId: joined.guestId, role: 'host' }, alice.hostSessionToken)).status, 400)
  const stillPending = await h.request('GET', path, undefined, alice.hostSessionToken)
  assert.equal(stillPending.body.status, 'pending')
})

test('HTTP request Host must match loopback, never untrusted cross-site host', async t => {
  const h = await fixture(t)
  const forged = await new Promise((resolve, reject) => {
    httpGet(h.root + '/healthz', { headers: { host: 'evil.example' } }, response => {
      const chunks = []
      response.on('data', bytes => chunks.push(bytes))
      response.on('end', () => resolve({ status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString()) }))
      response.on('error', reject)
    }).on('error', reject)
  })
  assert.equal(forged.status, 400)
  assert.deepEqual(forged.body, { error: 'unexpected_host' })
})

test('inactive verifier and exceptions fail closed without leaking exception details', async t => {
  const h = await fixture(t)
  h.claims.set('malformed-subject', { iss: ISSUER, aud: AUDIENCE,
    sub: 'invalid\nsubject', exp: AT / 1000 + 1200, scope: ['sessions:create'] })
  const malformed = await h.request('POST', '/v2/sessions', { permissions: WATCH }, 'malformed-subject')
  assert.equal(malformed.status, 401)
  assert.ok(!JSON.stringify(malformed.body).includes('invalid'))
  const host = await h.create()
  h.accounts.set('alpha', false)
  const join = await h.join(host)
  assert.equal(join.status, 404)
  assert.equal(join.body.error, 'invitation_unavailable')
})

test('trusted operator account revocation removes active sessions without an HTTP operator route', async t => {
  const h = await fixture(t)
  const host = await h.create()
  const guest = (await h.join(host)).body
  assert.equal(await h.broker.revokeAccount('alpha'), 1)
  assert.equal((await h.request('GET', h.sessionPath(host), undefined, host.hostSessionToken)).status, 404)
  assert.equal((await h.request('GET', h.sessionPath(host), undefined, guest.guestSessionToken)).status, 404)
  assert.equal((await h.join(host)).status, 404)
})
