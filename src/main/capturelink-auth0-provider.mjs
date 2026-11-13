/**
 * UX3F-3B1: Auth0 public native-client adapter and cryptographic JWKS validator.
 * Only trusted Electron main / broker construction may supply configuration.
 * No client secret, API bearer, credentials or user strings are ever logged.
 * No production registration, Electron IPC or VPS route is installed here.
 */
import { createPublicKey, verify as verifySignature } from 'node:crypto'

const MAX_RESPONSE = 65536
const MAX_JWT = 16000
const error = () => new Error('online_auth_unavailable')
const string = (v, min = 1, max = 1024) => typeof v === 'string' && v.length >= min && v.length <= max
const noControls = v => string(v) && /^[\x21-\x7e]+$/.test(v)

function configOrigin(domain) {
  if (!string(domain)) throw error()
  let u
  try { u = new URL(domain.includes('://') ? domain : `https://${domain}`) } catch { throw error() }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password || u.port ||
      u.pathname !== '/' || u.search || u.hash || u.hostname === 'localhost' ||
      /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) throw error()
  return u.origin
}
function parseJsonBuffer(data) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) }
  catch { throw error() }
}
function base64Part(text) {
  if (!string(text, 1, MAX_JWT) || !/^[a-zA-Z0-9_-]+$/.test(text) || text.length % 4 === 1) throw error()
  const out = Buffer.from(text, 'base64url')
  if (out.toString('base64url') !== text) throw error()
  return out
}
function parseJwt(value) {
  if (!string(value, 20, MAX_JWT) || !/^[A-Za-z0-9._-]+$/.test(value)) throw error()
  const pieces = value.split('.')
  if (pieces.length !== 3) throw error()
  const header = parseJsonBuffer(base64Part(pieces[0]))
  const claims = parseJsonBuffer(base64Part(pieces[1]))
  if (!header || typeof header !== 'object' || Array.isArray(header) ||
      header.alg !== 'RS256' || !string(header.kid, 1, 128) ||
      !/^[A-Za-z0-9._-]+$/.test(header.kid) ||
      (header.typ !== undefined && !['JWT', 'at+jwt'].includes(header.typ)) ||
      ['jwk', 'jku', 'x5u', 'crit'].some(p => Object.hasOwn(header, p)) ||
      !claims || typeof claims !== 'object' || Array.isArray(claims)) throw error()
  return { header, claims, signingInput: Buffer.from(`${pieces[0]}.${pieces[1]}`), signature: base64Part(pieces[2]) }
}
function requireTime(claims, now) {
  const nowSeconds = Math.floor(now() / 1000)
  if (!Number.isSafeInteger(nowSeconds) || !Number.isSafeInteger(claims.exp) ||
      claims.exp <= nowSeconds + 10 || claims.exp > nowSeconds + 86400 ||
      !Number.isSafeInteger(claims.iat) || claims.iat > nowSeconds + 60 ||
      claims.iat < nowSeconds - 86400 ||
      (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > nowSeconds + 60))) throw error()
}
function requireAudience(aud, audience, azp = null, clientId = null) {
  if (typeof aud === 'string') {
    if (aud !== audience) throw error()
  } else if (Array.isArray(aud) && aud.length > 0 && aud.length <= 5 &&
             aud.every(x => string(x, 1, 512)) && aud.includes(audience)) {
    if (aud.length > 1 && azp !== clientId) throw error()
  } else throw error()
}

export function createCaptureLinkAuth0Provider({ domain, clientId, audience,
  fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const origin = configOrigin(domain)
  if (!string(clientId, 8, 128) || !/^[A-Za-z0-9_-]+$/.test(clientId) ||
      !string(audience, 1, 512) || !/^https:\/\//.test(audience) ||
      typeof fetchImpl !== 'function' || typeof now !== 'function') throw error()
  const issuer = origin + '/'
  const endpoints = Object.freeze({
    authorize: `${origin}/authorize`, token: `${origin}/oauth/token`,
    jwks: `${origin}/.well-known/jwks.json`, revoke: `${origin}/oauth/revoke`,
  })
  let cached = null
  let lastFetch = 0
  let fetchPending = null

  async function readBounded(response, max) {
    if (!response || response.ok !== true || response.type === 'opaqueredirect' ||
        !/^application\/json\b/i.test(response.headers?.get?.('content-type') || '') ||
        Number(response.headers?.get?.('content-length') || '0') > max || !response.body) throw error()
    const reader = response.body.getReader()
    let bytes = 0
    const chunks = []
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.length
        if (bytes > max) throw error()
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    return parseJsonBuffer(Buffer.concat(chunks))
  }
  async function request(url, init, max = MAX_RESPONSE) {
    const timeout = AbortSignal.timeout(7000)
    try {
      const response = await fetchImpl(url, {
        ...init, redirect: 'error', cache: 'no-store', signal: timeout,
      })
      return await readBounded(response, max)
    } catch { throw error() }
  }
  async function loadKeys(force = false) {
    if (!force && cached && now() - lastFetch < 10 * 60 * 1000) return cached
    if (fetchPending) return fetchPending
    fetchPending = (async () => {
      const value = await request(endpoints.jwks, { method: 'GET' })
      if (!value || !Array.isArray(value.keys) || value.keys.length < 1 || value.keys.length > 32) throw error()
      const keys = new Map()
      for (const jwk of value.keys) {
        if (!jwk || jwk.kty !== 'RSA' || jwk.use && jwk.use !== 'sig' ||
            jwk.alg && jwk.alg !== 'RS256' || !string(jwk.kid, 1, 128) ||
            !/^[A-Za-z0-9._-]+$/.test(jwk.kid) || !string(jwk.n) || !string(jwk.e) || keys.has(jwk.kid)) throw error()
        let publicKey
        try {
          publicKey = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' })
          if (publicKey.asymmetricKeyType !== 'rsa' ||
              publicKey.asymmetricKeyDetails.modulusLength < 2048) throw error()
        } catch { throw error() }
        keys.set(jwk.kid, publicKey)
      }
      cached = keys
      lastFetch = now()
      return keys
    })()
    try { return await fetchPending }
    finally { fetchPending = null }
  }
  async function jwt(token) {
    const parsed = parseJwt(token)
    let keys = await loadKeys()
    if (!keys.has(parsed.header.kid)) keys = await loadKeys(true)
    const key = keys.get(parsed.header.kid)
    if (!key || !verifySignature('RSA-SHA256', parsed.signingInput, key, parsed.signature)) throw error()
    const c = parsed.claims
    if (c.iss !== issuer || !string(c.sub, 1, 256) || /[\s\x00-\x1f]/.test(c.sub)) throw error()
    requireTime(c, now)
    return c
  }
  async function access(token) {
    const c = await jwt(token)
    requireAudience(c.aud, audience, c.azp, clientId)
    if (c.azp !== clientId) throw error()
    if (!Array.isArray(c.permissions) ||
        !c.permissions.every(p => string(p, 1, 128)) ||
        !c.permissions.includes('sessions:create') ||
        !string(c.scope) || !c.scope.split(' ').includes('sessions:create')) throw error()
    return c
  }
  async function exchangeCode({ code, codeVerifier, redirectUri, clientId: fromClient }) {
    if (fromClient !== clientId || !noControls(code) || !noControls(codeVerifier) ||
        !string(redirectUri) || !/^http:\/\/127\.0\.0\.1:\d+\/capturelink-online\/callback$/.test(redirectUri)) throw error()
    return tokenRequest({ grant_type: 'authorization_code', client_id: clientId,
      code, code_verifier: codeVerifier, redirect_uri: redirectUri })
  }
  async function exchangeRefresh({ refreshToken, clientId: fromClient }) {
    if (fromClient !== clientId || !noControls(refreshToken)) throw error()
    return tokenRequest({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken })
  }
  async function tokenRequest(params) {
    const result = await request(endpoints.token, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    }, 32768)
    if (!result || result.token_type !== 'Bearer' || !noControls(result.access_token) ||
        (result.refresh_token !== undefined && !noControls(result.refresh_token)) ||
        (result.id_token !== undefined && !noControls(result.id_token))) throw error()
    return { tokenType: 'Bearer', accessToken: result.access_token,
      ...(result.refresh_token === undefined ? {} : { refreshToken: result.refresh_token }),
      ...(result.id_token === undefined ? {} : { idToken: result.id_token }) }
  }
  return Object.freeze({
    issuer: origin, clientId, audience,
    authorizationEndpoint: endpoints.authorize,
    scope: 'openid offline_access sessions:create',
    exchangeCode, exchangeRefresh,
    async verifyHostAccessToken(token) {
      try {
        const c = await access(token)
        return { iss: origin, aud: audience, sub: c.sub, exp: c.exp,
          ...(c.nbf === undefined ? {} : { nbf: c.nbf }), scope: ['sessions:create'] }
      } catch { return null }
    },
    async verifyTokens({ tokens, issuer: expectedIssuer, audience: expectedAudience,
      clientId: expectedClient, nonce }) {
      try {
        if (expectedIssuer !== origin || expectedAudience !== audience || expectedClient !== clientId ||
            !tokens || typeof tokens.accessToken !== 'string') throw error()
        const a = await access(tokens.accessToken)
        if (nonce !== null) {
          if (!string(tokens.idToken)) throw error()
          const id = await jwt(tokens.idToken)
          requireAudience(id.aud, clientId, id.azp, clientId)
          if (id.sub !== a.sub || id.nonce !== nonce) throw error()
        } else if (tokens.idToken !== undefined) {
          const id = await jwt(tokens.idToken)
          requireAudience(id.aud, clientId, id.azp, clientId)
          if (id.sub !== a.sub) throw error()
        }
        return { issuer: origin, audience, subject: a.sub,
          expiresAt: a.exp * 1000, scopes: ['sessions:create'],
          ...(nonce !== null ? { nonce } : {}) }
      } catch { throw error() }
    },
  })
}
