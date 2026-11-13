/** UX3F-3A: encrypted refresh token vault, separate from Xbox/pilot stores. */
import { constants } from 'node:fs'
import { lstat, open, link, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const ONLINE_VAULT_FILE = 'capturelink-online-refresh.v1.enc'
const MAX_SIZE = 16384
const ID = /^[A-Za-z0-9._~:/-]{1,512}$/
const SUBJECT = /^[\x21-\x7e]{1,256}$/
const TOKEN = /^[\x21-\x7e]{16,8192}$/
const fail = () => new Error('online_auth_storage_unavailable')

function validateRecord(record) {
  return record && typeof record === 'object' && !Array.isArray(record) &&
    Object.keys(record).sort().join(',') === 'clientId,issuer,refreshToken,subject' &&
    [record.clientId, record.issuer].every(value => typeof value === 'string' && ID.test(value)) &&
    typeof record.subject === 'string' && SUBJECT.test(record.subject) &&
    typeof record.refreshToken === 'string' && TOKEN.test(record.refreshToken) &&
    record.issuer.startsWith('https://')
}
export function createWindowsOnlineVault({ userData, safeStorage, platform = process.platform } = {}) {
  if (platform !== 'win32' || typeof userData !== 'string' || !isAbsolute(userData) ||
      !safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' ||
      typeof safeStorage.encryptString !== 'function' ||
      typeof safeStorage.decryptString !== 'function') throw fail()
  const target = join(userData, ONLINE_VAULT_FILE)
  const protector = () => { if (safeStorage.isEncryptionAvailable() !== true) throw fail() }
  async function parent() {
    const info = await lstat(userData)
    if (!info.isDirectory() || info.isSymbolicLink()) throw fail()
  }
  async function read() {
    await parent()
    let info
    try { info = await lstat(target) }
    catch (e) { if (e?.code === 'ENOENT') return null; throw fail() }
    if (!info.isFile() || info.isSymbolicLink() || info.size < 16 || info.size > MAX_SIZE) throw fail()
    protector()
    try {
      const file = await open(target, constants.O_RDONLY | (platform === 'win32' ? 0 : (constants.O_NOFOLLOW || 0)))
      try {
        const current = await file.stat()
        if (!current.isFile() || current.ino !== info.ino || current.dev !== info.dev ||
            current.size !== info.size) throw fail()
        const raw = await file.readFile()
        if (raw.length !== info.size) throw fail()
        const entry = JSON.parse(safeStorage.decryptString(raw))
        if (!entry || entry.version !== 1 || !validateRecord(entry.value) ||
            Object.keys(entry).sort().join(',') !== 'value,version') throw fail()
        return entry.value
      } finally { await file.close() }
    } catch { throw fail() }
  }
  return Object.freeze({
    load: read,
    async save(record) {
      if (!validateRecord(record)) throw fail()
      protector()
      // Existing corrupt ciphertext must never be silently overwritten.
      const previous = await read()
      let encrypted
      try {
        encrypted = safeStorage.encryptString(JSON.stringify({ version: 1, value: record }))
        if (!Buffer.isBuffer(encrypted) || encrypted.length < 16 || encrypted.length > MAX_SIZE) throw fail()
      } catch { throw fail() }
      const temp = join(userData, `.capturelink-online-${randomUUID()}.tmp`)
      let created = false
      try {
        const file = await open(temp, 'wx', 0o600)
        created = true
        try { await file.writeFile(encrypted) } finally { await file.close() }
        if (previous === null) await link(temp, target) // create exclusive
        else await rename(temp, target) // rotate atomically
      } catch { throw fail() }
      finally { if (created) await unlink(temp).catch(() => {}) }
      if (!await read()) throw fail()
    },
    async clear() {
      await parent()
      let info
      try { info = await lstat(target) }
      catch (e) { if (e?.code === 'ENOENT') return; throw fail() }
      if (!info.isFile() || info.isSymbolicLink()) throw fail()
      try { await unlink(target) } catch { throw fail() }
    },
  })
}
