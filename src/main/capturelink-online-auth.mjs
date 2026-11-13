/**
 * UX3F-3A: provider-neutral, main-process-only native-app OAuth foundation.
 * No Electron IPC, selected identity provider, production network adapter or
 * public deployment is included. Every trusted dependency is injected.
 *
 * The provider adapter MUST cryptographically validate issuer/audience, access
 * token and (for initial OIDC login) ID-token nonce, not merely decode a JWT.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

const CODE = /^[\x21-\x7e]{16,8192}$/
const ACCESS = /^[\x21-\x7e]{16,8192}$/
const ID = /^[A-Za-z0-9._~:/-]{1,256}$/
const SUBJECT = /^[\x21-\x7e]{1,256}$/
const STATE = /^[A-Za-z0-9_-]{43}$/
const MAX_TTL = 24 * 60 * 60 * 1000
const MIN_TTL = 10 * 1000
const LOGIN_WINDOW = 5 * 60 * 1000
const error = () => new Error('online_auth_unavailable')
const secret = () => randomBytes(32).toString('base64url')
const validString = x => typeof x === 'string' && x.length > 0
const same = (a, b) => {
  if (!STATE.test(a) || !STATE.test(b)) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

function httpsEndpoint(value, pathOk = true) {
  if (!validString(value)) throw error()
  let url
  try { url = new URL(value) } catch { throw error() }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search ||
      !url.hostname || (!pathOk && url.pathname !== '/')) throw error()
  return url
}
function loopbackRedirect(value) {
  if (!validString(value)) throw error()
  let url
  try { url = new URL(value) } catch { throw error() }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      !url.port || Number(url.port) < 1024 || url.pathname !== '/capturelink-online/callback' ||
      url.username || url.password || url.hash || url.search) throw error()
  return url
}
function checkConfig(config) {
  if (!config || typeof config !== 'object') throw error()
  const authorizationEndpoint = httpsEndpoint(config.authorizationEndpoint)
  const issuer = httpsEndpoint(config.issuer, false).origin
  const redirect = loopbackRedirect(config.redirectUri)
  if (!ID.test(config.clientId) || typeof config.scope !== 'string' ||
      !config.scope.split(' ').includes('sessions:create') ||
      !config.scope.split(' ').includes('openid') ||
      !ID.test(config.audience) ||
      ![config.openBrowser, config.exchangeCode, config.exchangeRefresh, config.verifyTokens]
        .every(fn => typeof fn === 'function') ||
      !config.vault || !['load', 'save', 'clear'].every(method => typeof config.vault[method] === 'function') ||
      (config.now !== undefined && typeof config.now !== 'function')) throw error()
  return { authorizationEndpoint, issuer, redirect }
}

export function createCaptureLinkOnlineAuth(config) {
  const { authorizationEndpoint, issuer, redirect } = checkConfig(config)
  const now = config.now ?? Date.now
  let login = null
  let active = null
  let inflight = null
  let generation = 0
  let vaultQueue = Promise.resolve()
  function serialVault(action) {
    const op = vaultQueue.then(action, action)
    vaultQueue = op.then(() => {}, () => {})
    return op
  }

  const checkClaims = (tokens, claims, nonce = null, subject = null) => {
    if (!tokens || tokens.tokenType !== 'Bearer' ||
        typeof tokens.accessToken !== 'string' || !ACCESS.test(tokens.accessToken) ||
        !claims || claims.issuer !== issuer || claims.audience !== config.audience ||
        !SUBJECT.test(claims.subject) ||
        !Array.isArray(claims.scopes) || !claims.scopes.includes('sessions:create') ||
        !Number.isSafeInteger(claims.expiresAt) ||
        claims.expiresAt <= now() + MIN_TTL || claims.expiresAt > now() + MAX_TTL ||
        (nonce !== null && (!STATE.test(claims.nonce) || !same(claims.nonce, nonce))) ||
        (subject !== null && claims.subject !== subject)) throw error()
    if (tokens.refreshToken !== undefined &&
        (typeof tokens.refreshToken !== 'string' || !CODE.test(tokens.refreshToken))) throw error()
    return { accessToken: tokens.accessToken, subject: claims.subject, expiresAt: claims.expiresAt }
  }
  const commit = (tokens, next, prior, epoch) => serialVault(async () => {
    if (generation !== epoch) throw error()
    // Serialize vault saves with sign-out cleanup: late network completions
    // must never restore an already signed-out credential.
    if (tokens.refreshToken !== undefined) {
      if (prior !== null && tokens.refreshToken === prior) throw error()
      await config.vault.save({
        issuer, clientId: config.clientId, subject: next.subject,
        refreshToken: tokens.refreshToken,
      })
    } else if (prior !== null) {
      throw error()
    } else {
      await config.vault.clear()
    }
    if (generation !== epoch) throw error()
    active = next
  })
  return Object.freeze({
    status() { return Object.freeze({ authenticated: !!active && now() < active.expiresAt - MIN_TTL }) },
    async beginLogin() {
      if (login || inflight) throw error()
      const epoch = ++generation
      const state = secret(), verifier = secret(), nonce = secret()
      login = { state, verifier, nonce, epoch, expiresAt: now() + LOGIN_WINDOW }
      const url = new URL(authorizationEndpoint.href)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('redirect_uri', redirect.href)
      url.searchParams.set('scope', config.scope)
      url.searchParams.set('state', state)
      url.searchParams.set('nonce', nonce)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'))
      try {
        // Browser launcher is trusted Electron main's shell.openExternal.
        // No URL, state, verifier or token is returned to the renderer.
        await config.openBrowser(url.href)
        if (generation !== epoch) throw error()
        return { started: true }
      } catch {
        if (login?.epoch === epoch) login = null
        throw error()
      }
    },
    async completeRedirect(value) {
      const pending = login
      // Consume the transaction before asynchronous work: duplicate redirects
      // and replayed authorization codes cannot exchange a second time.
      login = null
      if (!pending || pending.epoch !== generation || now() >= pending.expiresAt ||
          typeof value !== 'string' || value.length > 4096) throw error()
      try {
        const url = new URL(value)
        if (url.origin !== redirect.origin || url.pathname !== redirect.pathname ||
            url.username || url.password || url.hash ||
            ![...url.searchParams.keys()].every(k => ['code', 'state', 'iss'].includes(k)) ||
            url.searchParams.getAll('code').length !== 1 ||
            url.searchParams.getAll('iss').length > 1 ||
            (url.searchParams.has('iss') && url.searchParams.get('iss') !== issuer) ||
            url.searchParams.getAll('state').length !== 1 ||
            !same(url.searchParams.get('state'), pending.state) ||
            !CODE.test(url.searchParams.get('code'))) throw error()
        const busy = (async () => {
          const tokens = await config.exchangeCode({
            code: url.searchParams.get('code'), codeVerifier: pending.verifier,
            redirectUri: redirect.href, clientId: config.clientId,
          })
          const claims = await config.verifyTokens({
            tokens, issuer, audience: config.audience, clientId: config.clientId,
            nonce: pending.nonce,
          })
          const next = checkClaims(tokens, claims, pending.nonce)
          if (generation !== pending.epoch) throw error()
          await commit(tokens, next, null, pending.epoch)
          return { authenticated: true }
        })()
        inflight = busy
        return await busy
      } catch { throw error() }
      finally { inflight = null }
    },
    async renew() {
      if (login || inflight) throw error()
      const epoch = ++generation
      const busy = (async () => {
        const record = await config.vault.load()
        if (!record || record.issuer !== issuer || record.clientId !== config.clientId ||
            !SUBJECT.test(record.subject) || !CODE.test(record.refreshToken)) throw error()
        const tokens = await config.exchangeRefresh({
          refreshToken: record.refreshToken, clientId: config.clientId,
        })
        const claims = await config.verifyTokens({
          tokens, issuer, audience: config.audience, clientId: config.clientId,
          nonce: null,
        })
        const next = checkClaims(tokens, claims, null, record.subject)
        if (generation !== epoch) throw error()
        await commit(tokens, next, record.refreshToken, epoch)
        return { authenticated: true }
      })()
      inflight = busy
      try { return await busy }
      catch { active = null; throw error() }
      finally { inflight = null }
    },
    accessToken() {
      if (!active || now() >= active.expiresAt - MIN_TTL) return null
      return active.accessToken // main-process v2 client ONLY; never IPC
    },
    async signOut() {
      ++generation
      login = null
      active = null
      try { await serialVault(() => config.vault.clear()) } catch { throw error() }
      // Provider-side refresh revoke and outstanding v2 media/session teardown
      // are separate required integration steps.
      return { authenticated: false }
    },
  })
}
