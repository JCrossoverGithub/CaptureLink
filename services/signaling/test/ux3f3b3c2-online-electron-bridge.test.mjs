/** UX3F-3B3C2: offline composition of guarded Electron-main online session path. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createCaptureLinkAuth0Provider } from '../../../src/main/capturelink-auth0-provider.mjs'
import { createCaptureLinkOnlineHttpsSessionCandidate } from '../../../src/main/capturelink-online-https-session-candidate.mjs'
import { UX3F3B3A_TEST_ORIGIN } from '../../../src/main/capturelink-online-https-host-candidate.mjs'
import { CaptureLinkOnlineSessionBridge } from '../../../src/main/capturelink-online-session-bridge.mjs'
import { createCaptureLinkOnlineElectron } from '../../../src/main/capturelink-online-electron.mjs'
import { createPublicV2SignalingServer } from '../src/public-v2-server.mjs'

const issuer = 'https://identity.capturelink.test'
const audience = 'https://signal.capturelink.io/v2'
const clientId = 'CaptureLinkOfflineMainBridge'
const watch = Object.freeze({ watch: true, voice: false, controller: false, controllerMode: 'shared' })
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...createPublicKey(pair.privateKey).export({ format: 'jwk' }), kid: 'offline-main-bridge', use: 'sig', alg: 'RS256' }
const invitation = (kind, id) => 'CAPTURELINK-SESSION-V1:' + Buffer.from(JSON.stringify(
  kind === 'invite' ? { version: 1, kind, sessionId: id, createdAt: Date.now(), permissions: watch,
    transports: { voice: 'synthetic-offer-123456789' } }
    : { version: 1, kind, sessionId: id, transports: { voice: 'synthetic-answer-123456789' } }
)).toString('base64url')
function token() {
  const head = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: 'offline-main-bridge' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ iss: issuer + '/', sub: 'auth0|online-main-fixture',
    aud: audience, azp: clientId, iat: Math.floor(Date.now() / 1000) - 2,
    exp: Math.floor(Date.now() / 1000) + 1200,
    scope: 'openid offline_access sessions:create', permissions: ['sessions:create'] })).toString('base64url')
  const signed = `${head}.${body}`
  return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), pair.privateKey).toString('base64url')}`
}
async function fixture(t) {
  const account = new Map([['auth0|online-main-fixture', true]])
  const provider = createCaptureLinkAuth0Provider({ domain: issuer, clientId, audience,
    fetchImpl: async url => {
      assert.equal(url, issuer + '/.well-known/jwks.json')
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200,
        headers: { 'content-type': 'application/json' } })
    },
  })
  const broker = createPublicV2SignalingServer({
    expectedIssuer: provider.issuer, expectedAudience: provider.audience,
    verifyHostAccessToken: provider.verifyHostAccessToken,
    isHostActive: async subject => account.get(subject) === true,
  })
  const upstream = await broker.listen()
  t.after(() => broker.close())
  const observed = []
  const mappedFetch = async (url, init) => {
    const remote = new URL(url)
    assert.equal(remote.origin, UX3F3B3A_TEST_ORIGIN)
    assert.equal(init.redirect, 'error')
    assert.equal(init.credentials, 'omit')
    assert.equal(init.referrerPolicy, 'no-referrer')
    observed.push({ path: remote.pathname, auth: Object.hasOwn(init.headers, 'authorization') })
    const result = await fetch(upstream + remote.pathname + remote.search, init)
    return { url, redirected: false, status: result.status, headers: result.headers, body: result.body }
  }
  const factory = ({ accessToken }) => createCaptureLinkOnlineHttpsSessionCandidate({
    accessToken, fetchImpl: mappedFetch,
  })
  const host = new CaptureLinkOnlineSessionBridge({ candidateFactory: factory })
  const guest = new CaptureLinkOnlineSessionBridge({ candidateFactory: factory })
  t.after(async () => { await guest.end(); await host.end() })
  return { host, guest, observed, account }
}

test('single Auth0-owned host and anonymous guest exchange approved v2 signaling, never session bearers', async t => {
  const { host, guest, observed } = await fixture(t)
  let active = true
  const adapter = host.authenticatedHostAdapter(() => active ? token() : null)
  assert.deepEqual(adapter.status(), { hosting: false })
  assert.deepEqual(host.status(), { role: null, active: false })
  await assert.rejects(host.join('invalid', 'Alice'), /online_signaling_unavailable/)
  await assert.rejects(host.send('invite', 'invalid'), /online_signaling_unavailable/)
  const created = await adapter.create(watch)
  assert.deepEqual(Object.keys(created).sort(), ['inviteCode', 'inviteExpiresAt'])
  assert.deepEqual(adapter.status(), { hosting: true })
  await assert.rejects(adapter.create(watch), /online_signaling_unavailable/)
  assert.deepEqual(await guest.join(created.inviteCode, '  Alice  '), { status: 'pending' })
  assert.deepEqual(guest.status(), { role: 'guest', active: true })
  await assert.rejects(guest.approve(true), /online_signaling_unavailable/)
  assert.equal((await guest.snapshot()).status, 'pending')
  await assert.rejects(guest.send('response', invitation('response', randomUUID())), /online_signaling_unavailable/)
  const hostSnapshot = await host.snapshot()
  assert.equal(hostSnapshot.hasPendingGuest, true)
  assert.equal(hostSnapshot.guestDisplayName, 'Alice')
  assert.equal(hostSnapshot.status, 'pending')
  assert.deepEqual(await host.approve(true), { status: 'approved' })
  assert.equal((await guest.snapshot()).status, 'approved')
  assert.equal((await host.snapshot()).status, 'approved')
  const id = randomUUID()
  const invite = invitation('invite', id)
  assert.deepEqual(await host.send('invite', invite), { sent: true })
  assert.deepEqual(await guest.messages(), [{ kind: 'invite', payload: invite }])
  const answer = invitation('response', id)
  assert.deepEqual(await guest.send('response', answer), { sent: true })
  assert.deepEqual(await host.messages(), [{ kind: 'response', payload: answer }])
  assert.ok(observed.some(x => x.path === '/v2/sessions' && x.auth))
  assert.ok(observed.some(x => x.path === '/v2/join' && !x.auth))
  assert.ok(!JSON.stringify([host.status(), guest.status(), hostSnapshot, created]).includes('SessionToken'))
  assert.deepEqual(await adapter.end(), { ended: true })
  active = false
  assert.deepEqual(adapter.status(), { hosting: false })
  assert.deepEqual(host.status(), { role: null, active: false })
  await assert.rejects(guest.snapshot(), /online_signaling_unavailable/)
})


test('real Auth0 controller renew uses the same online bridge host; sign-out revokes and preserves guest role isolation', async t => {
  const { host, guest, observed } = await fixture(t)
  let record = { issuer, clientId, subject: 'auth0|online-main-fixture',
    refreshToken: 'old-refresh-credential-abcdefghijklmnopqrstuvwxyz' }
  const vault = { async load() { return record }, async save(value) { record = value },
    async clear() { record = null } }
  const online = createCaptureLinkOnlineElectron({
    provider: {
      issuer, authorizationEndpoint: issuer + '/authorize', clientId, audience,
      scope: 'openid offline_access sessions:create',
      async exchangeCode() { throw new Error('offline login not requested') },
      async exchangeRefresh() { return { tokenType: 'Bearer', accessToken: token(),
        refreshToken: 'new-refresh-credential-abcdefghijklmnopqrstuvwxyz' } },
      async verifyTokens() { return { issuer, audience, subject: 'auth0|online-main-fixture',
        expiresAt: Date.now() + 3_600_000, scopes: ['sessions:create'] } },
    },
    vault,
    redirectPort: 49152,
    async openBrowser() { throw new Error('offline browser not requested') },
    hostFactory: ({ accessToken }) => host.authenticatedHostAdapter(accessToken),
  })
  t.after(() => online.shutdown())
  assert.deepEqual(await online.initialize(), { enabled: true, authenticated: true, pending: false })
  assert.deepEqual(online.hostingStatus(), { hosting: false })
  const created = await online.createHostSession(watch)
  assert.equal(online.hostingStatus().hosting, true)
  await guest.join(created.inviteCode, 'Guest without an account')
  assert.equal((await host.snapshot()).hasPendingGuest, true)
  assert.equal((await guest.snapshot()).status, 'pending')
  assert.deepEqual(await online.signOut(), { enabled: true, authenticated: false, pending: false })
  assert.equal(record, null)
  assert.deepEqual(host.status(), { role: null, active: false })
  assert.deepEqual(online.hostingStatus(), { hosting: false })
  await assert.rejects(guest.snapshot(), /online_signaling_unavailable/)
  assert.ok(observed.some(call => call.path.endsWith('/revoke')))
  await assert.rejects(online.createHostSession(watch), /online_signaling_unavailable/)
})
test('host adapter can bind once, and a null host token fails without bearer or session creation', async t => {
  const { host, guest, observed } = await fixture(t)
  const adapter = host.authenticatedHostAdapter(() => null)
  assert.throws(() => host.authenticatedHostAdapter(token), /online_signaling_unavailable/)
  await assert.rejects(adapter.create(watch), /online_signaling_unavailable/)
  assert.deepEqual(host.status(), { role: null, active: false })
  assert.equal(observed.filter(x => x.path === '/v2/sessions').length, 0)
  await assert.rejects(guest.join('incorrect', 'Alice'), /online_signaling_unavailable/)
  assert.equal(observed.length, 0)
})

test('host rejection cannot authorize media and role-bound send is fail closed', async t => {
  const { host, guest } = await fixture(t)
  const adapter = host.authenticatedHostAdapter(token)
  const created = await adapter.create(watch)
  await guest.join(created.inviteCode, 'Unverified guest')
  await guest.snapshot()
  assert.equal((await host.snapshot()).status, 'pending')
  assert.deepEqual(await host.approve(false), { status: 'rejected' })
  assert.equal((await guest.snapshot()).status, 'rejected')
  await assert.rejects(host.send('invite', invitation('invite', randomUUID())), /online_signaling_unavailable/)
  await assert.rejects(guest.send('response', invitation('response', randomUUID())), /online_signaling_unavailable/)
})

test('ending while guest join is pending invalidates local authority before response', async t => {
  const { host, observed } = await fixture(t)
  const adapter = host.authenticatedHostAdapter(token)
  const created = await adapter.create(watch)
  let notify, unblock
  const reached = new Promise(resolve => { notify = resolve })
  const gate = new Promise(resolve => { unblock = resolve })
  const upstreamCandidate = ({ accessToken }) => createCaptureLinkOnlineHttpsSessionCandidate({
    accessToken, fetchImpl: async (url, init) => {
      // Delayed request failures are acceptable. More importantly, end must
      // invalidate the local bridge even if the adapter ignores abort.
      if (url.endsWith('/v2/join')) { notify(); await gate }
      throw new Error('offline synthetic network rejection')
    },
  })
  const guest = new CaptureLinkOnlineSessionBridge({ candidateFactory: upstreamCandidate })
  t.after(() => guest.end())
  const joining = guest.join(created.inviteCode, 'Alice')
  await reached
  const ending = guest.end()
  assert.deepEqual(guest.status(), { role: null, active: false })
  unblock()
  await assert.rejects(joining, /online_signaling_unavailable/)
  assert.deepEqual(await ending, { ended: true })
  assert.equal(observed.filter(x => x.path === '/v2/sessions').length, 1)
})

test('IPC source has exact-frame verification, independent one-session owner, and dev-gated renderer selection', async () => {
  const root = new URL('../../../', import.meta.url)
  const get = p => readFile(new URL(p, root), 'utf8')
  const [main, preload, types, renderer, auth, client] = await Promise.all([
    get('src/main/index.ts'), get('src/preload/index.ts'), get('src/renderer/src/env.d.ts'),
    get('src/renderer/src/hosted-session-ux.ts'), get('src/main/capturelink-online-electron.mjs'),
    get('src/main/capturelink-online-https-session-candidate.mjs'),
  ])
  assert.ok(main.includes('authorizedHostedFrame(event)'))
  assert.ok(main.includes('event.senderFrame !== mainWindow.webContents.mainFrame'))
  assert.ok(main.includes('signalingMode.claim(\'online\''))
  assert.ok(main.includes('signalingMode.claim(\'legacy\''))
  assert.ok(main.includes("hostFactory: ({ accessToken }) => onlineSession!.authenticatedHostAdapter(accessToken)"))
  assert.ok(main.includes('!app.isPackaged && process.platform === \'win32\''))
  assert.ok(main.includes('!app.isPackaged && !localGuestTest'))
  assert.ok(!main.includes('https://signal.capturelink.io/'))
  assert.ok(client.includes('UX3F3B3A_TEST_ORIGIN'))
  for (const method of ['onlineSessionCreate', 'onlineSessionJoin', 'onlineSessionSnapshot',
    'onlineSessionApprove', 'onlineSessionSend', 'onlineSessionMessages', 'onlineSessionEnd']) {
    assert.ok(preload.includes(method))
    assert.ok(types.includes(method))
    assert.ok(renderer.includes(method))
  }
  assert.ok(renderer.includes('const gate = createRendererSignalingModeGate(legacyBackend, onlineBackend)'))
  assert.ok(renderer.includes('modeArea.hidden = !status.enabled'))
  assert.ok(renderer.includes('const closingBackend = gate.release()'))
  assert.ok(!renderer.includes('https://signal.capturelink.io/'))
  assert.ok(!/\b(?:accessToken|refreshToken|clientSecret|codeVerifier|jwks)\b/.test(preload))
  assert.ok(auth.includes('const ended = stopHost()'))
})
