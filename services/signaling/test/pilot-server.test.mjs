import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { createSignalingServer, createPilotSignalingServer } from '../src/server.mjs'
import { INVITE_TTL_MS } from '../src/protocol.mjs'
import { RemoteSignalingClient } from '../src/client.mjs'

const token = () => randomBytes(32).toString('base64url')
const credentials = () => [
  { id: 'host_jpcmain', token: token() },
  { id: 'guest_xlaptop', token: token() },
  { id: 'third_install', token: token() },
]
const WATCH = Object.freeze({ watch: true, voice: false, controller: false, controllerMode: 'shared' })
const wire = x => 'CAPTURELINK-SESSION-V1:' + Buffer.from(JSON.stringify(x)).toString('base64url')
const offer = (sessionId = randomUUID()) => ({
  kind: 'invite', version: 1, sessionId, createdAt: Date.now(), permissions: WATCH,
  transports: { voice: 'voice-offer-123456' },
})
const answer = sessionId => ({ kind: 'response', version: 1, sessionId, transports: { voice: 'voice-answer-123456' } })

async function harness(t, { installations = credentials(), ...opts } = {}) {
  const server = createPilotSignalingServer({ installations, ...opts })
  const root = await server.listen()
  t.after(() => server.close())
  async function request(method, path, body, admission, bearer, headers = {}) {
    const response = await fetch(root + path, {
      method, redirect: 'error',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(admission ? { 'X-CaptureLink-Admission': `Bearer ${admission}` } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, data: await response.json(), headers: response.headers }
  }
  const create = async (id = 0) => {
    const r = await request('POST', '/v1/sessions', { permissions: WATCH }, installations[id].token)
    assert.equal(r.status, 201, JSON.stringify(r.data))
    return r.data
  }
  const join = async (host, id = 1) => {
    const r = await request('POST', '/v1/join', { inviteCode: host.inviteCode, displayName: 'Alex' }, installations[id].token)
    assert.equal(r.status, 202, JSON.stringify(r.data))
    return r.data
  }
  return { server, root, installations, request, create, join }
}

test('factory requires unique valid per-install credentials and bounded pilot limits', () => {
  const entries = credentials()
  for (const invalid of [[], [entries[0]], [entries[0], entries[0]],
    [entries[0], { id: entries[1].id, token: entries[0].token }],
    [entries[0], { id: 'bad id', token: entries[1].token }],
    [entries[0], { id: entries[1].id, token: 'password' }]]) {
    assert.throws(() => createPilotSignalingServer({ installations: invalid }))
  }
  assert.throws(() => createPilotSignalingServer({ installations: entries, maxSessions: 100 }))
  assert.throws(() => createPilotSignalingServer({ installations: entries, limits: { read: 1000 } }))
  assert.throws(() => createPilotSignalingServer({ installations: entries, limits: { garbage: 1 } }))
})

test('pilot stays loopback-only; health is minimal; admission required on all session operations', async t => {
  const h = await harness(t)
  assert.match(h.root, /^http:\/\/127\.0\.0\.1:\d+$/)
  assert.equal(h.server.server.address().address, '127.0.0.1')
  assert.deepEqual((await h.request('GET', '/healthz')).data, { status: 'ok' })
  const createdWithoutAuth = await h.request('POST', '/v1/sessions', { permissions: WATCH })
  assert.equal(createdWithoutAuth.status, 401)
  const deniedJoin = await h.request('POST', '/v1/join', { inviteCode: token() })
  assert.equal(deniedJoin.status, 401)
  const noAdmission = await h.request('GET', `/v1/sessions/${randomUUID()}`)
  assert.equal(noAdmission.status, 401)
  const wrongAdmission = await h.request('POST', '/v1/sessions', { permissions: WATCH }, token())
  assert.equal(wrongAdmission.status, 401)
  assert.equal(wrongAdmission.data.error, 'unauthorized')
  assert.ok(!JSON.stringify(wrongAdmission).includes(h.installations[0].token))
  assert.match((await h.request('GET', '/healthz')).headers.get('cache-control'), /no-store/)
})

test('host and guest remain bound to their admission identities, including approved messages', async t => {
  const h = await harness(t)
  const host = await h.create()
  const wrongInstall = h.installations[2].token
  assert.equal((await h.request('POST', '/v1/join', { inviteCode: host.inviteCode }, h.installations[0].token)).status, 403)
  const guest = await h.join(host)
  const path = `/v1/sessions/${host.sessionId}`
  assert.equal((await h.request('GET', path, undefined, wrongInstall, host.hostToken)).status, 401)
  assert.equal((await h.request('GET', path, undefined, h.installations[1].token, host.hostToken)).status, 401)
  assert.equal((await h.request('GET', path, undefined, h.installations[0].token, guest.guestToken)).status, 401)
  const snap = await h.request('GET', path, undefined, h.installations[0].token, host.hostToken)
  assert.equal(snap.status, 200)
  assert.equal(snap.data.pendingGuestId, guest.guestId)
  assert.equal(snap.data.guestDisplayName, 'Alex')
  assert.equal((await h.request('GET', `${path}/messages?after=0`, undefined, h.installations[1].token, guest.guestToken)).status, 403)
  assert.equal((await h.request('POST', `${path}/approve`, { guestId: guest.guestId }, h.installations[1].token, guest.guestToken)).status, 403)
  assert.equal((await h.request('POST', `${path}/approve`, { guestId: guest.guestId }, h.installations[0].token, host.hostToken)).status, 200)
  const invite = offer()
  assert.equal((await h.request('POST', `${path}/messages`, { kind: 'invite', payload: wire(invite) }, h.installations[0].token, host.hostToken)).status, 202)
  const incoming = await h.request('GET', `${path}/messages?after=0`, undefined, h.installations[1].token, guest.guestToken)
  assert.equal(incoming.status, 200)
  assert.equal(incoming.data.messages.length, 1)
  assert.equal((await h.request('POST', `${path}/messages`, { kind: 'response', payload: wire(answer(invite.sessionId)) }, h.installations[1].token, guest.guestToken)).status, 202)
  assert.equal((await h.request('POST', `${path}/revoke`, {}, h.installations[1].token, guest.guestToken)).status, 403)
  assert.equal((await h.request('POST', `${path}/leave`, {}, h.installations[1].token, guest.guestToken)).status, 200)
  assert.equal((await h.request('GET', path, undefined, h.installations[0].token, host.hostToken)).status, 404)
})

test('revoke installation is operator-only, removes sessions, and denies re-use', async t => {
  const h = await harness(t)
  const host = await h.create()
  const guest = await h.join(host)
  assert.equal(h.server.revokeInstallation('missing_id'), false)
  assert.equal(h.server.revokeInstallation(h.installations[1].id), true)
  assert.equal(h.server.revokeInstallation(h.installations[1].id), false)
  const guestRead = await h.request('GET', `/v1/sessions/${host.sessionId}`, undefined, h.installations[1].token, guest.guestToken)
  assert.equal(guestRead.status, 401)
  assert.equal((await h.request('GET', `/v1/sessions/${host.sessionId}`, undefined, h.installations[0].token, host.hostToken)).status, 404)
  assert.equal((await h.request('POST', '/v1/join', { inviteCode: token() }, h.installations[1].token)).status, 401)
  assert.equal((await h.create()).sessionId.length, 36)
  assert.equal(h.server.revokeInstallation(h.installations[0].id), true)
  assert.equal((await h.request('POST', '/v1/sessions', { permissions: WATCH }, h.installations[0].token)).status, 401)
})

test('distinct admitted installations can sustain ordinary polling behind one loopback proxy socket identity', async t => {
  const h = await harness(t)
  const host = await h.create(); const guest = await h.join(host)
  const path = `/v1/sessions/${host.sessionId}`
  // Two independent clients, 110 reads each, same socket IP and one broker listener.
  for (let i = 0; i < 110; i++) {
    assert.equal((await h.request('GET', path, undefined, h.installations[0].token, host.hostToken)).status, 200, `host ${i}`)
    assert.equal((await h.request('GET', path, undefined, h.installations[1].token, guest.guestToken)).status, 200, `guest ${i}`)
  }
})

test('pilot denies spoofed proxy headers without accepting identity from them', async t => {
  const h = await harness(t)
  const headers = ['X-Forwarded-For', 'Forwarded', 'X-Real-IP', 'X-Forwarded-Proto']
  for (const key of headers) {
    const attempt = await h.request('POST', '/v1/sessions', { permissions: WATCH }, h.installations[0].token, null,
      { [key]: '203.0.113.10' })
    assert.equal(attempt.status, 400)
    assert.equal(attempt.data.error, 'forwarded_headers_forbidden')
  }
  assert.equal((await h.create()).sessionId.length, 36)
})

test('different classes have independent quotas; read budget exhausted without poisoning another installation', async t => {
  const h = await harness(t, { limits: { read: 3, join: 2, create: 2, activePerInstallation: 2 } })
  const first = await h.create()
  const second = await h.create()
  assert.equal((await h.request('POST', '/v1/sessions', { permissions: WATCH }, h.installations[0].token)).status, 429)
  const path = `/v1/sessions/${first.sessionId}`
  for (let i = 0; i < 3; i++) assert.equal((await h.request('GET', path, undefined, h.installations[0].token, first.hostToken)).status, 200)
  assert.equal((await h.request('GET', path, undefined, h.installations[0].token, first.hostToken)).status, 429)
  assert.equal((await h.request('GET', path, undefined, h.installations[1].token, first.hostToken)).status, 401)
  const guest = await h.join(second)
  assert.equal((await h.request('GET', `/v1/sessions/${second.sessionId}`, undefined, h.installations[1].token, guest.guestToken)).status, 200)
})

test('session count, total message memory and payload retries are bounded', async t => {
  const h = await harness(t, { maxSessions: 1, limits: { storedMessageBytes: 200 } })
  const host = await h.create()
  assert.equal((await h.request('POST', '/v1/sessions', { permissions: WATCH }, h.installations[0].token)).status, 503)
  const guest = await h.join(host)
  const path = `/v1/sessions/${host.sessionId}`
  assert.equal((await h.request('POST', `${path}/approve`, { guestId: guest.guestId }, h.installations[0].token, host.hostToken)).status, 200)
  const small = offer()
  const sent = await h.request('POST', `${path}/messages`, { kind: 'invite', payload: wire(small) }, h.installations[0].token, host.hostToken)
  assert.equal(sent.status, 503)
  assert.equal(sent.data.error, 'message_capacity_exceeded')
  assert.equal((await h.request('GET', `${path}/messages?after=0`, undefined, h.installations[1].token, guest.guestToken)).data.messages.length, 0)
  assert.equal((await h.request('POST', `${path}/leave`, {}, h.installations[1].token, guest.guestToken)).status, 200)
  assert.equal((await h.create()).sessionId.length, 36)
})

test('invitation expiry frees capacity and process restart invalidates all ephemeral session state', async t => {
  let clock = Date.now()
  const installed = credentials()
  const h = await harness(t, { now: () => clock, installations: installed, maxSessions: 1 })
  const host = await h.create()
  clock += INVITE_TTL_MS + 5_001
  const next = await h.create()
  assert.notEqual(next.sessionId, host.sessionId)
  assert.equal((await h.request('GET', `/v1/sessions/${host.sessionId}`, undefined, installed[0].token, host.hostToken)).status, 404)
  const restarted = await harness(t, { installations: installed })
  assert.equal((await restarted.request('GET', `/v1/sessions/${next.sessionId}`, undefined, installed[0].token, next.hostToken)).status, 404)
})

test('client remote headers match pilot v1 service through an isolated HTTPS API adapter', async t => {
  const h = await harness(t)
  const approvedOrigin = 'https://signal.capturelink.test'
  const fetchImpl = async (url, init) => {
    assert.equal(new URL(url).origin, approvedOrigin)
    assert.equal(init.redirect, 'error')
    const actual = await fetch(h.root + new URL(url).pathname + new URL(url).search, init)
    return { url, status: actual.status, redirected: false, headers: actual.headers, text: () => actual.text() }
  }
  const make = i => new RemoteSignalingClient({
    enabled: true, endpoint: approvedOrigin, approvedOrigin,
    admissionToken: h.installations[i].token, fetchImpl,
  })
  const host = make(0), guest = make(1)
  const created = await host.create(WATCH)
  const joined = await guest.join(created.inviteCode, { displayName: 'Alex' })
  assert.equal((await host.snapshot()).guestDisplayName, 'Alex')
  await host.approve(joined.guestId)
  assert.equal((await guest.snapshot()).status, 'approved')
  await host.end()
  await assert.rejects(guest.snapshot(), e => e.code === 'not_found')
})

test('revocation during a partially received request cannot create a new invitation', async t => {
  const h = await harness(t)
  const body = JSON.stringify({ permissions: WATCH })
  const url = new URL('/v1/sessions', h.root)
  const req = httpRequest(url, {
    method: 'POST', headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'X-CaptureLink-Admission': `Bearer ${h.installations[0].token}`,
    },
  })
  const response = new Promise((resolve, reject) => {
    req.on('response', res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }))
    })
    req.on('error', reject)
  })
  req.write(body.slice(0, 8))
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(h.server.revokeInstallation(h.installations[0].id), true)
  req.end(body.slice(8))
  assert.equal((await response).status, 401)
})

test('legacy localhost factory is unchanged and ignores no pilot admission headers', async t => {
  const local = createSignalingServer()
  const root = await local.listen()
  t.after(() => local.close())
  const response = await fetch(root + '/v1/sessions', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ permissions: WATCH }) })
  assert.equal(response.status, 201)
})

test('pilot requires JSON, bounds advertised and streamed request sizes, and rejects foreign origin', async t => {
  const h = await harness(t)
  const admitted = h.installations[0].token
  const invalid = await h.request('POST', '/v1/sessions', { permissions: WATCH }, admitted, undefined,
    { 'content-type': 'application/json-never' })
  assert.equal(invalid.status, 415)
  const origin = await h.request('POST', '/v1/sessions', { permissions: WATCH }, admitted, undefined,
    { Origin: 'https://untrusted.test' })
  assert.equal(origin.status, 403)
  const oversized = await h.request('POST', '/v1/sessions', { permissions: WATCH, padding: 'x'.repeat(1_200_001) }, admitted)
  assert.equal(oversized.status, 413)
  assert.equal((await h.create()).sessionId.length, 36)
})

test('one admitted install cannot exhaust another install polling quota, and session quota also applies', async t => {
  const h = await harness(t, { limits: { session: 3, read: 10 } })
  const host = await h.create()
  const guest = await h.join(host)
  const path = `/v1/sessions/${host.sessionId}`
  assert.equal((await h.request('GET', path, undefined, h.installations[0].token, host.hostToken)).status, 200)
  assert.equal((await h.request('GET', path, undefined, h.installations[1].token, guest.guestToken)).status, 200)
  assert.equal((await h.request('GET', path, undefined, h.installations[0].token, host.hostToken)).status, 200)
  assert.equal((await h.request('GET', path, undefined, h.installations[1].token, guest.guestToken)).status, 429)
})

test('unauthenticated guess throttling does not consume legitimate installation quotas', async t => {
  const h = await harness(t)
  for (let i = 0; i < 40; i++) {
    const res = await h.request('POST', '/v1/join', { inviteCode: token() }, token())
    assert.equal(res.status, 401)
  }
  assert.equal((await h.request('POST', '/v1/join', { inviteCode: token() }, token())).status, 429)
  assert.equal((await h.create()).sessionId.length, 36)
})

test('two competing guest joins are serialized: only one may consume a one-use invitation', async t => {
  const h = await harness(t)
  const host = await h.create()
  const results = await Promise.all([
    h.request('POST', '/v1/join', { inviteCode: host.inviteCode }, h.installations[1].token),
    h.request('POST', '/v1/join', { inviteCode: host.inviteCode }, h.installations[2].token),
  ])
  assert.deepEqual(results.map(r => r.status).sort(), [202, 404])
})
