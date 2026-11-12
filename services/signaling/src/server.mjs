/**
 * CaptureLink UX3a prototype signaling broker.
 * No dependencies, no auth cookies, no SDP/ICE logging, no Xbox credentials.
 * Binds to loopback only. Public deployment is NOT authorized by this prototype.
 */
import { createServer as createHttpServer } from 'node:http'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createPilotAdmission } from './pilot-admission.mjs'
import {
  MAX_BODY, INVITE_TTL_MS, SESSION_TTL_MS, inspectEnvelope,
  isPlainObject, hasExactKeys, validPermissions, validUuid, canonicalGuestName
} from './protocol.mjs'

const MAX_SESSIONS = 100
const MAX_IP_TRACKERS = 10_000
const MAX_CODE_TRACKERS = 2_000

function secret() { return randomBytes(32).toString('base64url') }
function digest(value) { return createHash('sha256').update(value).digest() }
function equalsDigest(a, b) { return Buffer.isBuffer(a) && Buffer.isBuffer(b) && timingSafeEqual(a, b) }
function fingerprint(value) { return digest(value).toString('hex') }

function reply(res, status, object) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
  })
  res.end(JSON.stringify(object))
}

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code }
}

async function readJson(req, strict = false) {
  if (strict) {
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(String(req.headers['content-type'] || ''))) {
      throw new HttpError(415, 'json_required')
    }
    const length = req.headers['content-length']
    if (length !== undefined && !/^(?:0|[1-9]\d*)$/.test(length)) throw new HttpError(400, 'invalid_length')
    if (length !== undefined && Number(length) > MAX_BODY) throw new HttpError(413, 'request_too_large')
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'json_required')
  }
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new HttpError(413, 'request_too_large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
}

function checkToken(req, session) {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) {
    throw new HttpError(401, 'unauthorized')
  }
  const submitted = digest(header.slice(7))
  if (equalsDigest(submitted, session.hostHash)) return 'host'
  if (session.guest && equalsDigest(submitted, session.guest.hash)) return 'guest'
  throw new HttpError(401, 'unauthorized')
}

function permissionCopy(x) { return { watch: x.watch, voice: x.voice, controller: x.controller, controllerMode: x.controllerMode } }

/** Default is the accepted, completely unchanged UX3b1 localhost API. */
export function createSignalingServer({ now = Date.now, allowedOrigins = [], maxSessions = MAX_SESSIONS, pilot = null } = {}) {
  if (pilot !== null && (!pilot || typeof pilot.identify !== 'function' || typeof pilot.revoke !== 'function' ||
      !pilot.limits)) throw new Error('invalid_pilot_policy')
  const sessions = new Map()
  const inviteIndex = new Map()
  const byIp = new Map()
  const byCode = new Map()
  const byInstallation = new Map()
  const bySession = new Map()
  const globalRequests = new Map()
  let totalMessageBytes = 0
  let lastCleanup = 0

  function removeSession(id) {
    const item = sessions.get(id)
    if (!item) return
    if (item.inviteHash) inviteIndex.delete(item.inviteHash.toString('hex'))
    totalMessageBytes -= item.messageBytes || 0
    sessions.delete(id)
    bySession.delete(id)
  }

  function ensureCurrentAdmission(installationId, session = null) {
    if (!pilot) return
    if (!pilot.active(installationId)) throw new HttpError(401, 'unauthorized')
    if (session && sessions.get(session.id) !== session) throw new HttpError(404, 'not_found')
  }

  function routeBudget(pathname, method) {
    if (pathname === '/v1/sessions' && method === 'POST') return 'create'
    if (pathname === '/v1/join' && method === 'POST') return 'join'
    if (/^\/v1\/sessions\/[^/]+(?:\/messages)?$/.test(pathname) && method === 'GET') return 'read'
    if (pathname.endsWith('/messages') && method === 'POST') return 'message'
    if (/\/(approve|reject)$/.test(pathname) && method === 'POST') return 'decision'
    if (/\/(revoke|leave)$/.test(pathname) && method === 'POST') return 'close'
    return 'other'
  }

  function purge() {
    const time = now()
    if (time - lastCleanup < 5000 && lastCleanup <= time) return
    lastCleanup = time
    for (const [key, item] of sessions) {
      if (item.sessionExpiresAt <= time || (item.guest?.status !== 'approved' && item.inviteExpiresAt <= time)) {
        removeSession(key)
      }
    }
    for (const store of [byIp, byCode, byInstallation, bySession, globalRequests]) {
      for (const [key, value] of store) if (value.resetAt <= time) store.delete(key)
    }
  }

  function limit(store, key, count, ms, maxTrackers) {
    const time = now()
    let item = store.get(key)
    if (!item || item.resetAt <= time) {
      if (!item && store.size >= maxTrackers) throw new HttpError(429, 'rate_limited')
      item = { n: 0, resetAt: time + ms }
      store.set(key, item)
    }
    if (++item.n > count) throw new HttpError(429, 'rate_limited')
  }

  function authSession(req, id, installationId = null) {
    if (!validUuid(id)) throw new HttpError(404, 'not_found')
    const session = sessions.get(id)
    if (!session) throw new HttpError(404, 'not_found')
    if (session.sessionExpiresAt <= now()) throw new HttpError(410, 'session_expired')
    const role = checkToken(req, session)
    if (pilot) {
      if (installationId !== (role === 'host' ? session.hostInstallationId : session.guest?.installationId)) {
        throw new HttpError(401, 'unauthorized')
      }
      limit(bySession, id, pilot.limits.session, 60_000, 2_000)
    }
    return { session, role }
  }

  function snapshot(session, role) {
    return {
      version: 1,
      sessionId: session.id,
      role,
      permissions: permissionCopy(session.permissions),
      inviteExpiresAt: session.inviteExpiresAt,
      sessionExpiresAt: session.sessionExpiresAt,
      status: session.guest?.status || 'open',
      pendingGuestId: role === 'host' && session.guest?.status === 'pending' ? session.guest.id : null,
      guestId: role === 'host' && session.guest?.status === 'approved' ? session.guest.id : null,
      guestDisplayName: role === 'host' && session.guest && session.guest.status !== 'rejected' ? session.guest.displayName : null,
    }
  }

  const server = createHttpServer(async (req, res) => {
    try {
      purge()
      // Native clients send bearer credentials directly. Browser origins must be
      // explicitly allowlisted; wildcard CORS is intentionally not implemented.
      if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) throw new HttpError(403, 'origin_denied')
      const ip = req.socket.remoteAddress || 'unknown'  // Untrusted forwarding headers are NEVER identity.
      if (pilot && Object.keys(req.headers).some(k => k === 'forwarded' || k === 'x-real-ip' || k.startsWith('x-forwarded-'))) {
        throw new HttpError(400, 'forwarded_headers_forbidden')
      }
      if (pilot && (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || req.url.length > 1_024)) {
        throw new HttpError(400, 'invalid_request_target')
      }
      const pathname = new URL(req.url, 'http://localhost').pathname
      let installationId = null
      if (!pilot) {
        limit(byIp, ip, 100, 60_000, MAX_IP_TRACKERS)
      } else if (pathname !== '/healthz' || req.method !== 'GET') {
        installationId = pilot.identify(req.headers['x-capturelink-admission'])
        if (!installationId) {
          // A separate, small budget for unauthenticated guesses. Valid clients
          // never share this bucket even behind a reverse proxy.
          limit(byIp, `${ip}:unauthenticated`, 40, 60_000, MAX_IP_TRACKERS)
          throw new HttpError(401, 'unauthorized')
        }
        limit(globalRequests, 'all', pilot.limits.global, 60_000, 1)
        const budget = routeBudget(pathname, req.method)
        limit(byInstallation, `${installationId}:${budget}`, pilot.limits[budget], 60_000, 64 * 8)
      }
      if (pathname === '/healthz' && req.method === 'GET') {
        if (pilot) limit(byIp, `${ip}:health`, 120, 60_000, MAX_IP_TRACKERS)
        return reply(res, 200, { status: 'ok' })
      }

      if (pathname === '/v1/sessions' && req.method === 'POST') {
        const input = await readJson(req, !!pilot)
        ensureCurrentAdmission(installationId)
        if (!hasExactKeys(input, ['permissions']) || !validPermissions(input.permissions)) throw new HttpError(400, 'invalid_permissions')
        if (sessions.size >= maxSessions) throw new HttpError(503, 'capacity_exceeded')
        if (pilot && [...sessions.values()].filter(s => s.hostInstallationId === installationId).length >=
            pilot.limits.activePerInstallation) throw new HttpError(429, 'installation_capacity_exceeded')
        const id = randomUUID()
        const hostToken = secret()
        const inviteCode = secret()
        const item = {
          id, hostHash: digest(hostToken), inviteHash: digest(inviteCode),
          inviteExpiresAt: now() + INVITE_TTL_MS, sessionExpiresAt: now() + SESSION_TTL_MS,
          permissions: permissionCopy(input.permissions), guest: null, offerSessionId: null,
          sentInvite: false, sentResponse: false, messages: [], nextMessageId: 1,
          ...(pilot ? { hostInstallationId: installationId, messageBytes: 0 } : {}),
        }
        sessions.set(id, item)
        inviteIndex.set(fingerprint(inviteCode), id)
        return reply(res, 201, { version: 1, sessionId: id, hostToken, inviteCode,
          inviteExpiresAt: item.inviteExpiresAt, sessionExpiresAt: item.sessionExpiresAt })
      }

      if (pathname === '/v1/join' && req.method === 'POST') {
        const input = await readJson(req, !!pilot)
        ensureCurrentAdmission(installationId)
        if ((!hasExactKeys(input, ['inviteCode']) && !hasExactKeys(input, ['inviteCode', 'displayName'])) ||
            typeof input.inviteCode !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.inviteCode)) {
          throw new HttpError(400, 'invalid_invitation')
        }
        // Legacy clients without names remain compatible; new desktop UI requires a name.
        const guestDisplayName = Object.hasOwn(input, 'displayName') ? canonicalGuestName(input.displayName) : null
        if (Object.hasOwn(input, 'displayName') && !guestDisplayName) throw new HttpError(400, 'invalid_display_name')
        // Cap both source IP and code guesses. Code digest is not logged or returned.
        if (!pilot) limit(byIp, `${ip}:join`, 12, 60_000, MAX_IP_TRACKERS)
        limit(byCode, fingerprint(input.inviteCode), 3, 60_000, MAX_CODE_TRACKERS)
        const sessionId = inviteIndex.get(fingerprint(input.inviteCode))
        const session = sessions.get(sessionId)
        if (!session || !equalsDigest(digest(input.inviteCode), session.inviteHash) ||
            now() >= session.inviteExpiresAt || now() >= session.sessionExpiresAt || session.guest) {
          throw new HttpError(404, 'invitation_unavailable')
        }
        const guestToken = secret()
        const guestId = randomUUID()
        if (pilot && session.hostInstallationId === installationId) throw new HttpError(403, 'same_installation_forbidden')
        session.guest = { id: guestId, hash: digest(guestToken), status: 'pending', displayName: guestDisplayName,
          ...(pilot ? { installationId } : {}) }
        inviteIndex.delete(fingerprint(input.inviteCode))  // One-use invitation.
        return reply(res, 202, { version: 1, sessionId, guestId, guestToken, status: 'pending' })
      }

      const matched = /^\/v1\/sessions\/([^/]+)(?:\/(approve|reject|messages|revoke|leave))?$/.exec(pathname)
      if (!matched) throw new HttpError(404, 'not_found')
      const { session, role } = authSession(req, matched[1], installationId)
      const action = matched[2] || ''

      if (!action && req.method === 'GET') return reply(res, 200, snapshot(session, role))

      if ((action === 'approve' || action === 'reject') && req.method === 'POST') {
        if (role !== 'host') throw new HttpError(403, 'host_only')
        const input = await readJson(req, !!pilot)
        ensureCurrentAdmission(installationId, session)
        if (!hasExactKeys(input, ['guestId']) || !validUuid(input.guestId) ||
            !session.guest || session.guest.id !== input.guestId || session.guest.status !== 'pending') {
          throw new HttpError(409, 'no_matching_pending_guest')
        }
        if (now() >= session.inviteExpiresAt) throw new HttpError(410, 'invitation_expired')
        session.guest.status = action === 'approve' ? 'approved' : 'rejected'
        return reply(res, 200, { status: session.guest.status })
      }

      if (action === 'messages' && req.method === 'GET') {
        if (!session.guest || session.guest.status !== 'approved') throw new HttpError(403, 'not_approved')
        const url = new URL(req.url, 'http://localhost')
        const after = url.searchParams.get('after') ?? '0'
        if (!/^(?:0|[1-9]\d{0,8})$/.test(after)) throw new HttpError(400, 'invalid_cursor')
        const cursor = Number(after)
        const messages = session.messages.filter((msg) => msg.id > cursor && msg.to === role)
        return reply(res, 200, { messages, nextCursor: messages.length ? messages.at(-1).id : cursor })
      }

      if (action === 'messages' && req.method === 'POST') {
        if (!session.guest || session.guest.status !== 'approved') throw new HttpError(403, 'not_approved')
        const input = await readJson(req, !!pilot)
        ensureCurrentAdmission(installationId, session)
        if (!hasExactKeys(input, ['kind', 'payload']) || typeof input.payload !== 'string') {
          throw new HttpError(400, 'invalid_message')
        }
        const kind = role === 'host' ? 'invite' : 'response'
        if (input.kind !== kind) throw new HttpError(403, 'wrong_direction')
        if ((role === 'host' && session.sentInvite) || (role === 'guest' && session.sentResponse)) {
          throw new HttpError(409, 'message_already_sent')
        }
        if (role === 'guest' && !session.sentInvite) throw new HttpError(409, 'awaiting_host_invite')
        let metadata
        try { metadata = inspectEnvelope(input.payload, kind, session.permissions) }
        catch { throw new HttpError(400, 'invalid_signaling_envelope') }
        const messageBytes = Buffer.byteLength(input.payload, 'utf8')
        if (pilot && (totalMessageBytes + messageBytes > pilot.limits.storedMessageBytes ||
            session.messageBytes + messageBytes > 2 * MAX_BODY)) throw new HttpError(503, 'message_capacity_exceeded')
        if (role === 'host') {
          if (metadata.createdAt > now() + 60_000 || now() - metadata.createdAt > INVITE_TTL_MS) {
            throw new HttpError(410, 'signaling_expired')
          }
          session.offerSessionId = metadata.sessionId
          session.sentInvite = true
        } else {
          if (session.offerSessionId !== metadata.sessionId) throw new HttpError(409, 'mismatched_signaling_session')
          session.sentResponse = true
        }
        const message = { id: session.nextMessageId++, kind, payload: input.payload,
          to: role === 'host' ? 'guest' : 'host' }
        session.messages.push(message)
        if (pilot) { session.messageBytes += messageBytes; totalMessageBytes += messageBytes }
        return reply(res, 202, { accepted: true, messageId: message.id })
      }

      if ((action === 'revoke' || action === 'leave') && req.method === 'POST') {
        if ((action === 'revoke' && role !== 'host') || (action === 'leave' && role !== 'guest')) {
          throw new HttpError(403, 'forbidden')
        }
        removeSession(session.id)
        return reply(res, 200, { status: 'closed' })
      }

      throw new HttpError(404, 'not_found')
    } catch (err) {
      // No request body, token, SDP, ICE candidate, or IP addresses in logs.
      if (!res.headersSent) reply(res, err instanceof HttpError ? err.status : 500,
        { error: err instanceof HttpError ? err.code : 'internal_error' })
      else res.destroy()
    }
  })

  if (pilot) {
    server.requestTimeout = 15_000
    server.headersTimeout = 10_000
    server.keepAliveTimeout = 5_000
    server.maxConnections = 64
  }
  return {
    server,
    revokeInstallation(installationId) {
      if (!pilot || !pilot.revoke(installationId)) return false
      for (const [id, session] of sessions) {
        if (session.hostInstallationId === installationId || session.guest?.installationId === installationId) removeSession(id)
      }
      for (const key of byInstallation.keys()) if (key.startsWith(`${installationId}:`)) byInstallation.delete(key)
      return true
    },
    async listen(port = 0) {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve() })
      })
      return `http://127.0.0.1:${server.address().port}`
    },
    async close() { await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())) },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.CAPTURELINK_SIGNALING_PORT || '8787')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CAPTURELINK_SIGNALING_PORT')
  const app = createSignalingServer({
    allowedOrigins: (process.env.CAPTURELINK_SIGNALING_ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  })
  await app.listen(port)
  console.log(`[CaptureLink UX3a] signaling prototype listening on localhost port ${port}; DO NOT expose publicly`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0) })
}

/** UX3c-2 test/integration-only pilot factory. Never start via CLI or publish directly. */
export function createPilotSignalingServer({ installations, limits = {}, now = Date.now, maxSessions = 12 } = {}) {
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 12) throw new Error('invalid_pilot_capacity')
  const pilot = createPilotAdmission(installations, limits)
  return createSignalingServer({ now, maxSessions, pilot })
}
