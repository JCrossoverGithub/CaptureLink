/**
 * UX3c-3d: Windows-only, main-process admission enrollment for a two-device
 * controlled pilot. No renderer, environment or command-line credential path.
 *
 * The DNS hostname is an explicitly pinned source-level *candidate*. Do not
 * deploy or distribute enrolled builds before operator approval and DNS/TLS
 * review. The operator-supplied file contains only the 43-character token.
 */
import { constants } from 'node:fs'
import { lstat, open, link, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const PILOT_ORIGIN = 'https://signal.capturelink.io'
export const PILOT_STORE_FILE = 'capturelink-pilot-admission.v1.enc'
const TOKEN = /^[A-Za-z0-9_-]{43}$/
const MAX_IMPORT = 128
const MAX_STORE = 4096
const ERROR = 'pilot_enrollment_unavailable'
const INVALID = 'pilot_enrollment_invalid'
const OUTCOME = Object.freeze({ local: 'local', remote: 'remote', unavailable: 'unavailable' })

function fail(code = INVALID) { return new Error(code) }
function mustProtect(crypto, platform) {
  if (platform !== 'win32' || !crypto || typeof crypto.isEncryptionAvailable !== 'function' ||
      crypto.isEncryptionAvailable() !== true || typeof crypto.encryptString !== 'function' ||
      typeof crypto.decryptString !== 'function') throw fail(ERROR)
}
function validObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'admissionToken,origin,version' &&
    value.version === 1 && value.origin === PILOT_ORIGIN && TOKEN.test(value.admissionToken)
}
function checkedPath(userData) {
  if (typeof userData !== 'string' || !userData || !userData.includes('\\') && !userData.startsWith('/')) throw fail(ERROR)
  return join(userData, PILOT_STORE_FILE)
}

/** Distinguish absent enrollment from corrupt/unreadable enrollment. Never downgrade silently. */
export async function loadPilotEnrollment({ userData, safeStorage, platform = process.platform } = {}) {
  const path = checkedPath(userData)
  let meta
  try { meta = await lstat(path) }
  catch (error) {
    if (error?.code === 'ENOENT') return { mode: OUTCOME.local }
    throw fail()
  }
  if (!meta.isFile() || meta.isSymbolicLink() || meta.size < 16 || meta.size > MAX_STORE) throw fail()
  mustProtect(safeStorage, platform)
  try {
    const handle = await open(path, constants.O_RDONLY | (platform === 'win32' ? 0 : (constants.O_NOFOLLOW || 0)))
    try {
      const actual = await handle.stat()
      if (!actual.isFile() || actual.ino !== meta.ino || actual.dev !== meta.dev ||
          actual.size !== meta.size) throw fail()
      const data = await handle.readFile()
      if (data.length !== meta.size) throw fail()
      const value = JSON.parse(safeStorage.decryptString(data))
      if (!validObject(value)) throw fail()
      return { mode: OUTCOME.remote, origin: PILOT_ORIGIN, admissionToken: value.admissionToken }
    } finally { await handle.close() }
  } catch { throw fail() }
}

/**
 * Import a one-installation token from a manually selected local file. The
 * plaintext import is not erased by the application; operator must handle it.
 * 'rotate' replaces an existing encrypted store atomically, never in-place.
 */
export async function importPilotEnrollment({ userData, importPath, safeStorage,
  platform = process.platform, rotate = false } = {}) {
  mustProtect(safeStorage, platform)
  const target = checkedPath(userData)
  if (typeof importPath !== 'string' || !importPath) throw fail()
  let input
  try {
    const info = await lstat(importPath)
    if (!info.isFile() || info.isSymbolicLink() || info.size < 43 || info.size > MAX_IMPORT) throw fail()
    const handle = await open(importPath, constants.O_RDONLY | (platform === 'win32' ? 0 : (constants.O_NOFOLLOW || 0)))
    try {
      const current = await handle.stat()
      if (!current.isFile() || current.ino !== info.ino || current.dev !== info.dev || current.size !== info.size) throw fail()
      input = await handle.readFile()
      if (input.length !== info.size) throw fail()
    } finally { await handle.close() }
  } catch { throw fail() }
  const token = input.toString('utf8').replace(/\r?\n$/, '')
  if (!TOKEN.test(token)) throw fail()
  // Also refuse the same encrypted state from another Windows identity or
  // damaged store during a rotation; operator must deliberately disable it.
  let existing
  try { existing = await loadPilotEnrollment({ userData, safeStorage, platform }) }
  catch { throw fail() }
  if ((!rotate && existing.mode !== 'local') || (rotate && existing.mode !== 'remote')) throw fail()
  let ciphertext
  try {
    ciphertext = safeStorage.encryptString(JSON.stringify({ version: 1, origin: PILOT_ORIGIN, admissionToken: token }))
    if (!Buffer.isBuffer(ciphertext) || ciphertext.length < 16 || ciphertext.length > MAX_STORE) throw fail()
  } catch { throw fail() }
  // Use a private create-exclusive temporary file; rename for rotation.
  const temp = join(userData, `.capturelink-pilot-${randomUUID()}.tmp`)
  let created = false
  try {
    const file = await open(temp, 'wx', 0o600)
    created = true
    try { await file.writeFile(ciphertext) }
    finally { await file.close() }
    if (rotate) {
      await rename(temp, target)
    } else {
      // Hard link prevents an unexpected existing destination being overwritten.
      // link() is supported for normal Windows NTFS userData directories.
      await link(temp, target)
    }
  } catch { throw fail() }
  finally { if (created) await unlink(temp).catch(() => {}) }
  // Re-read the persisted OS-encrypted credential; never return it to UI.
  const check = await loadPilotEnrollment({ userData, safeStorage, platform })
  if (check.mode !== 'remote' || check.admissionToken !== token) throw fail()
  return { enrolled: true, rotated: rotate }
}

/** Local disable only: broker-side token revocation is a separate operation. */
export async function disablePilotEnrollment({ userData } = {}) {
  const path = checkedPath(userData)
  let meta
  try { meta = await lstat(path) }
  catch (error) { if (error?.code === 'ENOENT') return { disabled: true }; throw fail() }
  if (!meta.isFile() || meta.isSymbolicLink()) throw fail()
  try { await unlink(path) } catch { throw fail() }
  return { disabled: true }
}
