/** UX3F-3B3B hermetic Electron-main composition; no real Auth0 or remote signal network. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { createServer as createTcpServer } from 'node:net'
import { readFile } from 'node:fs/promises'
import { createCaptureLinkAuth0Provider } from '../../../src/main/capturelink-auth0-provider.mjs'
import { createCaptureLinkOnlineElectron } from '../../../src/main/capturelink-online-electron.mjs'
import {
  createCaptureLinkOnlineHttpsHostCandidate, UX3F3B3A_TEST_ORIGIN,
} from '../../../src/main/capturelink-online-https-host-candidate.mjs'
import { createPublicV2SignalingServer } from '../src/public-v2-server.mjs'

const ISSUER = 'https://identity.capturelink.test'
const AUDIENCE = 'https://signal.capturelink.io/v2'
const CLIENT = 'CaptureLinkStageBDevClient'
const WATCH = Object.freeze({ watch: true, voice: false, controller: false, controllerMode: 'shared' })
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...createPublicKey(keys.privateKey).export({ format: 'jwk' }), kid: 'stage-b', use: 'sig', alg: 'RS256' }
const jwt = claims => {
  const h = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: 'stage-b' })).toString('base64url')
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), keys.privateKey).toString('base64url')}`
}
const claims = extra => ({
  iss: ISSUER + '/', sub: 'auth0|offline-user',
  iat: Math.floor(Date.now() / 1000) - 1, exp: Math.floor(Date.now() / 1000) + 3600,
  ...extra,
})
const json = x => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } })
const store = () => {
  let record = null
  return { async load() { return record }, async save(x) { record = x },
    async clear() { record = null }, peek() { return record } }
}
async function getPort() {
  const s = createTcpServer()
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve))
  const port = s.address().port
  await new Promise(resolve => s.close(resolve))
  return port
}
async function waitUntil(fn) {
  for (let i = 0; i < 100; ++i) {
    if (fn()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('timed out waiting for offline callback')
}

async function fixture(t, { saved = false, pauseCreate = false, hostFactory = true } = {}) {
  const account = new Map([['auth0|offline-user', true]])
  const captured = []
  const browser = []
  const vault = store()
  let nonce = null
  let rotate = 0
  let finishCreate
  let createReached
  const held = new Promise(resolve => { finishCreate = resolve })
  const reached = new Promise(resolve => { createReached = resolve })
  const idToken = () => jwt(claims({ aud: CLIENT, nonce }))
  const access = () => jwt(claims({
    aud: AUDIENCE, azp: CLIENT,
    scope: 'openid offline_access sessions:create', permissions: ['sessions:create'],
  }))
  const provider = createCaptureLinkAuth0Provider({ domain: ISSUER, clientId: CLIENT, audience: AUDIENCE,
    fetchImpl: async (url, init) => {
      if (url === ISSUER + '/.well-known/jwks.json') return json({ keys: [jwk] })
      assert.equal(url, ISSUER + '/oauth/token')
      const form = new URLSearchParams(init.body)
      assert.ok(['authorization_code', 'refresh_token'].includes(form.get('grant_type')))
      return json({ token_type: 'Bearer', access_token: access(),
        ...(form.get('grant_type') === 'authorization_code' ? { id_token: idToken() } : {}),
        refresh_token: `offline-refresh-token-abcdefghijklmnopqrstuvwxyz${++rotate}` })
    },
  })
  const broker = createPublicV2SignalingServer({
    expectedIssuer: provider.issuer, expectedAudience: provider.audience,
    verifyHostAccessToken: provider.verifyHostAccessToken,
    isHostActive: async subject => account.get(subject) === true,
  })
  const upstream = await broker.listen()
  t.after(() => broker.close())
  const mappedFetch = async (url, init) => {
    assert.ok(url.startsWith(UX3F3B3A_TEST_ORIGIN + '/v2/'))
    const endpoint = new URL(url)
    const result = await fetch(upstream + endpoint.pathname, init)
    captured.push({ path: endpoint.pathname, method: init.method })
    if (pauseCreate && endpoint.pathname === '/v2/sessions' && init.method === 'POST') {
      // Buffer the complete server reply *before* sign-out, then deliver it late.
      // This models an adapter that ignores cancellation after receipt; it
      // ensures the candidate can revoke a capability it actually received.
      const body = await result.arrayBuffer()
      createReached()
      await held
      const buffered = new Response(body, { status: result.status, headers: result.headers })
      return { url, status: buffered.status, redirected: false,
        headers: buffered.headers, body: buffered.body }
    }
    return { url, status: result.status, redirected: false, headers: result.headers, body: result.body }
  }
  const port = await getPort()
  const online = createCaptureLinkOnlineElectron({
    provider, vault, redirectPort: port,
    async openBrowser(url) {
      browser.push(url)
      nonce = new URL(url).searchParams.get('nonce')
    },
    ...(hostFactory ? { hostFactory: ({ accessToken }) =>
      createCaptureLinkOnlineHttpsHostCandidate({ accessToken, fetchImpl: mappedFetch }) } : {}),
  })
  t.after(() => online.shutdown())
  if (saved) await vault.save({ issuer: ISSUER, clientId: CLIENT, subject: 'auth0|offline-user',
    refreshToken: 'prior-offline-refresh-token-abcdefghijklmnopqrstuvwxyz' })
  const login = async () => {
    assert.deepEqual(await online.begin(), { started: true })
    const auth = new URL(browser.at(-1))
    const callback = new URL(`http://127.0.0.1:${port}/capturelink-online/callback`)
    callback.searchParams.set('code', 'offline-authorization-code-abcdefghijklmnopqrstuvwxyz')
    callback.searchParams.set('state', auth.searchParams.get('state'))
    assert.equal((await fetch(callback)).status, 200)
    await waitUntil(() => online.status().authenticated && !online.status().pending)
  }
  return { online, vault, account, browser, captured, login, reached, finishCreate, access }
}

test('offline main-only Electron login creates an authenticated HTTPS invitation without IPC credentials', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.online.initialize(), { enabled: true, authenticated: false, pending: false })
  assert.deepEqual(f.online.hostingStatus(), { hosting: false })
  await assert.rejects(f.online.createHostSession(WATCH), /online_signaling_unavailable/)
  await f.login()
  const invite = await f.online.createHostSession(WATCH)
  assert.deepEqual(Object.keys(invite).sort(), ['inviteCode', 'inviteExpiresAt'])
  assert.match(invite.inviteCode, /^[\w-]{43}$/)
  assert.deepEqual(f.online.hostingStatus(), { hosting: true })
  for (const safe of [f.online.status(), f.online.hostingStatus(), invite]) {
    assert.ok(!JSON.stringify(safe).includes('Bearer'))
    assert.ok(!JSON.stringify(safe).includes('offline-refresh-token'))
    assert.ok(!JSON.stringify(safe).includes('hostSessionToken'))
    assert.ok(!JSON.stringify(safe).includes('auth0|offline-user'))
  }
  await assert.rejects(f.online.createHostSession(WATCH), /online_signaling_unavailable/)
  assert.deepEqual(await f.online.endHostSession(), { ended: true })
  assert.deepEqual(f.online.hostingStatus(), { hosting: false })
  assert.ok(f.captured.some(x => x.path.endsWith('/revoke')))
  await f.online.signOut()
  assert.equal(f.vault.peek(), null)
})

test('startup restores rotating Auth0 credentials and sign-out ends the hosted session', async t => {
  const f = await fixture(t, { saved: true })
  assert.deepEqual(await f.online.initialize(), { enabled: true, authenticated: true, pending: false })
  assert.equal(f.browser.length, 0)
  assert.ok(f.vault.peek()?.refreshToken?.startsWith('offline-refresh-token-'))
  await f.online.createHostSession(WATCH)
  assert.deepEqual(await f.online.signOut(), { enabled: true, authenticated: false, pending: false })
  assert.deepEqual(f.online.hostingStatus(), { hosting: false })
  assert.equal(f.vault.peek(), null)
  assert.ok(f.captured.some(x => x.path.endsWith('/revoke')))
  await assert.rejects(f.online.createHostSession(WATCH), /online_signaling_unavailable/)
})

test('sign-out while HTTPS creation awaits a late response invalidates and revokes it', async t => {
  const f = await fixture(t, { pauseCreate: true })
  await f.online.initialize(); await f.login()
  const creating = f.online.createHostSession(WATCH)
  await f.reached
  const signedOut = f.online.signOut()
  // Sign-out starts aborting the main-only host before waiting on the vault.
  await assert.rejects(f.online.createHostSession(WATCH), /online_signaling_unavailable/)
  f.finishCreate()
  await assert.rejects(creating, /online_signaling_unavailable/)
  assert.equal((await signedOut).authenticated, false)
  assert.deepEqual(f.online.hostingStatus(), { hosting: false })
  assert.equal(f.vault.peek(), null)
  assert.ok(f.captured.some(x => x.path.endsWith('/revoke')))
})

test('application shutdown tears down hosted authority but preserves encrypted renewal credential', async t => {
  const f = await fixture(t)
  await f.online.initialize(); await f.login()
  await f.online.createHostSession(WATCH)
  const before = f.vault.peek()
  assert.ok(before)
  assert.deepEqual(await f.online.shutdown(), { stopped: true })
  assert.deepEqual(f.online.status(), { enabled: false, authenticated: false, pending: false })
  assert.deepEqual(f.online.hostingStatus(), { hosting: false })
  assert.deepEqual(f.vault.peek(), before)
  assert.ok(f.captured.some(x => x.path.endsWith('/revoke')))
  await assert.rejects(f.online.createHostSession(WATCH), /online_signaling_unavailable/)
})

test('host candidate requires explicitly trusted factory; rejected permissions never hit the broker', async t => {
  const f = await fixture(t, { hostFactory: false })
  await f.online.initialize(); await f.login()
  await assert.rejects(f.online.createHostSession(WATCH), /online_signaling_unavailable/)
  assert.deepEqual(f.online.hostingStatus(), { hosting: false })
  assert.equal(f.captured.length, 0)
  await assert.rejects(f.online.endHostSession(), /online_signaling_unavailable/)
  await f.online.signOut()
  assert.equal(f.vault.peek(), null)
})

test('main-process source introduces no new host IPC or preload/renderer paths', async () => {
  const root = new URL('../../../', import.meta.url)
  const read = async path => readFile(new URL(path, root), 'utf8')
  const main = await read('src/main/index.ts')
  const preload = await read('src/preload/index.ts')
  const renderer = await read('src/renderer/src/capturelink-online-settings.ts')
  assert.ok(main.includes('hostFactory: ({ accessToken }) => createCaptureLinkOnlineHttpsHostCandidate({ accessToken })'))
  assert.ok(!main.includes('capturelink:online-host-create'))
  assert.ok(!preload.includes('createHostSession'))
  assert.ok(!renderer.includes('createHostSession'))
  assert.ok(main.includes('!app.isPackaged && !localGuestTest'))
  assert.ok(main.includes("process.platform === 'win32'"))
  assert.ok(main.includes('safeStorage.isEncryptionAvailable()'))
  assert.ok(!main.includes('UX3F3B3A_TEST_ORIGIN'))
})
