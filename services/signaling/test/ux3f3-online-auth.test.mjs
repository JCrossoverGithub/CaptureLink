import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, lstat, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createCaptureLinkOnlineAuth } from '../../../src/main/capturelink-online-auth.mjs'
import { createWindowsOnlineVault, ONLINE_VAULT_FILE } from '../../../src/main/capturelink-online-vault.mjs'

const issuer = 'https://accounts.example.test'
const redirectUri = 'http://127.0.0.1:49152/capturelink-online/callback'
const access = 'access-token-fixture-very-long-1'
const refresh = 'refresh-token-fixture-very-long-1'
const fakeVault = () => {
  let current = null
  return {
    async load() { return current },
    async save(record) { current = structuredClone(record) },
    async clear() { current = null },
    peek() { return current },
  }
}
function fixture(overrides = {}) {
  const visited = [], exchanged = []
  let time = 1700000000000
  const vault = overrides.vault ?? fakeVault()
  const c = {
    authorizationEndpoint: 'https://accounts.example.test/authorize',
    issuer, redirectUri, clientId: 'capturelink-public', audience: 'capturelink-api',
    scope: 'openid sessions:create', vault, now: () => time,
    openBrowser: async url => { visited.push(url) },
    exchangeCode: async params => {
      exchanged.push(params)
      return { tokenType: 'Bearer', accessToken: access, refreshToken: refresh }
    },
    exchangeRefresh: async () => ({ tokenType: 'Bearer', accessToken: access + '2', refreshToken: refresh + '2' }),
    verifyTokens: async ({ nonce }) => ({
      issuer, audience: 'capturelink-api', subject: 'account-1',
      expiresAt: time + 3600000, scopes: ['sessions:create'],
      ...(nonce ? { nonce } : {}),
    }),
    ...overrides,
  }
  const auth = createCaptureLinkOnlineAuth(c)
  const callback = (changes = {}) => {
    const url = new URL(visited.at(-1))
    const callbackUrl = new URL(redirectUri)
    callbackUrl.searchParams.set('state', url.searchParams.get('state'))
    callbackUrl.searchParams.set('code', 'valid_authorization_code_long_123')
    for (const [k, v] of Object.entries(changes)) callbackUrl.searchParams.set(k, v)
    return callbackUrl.href
  }
  return { auth, visited, exchanged, vault, callback, advance: ms => { time += ms } }
}

// No browser can authorize via renderer IPC: browser launch is an injected main callback.
test('config rejects absent provider, HTTP authorization endpoint and nonloopback redirect', () => {
  assert.throws(() => createCaptureLinkOnlineAuth(), /online_auth_unavailable/)
  assert.throws(() => fixture({ authorizationEndpoint: 'http://accounts.example.test/auth' }), /online_auth_unavailable/)
  assert.throws(() => fixture({ redirectUri: 'https://evil.example/callback' }), /online_auth_unavailable/)
  assert.throws(() => fixture({ redirectUri: 'http://localhost:49152/capturelink-online/callback' }), /online_auth_unavailable/)
  assert.throws(() => fixture({ redirectUri: 'http://127.0.0.1:49152/callback' }), /online_auth_unavailable/)
  assert.throws(() => fixture({ scope: 'openid email' }), /online_auth_unavailable/)
})
test('begin login opens trusted browser with code + S256 PKCE, state and nonce, never returns secrets', async () => {
  const f = fixture()
  assert.deepEqual(await f.auth.beginLogin(), { started: true })
  assert.equal(f.auth.accessToken(), null)
  const url = new URL(f.visited[0])
  assert.equal(url.protocol, 'https:')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri)
  assert.match(url.searchParams.get('state'), /^[\w-]{43}$/)
  assert.match(url.searchParams.get('nonce'), /^[\w-]{43}$/)
  assert.match(url.searchParams.get('code_challenge'), /^[\w-]{43}$/)
  assert.equal(url.searchParams.has('code_verifier'), false)
})
test('accepted callback exchanges one code using matching verifier and returns only safe status', async () => {
  const f = fixture()
  await f.auth.beginLogin()
  const expected = new URL(f.visited[0]).searchParams.get('code_challenge')
  assert.deepEqual(await f.auth.completeRedirect(f.callback()), { authenticated: true })
  const exchange = f.exchanged[0]
  assert.equal(exchange.redirectUri, redirectUri)
  assert.equal(exchange.clientId, 'capturelink-public')
  assert.equal(createHash('sha256').update(exchange.codeVerifier).digest('base64url'), expected)
  assert.deepEqual(f.auth.status(), { authenticated: true })
  assert.equal(f.auth.accessToken(), access)
  assert.equal(f.vault.peek().refreshToken, refresh)
})
test('rejects callback before login and nonmatching state without any token exchange', async () => {
  const f = fixture()
  await assert.rejects(f.auth.completeRedirect(redirectUri + '?code=c&state=s'), /online_auth_unavailable/)
  await f.auth.beginLogin()
  await assert.rejects(f.auth.completeRedirect(f.callback({ state: 'incorrect' })), /online_auth_unavailable/)
  assert.equal(f.exchanged.length, 0)
  assert.equal(f.auth.accessToken(), null)
})
test('rejects callback replay and duplicated query keys', async () => {
  const f = fixture()
  await f.auth.beginLogin()
  const u = f.callback()
  await f.auth.completeRedirect(u)
  await assert.rejects(f.auth.completeRedirect(u), /online_auth_unavailable/)
  await f.auth.beginLogin()
  const duplicate = f.callback() + '&code=another'
  await assert.rejects(f.auth.completeRedirect(duplicate), /online_auth_unavailable/)
  assert.equal(f.exchanged.length, 1)
})
test('rejects different origin, unexpected query fields, fragment and OAuth error response', async () => {
  for (const transform of [
    u => u.replace('127.0.0.1', 'localhost'),
    u => u + '&access_token=stolen',
    u => u + '#fragment',
    u => u.replace('code=', 'error='),
  ]) {
    const f = fixture(); await f.auth.beginLogin()
    await assert.rejects(f.auth.completeRedirect(transform(f.callback())), /online_auth_unavailable/)
    assert.equal(f.exchanged.length, 0)
  }
})
test('rejects expired login and overlapping login transaction', async () => {
  const f = fixture(); await f.auth.beginLogin()
  await assert.rejects(f.auth.beginLogin(), /online_auth_unavailable/)
  f.advance(301000)
  await assert.rejects(f.auth.completeRedirect(f.callback()), /online_auth_unavailable/)
  assert.equal(f.exchanged.length, 0)
})
test('browser launch failure is sanitized and a second attempt can begin', async () => {
  let count = 0
  const f = fixture({ openBrowser: async () => { if (count++ === 0) throw Error('PRIVATE_BROWSER_URL') } })
  await assert.rejects(f.auth.beginLogin(), /^Error: online_auth_unavailable$/)
  assert.deepEqual(await f.auth.beginLogin(), { started: true })
})
test('rejects unverifiable issuer, audience, subject, scope, expiry and nonce', async () => {
  for (const changes of [
    { issuer: 'https://bad.example' }, { audience: 'other-api' },
    { subject: '' }, { scopes: [] }, { expiresAt: 1000 },
    { nonce: 'forged-state-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  ]) {
    const f = fixture({ verifyTokens: async ({ nonce }) => ({
      issuer, audience: 'capturelink-api', subject: 'account-1', scopes: ['sessions:create'],
      expiresAt: 1700003600000, nonce, ...changes,
    }) })
    await f.auth.beginLogin()
    await assert.rejects(f.auth.completeRedirect(f.callback()), /online_auth_unavailable/)
    assert.equal(f.auth.accessToken(), null)
    assert.equal(f.vault.peek(), null)
  }
})
test('untrusted token response, verifier exception and vault refusal fail closed', async () => {
  const cases = [
    { exchangeCode: async () => ({ tokenType: 'Basic', accessToken: access }) },
    { verifyTokens: async () => { throw Error('SECRET_FROM_PROVIDER') } },
    { vault: { ...fakeVault(), save: async () => { throw Error('sensitive OS error') } } },
  ]
  for (const overrides of cases) {
    const f = fixture(overrides); await f.auth.beginLogin()
    await assert.rejects(f.auth.completeRedirect(f.callback()), /^Error: online_auth_unavailable$/)
    assert.equal(f.auth.accessToken(), null)
  }
})
test('token remains main-process memory-only, and expires before trusted expiry', async () => {
  const f = fixture(); await f.auth.beginLogin(); await f.auth.completeRedirect(f.callback())
  f.advance(3600000 - 10000)
  assert.equal(f.auth.accessToken(), null)
  assert.deepEqual(f.auth.status(), { authenticated: false })
})
test('renewal rotates refresh credential after verifying subject and audience', async () => {
  const f = fixture(); await f.auth.beginLogin(); await f.auth.completeRedirect(f.callback())
  f.advance(3600000)
  assert.deepEqual(await f.auth.renew(), { authenticated: true })
  assert.equal(f.auth.accessToken(), access + '2')
  assert.equal(f.vault.peek().refreshToken, refresh + '2')
})
test('renew refuses account substitution and nonrotating refresh tokens', async () => {
  for (const override of [
    { verifyTokens: async ({ nonce }) => ({ issuer, audience: 'capturelink-api', subject: nonce ? 'account-1' : 'other-account', scopes: ['sessions:create'], expiresAt: 1700003600000, nonce }) },
    { exchangeRefresh: async () => ({ tokenType: 'Bearer', accessToken: access, refreshToken: refresh }) },
  ]) {
    const f = fixture(override); await f.auth.beginLogin(); await f.auth.completeRedirect(f.callback())
    await assert.rejects(f.auth.renew(), /online_auth_unavailable/)
    assert.equal(f.auth.accessToken(), null)
  }
})
test('renew with no saved credentials fails without opening browser', async () => {
  const f = fixture()
  await assert.rejects(f.auth.renew(), /online_auth_unavailable/)
  assert.equal(f.visited.length, 0)
})
test('sign out clears access and stored refresh, and previous code cannot be replayed', async () => {
  const f = fixture(); await f.auth.beginLogin(); const callback = f.callback()
  await f.auth.completeRedirect(callback)
  assert.deepEqual(await f.auth.signOut(), { authenticated: false })
  assert.equal(f.vault.peek(), null)
  assert.equal(f.auth.accessToken(), null)
  await assert.rejects(f.auth.completeRedirect(callback), /online_auth_unavailable/)
})
test('sign out invalidates pending login', async () => {
  const f = fixture(); await f.auth.beginLogin(); const u = f.callback()
  await f.auth.signOut()
  await assert.rejects(f.auth.completeRedirect(u), /online_auth_unavailable/)
  assert.equal(f.exchanged.length, 0)
})
test('sign out during delayed code exchange prevents access-token activation', async () => {
  let resolveExchange
  const f = fixture({ exchangeCode: async () => new Promise(resolve => { resolveExchange = resolve }) })
  await f.auth.beginLogin()
  const pending = f.auth.completeRedirect(f.callback())
  await f.auth.signOut()
  resolveExchange({ tokenType: 'Bearer', accessToken: access, refreshToken: refresh })
  await assert.rejects(pending, /online_auth_unavailable/)
  assert.equal(f.auth.accessToken(), null)
  assert.equal(f.vault.peek(), null)
})

function mockSafeStorage() {
  // Test-only mock for the Electron API, NOT a production crypto substitute.
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from('MOCK-ENCRYPTED:' + Buffer.from(value).toString('base64')),
    decryptString: buffer => {
      const value = buffer.toString()
      if (!value.startsWith('MOCK-ENCRYPTED:')) throw Error('decrypt error')
      return Buffer.from(value.slice(15), 'base64').toString()
    },
  }
}
async function withVault(fn) {
  const root = await mkdtemp(join(tmpdir(), 'cl-ux3f3-'))
  try {
    return await fn({ root, vault: createWindowsOnlineVault({ userData: root, safeStorage: mockSafeStorage(), platform: 'win32' }) })
  } finally { await rm(root, { recursive: true, force: true }) }
}
const record = { issuer, clientId: 'capturelink-public', subject: 'account-1', refreshToken: refresh }
test('vault refuses non-Windows platform and protection service missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cl-ux3f3-'))
  try {
    assert.throws(() => createWindowsOnlineVault({ userData: root, safeStorage: mockSafeStorage(), platform: 'linux' }), /online_auth_storage_unavailable/)
    const vault = createWindowsOnlineVault({ userData: root, safeStorage: {
      ...mockSafeStorage(), isEncryptionAvailable: () => false,
    }, platform: 'win32' })
    await assert.rejects(vault.save(record), /online_auth_storage_unavailable/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('vault stores encrypted data separate from pilot enrollment and returns only validated values', async () => {
  await withVault(async ({ root, vault }) => {
    assert.equal(await vault.load(), null)
    await vault.save(record)
    const raw = await readFile(join(root, ONLINE_VAULT_FILE))
    assert.equal(raw.includes(Buffer.from(refresh)), false)
    assert.notEqual(ONLINE_VAULT_FILE, 'capturelink-pilot-admission.v1.enc')
    assert.deepEqual(await vault.load(), record)
  })
})
test('vault rotates encrypted refresh material and clear is idempotent', async () => {
  await withVault(async ({ root, vault }) => {
    await vault.save(record)
    await vault.save({ ...record, refreshToken: refresh + 'new' })
    assert.equal((await vault.load()).refreshToken, refresh + 'new')
    await vault.clear(); await vault.clear()
    assert.equal(await vault.load(), null)
  })
})
test('vault refuses malformed, undecryptable, symlink or nonfile content', async () => {
  await withVault(async ({ root, vault }) => {
    const file = join(root, ONLINE_VAULT_FILE)
    await writeFile(file, 'plaintext-as-if-it-were-encrypted')
    await assert.rejects(vault.load(), /online_auth_storage_unavailable/)
    await assert.rejects(vault.save(record), /online_auth_storage_unavailable/)
    await rm(file)
    try { await symlink(join(root, 'target'), file) }
    catch (e) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(e?.code)) return // restricted Windows runner
      throw e
    }
    await assert.rejects(vault.load(), /online_auth_storage_unavailable/)
    await assert.rejects(vault.clear(), /online_auth_storage_unavailable/)
  })
})
test('vault rejects credential-like values with control characters', async () => {
  await withVault(async ({ vault }) => {
    await assert.rejects(vault.save({ ...record, refreshToken: 'validToken12345678\n' }), /online_auth_storage_unavailable/)
    assert.equal(await vault.load(), null)
  })
})

test('sign-out serializes behind an already-started encrypted vault write', async () => {
  const base = fakeVault()
  let unblock, saveStarted
  const started = new Promise(resolve => { saveStarted = resolve })
  const waitingVault = {
    load: () => base.load(),
    save: async record => {
      saveStarted()
      await new Promise(resolve => { unblock = resolve })
      await base.save(record)
    },
    clear: () => base.clear(),
  }
  const f = fixture({ vault: waitingVault })
  await f.auth.beginLogin()
  const login = f.auth.completeRedirect(f.callback())
  await started
  const signout = f.auth.signOut()
  unblock()
  await assert.rejects(login, /online_auth_unavailable/)
  assert.deepEqual(await signout, { authenticated: false })
  assert.equal(base.peek(), null)
  assert.equal(f.auth.accessToken(), null)
})
test('generic provider subject with pipe remains supported but never enters renderer', async () => {
  const f = fixture({ verifyTokens: async ({ nonce }) => ({
    issuer, audience: 'capturelink-api', subject: 'auth0|provider-id',
    expiresAt: 1700003600000, scopes: ['sessions:create'], nonce,
  }) })
  await f.auth.beginLogin()
  assert.deepEqual(await f.auth.completeRedirect(f.callback()), { authenticated: true })
  assert.deepEqual(f.auth.status(), { authenticated: true })
  assert.equal(f.vault.peek().subject, 'auth0|provider-id')
})

test('authorization response issuer, when supplied, must match configured issuer', async () => {
  const accepted = fixture(); await accepted.auth.beginLogin()
  await accepted.auth.completeRedirect(accepted.callback({ iss: issuer }))
  const rejected = fixture(); await rejected.auth.beginLogin()
  await assert.rejects(rejected.auth.completeRedirect(rejected.callback({ iss: 'https://malicious.example' })), /online_auth_unavailable/)
  assert.equal(rejected.exchanged.length, 0)
})
