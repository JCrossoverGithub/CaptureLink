/**
 * UX3F-3B3A: isolated, main-process-only HTTPS /v2 host-creation candidate.
 *
 * This stage intentionally pins a non-routable .test identity and is not
 * imported by Electron, the private pilot, or the production edge. A later
 * reviewed stage must explicitly approve a real origin, full session bridge,
 * account deactivation handling, and production deployment.
 *
 * OAuth access tokens and broker host capabilities never leave this closure.
 */
import { validPermissions, validUuid, INVITE_TTL_MS, SESSION_TTL_MS } from '../../services/signaling/src/protocol.mjs'

export const UX3F3B3A_TEST_ORIGIN = 'https://signal.capturelink.test'

const fail = () => new Error('online_signaling_unavailable')
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/
const BEARER = /^[A-Za-z0-9_.-]{16,8192}$/
const MAX_REPLY_BYTES = 16_384
const REQUEST_TIMEOUT_MS = 10_000

function optionsValid(config) {
  return config && typeof config === 'object' && !Array.isArray(config) &&
    config.origin === UX3F3B3A_TEST_ORIGIN &&
    typeof config.accessToken === 'function' &&
    typeof config.fetchImpl === 'function' &&
    typeof config.now === 'function'
}

async function jsonRequest(fetchImpl, method, path, token, body, signal, expectedStatus) {
  if (signal?.aborted || typeof token !== 'string' || !BEARER.test(token)) throw fail()
  const target = UX3F3B3A_TEST_ORIGIN + path
  let response
  try {
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    response = await fetchImpl(target, {
      method,
      redirect: 'error', cache: 'no-store', credentials: 'omit',
      referrerPolicy: 'no-referrer', signal: requestSignal,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response || response.redirected !== false || response.url !== target ||
        response.status !== expectedStatus ||
        !/^application\/json(?:\s*;|$)/i.test(response.headers?.get?.('content-type') ?? '') ||
        Number(response.headers.get('content-length') ?? 0) > MAX_REPLY_BYTES) throw fail()
    if (!response.body || typeof response.body.getReader !== 'function') throw fail()
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!(value instanceof Uint8Array)) throw fail()
        size += value.byteLength
        if (size > MAX_REPLY_BYTES) throw fail()
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch { throw fail() }
}

/**
 * The caller is trusted Electron-main code or a hermetic test harness.
 * `accessToken()` must return a previously validated, non-expired Auth0 JWT
 * from main memory; it is never obtained from renderer input.
 */
export function createCaptureLinkOnlineHttpsHostCandidate({
  origin = UX3F3B3A_TEST_ORIGIN, accessToken,
  fetchImpl = globalThis.fetch, now = Date.now,
} = {}) {
  if (!optionsValid({ origin, accessToken, fetchImpl, now })) throw fail()

  let session = null
  let creating = false
  let generation = 0
  let controller = null

  const revoke = async (record) => {
    try {
      await jsonRequest(fetchImpl, 'POST',
        `/v2/sessions/${record.sessionId}/revoke`, record.hostSessionToken,
        undefined, undefined, 200)
    } catch { /* Local authority was already dropped; broker TTL is bounded. */ }
  }
  return Object.freeze({
    status() { return Object.freeze({ hosting: session !== null }) },
    async create(permissions, { signal } = {}) {
      if (session || creating || !validPermissions(permissions) || signal?.aborted) throw fail()
      const epoch = generation
      const control = new AbortController()
      controller = control
      creating = true
      let result
      try {
        let bearer
        try { bearer = accessToken() } catch { throw fail() }
        if (!BEARER.test(bearer)) throw fail()
        const combined = signal ? AbortSignal.any([signal, control.signal]) : control.signal
        result = await jsonRequest(fetchImpl, 'POST', '/v2/sessions', bearer,
          { permissions }, combined, 201)
        const time = now()
        if (result?.version !== 2 || !validUuid(result.sessionId) ||
            !CAPABILITY.test(result.hostSessionToken) || !CAPABILITY.test(result.inviteCode) ||
            result.hostSessionToken === result.inviteCode ||
            !Number.isSafeInteger(result.inviteExpiresAt) ||
            result.inviteExpiresAt <= time || result.inviteExpiresAt > time + INVITE_TTL_MS + 5_000 ||
            !Number.isSafeInteger(result.sessionExpiresAt) ||
            result.sessionExpiresAt <= time || result.sessionExpiresAt > time + SESSION_TTL_MS + 5_000) throw fail()
        if (generation !== epoch || combined.aborted) {
          // If a late HTTP response still supplied a valid capability, revoke.
          await revoke(result)
          throw fail()
        }
        session = Object.freeze({ sessionId: result.sessionId, hostSessionToken: result.hostSessionToken })
        return Object.freeze({ inviteCode: result.inviteCode, inviteExpiresAt: result.inviteExpiresAt })
      } catch { throw fail() }
      finally {
        if (controller === control) controller = null
        creating = false
      }
    },
    async end() {
      ++generation
      controller?.abort()
      controller = null
      const record = session
      session = null
      if (record) await revoke(record)
      return Object.freeze({ ended: true })
    },
  })
}
