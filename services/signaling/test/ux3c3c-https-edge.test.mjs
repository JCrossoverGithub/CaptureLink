/**
 * UX3c-3c offline HTTPS integration gate. All listeners bind 127.0.0.1.
 * OpenSSL-generated ephemeral self-signed CERTIFICATES ARE TEST-ONLY.
 * This test intentionally does NOT configure a public Caddy instance,
 * a desktop remote toggle, or a global TLS trust bypass.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { createPilotSignalingServer } from '../src/server.mjs'
import { RemoteSignalingClient } from '../src/client.mjs'

const ORIGIN = 'https://signal.capturelink.test'
const HOST = 'signal.capturelink.test'
const WATCH = Object.freeze({ watch: true, voice: false, controller: false, controllerMode: 'shared' })
const token = () => randomBytes(32).toString('base64url')

async function ephemeralCertificate(t) {
  const dir = await mkdtemp(join(tmpdir(), 'capturelink-ux3c3c-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const keyFile = join(dir, 'edge.key')
  const certFile = join(dir, 'edge.crt')
  const result = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
    '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1',
    '-subj', `/CN=${HOST}`, '-addext', `subjectAltName=DNS:${HOST}`,
  ], { encoding: 'utf8', timeout: 10_000 })
  assert.equal(result.status, 0, 'OpenSSL must generate ephemeral test-only TLS credentials')
  const [key, cert] = await Promise.all([readFile(keyFile), readFile(certFile)])
  return { key, cert }
}

async function serveLoopback(server, t) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  assert.equal(server.address().address, '127.0.0.1')
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections?.()
    server.close(error => error ? reject(error) : resolve())
  }))
  return server.address().port
}

function proxyForTest(upstreamPort, tls) {
  // Simulates the reviewed Caddy edge's security properties; it is NOT
  // deployable or a substitute for validating the actual Caddy configuration.
  return createHttpsServer(tls, (req, res) => {
    if (req.headers.host !== HOST || req.url === '/healthz') {
      res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); return
    }
    const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}` }
    for (const k of Object.keys(headers)) {
      if (k === 'forwarded' || k === 'x-real-ip' || k === 'cf-connecting-ip' ||
          k === 'true-client-ip' || k.startsWith('x-forwarded-')) delete headers[k]
    }
    const upstream = httpRequest({
      hostname: '127.0.0.1', port: upstreamPort, path: req.url,
      method: req.method, headers, agent: false,
    }, target => {
      res.writeHead(target.statusCode, target.headers)
      target.pipe(res)
    })
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
      res.end('{"error":"upstream_unavailable"}')
    })
    req.pipe(upstream)
  })
}

function tlsFetchAdapter({ edgePort, cert, trusted = true }) {
  return async (url, init = {}) => {
    const parsed = new URL(url)
    assert.equal(parsed.origin, ORIGIN, 'only approved origin may be requested')
    assert.equal(init.redirect, 'error', 'redirects must not follow')
    assert.equal(init.cache, 'no-store')
    return await new Promise((resolve, reject) => {
      const req = httpsRequest({
        host: '127.0.0.1', port: edgePort, servername: HOST, method: init.method,
        path: parsed.pathname + parsed.search, headers: { host: HOST, ...init.headers },
        ...(trusted ? { ca: cert } : {}), rejectUnauthorized: true, agent: false,
        signal: init.signal,
      }, response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => {
          const body = Buffer.concat(chunks)
          resolve({
            url, redirected: false, status: response.statusCode,
            headers: new Headers(response.headers),
            text: async () => body.toString('utf8'),
          })
        })
        response.on('error', reject)
      })
      req.on('error', reject)
      req.end(init.body)
    })
  }
}

async function harness(t) {
  const hostToken = token(), guestToken = token()
  const broker = createPilotSignalingServer({
    installations: [{ id: 'host_jpcmain', token: hostToken }, { id: 'guest_xlaptop', token: guestToken }],
  })
  const upstream = await broker.listen()
  assert.match(upstream, /^http:\/\/127\.0\.0\.1:\d+$/)
  t.after(() => broker.close())
  const tls = await ephemeralCertificate(t)
  const edge = proxyForTest(Number(new URL(upstream).port), tls)
  const edgePort = await serveLoopback(edge, t)
  const fetchImpl = tlsFetchAdapter({ edgePort, cert: tls.cert })
  const make = admissionToken => new RemoteSignalingClient({
    endpoint: ORIGIN, approvedOrigin: ORIGIN, admissionToken,
    enabled: true, fetchImpl,
  })
  return { broker, edge, edgePort, tls, hostToken, guestToken, make }
}

test('real local TLS edge terminates HTTPS, limits host names, keeps pilot on loopback, and rejects untrusted certificates', async t => {
  const h = await harness(t)
  assert.equal(h.edge.address().address, '127.0.0.1')
  await assert.rejects(h.make(h.hostToken).create(WATCH, { signal: AbortSignal.abort() }),
    error => error.code === 'cancelled')
  const badTls = new RemoteSignalingClient({
    endpoint: ORIGIN, approvedOrigin: ORIGIN, admissionToken: h.hostToken,
    enabled: true, fetchImpl: tlsFetchAdapter({ edgePort: h.edgePort, cert: h.tls.cert, trusted: false }),
  })
  await assert.rejects(badTls.create(WATCH), e => e.code === 'network_unavailable')
  // Without installation admission, the broker rejects a proxied create request.
  const noAdmission = await tlsFetchAdapter({ edgePort: h.edgePort, cert: h.tls.cert })(
    `${ORIGIN}/v1/sessions`, { method: 'POST', cache: 'no-store', redirect: 'error',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ permissions: WATCH }) })
  assert.equal(noAdmission.status, 401)
  assert.deepEqual(JSON.parse(await noAdmission.text()), { error: 'unauthorized' })
  // Public health checks are not exposed by the example ingress.
  const hidden = await tlsFetchAdapter({ edgePort: h.edgePort, cert: h.tls.cert })(
    `${ORIGIN}/healthz`, { method: 'GET', cache: 'no-store', redirect: 'error', headers: {} })
  assert.equal(hidden.status, 404)
})

test('host and guest execute a full admission-bound invitation, approval, and revocation over real local TLS proxy', async t => {
  const h = await harness(t)
  const host = h.make(h.hostToken), guest = h.make(h.guestToken)
  const created = await host.create(WATCH)
  assert.match(created.inviteCode, /^[A-Za-z0-9_-]{43}$/)
  const joined = await guest.join(created.inviteCode, { displayName: 'Alex' })
  assert.equal(joined.status, 'pending')
  const snapshot = await host.snapshot()
  assert.equal(snapshot.guestDisplayName, 'Alex')
  await assert.rejects(guest.messages(), e => e.code === 'not_approved')
  await host.approve(joined.guestId)
  assert.equal((await guest.snapshot()).status, 'approved')
  await host.end()
  await assert.rejects(guest.snapshot(), e => e.code === 'not_found')
  guest.clearLocal()
  assert.equal(host.role, null)
  assert.equal(guest.role, null)
})

test('test edge strips forwarded metadata, and broker independently rejects headers when sent directly', async t => {
  const h = await harness(t)
  const admitted = await tlsFetchAdapter({ edgePort: h.edgePort, cert: h.tls.cert })(
    `${ORIGIN}/v1/sessions`, { method: 'POST', cache: 'no-store', redirect: 'error',
      headers: { 'content-type': 'application/json', 'X-CaptureLink-Admission': `Bearer ${h.hostToken}`,
        'X-Forwarded-For': '203.0.113.9', 'X-Real-IP': '198.51.100.8', 'Forwarded': 'for=192.0.2.3' },
      body: JSON.stringify({ permissions: WATCH }) })
  assert.equal(admitted.status, 201, 'edge must strip untrusted forwarding information')
  const brokerUrl = `http://127.0.0.1:${h.broker.server.address().port}`
  const denied = await fetch(brokerUrl + '/v1/sessions', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Forwarded-For': '203.0.113.9',
      'X-CaptureLink-Admission': `Bearer ${h.hostToken}` }, body: JSON.stringify({ permissions: WATCH }),
  })
  assert.equal(denied.status, 400, 'broker must reject forwarding headers even if edge fails')
  assert.equal((await denied.json()).error, 'forwarded_headers_forbidden')
})
