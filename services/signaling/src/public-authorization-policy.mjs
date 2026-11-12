/**
 * CaptureLink UX3F-1: offline, provider-neutral policy seam for a future /v2.
 *
 * NOT a route, credential validator, invitation registry, session store or
 * deployment entry point. All injected functions are trusted server adapters,
 * never request-body callbacks. Callers MUST do atomic invitation consumption,
 * session-token digest verification, rate limits and HTTP/schema validation.
 *
 * Private WeakMap principals prevent request JSON from asserting a role.
 * No tokens are retained in principals or returned by this module.
 */
import { canonicalGuestName, validUuid } from './protocol.mjs'

const INVITATION = /^[A-Za-z0-9_-]{43}$/
const TOKEN = /^[\x21-\x7e]{1,8192}$/
const SUBJECT = /^[\x21-\x7e]{1,256}$/
const GRANT = 'sessions:create'

const allow = (code = 'allowed', status = 200) => Object.freeze({ allowed: true, status, code })
const deny = (code = 'forbidden', status = 403) => Object.freeze({ allowed: false, status, code })
const invalid = () => deny('unauthorized', 401)
const unavailable = () => deny('invitation_unavailable', 404)
const isId = validUuid
const isSubject = value => typeof value === 'string' && SUBJECT.test(value)
const isTimestamp = value => Number.isSafeInteger(value) && value > 0
const isString = value => typeof value === 'string' && value.length > 0 && value.length <= 1024
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x)

/**
 * Required adapters (all trusted, server-side):
 * - verifyHostAccessToken(token): verified {iss,aud,sub,exp,scope}, exp in UTC seconds.
 * - verifySessionCapability({sessionId,token}): verified {role,sessionId,expiresAt,
 *   ownerSubject? | guestId?}; expiresAt in UTC epoch milliseconds.
 * - redeemInvitation(inviteCode, guestName): atomically consume one invitation,
 *   persist pending guest, return {sessionId,guestId,expiresAt}; NO raw token.
 * - loadSession(sessionId): current authoritative session snapshot, see below.
 * - isHostActive(subject): consult authoritative account revocation state.
 * All adapters are injected to keep this module offline and without global state.
 */
export function createPublicAuthorizationPolicy({
  verifyHostAccessToken, verifySessionCapability, redeemInvitation,
  loadSession, isHostActive, expectedIssuer, expectedAudience, now = Date.now,
} = {}) {
  if ([verifyHostAccessToken, verifySessionCapability, redeemInvitation, loadSession,
       isHostActive, now].some(x => typeof x !== 'function') ||
      !isString(expectedIssuer) || !isString(expectedAudience)) {
    throw new Error('invalid_public_policy_configuration')
  }

  // A capability is usable only within the particular policy instance that made it.
  const minted = new WeakMap()
  const make = claims => {
    const principal = Object.freeze({ kind: claims.kind })
    minted.set(principal, Object.freeze({ ...claims }))
    return principal
  }
  const claimsFor = principal => isObj(principal) ? minted.get(principal) : undefined

  const active = async subject => {
    try { return (await isHostActive(subject)) === true } catch { return false }
  }

  async function authenticateHost(token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null
    let c
    try { c = await verifyHostAccessToken(token) } catch { return null }
    const ms = now()
    if (!Number.isSafeInteger(ms) || !isObj(c) || c.iss !== expectedIssuer || c.aud !== expectedAudience ||
        !isSubject(c.sub) || !isTimestamp(c.exp) || !Number.isSafeInteger(c.exp * 1000) ||
        c.exp * 1000 <= ms ||
        (c.nbf !== undefined && (!isTimestamp(c.nbf) || !Number.isSafeInteger(c.nbf * 1000) ||
          c.nbf * 1000 > ms)) ||
        !Array.isArray(c.scope) || !c.scope.every(isString)) return null
    return make({ kind: 'verified-host', subject: c.sub, expiresAt: c.exp * 1000,
      canCreate: c.scope.includes(GRANT) })
  }

  async function authenticateSession(sessionId, token) {
    if (!isId(sessionId) || typeof token !== 'string' || !INVITATION.test(token)) return null
    let c
    try { c = await verifySessionCapability({ sessionId, token }) } catch { return null }
    if (!isObj(c) || c.sessionId !== sessionId || !isTimestamp(c.expiresAt) || c.expiresAt <= now()) return null
    if (c.role === 'host' && isSubject(c.ownerSubject)) {
      return make({ kind: 'session-host', sessionId, ownerSubject: c.ownerSubject, expiresAt: c.expiresAt })
    }
    if (c.role === 'guest' && isId(c.guestId)) {
      return make({ kind: 'session-guest', sessionId, guestId: c.guestId, expiresAt: c.expiresAt })
    }
    return null
  }

  const anonymous = make({ kind: 'anonymous' })

  // Join is the only operation that accepts an anonymous principal; the trusted
  // redeemer must atomically consume the invite and create a *pending* guest.
  async function requestPendingJoin({ principal, inviteCode, displayName } = {}) {
    const p = claimsFor(principal)
    if (!p || p.kind !== 'anonymous') return { ...deny('forbidden'), principal: null }
    if (typeof inviteCode !== 'string' || !INVITATION.test(inviteCode) ||
        Buffer.from(inviteCode, 'base64url').toString('base64url') !== inviteCode) {
      return { ...unavailable(), principal: null }
    }
    const name = canonicalGuestName(displayName)
    if (!name) return { ...deny('invalid_display_name', 400), principal: null }
    let redeemed
    try { redeemed = await redeemInvitation(inviteCode, name) } catch { return { ...unavailable(), principal: null } }
    if (!isObj(redeemed) || !isId(redeemed.sessionId) || !isId(redeemed.guestId) ||
        !isTimestamp(redeemed.expiresAt) || redeemed.expiresAt <= now()) {
      return { ...unavailable(), principal: null }
    }
    // Read the authoritative state; do not trust a role/status from the joiner.
    let session
    try { session = await loadSession(redeemed.sessionId) } catch { return { ...unavailable(), principal: null } }
    if (!live(session, redeemed.sessionId) || session.guest?.id !== redeemed.guestId ||
        session.guest.status !== 'pending' || !(await active(session.ownerSubject))) {
      return { ...unavailable(), principal: null }
    }
    return Object.freeze({ ...allow('pending', 202),
      principal: make({ kind: 'session-guest', sessionId: redeemed.sessionId,
        guestId: redeemed.guestId, expiresAt: redeemed.expiresAt }),
      sessionId: redeemed.sessionId, guestId: redeemed.guestId })
  }

  function live(session, sessionId) {
    return isObj(session) && session.id === sessionId && !session.revoked &&
      isSubject(session.ownerSubject) && isTimestamp(session.expiresAt) && session.expiresAt > now()
  }

  async function authorize({ principal, operation, sessionId, guestId, kind } = {}) {
    const p = claimsFor(principal)
    if (!p || !isString(operation)) return invalid()
    if (p.expiresAt !== undefined && p.expiresAt <= now()) return invalid()

    if (operation === 'create') {
      if (p.kind !== 'verified-host') return deny()
      if (!p.canCreate) return deny('insufficient_scope')
      return (await active(p.subject)) ? allow() : deny('account_inactive')
    }

    const operations = ['snapshot', 'approve', 'reject', 'read-messages', 'write-message', 'revoke', 'leave']
    if (!operations.includes(operation)) return deny()
    if (!isId(sessionId) || !['session-host', 'session-guest'].includes(p.kind) ||
        p.sessionId !== sessionId) return invalid()

    let session
    try { session = await loadSession(sessionId) } catch { return invalid() }
    if (!live(session, sessionId)) return invalid()
    if (!(await active(session.ownerSubject))) return deny('account_inactive')

    const host = p.kind === 'session-host'
    if (host && p.ownerSubject !== session.ownerSubject) return invalid()
    if (!host && (session.guest?.id !== p.guestId ||
        !['pending', 'approved', 'rejected'].includes(session.guest.status))) return invalid()

    if (operation === 'snapshot') return allow()
    if (operation === 'revoke') return host ? allow() : deny('host_only')
    if (operation === 'leave') return !host ? allow() : deny('guest_only')

    if (operation === 'approve' || operation === 'reject') {
      if (!host) return deny('host_only')
      if (!isId(guestId) || !session.guest || session.guest.id !== guestId ||
          session.guest.status !== 'pending' ||
          !isTimestamp(session.inviteExpiresAt) || session.inviteExpiresAt <= now()) {
        return deny('no_matching_pending_guest', 409)
      }
      return allow()
    }

    if (session.guest?.status !== 'approved') return deny('not_approved')
    if (operation === 'read-messages') return allow()
    // Only a host writes the offer and only a guest writes the answer, once.
    if (host && kind !== 'invite') return deny('wrong_direction')
    if (!host && kind !== 'response') return deny('wrong_direction')
    if ((host && session.sentInvite) || (!host && session.sentResponse)) {
      return deny('message_already_sent', 409)
    }
    if (!host && !session.sentInvite) return deny('awaiting_host_invite', 409)
    return allow()
  }

  return Object.freeze({ anonymous, authenticateHost, authenticateSession, requestPendingJoin, authorize })
}
