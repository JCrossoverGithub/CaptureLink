import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:net'
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCaptureLinkOnlineDevConfig, ONLINE_DEV_CONFIG_FILENAME } from '../../../src/main/capturelink-online-dev-config.mjs'
import { createCaptureLinkOnlineElectron } from '../../../src/main/capturelink-online-electron.mjs'

const ISSUER = 'https://example.auth0.test'
const AUDIENCE = 'https://signal.capturelink.io/v2'
const CLIENT = 'capturelink-test-client-id'
const ACCESS = 'access-test-token-abcdefghijklmnopqrstuvwxyz0123456789'
const REFRESH = 'refresh-test-token-abcdefghijklmnopqrstuvwxyz0123456789'
const TOKEN = () => ({ tokenType: 'Bearer', accessToken: ACCESS, refreshToken: REFRESH })
const fail = /online_auth_unavailable/
const vault = () => {
  let stored = null
  return { async load() { return stored }, async save(value) { stored = value },
    async clear() { stored = null }, peek() { return stored } }
}
const makeProvider = (state = {}) => ({
  issuer: ISSUER,
  authorizationEndpoint: `${ISSUER}/authorize`,
  clientId: CLIENT,
  audience: AUDIENCE,
  scope: 'openid offline_access sessions:create',
  async exchangeCode({ code, codeVerifier, redirectUri }) {
    assert.equal(code, 'real-authorization-code-0123456789')
    assert.equal(typeof codeVerifier, 'string')
    assert.ok(codeVerifier.length >= 43)
    assert.equal(redirectUri, state.redirect)
    return TOKEN()
  },
  async exchangeRefresh() { return TOKEN() },
  async verifyTokens({ nonce }) {
    return { issuer: ISSUER, audience: AUDIENCE, subject: 'auth0|test-user',
      expiresAt: Date.now() + 3_600_000, scopes: ['sessions:create'], ...(nonce ? { nonce } : {}) }
  },
})
async function getPort() {
  const s = createServer()
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve))
  const port = s.address().port
  await new Promise(resolve => s.close(resolve))
  return port
}

async function setup(t, state = {}) {
  const port = await getPort()
  state.redirect = `http://127.0.0.1:${port}/capturelink-online/callback`
  const store = vault()
  const browser = []
  const online = createCaptureLinkOnlineElectron({
    provider: makeProvider(state), vault: store, redirectPort: port,
    async openBrowser(url) { browser.push(url) },
  })
  t.after(() => online.shutdown())
  return { online, store, browser, redirect: state.redirect }
}
async function waitUntil(callback, expected) {
  for (let i = 0; i < 100; ++i) {
    if (callback() === expected) return
    await new Promise(r => setTimeout(r, 10))
  }
  assert.equal(callback(), expected)
}

test('main-only browser flow completes one PKCE callback; renderer-safe boolean status', async t => {
  const { online, store, browser, redirect } = await setup(t)
  assert.deepEqual(await online.initialize(), { enabled: true, authenticated: false, pending: false })
  assert.deepEqual(await online.begin(), { started: true })
  assert.equal(online.status().pending, true)
  assert.equal(browser.length, 1)
  const authorize = new URL(browser[0])
  assert.equal(authorize.origin, ISSUER)
  assert.equal(authorize.searchParams.get('audience'), AUDIENCE)
  assert.equal(authorize.searchParams.get('redirect_uri'), redirect)
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256')
  const cb = new URL(redirect)
  cb.searchParams.set('code', 'real-authorization-code-0123456789')
  cb.searchParams.set('state', authorize.searchParams.get('state'))
  assert.equal((await fetch(cb)).status, 200)
  await waitUntil(() => online.status().authenticated, true)
  assert.deepEqual(online.status(), { enabled: true, authenticated: true, pending: false })
  assert.ok(store.peek()?.refreshToken)
  for (const unsafe of [ACCESS, REFRESH, 'auth0|test-user', authorize.searchParams.get('state')]) {
    assert.ok(!JSON.stringify(online.status()).includes(unsafe))
  }
  assert.deepEqual(await online.signOut(), { enabled: true, authenticated: false, pending: false })
  assert.equal(store.peek(), null)
  await assert.rejects(fetch(cb))
})

test('bad callback fails closed and permits a fresh login without tokens', async t => {
  const { online, browser, redirect } = await setup(t)
  await online.initialize()
  await online.begin()
  const cb = new URL(redirect)
  cb.searchParams.set('code', 'real-authorization-code-0123456789')
  cb.searchParams.set('state', 'bad-state')
  assert.equal((await fetch(cb)).status, 400)
  await waitUntil(() => online.status().pending, false)
  assert.equal(online.status().authenticated, false)
  assert.deepEqual(await online.begin(), { started: true })
  assert.equal(browser.length, 2)
  await online.signOut()
  assert.equal(online.status().authenticated, false)
})

test('occupied callback port rejects browser launch without any fallback', async t => {
  const { online, browser, redirect } = await setup(t)
  const blocker = createServer()
  const port = Number(new URL(redirect).port)
  await new Promise(resolve => blocker.listen(port, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => blocker.close(resolve)))
  await online.initialize()
  await assert.rejects(online.begin(), fail)
  assert.equal(browser.length, 0)
  assert.deepEqual(online.status(), { enabled: true, authenticated: false, pending: false })
})

test('sign-out aborts a pending login and preserves Xbox-independent account state', async t => {
  const { online, browser, redirect } = await setup(t)
  await online.initialize()
  await online.begin()
  const url = new URL(browser[0])
  await online.signOut()
  assert.deepEqual(online.status(), { enabled: true, authenticated: false, pending: false })
  const cb = new URL(redirect)
  cb.searchParams.set('code', 'real-authorization-code-0123456789')
  cb.searchParams.set('state', url.searchParams.get('state'))
  await assert.rejects(fetch(cb))
  assert.equal(online.status().authenticated, false)
})

test('post-quit controller denies operations and does not silently delete stored credential', async t => {
  const { online } = await setup(t)
  await online.initialize()
  assert.deepEqual(await online.shutdown(), { stopped: true })
  assert.equal(online.status().enabled, false)
  await assert.rejects(online.begin(), fail)
})


test('operator-only Auth0 domain file disables by default and pins tenant', async t => {
  const home = await mkdtemp(join(tmpdir(), 'capturelink-auth0-config-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const file = join(home, ONLINE_DEV_CONFIG_FILENAME)
  assert.equal(await loadCaptureLinkOnlineDevConfig({ home }), null)
  for (const body of [
    '{}', '{"domain":"evil.example.com"}',
    '{"domain":"dev-xh0d5exjel25dl0d.us.auth0.com","clientSecret":"must-not-enter"}',
    '{"domain":"https://dev-xh0d5exjel25dl0d.us.auth0.com"}',
  ]) {
    await writeFile(file, body)
    assert.equal(await loadCaptureLinkOnlineDevConfig({ home }), null)
  }
  await writeFile(file, '{"domain":"dev-xh0d5exjel25dl0d.us.auth0.com"}')
  const config = await loadCaptureLinkOnlineDevConfig({ home })
  assert.equal(config.domain, 'dev-xh0d5exjel25dl0d.us.auth0.com')
  assert.equal(config.redirectPort, 49152)
  assert.equal(config.audience, AUDIENCE)
})

test('operator-only Auth0 domain file rejects symlinks to valid configurations', async t => {
  const home = await mkdtemp(join(tmpdir(), 'capturelink-auth0-symlink-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const target = join(home, 'valid-target.json')
  const file = join(home, ONLINE_DEV_CONFIG_FILENAME)
  // A valid target makes this a real symlink-rejection test, not a missing-file test.
  await writeFile(target, '{"domain":"dev-xh0d5exjel25dl0d.us.auth0.com"}')
  try {
    await symlink(target, file, 'file')
  } catch (error) {
    if (process.platform === 'win32' &&
        ['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip('Windows does not permit creating a test symlink; Linux still verifies rejection')
      return
    }
    throw error
  }
  assert.equal(await loadCaptureLinkOnlineDevConfig({ home }), null)
})


test('restart restores only a rotating verified refresh credential; no browser needed', async t => {
  const port = await getPort()
  const store = vault()
  await store.save({ issuer: ISSUER, clientId: CLIENT, subject: 'auth0|test-user',
    refreshToken: 'old-refresh-token-abcdefghijklmnopqrstuvwxyz0123456789' })
  const provider = makeProvider()
  const online = createCaptureLinkOnlineElectron({
    provider, vault: store, redirectPort: port,
    async openBrowser() { assert.fail('restore must not invoke the browser') },
  })
  t.after(() => online.shutdown())
  assert.deepEqual(await online.initialize(), { enabled: true, authenticated: true, pending: false })
  assert.equal(store.peek().refreshToken, REFRESH)
  await online.signOut()
  assert.equal(store.peek(), null)
})
