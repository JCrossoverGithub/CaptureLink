/**
 * CaptureLink UX3a prototype signaling broker.
 * No dependencies, no auth cookies, no SDP/ICE logging, no Xbox credentials.
 * Binds to loopback only. Public deployment is NOT authorized by this prototype.
 */
import { createServer as createHttpServer } from 'node:http'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { pathToFileURL } from 'node:url'
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

async function readJson(req) {
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

export function createSignalingServer({ now = Date.now, allowedOrigins = [], maxSessions = MAX_SESSIONS } = {}) {
  const sessions = new Map()
  const inviteIndex = new Map()
  const byIp = new Map()
  const byCode = new Map()
  let lastCleanup = 0

  function purge() {
    const time = now()
    if (time - lastCleanup < 5000 && lastCleanup <= time) return
    lastCleanup = time
    for (const [key, item] of sessions) {
      if (item.sessionExpiresAt <= time || (item.guest?.status !== 'approved' && item.inviteExpiresAt <= time)) {
        if (item.inviteHash) inviteIndex.delete(item.inviteHash.toString('hex'))
        sessions.delete(key)
      }
    }
    for (const store of [byIp, byCode]) {
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

  function authSession(req, id) {
    if (!validUuid(id)) throw new HttpError(404, 'not_found')
    const session = sessions.get(id)
    if (!session) throw new HttpError(404, 'not_found')
    if (session.sessionExpiresAt <= now()) throw new HttpError(410, 'session_expired')
    const role = checkToken(req, session)
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
      const ip = req.socket.remoteAddress || 'unknown'  // Do not trust X-Forwarded-For.
      limit(byIp, ip, 100, 60_000, MAX_IP_TRACKERS)
      const pathname = new URL(req.url, 'http://localhost').pathname

      if (pathname === '/healthz' && req.method === 'GET') return reply(res, 200, { status: 'ok' })

      if (pathname === '/v1/sessions' && req.method === 'POST') {
        const input = await readJson(req)
        if (!hasExactKeys(input, ['permissions']) || !validPermissions(input.permissions)) throw new HttpError(400, 'invalid_permissions')
        if (sessions.size >= maxSessions) throw new HttpError(503, 'capacity_exceeded')
        const id = randomUUID()
        const hostToken = secret()
        const inviteCode = secret()
        const item = {
          id, hostHash: digest(hostToken), inviteHash: digest(inviteCode),
          inviteExpiresAt: now() + INVITE_TTL_MS, sessionExpiresAt: now() + SESSION_TTL_MS,
          permissions: permissionCopy(input.permissions), guest: null, offerSessionId: null,
          sentInvite: false, sentResponse: false, messages: [], nextMessageId: 1,
        }
        sessions.set(id, item)
        inviteIndex.set(fingerprint(inviteCode), id)
        return reply(res, 201, { version: 1, sessionId: id, hostToken, inviteCode,
          inviteExpiresAt: item.inviteExpiresAt, sessionExpiresAt: item.sessionExpiresAt })
      }

      if (pathname === '/v1/join' && req.method === 'POST') {
        const input = await readJson(req)
        if ((!hasExactKeys(input, ['inviteCode']) && !hasExactKeys(input, ['inviteCode', 'displayName'])) ||
            typeof input.inviteCode !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.inviteCode)) {
          throw new HttpError(400, 'invalid_invitation')
        }
        // Legacy clients without names remain compatible; new desktop UI requires a name.
        const guestDisplayName = Object.hasOwn(input, 'displayName') ? canonicalGuestName(input.displayName) : null
        if (Object.hasOwn(input, 'displayName') && !guestDisplayName) throw new HttpError(400, 'invalid_display_name')
        // Cap both source IP and code guesses. Code digest is not logged or returned.
        limit(byIp, `${ip}:join`, 12, 60_000, MAX_IP_TRACKERS)
        limit(byCode, fingerprint(input.inviteCode), 3, 60_000, MAX_CODE_TRACKERS)
        const sessionId = inviteIndex.get(fingerprint(input.inviteCode))
        const session = sessions.get(sessionId)
        if (!session || !equalsDigest(digest(input.inviteCode), session.inviteHash) ||
            now() >= session.inviteExpiresAt || now() >= session.sessionExpiresAt || session.guest) {
          throw new HttpError(404, 'invitation_unavailable')
        }
        const guestToken = secret()
        const guestId = randomUUID()
        session.guest = { id: guestId, hash: digest(guestToken), status: 'pending', displayName: guestDisplayName }
        inviteIndex.delete(fingerprint(input.inviteCode))  // One-use invitation.
        return reply(res, 202, { version: 1, sessionId, guestId, guestToken, status: 'pending' })
      }

      const matched = /^\/v1\/sessions\/([^/]+)(?:\/(approve|reject|messages|revoke|leave))?$/.exec(pathname)
      if (!matched) throw new HttpError(404, 'not_found')
      const { session, role } = authSession(req, matched[1])
      const action = matched[2] || ''

      if (!action && req.method === 'GET') return reply(res, 200, snapshot(session, role))

      if ((action === 'approve' || action === 'reject') && req.method === 'POST') {
        if (role !== 'host') throw new HttpError(403, 'host_only')
        const input = await readJson(req)
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
        const input = await readJson(req)
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
        return reply(res, 202, { accepted: true, messageId: message.id })
      }

      if ((action === 'revoke' || action === 'leave') && req.method === 'POST') {
        if ((action === 'revoke' && role !== 'host') || (action === 'leave' && role !== 'guest')) {
          throw new HttpError(403, 'forbidden')
        }
        if (session.inviteHash) inviteIndex.delete(session.inviteHash.toString('hex'))
        sessions.delete(session.id)
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

  return {
    server,
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
