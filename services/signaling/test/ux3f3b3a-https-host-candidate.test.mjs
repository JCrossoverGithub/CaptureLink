/** UX3F-3B3A: offline-only HTTPS host candidate. No public service contacted. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaptureLinkAuth0Provider } from '../../../src/main/capturelink-auth0-provider.mjs'
import {
  createCaptureLinkOnlineHttpsHostCandidate, UX3F3B3A_TEST_ORIGIN,
} from '../../../src/main/capturelink-online-https-host-candidate.mjs'
import { createPublicV2SignalingServer } from '../src/public-v2-server.mjs'

const WATCH = Object.freeze({ watch: true, voice: false, controller: false, controllerMode: 'shared' })
const ISSUER = 'https://identity.capturelink.test'
const AUDIENCE = 'https://signal.capturelink.io/v2'
const CLIENT_ID = 'CaptureLinkStageADevClient'
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...createPublicKey(keys.privateKey).export({ format: 'jwk' }), kid: 'stage-a', use: 'sig', alg: 'RS256' }
const jwt = claims => {
  const head = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: 'stage-a' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const unsigned = `${head}.${body}`
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), keys.privateKey).toString('base64url')}`
}
const token = (changes = {}) => jwt({
  iss: ISSUER + '/', sub: 'auth0|offline-host', aud: AUDIENCE, azp: CLIENT_ID,
  iat: Math.floor(Date.now() / 1000) - 2, exp: Math.floor(Date.now() / 1000) + 600,
  scope: 'openid offline_access sessions:create', permissions: ['sessions:create'],
  ...changes,
})
const json = body => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' },
})
async function brokerFixture(t) {
  const accounts = new Map([['auth0|offline-host', true]])
  const provider = createCaptureLinkAuth0Provider({
    domain: ISSUER, clientId: CLIENT_ID, audience: AUDIENCE,
    fetchImpl: async u => {
      assert.equal(u, ISSUER + '/.well-known/jwks.json')
      return json({ keys: [jwk] })
    },
  })
  const broker = createPublicV2SignalingServer({
    expectedIssuer: provider.issuer,
    expectedAudience: provider.audience,
    verifyHostAccessToken: provider.verifyHostAccessToken,
    isHostActive: async subject => accounts.get(subject) === true,
  })
  const loopback = await broker.listen()
  t.after(() => broker.close())
  return { accounts, loopback, broker, provider }
}

// Test adapter is intentionally not a product transport. The source client
// always constructs the exact pinned HTTPS URL; this fixture only maps it to
// an isolated loopback broker without changing production network settings.
function mappedFetch(loopback, capture = []) {
  return async (url, init) => {
    assert.ok(url.startsWith(UX3F3B3A_TEST_ORIGIN + '/v2/'))
    assert.equal(init.redirect, 'error')
    assert.equal(init.cache, 'no-store')
    assert.equal(init.credentials, 'omit')
    assert.equal(init.referrerPolicy, 'no-referrer')
    assert.ok(!url.includes('Bearer'))
    assert.ok(!('x-capturelink-admission' in init.headers))
    capture.push({ target: url, method: init.method, hasAuth: !!init.headers.authorization })
    const path = new URL(url).pathname
    const result = await fetch(loopback + path, init)
    return { status: result.status, redirected: false, url,
      headers: result.headers, body: result.body }
  }
}

test('origin is precisely pinned to offline .test; no localhost, production, URL credentials, or flags', () => {
  let calls = 0
  const fetchImpl = async () => { calls++; throw Error('must not request') }
  const construct = origin => createCaptureLinkOnlineHttpsHostCandidate({ origin, accessToken: token, fetchImpl })
  assert.equal(construct(UX3F3B3A_TEST_ORIGIN).status().hosting, false)
  for (const origin of [
    'https://signal.capturelink.io', 'https://evil.test', 'https://signal.capturelink.test/',
    'https://signal.capturelink.test:443', 'https://SIGNAL.capturelink.test',
    'https://signal.capturelink.test.', 'http://signal.capturelink.test',
    'https://signal.capturelink.test/path', 'https://signal.capturelink.test?x=1',
    'https://user:password@signal.capturelink.test', 'https://127.0.0.1:8443',
    'http://127.0.0.1:8000', null,
  ]) assert.throws(() => construct(origin), /online_signaling_unavailable/, String(origin))
  assert.equal(calls, 0)
})

test('verified synthetic Auth0 JWT creates v2 invite; capability never exits the main-only client', async t => {
  const { loopback } = await brokerFixture(t)
  const captured = []
  const candidate = createCaptureLinkOnlineHttpsHostCandidate({ accessToken: token, fetchImpl: mappedFetch(loopback, captured) })
  const created = await candidate.create(WATCH)
  assert.deepEqual(Object.keys(created).sort(), ['inviteCode', 'inviteExpiresAt'])
  assert.match(created.inviteCode, /^[A-Za-z0-9_-]{43}$/)
  assert.deepEqual(candidate.status(), { hosting: true })
  assert.deepEqual(captured.map(x => [x.method, new URL(x.target).pathname]), [['POST', '/v2/sessions']])
  await assert.rejects(candidate.create(WATCH), /online_signaling_unavailable/)
  assert.deepEqual(await candidate.end(), { ended: true })
  assert.deepEqual(await candidate.end(), { ended: true })
  assert.deepEqual(candidate.status(), { hosting: false })
  assert.equal(captured[1].method, 'POST')
  assert.match(captured[1].target, /\/v2\/sessions\/[a-f0-9-]+\/revoke$/)
  const reused = await fetch(loopback + '/v2/join', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inviteCode: created.inviteCode, displayName: 'Alex' }),
  })
  assert.equal(reused.status, 404)
})

test('server rejects forged issuer, scope, permissions and inactive host', async t => {
  const { loopback, accounts } = await brokerFixture(t)
  for (const given of [
    token({ iss: 'https://evil.test/' }), token({ aud: 'wrong' }),
    token({ permissions: [] }), token({ scope: 'openid' }),
    token({ exp: Math.floor(Date.now() / 1000) - 30 }),
  ]) {
    const client = createCaptureLinkOnlineHttpsHostCandidate({
      accessToken: () => given, fetchImpl: mappedFetch(loopback),
    })
    await assert.rejects(client.create(WATCH), /online_signaling_unavailable/)
    assert.equal(client.status().hosting, false)
  }
  accounts.set('auth0|offline-host', false)
  const client = createCaptureLinkOnlineHttpsHostCandidate({ accessToken: token, fetchImpl: mappedFetch(loopback) })
  await assert.rejects(client.create(WATCH), /online_signaling_unavailable/)
  assert.equal(client.status().hosting, false)
})

test('rejects stale token, invalid permissions, redirect, mismatched URL and oversized response', async () => {
  let calls = 0
  const network = async () => { calls++; throw Error('should not request') }
  for (const getter of [() => null, () => 'bad', () => { throw Error('SECRET TOKEN') }]) {
    const client = createCaptureLinkOnlineHttpsHostCandidate({ accessToken: getter, fetchImpl: network })
    await assert.rejects(client.create(WATCH), e => e.message === 'online_signaling_unavailable')
  }
  const client = createCaptureLinkOnlineHttpsHostCandidate({ accessToken: token, fetchImpl: network })
  await assert.rejects(client.create({ ...WATCH, controllerMode: 'invalid' }), /online_signaling_unavailable/)
  assert.equal(calls, 0)
  const bad = [
    (url) => ({ url, redirected: true, status: 201, headers: new Headers({ 'content-type': 'application/json' }) }),
    () => ({ url: 'https://attacker.test/v2/sessions', redirected: false, status: 201, headers: new Headers({ 'content-type': 'application/json' }) }),
    url => ({ url, redirected: false, status: 201, headers: new Headers({ 'content-type': 'text/html' }) }),
    url => ({ url, redirected: false, status: 201, headers: new Headers({ 'content-type': 'application/json' }), body: new Response('x'.repeat(20_000)).body }),
    url => ({ url, redirected: false, status: 201, headers: new Headers({ 'content-type': 'application/json', 'content-length': '300000' }), body: new Response('{}').body }),
  ]
  for (const fn of bad) {
    const instance = createCaptureLinkOnlineHttpsHostCandidate({ accessToken: token,
      fetchImpl: async (url, init) => { assert.equal(init.redirect, 'error'); return fn(url) },
    })
    await assert.rejects(instance.create(WATCH), e => e.message === 'online_signaling_unavailable')
    assert.equal(instance.status().hosting, false)
  }
})

test('concurrent create blocked; end cancels pending host creation and rejects late response', async () => {
  let resolve
  const wait = new Promise(r => { resolve = r })
  const client = createCaptureLinkOnlineHttpsHostCandidate({ accessToken: token,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/revoke')) return { url, redirected: false, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: new Response('{"status":"closed"}').body }
      await wait
      return { url, redirected: false, status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: new Response(JSON.stringify({ version: 2,
          sessionId: '00000000-0000-4000-8000-000000000001',
          hostSessionToken: Buffer.alloc(32, 3).toString('base64url'),
          inviteCode: Buffer.alloc(32, 4).toString('base64url'),
          inviteExpiresAt: Date.now() + 60_000,
          sessionExpiresAt: Date.now() + 5 * 60_000,
        })).body }
    },
  })
  const first = client.create(WATCH)
  await assert.rejects(client.create(WATCH), /online_signaling_unavailable/)
  await client.end()
  resolve()
  await assert.rejects(first, /online_signaling_unavailable/)
  assert.deepEqual(client.status(), { hosting: false })
})

// Test-only temporary TLS certificate, never saved in repository or used by
// the product. Openssl is an optional test prerequisite for this one test.
async function tlsFixture(t, upstream) {
  const dir = await mkdtemp(join(tmpdir(), 'capturelink-ux3f3b3a-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const keyPath = join(dir, 'server.key'), certPath = join(dir, 'server.crt')
  const openssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=signal.capturelink.test',
    '-addext', 'subjectAltName=DNS:signal.capturelink.test'], { encoding: 'utf-8', timeout: 15_000 })
  if (openssl.status !== 0) throw Error('openssl unavailable or certificate generation failed')
  const cert = await readFile(certPath)
  const key = await readFile(keyPath)
  const server = createHttpsServer({ key, cert }, async (req, res) => {
    try {
      assert.equal(req.headers.host, 'signal.capturelink.test')
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      const proxied = await fetch(upstream + req.url, { method: req.method,
        headers: {
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
          ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
        }, ...(body.length ? { body } : {}),
      })
      const payload = Buffer.from(await proxied.arrayBuffer())
      res.writeHead(proxied.status, { 'content-type': proxied.headers.get('content-type') || 'application/json' })
      res.end(payload)
    } catch { res.writeHead(502); res.end('') }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  return { cert, port: server.address().port }
}

function trustedTlsFetch({ cert, port }, trust = true) {
  return (url, init) => new Promise((resolve, reject) => {
    const target = new URL(url)
    assert.equal(target.origin, UX3F3B3A_TEST_ORIGIN)
    const req = httpsRequest({
      hostname: target.hostname, path: target.pathname, port, method: init.method,
      headers: { ...init.headers, host: target.hostname },
      servername: target.hostname, ca: trust ? cert : [], rejectUnauthorized: true,
      lookup: (host, options, callback) => options.all
        ? callback(null, [{ address: '127.0.0.1', family: 4 }])
        : callback(null, '127.0.0.1', 4),
      signal: init.signal,
    }, res => {
      const pieces = []
      res.on('data', part => pieces.push(part))
      res.on('end', () => {
        const web = new Response(Buffer.concat(pieces), {
          status: res.statusCode, headers: res.headers,
        })
        resolve({ url, status: web.status, redirected: false,
          headers: web.headers, body: web.body })
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    if (init.body) req.write(init.body)
    req.end()
  })
}

test('real TLS edge: explicitly trusted test certificate works; untrusted certificate fails closed', async t => {
  const { loopback } = await brokerFixture(t)
  const edge = await tlsFixture(t, loopback)
  const trusted = createCaptureLinkOnlineHttpsHostCandidate({ accessToken: token, fetchImpl: trustedTlsFetch(edge) })
  const created = await trusted.create(WATCH)
  assert.match(created.inviteCode, /^[\w-]{43}$/)
  assert.deepEqual(await trusted.end(), { ended: true })
  const untrusted = createCaptureLinkOnlineHttpsHostCandidate({ accessToken: token,
    fetchImpl: trustedTlsFetch(edge, false) })
  await assert.rejects(untrusted.create(WATCH), e => e.message === 'online_signaling_unavailable')
  assert.deepEqual(untrusted.status(), { hosting: false })
})
