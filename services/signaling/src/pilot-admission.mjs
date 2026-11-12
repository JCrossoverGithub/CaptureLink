/**
 * UX3c-2 private-pilot admission registry. No public enrollment or network API.
 * The operator supplies distinct, randomly generated installation tokens at
 * server construction; only SHA-256 digests are kept in this registry.
 */
import { createHash } from 'node:crypto'

const TOKEN = /^[A-Za-z0-9_-]{43}$/
const ID = /^[a-z][a-z0-9_-]{2,63}$/
const LIMITS = Object.freeze({
  create: 6, join: 12, read: 300, message: 16, decision: 24, close: 24,
  other: 12, global: 1_200, session: 360,
  activePerInstallation: 4, storedMessageBytes: 12_000_000,
})

const keyDigest = token => createHash('sha256').update(token).digest('hex')

export function createPilotAdmission(installations, limits = {}) {
  if (!Array.isArray(installations) || installations.length < 2 || installations.length > 64) {
    throw new Error('invalid_pilot_admission_configuration')
  }
  if (limits === null || typeof limits !== 'object' || Array.isArray(limits) ||
      Object.keys(limits).some(k => !Object.hasOwn(LIMITS, k))) throw new Error('invalid_pilot_limits')
  const budget = { ...LIMITS }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > LIMITS[name]) throw new Error('invalid_pilot_limits')
    budget[name] = value
  }
  const fingerprints = new Map()
  const installationIds = new Map()
  for (const entry of installations) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).sort().join('|') !== 'id|token' ||
        typeof entry.id !== 'string' || !ID.test(entry.id) ||
        typeof entry.token !== 'string' || !TOKEN.test(entry.token) ||
        Buffer.from(entry.token, 'base64url').toString('base64url') !== entry.token) {
      throw new Error('invalid_pilot_admission_configuration')
    }
    const hash = keyDigest(entry.token)
    if (fingerprints.has(hash) || installationIds.has(entry.id)) throw new Error('duplicate_pilot_installation')
    installationIds.set(entry.id, hash)
    fingerprints.set(hash, entry.id)
  }
  return Object.freeze({
    limits: Object.freeze(budget),
    identify(value) {
      if (typeof value !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(value)) return null
      return fingerprints.get(keyDigest(value.slice(7))) || null
    },
    active(id) { return installationIds.has(id) },
    revoke(id) {
      const hash = installationIds.get(id)
      if (!hash) return false
      installationIds.delete(id)
      fingerprints.delete(hash)
      return true
    },
  })
}
