/**
 * UX3F-3B3C1: hermetic, main-only HTTPS /v2 host-or-anonymous-guest client.
 * The endpoint is intentionally an unroutable .test identity. Not an Electron
 * IPC/renderer client and not a production signaling option. A later stage
 * must explicitly review and authorize any real service origin and UI route.
 */
import {
  canonicalGuestName, inspectEnvelope, permissionsEqual, validPermissions,
  validUuid, INVITE_TTL_MS, SESSION_TTL_MS, MAX_BODY,
} from '../../services/signaling/src/protocol.mjs'
import { UX3F3B3A_TEST_ORIGIN } from './capturelink-online-https-host-candidate.mjs'

const unavailable = () => new Error('online_signaling_unavailable')
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/
const BEARER = /^[A-Za-z0-9_.-]{16,8192}$/
const MAX_REPLY = MAX_BODY
const TIMEOUT_MS = 10_000
const STATUS = new Set(['open', 'pending', 'approved', 'rejected'])

function validConfig(x) {
  return x?.origin === UX3F3B3A_TEST_ORIGIN &&
    typeof x.fetchImpl === 'function' && typeof x.now === 'function' &&
    (x.accessToken === null || typeof x.accessToken === 'function')
}

async function request(fetchImpl, method, pathname, token, body, signal, expectedStatus) {
  if (signal?.aborted || typeof pathname !== 'string' ||
      !/^\/v2\/(?:sessions(?:\/[a-f0-9-]+(?:\/(?:approve|reject|messages|revoke|leave))?)?|join)(?:\?after=(?:0|[1-9]\d{0,8}))?$/.test(pathname) ||
      (token !== null && (typeof token !== 'string' || !BEARER.test(token)))) throw unavailable()
  const target = UX3F3B3A_TEST_ORIGIN + pathname
  try {
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS)
    const response = await fetchImpl(target, {
      method, redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      signal: combined,
      headers: {
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response || response.redirected !== false || response.url !== target ||
        response.status !== expectedStatus ||
        !/^application\/json(?:\s*;|$)/i.test(response.headers?.get?.('content-type') ?? '')) throw unavailable()
    const length = response.headers.get('content-length')
    if (length !== null && (!/^(?:0|[1-9]\d*)$/.test(length) || Number(length) > MAX_REPLY)) throw unavailable()
    const reader = response.body?.getReader?.()
    if (!reader) throw unavailable()
    const chunks = []
    let bytes = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (!(value instanceof Uint8Array)) throw unavailable()
        bytes += value.byteLength
        if (bytes > MAX_REPLY) throw unavailable()
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const result = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)))
    if (!result || Array.isArray(result) || typeof result !== 'object') throw unavailable()
    return result
  } catch { throw unavailable() }
}

const uuid = x => validUuid(x)
const capability = x => typeof x === 'string' && CAPABILITY.test(x)
const timeValid = (value, now, ttl) => Number.isSafeInteger(value) && value > now && value <= now + ttl + 5_000

export function createCaptureLinkOnlineHttpsSessionCandidate({
  origin = UX3F3B3A_TEST_ORIGIN, accessToken = null,
  fetchImpl = globalThis.fetch, now = Date.now,
} = {}) {
  if (!validConfig({ origin, accessToken, fetchImpl, now })) throw unavailable()

  let record = null
  let starting = false
  let generation = 0
  const inFlight = new Set()
  let cursor = 0
  let lastSnapshot = null
  let offerSessionId = null
  let guestPinnedPermissions = null

  const abortOperations = () => {
    for (const ctrl of inFlight) ctrl.abort()
    inFlight.clear()
  }
  const execute = async (method, path, token, body, expected, signal) => {
    const ctrl = new AbortController()
    inFlight.add(ctrl)
    try {
      const combined = signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal
      return await request(fetchImpl, method, path, token, body, combined, expected)
    } finally { inFlight.delete(ctrl) }
  }
  const withRecord = (requiredRole = null) => {
    if (!record || (requiredRole && record.role !== requiredRole)) throw unavailable()
    return record
  }
  const path = (r, operation = '') => `/v2/sessions/${r.sessionId}${operation ? '/' + operation : ''}`
  const closeRemote = async r => {
    try {
      await execute('POST', path(r, r.role === 'host' ? 'revoke' : 'leave'), r.token, undefined, 200)
    } catch { /* local capability already cleared; remote revocation not proven */ }
  }
  const checkEpoch = (r, epoch) => {
    if (generation !== epoch || record !== r) throw unavailable()
  }
  return Object.freeze({
    status() { return Object.freeze({ role: record?.role ?? null, active: record !== null }) },
    async create(permissions, { signal } = {}) {
      if (record || starting || signal?.aborted || !validPermissions(permissions) || !accessToken) throw unavailable()
      const epoch = generation
      starting = true
      try {
        let bearer
        try { bearer = accessToken() } catch { throw unavailable() }
        if (!BEARER.test(bearer)) throw unavailable()
        const result = await execute('POST', '/v2/sessions', bearer, { permissions }, 201, signal)
        const currentTime = now()
        if (result.version !== 2 || !uuid(result.sessionId) || !capability(result.hostSessionToken) ||
            !capability(result.inviteCode) || result.hostSessionToken === result.inviteCode ||
            !timeValid(result.inviteExpiresAt, currentTime, INVITE_TTL_MS) ||
            !timeValid(result.sessionExpiresAt, currentTime, SESSION_TTL_MS)) throw unavailable()
        const newRecord = Object.freeze({ role: 'host', sessionId: result.sessionId,
          token: result.hostSessionToken, permissions: Object.freeze({ ...permissions }) })
        if (epoch !== generation || signal?.aborted) {
          await closeRemote(newRecord)
          throw unavailable()
        }
        record = newRecord
        return Object.freeze({ inviteCode: result.inviteCode, inviteExpiresAt: result.inviteExpiresAt })
      } catch { throw unavailable() }
      finally { starting = false }
    },
    async join(inviteCode, { displayName, signal } = {}) {
      if (record || starting || signal?.aborted || !capability(inviteCode)) throw unavailable()
      const name = canonicalGuestName(displayName)
      if (!name) throw unavailable()
      const epoch = generation
      starting = true
      try {
        const result = await execute('POST', '/v2/join', null,
          { inviteCode, displayName: name }, 202, signal)
        if (result.version !== 2 || !uuid(result.sessionId) || !uuid(result.guestId) ||
            !capability(result.guestSessionToken) || result.status !== 'pending') throw unavailable()
        const newRecord = Object.freeze({ role: 'guest', sessionId: result.sessionId,
          token: result.guestSessionToken, permissions: null })
        if (epoch !== generation || signal?.aborted) {
          await closeRemote(newRecord)
          throw unavailable()
        }
        record = newRecord
        return Object.freeze({ status: 'pending' })
      } catch { throw unavailable() }
      finally { starting = false }
    },
    async snapshot({ signal } = {}) {
      const r = withRecord()
      const epoch = generation
      const data = await execute('GET', path(r), r.token, undefined, 200, signal)
      checkEpoch(r, epoch)
      if (data.version !== 2 || data.sessionId !== r.sessionId || data.role !== r.role ||
          !STATUS.has(data.status) || !validPermissions(data.permissions) ||
          (r.permissions && !permissionsEqual(r.permissions, data.permissions)) ||
          (guestPinnedPermissions && !permissionsEqual(guestPinnedPermissions, data.permissions)) ||
          (data.pendingGuestId !== null && data.pendingGuestId !== undefined && !uuid(data.pendingGuestId)) ||
          (data.guestDisplayName !== null && data.guestDisplayName !== undefined &&
            canonicalGuestName(data.guestDisplayName) !== data.guestDisplayName)) throw unavailable()
      if (r.role === 'guest' && !guestPinnedPermissions) guestPinnedPermissions = Object.freeze({ ...data.permissions })
      lastSnapshot = { status: data.status, permissions: Object.freeze({ ...data.permissions }),
        pendingGuestId: r.role === 'host' ? data.pendingGuestId ?? null : null }
      return Object.freeze({ role: r.role, status: data.status,
        hasPendingGuest: r.role === 'host' && Boolean(data.pendingGuestId),
        guestDisplayName: r.role === 'host' ? data.guestDisplayName ?? null : null,
        permissions: lastSnapshot.permissions })
    },
    async approve(allow, { signal } = {}) {
      const r = withRecord('host')
      if (typeof allow !== 'boolean' || !lastSnapshot?.pendingGuestId || lastSnapshot.status !== 'pending') throw unavailable()
      const epoch = generation
      const guestId = lastSnapshot.pendingGuestId
      // Confirm that the pending guest has not changed since the last poll.
      const latest = await execute('GET', path(r), r.token, undefined, 200, signal)
      checkEpoch(r, epoch)
      if (latest.sessionId !== r.sessionId || latest.role !== 'host' || latest.status !== 'pending' ||
          latest.pendingGuestId !== guestId) throw unavailable()
      const op = allow ? 'approve' : 'reject'
      const data = await execute('POST', path(r, op), r.token, { guestId }, 200, signal)
      checkEpoch(r, epoch)
      if (data.status !== (allow ? 'approved' : 'rejected')) throw unavailable()
      lastSnapshot = { ...lastSnapshot, pendingGuestId: null, status: data.status }
      return Object.freeze({ status: data.status })
    },
    async send(kind, wire, { signal } = {}) {
      const r = withRecord()
      const epoch = generation
      if (kind !== (r.role === 'host' ? 'invite' : 'response') ||
          !lastSnapshot || lastSnapshot.status !== 'approved') throw unavailable()
      let envelope
      try { envelope = inspectEnvelope(wire, kind, lastSnapshot.permissions) }
      catch { throw unavailable() }
      if (kind === 'response' && (!offerSessionId || envelope.sessionId !== offerSessionId)) throw unavailable()
      const data = await execute('POST', path(r, 'messages'), r.token, { kind, payload: wire }, 202, signal)
      checkEpoch(r, epoch)
      if (data.accepted !== true) throw unavailable()
      if (kind === 'invite') offerSessionId = envelope.sessionId
      return Object.freeze({ sent: true })
    },
    async messages({ signal } = {}) {
      const r = withRecord()
      const epoch = generation
      if (!lastSnapshot || lastSnapshot.status !== 'approved') throw unavailable()
      const data = await execute('GET', path(r, 'messages') + `?after=${cursor}`, r.token, undefined, 200, signal)
      checkEpoch(r, epoch)
      if (!Array.isArray(data.messages) || data.messages.length > 2 ||
          !Number.isSafeInteger(data.nextCursor) || data.nextCursor < cursor) throw unavailable()
      const expectedKind = r.role === 'host' ? 'response' : 'invite'
      let previous = cursor
      const result = []
      let nextOfferSessionId = offerSessionId
      for (const item of data.messages) {
        if (!Number.isSafeInteger(item?.id) || item.id <= previous || item.id > 999_999_999 ||
            item.kind !== expectedKind || typeof item.payload !== 'string') throw unavailable()
        let metadata
        try { metadata = inspectEnvelope(item.payload, item.kind, lastSnapshot.permissions) }
        catch { throw unavailable() }
        if (r.role === 'host' && (!nextOfferSessionId || metadata.sessionId !== nextOfferSessionId)) throw unavailable()
        if (r.role === 'guest' && nextOfferSessionId && metadata.sessionId !== nextOfferSessionId) throw unavailable()
        if (r.role === 'guest') nextOfferSessionId = metadata.sessionId
        result.push(Object.freeze({ kind: item.kind, payload: item.payload }))
        previous = item.id
      }
      if (data.nextCursor !== previous) throw unavailable()
      cursor = previous
      offerSessionId = nextOfferSessionId
      return result
    },
    async end() {
      ++generation
      abortOperations()
      const prior = record
      record = null
      starting = false
      cursor = 0
      lastSnapshot = null
      offerSessionId = null
      guestPinnedPermissions = null
      if (prior) await closeRemote(prior)
      return Object.freeze({ ended: true })
    },
  })
}
