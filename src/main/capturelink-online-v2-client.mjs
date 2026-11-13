/**
 * UX3F-3B1: main-process-only client for the isolated /v2 broker.
 * This adapter intentionally accepts ONLY loopback HTTP for offline testing.
 * A production HTTPS adapter requires separately reviewed origin/TLS policy.
 * Session bearers never appear in create/join return values or IPC-facing status.
 */
import { canonicalGuestName, validPermissions, validUuid } from '../../services/signaling/src/protocol.mjs'
const TOKEN = /^[A-Za-z0-9_-]{43}$/
const error = () => new Error('online_signaling_unavailable')

export function createLocalV2SignalingClient({ origin, accessToken, fetchImpl = globalThis.fetch } = {}) {
  let url
  try { url = new URL(origin) } catch { throw error() }
  if (!url || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
      typeof fetchImpl !== 'function' || typeof accessToken !== 'function') throw error()
  let role = null, sessionId = null, sessionToken = null, cursor = 0, starting = false
  function path(action = '') {
    if (!sessionId) throw error()
    return `/v2/sessions/${sessionId}${action ? `/${action}` : ''}`
  }
  async function request(method, pathname, body, token, { signal } = {}) {
    if (signal?.aborted) throw error()
    if (token !== null && (typeof token !== 'string' || token.length > 8192 || /[\s\x00-\x1f]/.test(token))) throw error()
    try {
      const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
      const response = await fetchImpl(url.origin + pathname, {
        method, redirect: 'error', cache: 'no-store', signal: combined,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (!response.ok || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) throw error()
      let count = 0
      const chunks = []
      const reader = response.body?.getReader()
      if (!reader) throw error()
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          count += value.length
          if (count > 1_200_000) throw error()
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
    } catch { throw error() }
  }
  function requireSession(required = null) {
    if (!role || !sessionToken || !sessionId || (required && role !== required)) throw error()
  }
  function validCreation(data, host) {
    return data?.version === 2 && validUuid(data.sessionId) &&
      TOKEN.test(host ? data.hostSessionToken : data.guestSessionToken) &&
      (host ? TOKEN.test(data.inviteCode) && Number.isSafeInteger(data.inviteExpiresAt) :
        validUuid(data.guestId) && data.status === 'pending')
  }
  return Object.freeze({
    get role() { return role },
    async create(permissions, options = {}) {
      if (role || starting || !validPermissions(permissions)) throw error()
      starting = true
      try {
        // The current, verified Auth0 access token is read from main memory only.
        let token
        try { token = accessToken() } catch { throw error() }
        if (typeof token !== 'string') throw error()
        const data = await request('POST', '/v2/sessions', { permissions }, token, options)
        if (!validCreation(data, true)) throw error()
        role = 'host'; sessionId = data.sessionId; sessionToken = data.hostSessionToken; cursor = 0
        return { inviteCode: data.inviteCode, inviteExpiresAt: data.inviteExpiresAt }
      } finally { starting = false }
    },
    async join(inviteCode, { signal, displayName } = {}) {
      if (role || starting || !TOKEN.test(inviteCode)) throw error()
      const name = canonicalGuestName(displayName)
      if (!name) throw error()
      starting = true
      try {
        const data = await request('POST', '/v2/join', { inviteCode, displayName: name }, null, { signal })
        if (!validCreation(data, false)) throw error()
        role = 'guest'; sessionId = data.sessionId; sessionToken = data.guestSessionToken; cursor = 0
        return { status: 'pending' }
      } finally { starting = false }
    },
    async snapshot({ signal } = {}) {
      requireSession()
      const data = await request('GET', path(), undefined, sessionToken, { signal })
      if (data.version !== 2 || data.sessionId !== sessionId || data.role !== role ||
          !['open', 'pending', 'approved', 'rejected'].includes(data.status)) throw error()
      return {
        role, status: data.status, pendingGuestId: role === 'host' ? data.pendingGuestId : null,
        guestDisplayName: role === 'host' ? data.guestDisplayName : null,
      }
    },
    async approve(guestId, { signal } = {}) {
      requireSession('host'); if (!validUuid(guestId)) throw error()
      const data = await request('POST', path('approve'), { guestId }, sessionToken, { signal })
      if (data.status !== 'approved') throw error()
      return { status: 'approved' }
    },
    async reject(guestId, { signal } = {}) {
      requireSession('host'); if (!validUuid(guestId)) throw error()
      const data = await request('POST', path('reject'), { guestId }, sessionToken, { signal })
      if (data.status !== 'rejected') throw error()
      return { status: 'rejected' }
    },
    async send(kind, payload, { signal } = {}) {
      requireSession()
      if (kind !== (role === 'host' ? 'invite' : 'response') ||
          typeof payload !== 'string' || !payload.startsWith('CAPTURELINK-SESSION-V1:') ||
          payload.length > 1_000_000) throw error()
      const data = await request('POST', path('messages'), { kind, payload }, sessionToken, { signal })
      if (data.accepted !== true) throw error()
      return { sent: true }
    },
    async messages({ signal } = {}) {
      requireSession()
      const data = await request('GET', `${path('messages')}?after=${cursor}`, undefined, sessionToken, { signal })
      if (!Array.isArray(data.messages) || !Number.isSafeInteger(data.nextCursor) || data.nextCursor < cursor ||
          data.messages.some(m => !Number.isSafeInteger(m.id) || m.id <= cursor ||
            m.kind !== (role === 'host' ? 'response' : 'invite') ||
            typeof m.payload !== 'string' || !m.payload.startsWith('CAPTURELINK-SESSION-V1:'))) throw error()
      cursor = data.nextCursor
      return data.messages
    },
    async end({ signal } = {}) {
      if (starting) throw error()
      if (!role) return
      const action = role === 'host' ? 'revoke' : 'leave'
      const endPath = path(action)
      const token = sessionToken
      role = null; sessionId = null; sessionToken = null; cursor = 0
      try { await request('POST', endPath, undefined, token, { signal }) } catch { /* locally fail closed */ }
    },
  })
}
