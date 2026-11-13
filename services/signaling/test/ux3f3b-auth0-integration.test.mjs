/** UX3F-3B1: all Auth0 exchanges/JWKS synthetic, broker bound only to loopback. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createPublicKey, sign, randomUUID } from 'node:crypto'
import { createCaptureLinkAuth0Provider } from '../../../src/main/capturelink-auth0-provider.mjs'
import { createCaptureLinkOnlineAuth } from '../../../src/main/capturelink-online-auth.mjs'
import { createCaptureLinkOnlineLoopback } from '../../../src/main/capturelink-online-loopback.mjs'
import { createLocalV2SignalingClient } from '../../../src/main/capturelink-online-v2-client.mjs'
import { createPublicV2SignalingServer } from '../src/public-v2-server.mjs'

const BASE = 'https://identity.example.test'
const CLIENT = 'CaptureLinkDevPublicClient'
const AUDIENCE = 'https://signal.capturelink.io/v2'
const WATCH = { watch: true, voice: false, controller: false, controllerMode: 'shared' }
const now = () => Date.now()
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...createPublicKey(keys.privateKey).export({ format: 'jwk' }), kid: 'key-A', kty: 'RSA', alg: 'RS256', use: 'sig' }
const json = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
const jwt = (claims, overrides = {}) => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'key-A', ...overrides })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const input = `${header}.${payload}`
  const sig = sign('RSA-SHA256', Buffer.from(input), keys.privateKey).toString('base64url')
  return `${input}.${sig}`
}
const baseClaims = (aud, sub = 'auth0|test-user') => ({ iss: BASE + '/', aud, sub,
  azp: CLIENT, iat: Math.floor(now() / 1000) - 2, exp: Math.floor(now() / 1000) + 1800 })
const access = (changes = {}) => jwt({ ...baseClaims(AUDIENCE), scope: 'openid offline_access sessions:create',
  permissions: ['sessions:create'], ...changes })
const idToken = nonce => jwt({ ...baseClaims(CLIENT), nonce })
function providerFixture({ alterAccess = x => x, jwks = { keys: [jwk] }, http = null } = {}) {
  const calls = []
  let currentNonce = null
  let counter = 0
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options })
    if (http) return http(url, options)
    if (url === `${BASE}/.well-known/jwks.json`) return json(jwks)
    if (url === `${BASE}/oauth/token`) {
      const p = new URLSearchParams(options.body)
      if (p.get('grant_type') === 'authorization_code') {
        assert.equal(p.get('client_id'), CLIENT)
        assert.ok(p.get('code_verifier'))
        return json({ token_type: 'Bearer', access_token: alterAccess(access()),
          id_token: idToken(currentNonce), refresh_token: 'refresh-test-token-a-' + ++counter })
      }
      if (p.get('grant_type') === 'refresh_token') {
        return json({ token_type: 'Bearer', access_token: alterAccess(access()),
          refresh_token: 'refresh-test-token-a-' + ++counter })
      }
    }
    throw Error('unexpected request')
  }
  const provider = createCaptureLinkAuth0Provider({ domain: BASE, clientId: CLIENT, audience: AUDIENCE,
    fetchImpl, now })
  return { provider, calls, setNonce: n => { currentNonce = n } }
}
const makeAuth = (provider, redirectUri, openBrowser, vault) => createCaptureLinkOnlineAuth({
  issuer: provider.issuer, authorizationEndpoint: provider.authorizationEndpoint,
  redirectUri, clientId: CLIENT, audience: AUDIENCE, scope: provider.scope,
  openBrowser, exchangeCode: provider.exchangeCode, exchangeRefresh: provider.exchangeRefresh,
  verifyTokens: provider.verifyTokens, vault,
})
const fakeVault = () => {
  let record
  return { async load() { return record }, async save(v) { record = v },
    async clear() { record = null }, peek() { return record } }
}

test('rejects unsafe provider config; public client needs no secret', () => {
  for (const domain of ['http://identity.example.test', 'http://127.0.0.1',
    'https://example.test/x', 'https://example.test?query=x', 'https://example.test:444/']) {
    assert.throws(() => createCaptureLinkAuth0Provider({ domain, clientId: CLIENT, audience: AUDIENCE }), /online_auth_unavailable/)
  }
  const { provider } = providerFixture()
  assert.equal(provider.scope, 'openid offline_access sessions:create')
  assert.ok(!Object.keys(provider).some(x => x.toLowerCase().includes('secret')))
})

test('real RS256/JWKS verifies Auth0 API claims and blocks signature, issuer, audience, azp, RBAC, expiry and scope forgery', async () => {
  const { provider } = providerFixture()
  const expectedExp = Math.floor(now() / 1000) + 1800
  assert.deepEqual(await provider.verifyHostAccessToken(access({ exp: expectedExp })), {
    iss: BASE, aud: AUDIENCE, sub: 'auth0|test-user', exp: expectedExp,
    scope: ['sessions:create'],
  })
  const original = access()
  const pieces = original.split('.')
  const badPayload = { ...baseClaims(AUDIENCE), permissions: ['sessions:create'], scope: 'sessions:create', sub: 'auth0|attacker' }
  const forged = `${pieces[0]}.${Buffer.from(JSON.stringify(badPayload)).toString('base64url')}.${pieces[2]}`
  assert.equal(await provider.verifyHostAccessToken(forged), null)
  for (const token of [
    access({ iss: 'https://evil.test/' }), access({ aud: 'other' }),
    access({ azp: 'other-client' }), access({ permissions: [] }), access({ scope: 'openid' }),
    access({ aud: [AUDIENCE, 'https://example.test/other'], azp: 'wrong-client' }),
    access({ exp: Math.floor(now() / 1000) - 1 }),
    access({ nbf: Math.floor(now() / 1000) + 3600 }),
    jwt({ ...baseClaims(AUDIENCE), scope: 'sessions:create', permissions: ['sessions:create'] }, { alg: 'none' }),
  ]) assert.equal(await provider.verifyHostAccessToken(token), null)
})

test('rejects invalid JWKS, unknown kid, HTTP redirects, and mismatched OIDC ID-token nonce', async () => {
  assert.equal(await providerFixture({ jwks: { keys: [{ ...jwk, n: 'AAAA' }] } }).provider.verifyHostAccessToken(access()), null)
  assert.equal(await providerFixture({ jwks: { keys: [] } }).provider.verifyHostAccessToken(access()), null)
  assert.equal(await providerFixture({ jwks: { keys: [jwk, jwk] } }).provider.verifyHostAccessToken(access()), null)
  const redirect = providerFixture({ http: () => new Response('redirect', { status: 302, headers: {location: 'https://evil.test'} }) })
  assert.equal(await redirect.provider.verifyHostAccessToken(access()), null)
  const { provider } = providerFixture()
  await assert.rejects(provider.verifyTokens({ tokens: { accessToken: access(), idToken: idToken('bad-nonce') },
    issuer: BASE, audience: AUDIENCE, clientId: CLIENT, nonce: 'expected-nonce' }), /online_auth_unavailable/)
})

test('loopback listener binds before browser, Auth0 authorize includes audience+PKCE, callback exchanges one code, credentials stay main-only', async t => {
  const f = providerFixture()
  const vault = fakeVault()
  let auth
  let browserUrl
  const listener = createCaptureLinkOnlineLoopback({ port: 0,
    onRedirect: async uri => auth.completeRedirect(uri) })
  t.after(() => listener.close())
  const redirectUri = await listener.listen()
  auth = makeAuth(f.provider, redirectUri, async url => { browserUrl = url }, vault)
  assert.deepEqual(await auth.beginLogin(), { started: true })
  const authorization = new URL(browserUrl)
  assert.equal(authorization.origin, BASE)
  assert.equal(authorization.searchParams.get('audience'), AUDIENCE)
  assert.equal(authorization.searchParams.get('scope'), f.provider.scope)
  assert.equal(authorization.searchParams.get('redirect_uri'), redirectUri)
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
  f.setNonce(authorization.searchParams.get('nonce'))
  const callback = new URL(redirectUri)
  callback.searchParams.set('code', 'dev-auth0-authorization-code-123456')
  callback.searchParams.set('state', authorization.searchParams.get('state'))
  callback.searchParams.set('iss', BASE + '/')
  const response = await fetch(callback)
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.ok(!html.includes('code='))
  assert.deepEqual(await listener.wait(), { authenticated: true })
  assert.deepEqual(auth.status(), { authenticated: true })
  assert.ok(vault.peek()?.refreshToken)
  assert.equal(f.calls.filter(c => c.url.endsWith('oauth/token')).length, 1)
  await assert.rejects(auth.completeRedirect(callback.href), /online_auth_unavailable/)
  assert.deepEqual(await auth.renew(), { authenticated: true })
  assert.notEqual(vault.peek().refreshToken, 'refresh-test-token-a-1')
  await auth.signOut()
  assert.equal(vault.peek(), null)
  assert.equal(auth.accessToken(), null)
})

test('loopback rejects wrong Host, bearer header, path and malformed callback; no token exchange', async t => {
  const f = providerFixture()
  let auth
  const listener = createCaptureLinkOnlineLoopback({ port: 0, onRedirect: url => auth.completeRedirect(url) })
  t.after(() => listener.close())
  const uri = await listener.listen()
  let authorize
  auth = makeAuth(f.provider, uri, async url => { authorize = new URL(url) }, fakeVault())
  await auth.beginLogin()
  assert.equal((await fetch(uri.replace('/callback', '/wrong'))).status, 404)
  assert.equal((await fetch(uri + '?code=fake&state=fake', { headers: { authorization: 'Bearer rejected' } })).status, 404)
  const callback = new URL(uri)
  callback.searchParams.set('code', 'authorization-code-valid-long-123')
  callback.searchParams.set('state', authorize.searchParams.get('state'))
  callback.searchParams.append('state', authorize.searchParams.get('state'))
  assert.equal((await fetch(callback)).status, 400)
  await assert.rejects(listener.wait(), /online_auth_unavailable/)
  assert.equal(f.calls.length, 0)
  assert.equal(auth.accessToken(), null)
})

test('signed Auth0 token creates v2 session; account-free guest must be approved before signaling; local bearer isolation', async t => {
  const f = providerFixture()
  // A main-process coordinator feeds verified Auth0 tokens into the isolated v2 client.
  let browser
  const a = makeAuth(f.provider, 'http://127.0.0.1:49153/capturelink-online/callback',
    async url => { browser = new URL(url); f.setNonce(browser.searchParams.get('nonce')) }, fakeVault())
  await a.beginLogin()
  const cb = new URL('http://127.0.0.1:49153/capturelink-online/callback')
  cb.searchParams.set('code', 'authorization-code-valid-long-123')
  cb.searchParams.set('state', browser.searchParams.get('state'))
  await a.completeRedirect(cb.href)
  const accounts = new Map([['auth0|test-user', true]])
  const broker = createPublicV2SignalingServer({
    expectedIssuer: f.provider.issuer, expectedAudience: AUDIENCE,
    verifyHostAccessToken: f.provider.verifyHostAccessToken,
    isHostActive: async subject => accounts.get(subject) === true,
  })
  const endpoint = await broker.listen()
  t.after(() => broker.close())
  const host = createLocalV2SignalingClient({ origin: endpoint, accessToken: () => a.accessToken() })
  const guest = createLocalV2SignalingClient({ origin: endpoint, accessToken: () => { throw Error('guest must not need host identity') } })
  const created = await host.create(WATCH)
  assert.match(created.inviteCode, /^[A-Za-z0-9_-]{43}$/)
  assert.deepEqual(Object.keys(created).sort(), ['inviteCode', 'inviteExpiresAt'])
  assert.equal(host.role, 'host')
  await guest.join(created.inviteCode, { displayName: 'Friend' })
  const snap = await host.snapshot()
  assert.equal(snap.status, 'pending')
  assert.equal(snap.guestDisplayName, 'Friend')
  const uuid = randomUUID()
  const wire = payload => 'CAPTURELINK-SESSION-V1:' + Buffer.from(JSON.stringify(payload)).toString('base64url')
  const invitation = wire({ version: 1, kind: 'invite', sessionId: uuid, createdAt: now(), permissions: WATCH,
    transports: { voice: 'voice-offer-abcdefgh' } })
  await assert.rejects(host.send('invite', invitation), /online_signaling_unavailable/)
  await host.approve(snap.pendingGuestId)
  await host.send('invite', invitation)
  assert.deepEqual((await guest.messages()).map(m => m.payload), [invitation])
  const answer = wire({ version: 1, kind: 'response', sessionId: uuid,
    transports: { voice: 'voice-answer-abcdefgh' } })
  await guest.send('response', answer)
  assert.deepEqual((await host.messages()).map(m => m.payload), [answer])
  await host.end()
  await assert.rejects(guest.snapshot(), /online_signaling_unavailable/)
  await guest.end()
})

test('v2 client refuses nonloopback origin, concurrent hosting and credential exposure', async () => {
  for (const origin of ['https://signal.capturelink.io', 'http://localhost:3000',
    'http://127.0.0.1:3000/path', 'http://127.0.0.1:3000@evil.test']) {
    assert.throws(() => createLocalV2SignalingClient({ origin, accessToken: () => access() }), /online_signaling_unavailable/)
  }
  let unlock
  const pending = new Promise(resolve => { unlock = resolve })
  let requests = 0
  const client = createLocalV2SignalingClient({ origin: 'http://127.0.0.1:49152',
    accessToken: () => access(),
    fetchImpl: async () => { requests++; await pending; return json({ version: 2, sessionId: randomUUID(),
      hostSessionToken: Buffer.alloc(32, 1).toString('base64url'),
      inviteCode: Buffer.alloc(32, 2).toString('base64url'), inviteExpiresAt: now() + 10000 }) },
  })
  const first = client.create(WATCH)
  await assert.rejects(client.create(WATCH), /online_signaling_unavailable/)
  await assert.rejects(client.end(), /online_signaling_unavailable/)
  unlock()
  const result = await first
  assert.deepEqual(Object.keys(result).sort(), ['inviteCode', 'inviteExpiresAt'])
  assert.equal(requests, 1)
})

test('loopback callback timeout rejects and never returns a bearer to the browser', async t => {
  const listener = createCaptureLinkOnlineLoopback({ port: 0, timeoutMs: 100, onRedirect: async () => ({authenticated:true}) })
  t.after(() => listener.close())
  await listener.listen()
  await assert.rejects(listener.wait(), /online_auth_unavailable/)
})
