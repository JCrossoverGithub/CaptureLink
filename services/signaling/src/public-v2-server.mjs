/**
 * CaptureLink UX3F-2 G2: offline, loopback-only /v2 broker candidate.
 *
 * Deliberately NOT a production entry point or identity provider. No environment
 * credentials, external listeners, disk persistence, OAuth exchange or media relay.
 * Identity verification and account status come only from trusted injected code.
 * A single in-process transaction queue serializes all state/authorization work;
 * do not scale to multiple processes without replacing this store/lock.
 */
import { createServer as createHttpServer } from 'node:http'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createPublicAuthorizationPolicy } from './public-authorization-policy.mjs'
import {
  MAX_BODY, INVITE_TTL_MS, SESSION_TTL_MS, inspectEnvelope,
  hasExactKeys, validPermissions, validUuid,
} from './protocol.mjs'

const CREDENTIAL = /^[A-Za-z0-9_-]{43}$/
const CURSOR = /^(?:0|[1-9]\d{0,8})$/
const MINUTE = 60_000
const defaults = Object.freeze({
  maxSessions: 12,
  maxSessionsPerHost: 2,
  maxTotalMessageBytes: 4 * MAX_BODY,
  perSocketPerMinute: 600,
  joinPerSocketPerMinute: 24,
  joinPerCodePerMinute: 3,
  createPerHostPerMinute: 10,
  sessionOpsPerMinute: 300,
})
const replyHeaders = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, private',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'",
})

class RequestError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code }
}
const reject = (status, code) => { throw new RequestError(status, code) }
const secret = () => randomBytes(32).toString('base64url')
const hash = value => createHash('sha256').update(value).digest()
const fingerprint = value => hash(value).toString('hex')
const same = (a, b) => Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.length === b.length && timingSafeEqual(a, b)
const permissions = x => ({ watch: x.watch, voice: x.voice, controller: x.controller, controllerMode: x.controllerMode })
const nowValid = t => Number.isSafeInteger(t) && t > 0

function respond(res, status, body) {
  res.writeHead(status, replyHeaders)
  res.end(JSON.stringify(body))
}
async function boundedBody(req, requireJson) {
  const type = req.headers['content-type']
  if (requireJson && !/^application\/json(?:;\s*charset=utf-8)?$/i.test(String(type || ''))) {
    reject(415, 'json_required')
  }
  const length = req.headers['content-length']
  if (length !== undefined && (!/^(?:0|[1-9]\d*)$/.test(String(length)) || !Number.isSafeInteger(Number(length)))) {
    reject(400, 'invalid_length')
  }
  if (length !== undefined && Number(length) > MAX_BODY) reject(413, 'request_too_large')
  let bytes = 0
  const pieces = []
  for await (const part of req) {
    bytes += part.length
    if (bytes > MAX_BODY) reject(413, 'request_too_large')
    pieces.push(part)
  }
  if (!requireJson) {
    if (bytes !== 0) reject(400, 'unexpected_body')
    return null
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(pieces)))
  } catch { reject(400, 'invalid_json') }
}
function bearer(req) {
  const raw = req.headers.authorization
  if (typeof raw !== 'string') reject(401, 'unauthorized')
  const match = /^Bearer ([^\s]{1,8192})$/.exec(raw)
  if (!match) reject(401, 'unauthorized')
  return match[1]
}
function checkedPolicy(result) {
  if (!result?.allowed) reject(result?.status || 401, result?.code || 'unauthorized')
}

/**
 * Trusted injected callbacks must be side-effect-free and bounded-time.
 * A timeout protects the single-process queue if the verifier hangs.
 */
async function deadline(promise, timeoutMs, fallback) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(() => promise()),
      new Promise(resolve => { timer = setTimeout(() => resolve(fallback), timeoutMs); timer.unref?.() }),
    ])
  } catch { return fallback }
  finally { clearTimeout(timer) }
}

export function createPublicV2SignalingServer({
  verifyHostAccessToken, isHostActive, expectedIssuer, expectedAudience,
  now = Date.now, limits = {},
} = {}) {
  if (typeof verifyHostAccessToken !== 'function' || typeof isHostActive !== 'function' ||
      typeof now !== 'function' || typeof expectedIssuer !== 'string' || !expectedIssuer ||
      typeof expectedAudience !== 'string' || !expectedAudience ||
      limits === null || typeof limits !== 'object' || Array.isArray(limits) ||
      Object.keys(limits).some(key => !Object.hasOwn(defaults, key))) {
    throw new Error('invalid_v2_broker_configuration')
  }
  const budget = { ...defaults, ...limits }
  if (Object.values(budget).some(value => !Number.isSafeInteger(value) || value < 1 || value > 100_000_000)) {
    throw new Error('invalid_v2_limits')
  }

  const sessions = new Map()
  const inviteIndex = new Map()
  const socketBudget = new Map()
  const joinSocketBudget = new Map()
  const inviteBudget = new Map()
  const ownerBudget = new Map()
  const sessionBudget = new Map()
  let totalMessageBytes = 0
  let queue = Promise.resolve()

  // No two stateful requests execute concurrently within one broker instance.
  async function transaction(fn) {
    const previous = queue
    let unlock
    queue = new Promise(resolve => { unlock = resolve })
    await previous
    try { return await fn() } finally { unlock() }
  }
  function remove(id) {
    const session = sessions.get(id)
    if (!session) return
    sessions.delete(id)
    inviteIndex.delete(session.inviteFingerprint)
    totalMessageBytes -= session.messageBytes
    session.hostHash.fill(0)
    session.inviteHash.fill(0)
    session.guest?.tokenHash.fill(0)
  }
  function purge() {
    const time = now()
    for (const [id, session] of sessions) {
      if (time >= session.expiresAt || (session.guest?.status !== 'approved' && time >= session.inviteExpiresAt)) remove(id)
    }
    for (const tracker of [socketBudget, joinSocketBudget, inviteBudget, ownerBudget, sessionBudget]) {
      for (const [key, entry] of tracker) if (entry.until <= time) tracker.delete(key)
    }
  }
  function rate(store, key, cap, maxEntries) {
    const time = now()
    let entry = store.get(key)
    if (!entry || entry.until <= time) {
      if (!entry && store.size >= maxEntries) reject(429, 'rate_limited')
      entry = { count: 0, until: time + MINUTE }
      store.set(key, entry)
    }
    if (++entry.count > cap) reject(429, 'rate_limited')
  }

  function policyFor({ onHostClaims = () => {}, redeem = async () => null } = {}) {
    return createPublicAuthorizationPolicy({
      expectedIssuer, expectedAudience, now,
      verifyHostAccessToken: async token => {
        const claims = await deadline(() => verifyHostAccessToken(token), 5_000, null)
        onHostClaims(claims)
        return claims
      },
      isHostActive: subject => deadline(() => isHostActive(subject), 5_000, false),
      verifySessionCapability: async ({ sessionId, token }) => {
        const session = sessions.get(sessionId)
        if (!session || !CREDENTIAL.test(token)) return null
        const submitted = hash(token)
        if (same(submitted, session.hostHash)) {
          return { role: 'host', sessionId, ownerSubject: session.ownerSubject, expiresAt: session.expiresAt }
        }
        if (session.guest && same(submitted, session.guest.tokenHash)) {
          return { role: 'guest', sessionId, guestId: session.guest.id, expiresAt: session.expiresAt }
        }
        return null
      },
      redeemInvitation: redeem,
      loadSession: async sessionId => sessions.get(sessionId) ?? null,
    })
  }

  async function handle(req, res, pathname, searchParams, input) {
    purge()
    const ip = req.socket.remoteAddress || 'unknown' // Never forwarded header claims.
    rate(socketBudget, ip, budget.perSocketPerMinute, 1_024)
    if (pathname === '/healthz' && req.method === 'GET') return respond(res, 200, { status: 'ok' })

    if (pathname === '/v2/sessions' && req.method === 'POST') {
      if (!hasExactKeys(input, ['permissions']) || !validPermissions(input.permissions)) reject(400, 'invalid_permissions')
      const token = bearer(req)
      let verified = null
      const policy = policyFor({ onHostClaims: claims => { verified = claims } })
      const principal = await policy.authenticateHost(token)
      if (!principal) reject(401, 'unauthorized')
      checkedPolicy(await policy.authorize({ principal, operation: 'create' }))
      // Only a claims value observed through the server-side trusted verifier is used.
      const subject = verified?.sub
      if (typeof subject !== 'string') reject(401, 'unauthorized')
      rate(ownerBudget, subject, budget.createPerHostPerMinute, 1_024)
      if (sessions.size >= budget.maxSessions) reject(503, 'capacity_exceeded')
      if ([...sessions.values()].filter(session => session.ownerSubject === subject).length >= budget.maxSessionsPerHost) {
        reject(429, 'host_capacity_exceeded')
      }
      const hostToken = secret(), inviteCode = secret(), sessionId = randomUUID()
      const session = {
        id: sessionId, ownerSubject: subject, permissions: permissions(input.permissions),
        hostHash: hash(hostToken), inviteHash: hash(inviteCode), inviteFingerprint: fingerprint(inviteCode),
        inviteExpiresAt: now() + INVITE_TTL_MS, expiresAt: now() + SESSION_TTL_MS,
        guest: null, sentInvite: false, sentResponse: false, offerSessionId: null,
        messages: [], messageBytes: 0, revoked: false,
      }
      sessions.set(sessionId, session)
      inviteIndex.set(session.inviteFingerprint, sessionId)
      return respond(res, 201, {
        version: 2, sessionId, hostSessionToken: hostToken, inviteCode,
        inviteExpiresAt: session.inviteExpiresAt, sessionExpiresAt: session.expiresAt,
      })
    }

    if (pathname === '/v2/join' && req.method === 'POST') {
      if (req.headers.authorization !== undefined || req.headers['x-capturelink-admission'] !== undefined) {
        reject(400, 'unexpected_credential')
      }
      if (!hasExactKeys(input, ['inviteCode', 'displayName'])) reject(404, 'invitation_unavailable')
      rate(joinSocketBudget, ip, budget.joinPerSocketPerMinute, 1_024)
      const code = input.inviteCode
      if (typeof code !== 'string' || !CREDENTIAL.test(code)) reject(404, 'invitation_unavailable')
      rate(inviteBudget, fingerprint(code), budget.joinPerCodePerMinute, 2_048)
      let guestToken = null
      let pendingSessionId = null
      const policy = policyFor({
        redeem: async (inviteCode, displayName) => {
          const digest = fingerprint(inviteCode)
          const id = inviteIndex.get(digest)
          const session = sessions.get(id)
          if (!session || !same(hash(inviteCode), session.inviteHash) ||
              now() >= session.inviteExpiresAt || now() >= session.expiresAt || session.guest) return null
          if (await deadline(() => isHostActive(session.ownerSubject), 5_000, false) !== true) {
            remove(session.id)
            return null
          }
          guestToken = secret()
          const guestId = randomUUID()
          session.guest = { id: guestId, tokenHash: hash(guestToken), status: 'pending', displayName }
          pendingSessionId = session.id
          inviteIndex.delete(digest)
          return { sessionId: session.id, guestId, expiresAt: session.expiresAt }
        },
      })
      const result = await policy.requestPendingJoin({
        principal: policy.anonymous, inviteCode: code, displayName: input.displayName,
      })
      if (!result?.allowed && guestToken) {
        // A verifier could revoke the host between atomic redemption and the
        // policy's final host-active recheck. Never strand a pending guest whose
        // capability was not delivered to its caller.
        if (pendingSessionId) remove(pendingSessionId)
      }
      checkedPolicy(result)
      if (!guestToken) reject(500, 'internal_error')
      return respond(res, 202, {
        version: 2, sessionId: result.sessionId, guestId: result.guestId,
        guestSessionToken: guestToken, status: 'pending',
      })
    }

    const route = /^\/v2\/sessions\/([^/]+)(?:\/(approve|reject|messages|revoke|leave))?$/.exec(pathname)
    if (!route || !validUuid(route[1])) reject(404, 'not_found')
    const [, id, action = ''] = route
    const session = sessions.get(id)
    if (!session) reject(404, 'not_found')
    const policy = policyFor()
    const principal = await policy.authenticateSession(id, bearer(req))
    if (!principal) reject(401, 'unauthorized')
    rate(sessionBudget, id, budget.sessionOpsPerMinute, budget.maxSessions)

    const operation = action === '' && req.method === 'GET' ? 'snapshot'
      : action === 'messages' ? (req.method === 'GET' ? 'read-messages' : 'write-message')
      : action
    const expectedMethod = action === '' || action === 'messages' && req.method === 'GET' ? 'GET' : 'POST'
    if (!['snapshot', 'approve', 'reject', 'read-messages', 'write-message', 'revoke', 'leave'].includes(operation) ||
        req.method !== expectedMethod) reject(404, 'not_found')
    const guestId = input?.guestId
    const kind = input?.kind
    const allowed = await policy.authorize({ principal, operation, sessionId: id, guestId, kind })
    if (!allowed.allowed && allowed.code === 'account_inactive') {
      // Observed account revocation invalidates the in-memory session too.
      remove(id)
    }
    checkedPolicy(allowed)
    if (operation === 'snapshot') {
      const host = principal.kind === 'session-host'
      return respond(res, 200, {
        version: 2, sessionId: id, role: host ? 'host' : 'guest',
        permissions: permissions(session.permissions), inviteExpiresAt: session.inviteExpiresAt,
        sessionExpiresAt: session.expiresAt, status: session.guest?.status || 'open',
        pendingGuestId: host && session.guest?.status === 'pending' ? session.guest.id : null,
        guestId: host && session.guest?.status === 'approved' ? session.guest.id : null,
        guestDisplayName: host && session.guest?.status !== 'rejected' ? (session.guest?.displayName || null) : null,
      })
    }
    if (operation === 'approve' || operation === 'reject') {
      if (!hasExactKeys(input, ['guestId']) || !validUuid(input.guestId)) reject(400, 'invalid_guest')
      session.guest.status = operation === 'approve' ? 'approved' : 'rejected'
      return respond(res, 200, { status: session.guest.status })
    }
    if (operation === 'read-messages') {
      const after = searchParams.get('after') ?? '0'
      if (!CURSOR.test(after) || [...searchParams.keys()].some(key => key !== 'after') ||
          searchParams.getAll('after').length > 1) reject(400, 'invalid_cursor')
      const role = principal.kind === 'session-host' ? 'host' : 'guest'
      const messages = session.messages.filter(item => item.id > Number(after) && item.to === role)
      return respond(res, 200, { messages, nextCursor: messages.length ? messages.at(-1).id : Number(after) })
    }
    if (operation === 'write-message') {
      if (!hasExactKeys(input, ['kind', 'payload']) || typeof input.payload !== 'string') reject(400, 'invalid_message')
      let metadata
      try { metadata = inspectEnvelope(input.payload, input.kind, session.permissions) }
      catch { reject(400, 'invalid_signaling_envelope') }
      const bytes = Buffer.byteLength(input.payload, 'utf8')
      if (totalMessageBytes + bytes > budget.maxTotalMessageBytes || session.messageBytes + bytes > 2 * MAX_BODY) {
        reject(503, 'message_capacity_exceeded')
      }
      if (principal.kind === 'session-host') {
        if (metadata.createdAt > now() + 60_000 || now() - metadata.createdAt > INVITE_TTL_MS) {
          reject(410, 'signaling_expired')
        }
        session.offerSessionId = metadata.sessionId
        session.sentInvite = true
      } else {
        if (metadata.sessionId !== session.offerSessionId) reject(409, 'mismatched_signaling_session')
        session.sentResponse = true
      }
      const message = {
        id: session.messages.length + 1, kind: input.kind, payload: input.payload,
        to: principal.kind === 'session-host' ? 'guest' : 'host',
      }
      session.messages.push(message)
      session.messageBytes += bytes
      totalMessageBytes += bytes
      return respond(res, 202, { accepted: true, messageId: message.id })
    }
    if (operation === 'revoke' || operation === 'leave') {
      remove(id)
      return respond(res, 200, { status: 'closed' })
    }
    reject(404, 'not_found')
  }

  const server = createHttpServer(async (req, res) => {
    try {
      if (req.headers.origin) reject(403, 'origin_denied')
      if (Object.keys(req.headers).some(k =>
        k === 'forwarded' || k === 'x-real-ip' || k === 'cf-connecting-ip' ||
        k === 'true-client-ip' || k.startsWith('x-forwarded-'))) reject(400, 'forwarded_headers_forbidden')
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') ||
          req.url.length > 1024 || req.url.includes('#')) reject(400, 'invalid_request_target')
      if (req.headers.host !== `127.0.0.1:${server.address()?.port}`) reject(400, 'unexpected_host')
      const parsed = new URL(req.url, 'http://127.0.0.1')
      if (parsed.pathname.startsWith('/v2/') && req.headers['x-capturelink-admission'] !== undefined) {
        reject(400, 'unexpected_credential')
      }
      if (parsed.search && !(req.method === 'GET' &&
          /^\/v2\/sessions\/[^/]+\/messages$/.test(parsed.pathname))) reject(400, 'invalid_query')
      let input = null
      if (req.method === 'POST') {
        const bodyRoute = parsed.pathname === '/v2/join' || parsed.pathname === '/v2/sessions' ||
          /\/((?:approve|reject|messages))$/.test(parsed.pathname)
        input = await boundedBody(req, bodyRoute)
      } else if (req.method !== 'GET') reject(404, 'not_found')
      return await transaction(() => handle(req, res, parsed.pathname, parsed.searchParams, input))
    } catch (error) {
      // Never log raw payloads, credentials, identities, IP, SDP or TLS details.
      if (!res.headersSent) respond(res, error instanceof RequestError ? error.status : 500,
        { error: error instanceof RequestError ? error.code : 'internal_error' })
      else res.destroy()
    }
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000
  server.maxConnections = 64
  return Object.freeze({
    address() { return server.address() },
    async listen(port = 0) {
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid_port')
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve() })
      })
      return `http://127.0.0.1:${server.address().port}`
    },
    async revokeAccount(subject) {
      if (typeof subject !== 'string' || !subject) return false
      return transaction(() => {
        let count = 0
        for (const [id, session] of sessions) if (session.ownerSubject === subject) { remove(id); count++ }
        return count
      })
    },
    async close() {
      server.closeAllConnections?.()
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  })
}
