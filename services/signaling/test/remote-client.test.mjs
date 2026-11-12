import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createSignalingServer } from '../src/server.mjs'
import { LocalSignalingClient, RemoteSignalingClient, SignalingClientError } from '../src/client.mjs'
import { createSignalingClientForMain } from '../../../src/main/ux3c-signaling-client.mjs'

const ORIGIN = 'https://signal.capturelink.test'
const ADMISSION = randomBytes(32).toString('base64url')
const WATCH = { watch: true, voice: false, controller: false, controllerMode: 'shared' }
const remote = (options = {}) => new RemoteSignalingClient({
  endpoint: ORIGIN, approvedOrigin: ORIGIN, admissionToken: ADMISSION, enabled: true, ...options,
})

test('default desktop selector remains pinned to the original localhost client', () => {
  const original = createSignalingClientForMain()
  assert.ok(original instanceof LocalSignalingClient)
  assert.equal(original.role, null)
  for (const config of [
    { mode: 'remote' },
    { mode: 'remote', remote: { enabled: false, endpoint: ORIGIN, approvedOrigin: ORIGIN, admissionToken: ADMISSION } },
    { mode: 'local', remote: { enabled: true } },
    { mode: 'internet' },
  ]) assert.throws(() => createSignalingClientForMain(config), e => e instanceof SignalingClientError)
  assert.throws(() => new LocalSignalingClient({ endpoint: ORIGIN }), e => e.code === 'endpoint_not_loopback')
})

test('remote constructor rejects insecure, ambiguous, unexpected and userinfo origins before network', () => {
  let calls = 0
  const fetchImpl = async () => { calls++; throw Error('unreachable') }
  const invalid = [
    'http://signal.capturelink.test', 'http://127.0.0.1:8787',
    'https://127.0.0.1', 'https://localhost', 'https://localhost:443',
    'https://[::1]', 'https://192.168.1.1',
    'https://host.local', 'https://host.internal', 'https://host.onion',
    'https://signal.capturelink.test/path', 'https://signal.capturelink.test/?x=1',
    'https://signal.capturelink.test/#secret', 'https://user:pass@signal.capturelink.test',
    'https://signal.capturelink.test@attacker.test',
    'https://signal.capturelink.test.attacker.test',
    'https://SIGNAL.capturelink.test', 'https://signal.capturelink.test.',
    'https://signal.capturelink.test:443',
    'https://signal.capturelink.test//',
    'https://signal.capturelink.test\\@attacker.test',
    'https://signal.capturelink.test%2f.attacker.test',
    'https://evil.test', '', null, 10,
  ]
  for (const endpoint of invalid) {
    assert.throws(() => remote({ endpoint, fetchImpl }), e =>
      e instanceof SignalingClientError && ['invalid_remote_endpoint', 'remote_origin_not_approved'].includes(e.code), String(endpoint))
  }
  assert.equal(calls, 0)
  assert.throws(() => remote({ approvedOrigin: 'https://evil.test', fetchImpl }), e => e.code === 'remote_origin_not_approved')
  assert.throws(() => remote({ enabled: false, fetchImpl }), e => e.code === 'remote_disabled')
  assert.throws(() => remote({ admissionToken: null, fetchImpl }), e => e.code === 'remote_admission_required')
  assert.throws(() => remote({ admissionToken: 'x', fetchImpl }), e => e.code === 'remote_admission_required')
  assert.throws(() => remote({ fetchImpl: null }), e => e.code === 'invalid_client_configuration')
  assert.equal(calls, 0)
})

test('fully gated main-process candidate can exchange approved host/guest signaling through an HTTPS contract fixture', async t => {
  // Hermetic transport fixture: the HTTPS origin is *simulated* while the
  // existing trusted loopback broker exercises real v1 request/response logic.
  // This is not a real TLS certificate or internet deployment test.
  const broker = createSignalingServer()
  const local = await broker.listen()
  t.after(() => broker.close())
  const captures = []
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url)
    assert.equal(parsed.origin, ORIGIN)
    assert.equal(init.redirect, 'error')
    assert.equal(init.cache, 'no-store')
    assert.equal(init.headers['X-CaptureLink-Admission'], `Bearer ${ADMISSION}`)
    assert.ok(!url.includes(ADMISSION))
    assert.ok(!url.includes('Bearer '))
    captures.push({ method: init.method, path: parsed.pathname, hasRoleBearer: Boolean(init.headers.Authorization) })
    const actual = await fetch(local + parsed.pathname + parsed.search, init)
    return {
      status: actual.status, headers: actual.headers, redirected: false,
      url, text: () => actual.text(),
    }
  }
  const make = () => createSignalingClientForMain({
    mode: 'remote', remote: { enabled: true, endpoint: ORIGIN, approvedOrigin: ORIGIN, admissionToken: ADMISSION },
    fetchImpl,
  })
  const host = make(), guest = make()
  assert.ok(host instanceof RemoteSignalingClient)
  const created = await host.create(WATCH)
  assert.match(created.inviteCode, /^[A-Za-z0-9_-]{43}$/)
  const join = await guest.join(created.inviteCode, { displayName: 'Alex' })
  assert.equal(join.status, 'pending')
  const pending = await host.snapshot()
  assert.equal(pending.guestDisplayName, 'Alex')
  assert.equal(pending.pendingGuestId, join.guestId)
  await assert.rejects(guest.messages(), e => e.code === 'not_approved')
  await host.approve(join.guestId)
  assert.equal((await guest.snapshot()).status, 'approved')
  assert.ok(captures.some(c => c.path === '/v1/sessions' && !c.hasRoleBearer))
  assert.ok(captures.some(c => c.path.startsWith('/v1/sessions/') && c.hasRoleBearer))
  assert.equal((await host.messages()).length, 0)
  await host.end()
  await assert.rejects(guest.snapshot(), e => e.code === 'not_found')
  guest.clearLocal()
  assert.equal(host.role, null)
  assert.equal(guest.role, null)
})

test('redirects, unexpected origin and invalid JSON fail closed without transmitting tokens to another origin', async () => {
  let calls = 0
  let lastOptions
  const wrongOrigin = remote({ fetchImpl: async (_url, init) => {
    calls++; lastOptions = init
    return { redirected: true, url: 'https://attacker.test/v1/sessions', status: 200,
      headers: new Headers({ 'content-type': 'application/json' }), text: async () => '{}' }
  } })
  await assert.rejects(wrongOrigin.create(WATCH), e => e.code === 'invalid_server_response')
  assert.equal(calls, 1)
  assert.equal(lastOptions.redirect, 'error')
  assert.equal(wrongOrigin.role, null)
  const mismatched = remote({ fetchImpl: async () => ({
    redirected: false, url: 'https://attacker.test/v1/sessions', status: 200,
    headers: new Headers({ 'content-type': 'application/json' }), text: async () => '{}',
  }) })
  await assert.rejects(mismatched.create(WATCH), e => e.code === 'invalid_server_response')
  const badJson = remote({ fetchImpl: async url => ({
    redirected: false, url, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => 'Bearer Secret\nICE 192.0.2.10',
  }) })
  await assert.rejects(badJson.create(WATCH), e => e.code === 'invalid_server_response' && !e.message.includes('192.0.2.10'))
})

test('simulated certificate rejection, timeout and cancellation never reveal secrets or retry via HTTP', async () => {
  const seen = []
  const tlsFailure = remote({ fetchImpl: async (url, init) => {
    seen.push([url, init.redirect])
    throw new TypeError('certificate expired; Bearer PRIVATE SECRET')
  } })
  await assert.rejects(tlsFailure.create(WATCH), e => e.code === 'network_unavailable' && !e.message.includes('PRIVATE'))
  assert.deepEqual(seen, [[ORIGIN + '/v1/sessions', 'error']])

  let requests = 0
  const cancelled = remote({ fetchImpl: async () => { requests++; throw Error('should not be called') } })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(cancelled.create(WATCH, { signal: controller.signal }), e => e.code === 'cancelled')
  assert.equal(requests, 0)

  const timeout = remote({ requestTimeoutMs: 100, fetchImpl: async (_url, init) => {
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  } })
  await assert.rejects(timeout.create(WATCH), e => e.code === 'request_timeout')
})

test('remote response size, media-type and server errors are bounded and sanitized', async () => {
  const cases = [
    { headers: new Headers({ 'content-type': 'text/html' }), text: '{}', code: 'invalid_server_response' },
    { headers: new Headers({ 'content-type': 'application/json', 'content-length': '2000000' }), text: '{}', code: 'response_too_large' },
    { headers: new Headers({ 'content-type': 'application/json' }), text: '{"error":"oops credential HTTP://host"}', status: 403, code: 'server_rejected' },
    { headers: new Headers({ 'content-type': 'application/json' }), text: ' '.repeat(1_200_001), code: 'response_too_large' },
  ]
  for (const c of cases) {
    const client = remote({ fetchImpl: async url => ({ url, redirected: false, status: c.status || 200, headers: c.headers, text: async () => c.text }) })
    await assert.rejects(client.create(WATCH), e => e.code === c.code && !e.message.includes('credential'))
  }
})

test('real Node Fetch rejects an ephemeral untrusted TLS server (no certificate bypass)', async t => {
  const { untrustedTlsFixture } = await import('./ux3c1-tls-fixture.mjs')
  const fixture = await untrustedTlsFixture()
  t.after(() => fixture.close())
  let calls = 0
  const client = remote({ fetchImpl: async (_approvedUrl, init) => {
    // Test-only network adapter routes the approved fixture origin to the
    // ephemeral loopback TLS listener; no DNS, public network or real service.
    calls++
    return fetch(fixture.url + '/v1/sessions', init)
  } })
  await assert.rejects(client.create(WATCH), e => e.code === 'network_unavailable' && !e.message.includes('CERTIFICATE'))
  assert.equal(calls, 1)
  assert.equal(client.role, null)
})

test('a streaming oversized remote response is rejected without draining unbounded data', async () => {
  let chunksRead = 0
  const fetchImpl = async url => ({
    url, redirected: false, status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => { throw Error('stream fixture must use bounded reader') },
    body: new ReadableStream({
      pull(controller) {
        chunksRead++
        controller.enqueue(new Uint8Array(900_000))
      },
    }),
  })
  const client = remote({ fetchImpl })
  await assert.rejects(client.create(WATCH), e => e.code === 'response_too_large')
  assert.ok(chunksRead <= 4, `Read unexpectedly many chunks: ${chunksRead}`)
})
