/** UX3F-3B3C1: anonymous guest and approved SDP/ICE through a hermetic HTTPS identity. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { createCaptureLinkAuth0Provider } from '../../../src/main/capturelink-auth0-provider.mjs'
import { createCaptureLinkOnlineHttpsSessionCandidate } from '../../../src/main/capturelink-online-https-session-candidate.mjs'
import { UX3F3B3A_TEST_ORIGIN } from '../../../src/main/capturelink-online-https-host-candidate.mjs'
import { createPublicV2SignalingServer } from '../src/public-v2-server.mjs'

const issuer = 'https://identity.capturelink.test'
const audience = 'https://signal.capturelink.io/v2'
const clientId = 'CaptureLinkOfflineGuestClient'
const watch = Object.freeze({ watch: true, voice: false, controller: false, controllerMode: 'shared' })
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...createPublicKey(pair.privateKey).export({ format: 'jwk' }), kid: 'guest-only', use: 'sig', alg: 'RS256' }
function token(claims = {}) {
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: 'guest-only' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ iss: issuer + '/', sub: 'auth0|offline-guest-fixture',
    aud: audience, azp: clientId, iat: Math.floor(Date.now() / 1000) - 2,
    exp: Math.floor(Date.now() / 1000) + 1200,
    scope: 'openid offline_access sessions:create', permissions: ['sessions:create'], ...claims })).toString('base64url')
  const unsigned = `${header}.${body}`
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), pair.privateKey).toString('base64url')}`
}
function envelope(kind, sessionId, permissions = watch) {
  const data = kind === 'invite'
    ? { version: 1, kind, sessionId, createdAt: Date.now(), permissions, transports: { voice: 'synthetic-voice-sdp-0001' } }
    : { version: 1, kind, sessionId, transports: { voice: 'synthetic-voice-sdp-0002' } }
  return 'CAPTURELINK-SESSION-V1:' + Buffer.from(JSON.stringify(data)).toString('base64url')
}
async function fixture(t) {
  const accounts = new Map([['auth0|offline-guest-fixture', true]])
  const calls = []
  const provider = createCaptureLinkAuth0Provider({ domain: issuer, clientId, audience,
    fetchImpl: async url => {
      assert.equal(url, issuer + '/.well-known/jwks.json')
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
  const broker = createPublicV2SignalingServer({
    expectedIssuer: provider.issuer, expectedAudience: provider.audience,
    verifyHostAccessToken: provider.verifyHostAccessToken,
    isHostActive: async sub => accounts.get(sub) === true,
  })
  const upstream = await broker.listen()
  t.after(() => broker.close())
  const mappedFetch = async (url, init) => {
    assert.equal(new URL(url).origin, UX3F3B3A_TEST_ORIGIN)
    assert.equal(init.redirect, 'error')
    assert.equal(init.cache, 'no-store')
    assert.equal(init.credentials, 'omit')
    assert.equal(init.referrerPolicy, 'no-referrer')
    assert.ok(!('x-capturelink-admission' in init.headers))
    assert.ok(!url.includes('Bearer'))
    calls.push({ path: new URL(url).pathname, method: init.method,
      credential: 'authorization' in init.headers })
    const urlPath = new URL(url).pathname + new URL(url).search
    const response = await fetch(upstream + urlPath, init)
    return { url, redirected: false, status: response.status,
      headers: response.headers, body: response.body }
  }
  const host = createCaptureLinkOnlineHttpsSessionCandidate({ accessToken: token, fetchImpl: mappedFetch })
  const guest = createCaptureLinkOnlineHttpsSessionCandidate({ fetchImpl: mappedFetch })
  t.after(async () => { await guest.end(); await host.end() })
  return { host, guest, mappedFetch, calls, broker, accounts, upstream }
}

test('pinned offline origin, no production/HTTP credential routing', async () => {
  let calls = 0
  const noFetch = () => { calls++; throw Error('unexpected network call') }
  for (const invalid of ['https://signal.capturelink.io', 'http://signal.capturelink.test',
    'https://signal.capturelink.test/', 'https://evil.test', 'https://signal.capturelink.test:443',
    'https://username:password@signal.capturelink.test']) {
    assert.throws(() => createCaptureLinkOnlineHttpsSessionCandidate({ origin: invalid, accessToken: token, fetchImpl: noFetch }),
      /online_signaling_unavailable/)
  }
  const guest = createCaptureLinkOnlineHttpsSessionCandidate({ fetchImpl: noFetch })
  assert.deepEqual(guest.status(), { role: null, active: false })
  await assert.rejects(guest.create(watch), /online_signaling_unavailable/)
  await assert.rejects(guest.join('bad', { displayName: 'Alice' }), /online_signaling_unavailable/)
  assert.equal(calls, 0)
})

test('verified Auth0 host and account-free guest complete explicit approval and SDP/ICE exchange', async t => {
  const { host, guest, calls } = await fixture(t)
  const created = await host.create(watch)
  assert.deepEqual(Object.keys(created).sort(), ['inviteCode', 'inviteExpiresAt'])
  assert.match(created.inviteCode, /^[A-Za-z0-9_-]{43}$/)
  assert.deepEqual(await guest.join(created.inviteCode, { displayName: '  Alice  ' }), { status: 'pending' })
  assert.deepEqual(guest.status(), { role: 'guest', active: true })
  assert.deepEqual(await guest.snapshot(), {
    role: 'guest', status: 'pending', hasPendingGuest: false, guestDisplayName: null, permissions: watch,
  })
  await assert.rejects(guest.send('response', envelope('response', randomUUID())), /online_signaling_unavailable/)
  const hostView = await host.snapshot()
  assert.equal(hostView.hasPendingGuest, true)
  assert.equal(hostView.guestDisplayName, 'Alice')
  assert.equal(hostView.status, 'pending')
  assert.deepEqual(await host.approve(true), { status: 'approved' })
  assert.equal((await guest.snapshot()).status, 'approved')
  assert.equal((await host.snapshot()).status, 'approved')
  const peerId = randomUUID()
  const offer = envelope('invite', peerId)
  assert.deepEqual(await host.send('invite', offer), { sent: true })
  assert.deepEqual(await guest.messages(), [{ kind: 'invite', payload: offer }])
  const response = envelope('response', peerId)
  assert.deepEqual(await guest.send('response', response), { sent: true })
  assert.deepEqual(await host.messages(), [{ kind: 'response', payload: response }])
  assert.deepEqual(await guest.messages(), [])
  assert.deepEqual(await host.messages(), [])
  assert.ok(calls.find(x => x.path === '/v2/sessions' && x.credential))
  assert.ok(calls.find(x => x.path === '/v2/join' && !x.credential))
  for (const visible of [created, host.status(), guest.status(), hostView]) {
    assert.ok(!JSON.stringify(visible).includes('guestSessionToken'))
    assert.ok(!JSON.stringify(visible).includes('hostSessionToken'))
    assert.ok(!JSON.stringify(visible).includes('auth0|'))
  }
  assert.deepEqual(await host.end(), { ended: true })
  assert.deepEqual(host.status(), { role: null, active: false })
  await assert.rejects(guest.snapshot(), /online_signaling_unavailable/)
  assert.deepEqual(await guest.end(), { ended: true })
})

test('rejected guest stays unapproved and no SDP/ICE may be sent', async t => {
  const { host, guest } = await fixture(t)
  const invite = await host.create(watch)
  await guest.join(invite.inviteCode, { displayName: 'Not Verified' })
  assert.equal((await host.snapshot()).status, 'pending')
  assert.deepEqual(await host.approve(false), { status: 'rejected' })
  assert.equal((await guest.snapshot()).status, 'rejected')
  await assert.rejects(guest.send('response', envelope('response', randomUUID())), /online_signaling_unavailable/)
  await assert.rejects(host.send('invite', envelope('invite', randomUUID())), /online_signaling_unavailable/)
})

test('invalid response and redirect fail closed and do not disclose capabilities', async () => {
  const failures = [
    url => ({ url, redirected: true, status: 202, headers: new Headers({ 'content-type': 'application/json' }), body: new Response('{}').body }),
    () => ({ url: 'https://evil.test/v2/join', redirected: false, status: 202, headers: new Headers({ 'content-type': 'application/json' }), body: new Response('{}').body }),
    url => ({ url, redirected: false, status: 302, headers: new Headers({ 'content-type': 'application/json' }), body: new Response('{}').body }),
    url => ({ url, redirected: false, status: 202, headers: new Headers({ 'content-type': 'text/html' }), body: new Response('{}').body }),
    url => ({ url, redirected: false, status: 202, headers: new Headers({ 'content-type': 'application/json', 'content-length': '1200001' }), body: new Response('{}').body }),
    url => ({ url, redirected: false, status: 202, headers: new Headers({ 'content-type': 'application/json' }), body: new Response('x'.repeat(1_200_001)).body }),
  ]
  for (const bad of failures) {
    const guest = createCaptureLinkOnlineHttpsSessionCandidate({ fetchImpl: async url => bad(url) })
    await assert.rejects(guest.join(Buffer.alloc(32, 1).toString('base64url'), { displayName: 'Alice' }),
      e => e.message === 'online_signaling_unavailable')
    assert.deepEqual(guest.status(), { role: null, active: false })
  }
})

test('host deactivation prevents anonymous invitation redemption', async t => {
  const { host, guest, accounts } = await fixture(t)
  const created = await host.create(watch)
  accounts.set('auth0|offline-guest-fixture', false)
  await assert.rejects(guest.join(created.inviteCode, { displayName: 'Alice' }), /online_signaling_unavailable/)
  assert.deepEqual(guest.status(), { role: null, active: false })
})

test('end invalidates guest authority before a delayed successful join response', async t => {
  const { host, mappedFetch, upstream } = await fixture(t)
  const created = await host.create(watch)
  let released
  let reached
  const gate = new Promise(r => { released = r })
  const reachedPromise = new Promise(r => { reached = r })
  const guest = createCaptureLinkOnlineHttpsSessionCandidate({ fetchImpl: async (url, init) => {
    const real = await mappedFetch(url, init)
    if (url.endsWith('/v2/join')) {
      // A fully accepted server response arrives after local cancellation.
      // The mapped adapter intentionally ignores signal cancellation here.
      const bytes = await new Response(real.body).arrayBuffer()
      reached()
      await gate
      return { ...real, body: new Response(bytes).body }
    }
    return real
  } })
  t.after(() => guest.end())
  const pending = guest.join(created.inviteCode, { displayName: 'Alice' })
  await reachedPromise
  const ended = guest.end()
  released()
  await assert.rejects(pending, /online_signaling_unavailable/)
  assert.deepEqual(await ended, { ended: true })
  assert.deepEqual(guest.status(), { role: null, active: false })
  // Anonymous join consumes the code, but cleanup of the late capability
  // must remove its pending guest session even when a response arrived late.
  const probe = await fetch(upstream + '/v2/join', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inviteCode: created.inviteCode, displayName: 'Bob' }),
  })
  assert.equal(probe.status, 404)
})
