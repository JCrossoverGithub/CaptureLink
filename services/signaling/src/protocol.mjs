/** CaptureLink UX3a protocol validation. No Xbox credentials enter this service. */
export const MAX_SIGNAL = 1_000_000
export const MAX_BODY = 1_200_000
export const INVITE_TTL_MS = 15 * 60 * 1000
export const SESSION_TTL_MS = 3 * 60 * 60 * 1000

const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PREFIX = 'CAPTURELINK-SESSION-V1:'

export function isPlainObject(x) {
  return typeof x === 'object' && x !== null && !Array.isArray(x) &&
    (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null)
}

export function hasExactKeys(x, keys) {
  return isPlainObject(x) && Object.keys(x).sort().join('|') === [...keys].sort().join('|')
}

export function validPermissions(value) {
  return hasExactKeys(value, ['watch', 'voice', 'controller', 'controllerMode']) &&
    typeof value.watch === 'boolean' && typeof value.voice === 'boolean' && typeof value.controller === 'boolean' &&
    (value.controllerMode === 'shared' || value.controllerMode === 'player2') &&
    (value.watch || value.voice || value.controller) && (!value.controller || value.watch)
}

export function permissionsEqual(a, b) {
  return validPermissions(a) && validPermissions(b) &&
    Object.keys(a).every((key) => a[key] === b[key])
}

function decodeEnvelope(wire) {
  if (typeof wire !== 'string' || !wire.startsWith(PREFIX) || wire.length > MAX_SIGNAL || wire.length <= PREFIX.length) {
    throw new Error('invalid_signaling_envelope')
  }
  const encoded = wire.slice(PREFIX.length)
  if (!/^[a-zA-Z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) throw new Error('invalid_signaling_envelope')
  try {
    const bytes = Buffer.from(encoded, 'base64url')
    if (bytes.toString('base64url') !== encoded) throw new Error('noncanonical')
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!isPlainObject(parsed) || parsed.version !== 1 || !UID.test(parsed.sessionId)) throw new Error('invalid')
    return parsed
  } catch {
    throw new Error('invalid_signaling_envelope')
  }
}

function validTransports(transports, requiredController, requiredVoice) {
  if (!isPlainObject(transports) || Object.keys(transports).some((key) => key !== 'controller' && key !== 'voice')) return false
  if (Object.hasOwn(transports, 'controller') !== requiredController || Object.hasOwn(transports, 'voice') !== requiredVoice) return false
  for (const value of Object.values(transports)) {
    if (typeof value !== 'string' || value.length < 8 || value.length > 400_000) return false
  }
  return requiredController || requiredVoice
}

/** Validates UX2 wire schema and returns only metadata; never logs or persists SDP to disk. */
export function inspectEnvelope(wire, expectedKind, expectedPermissions = null) {
  const obj = decodeEnvelope(wire)
  if (obj.kind !== expectedKind) throw new Error('wrong_signaling_kind')
  if (expectedKind === 'invite') {
    if (!hasExactKeys(obj, ['kind', 'version', 'sessionId', 'createdAt', 'permissions', 'transports']) ||
        !validPermissions(obj.permissions) || !permissionsEqual(obj.permissions, expectedPermissions) ||
        !Number.isSafeInteger(obj.createdAt)) throw new Error('invalid_signaling_envelope')
    const reqVoice = obj.permissions.voice || (obj.permissions.watch && !obj.permissions.controller)
    if (!validTransports(obj.transports, obj.permissions.controller, reqVoice)) throw new Error('invalid_signaling_envelope')
  } else if (expectedKind === 'response') {
    if (!hasExactKeys(obj, ['kind', 'version', 'sessionId', 'transports']) || !validPermissions(expectedPermissions)) {
      throw new Error('invalid_signaling_envelope')
    }
    const reqVoice = expectedPermissions.voice || (expectedPermissions.watch && !expectedPermissions.controller)
    if (!validTransports(obj.transports, expectedPermissions.controller, reqVoice)) throw new Error('invalid_signaling_envelope')
  } else throw new Error('wrong_signaling_kind')
  return { sessionId: obj.sessionId, createdAt: obj.kind === 'invite' ? obj.createdAt : null }
}

/** Unverified, guest-chosen label. Normalize, then strictly limit visible characters.
 * Excludes HTML metacharacters, emoji, bidi controls, line breaks and invisible formatting.
 * Never use this as a verified identity or authorization credential.
 */
export function canonicalGuestName(value) {
  if (typeof value !== 'string') return null
  const name = value.normalize('NFKC').trim().replace(/ +/g, ' ')
  if ([...name].length < 1 || [...name].length > 32 ||
      !/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} ._'-]*$/u.test(name)) return null
  return name
}

export function validUuid(value) { return typeof value === 'string' && UID.test(value) }
