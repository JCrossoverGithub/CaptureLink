import assert from 'node:assert/strict'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import {
  loadPilotEnrollment, importPilotEnrollment, disablePilotEnrollment,
  PILOT_ORIGIN, PILOT_STORE_FILE,
} from '../../../src/main/ux3c3d-pilot-enrollment.mjs'
import { createSignalingClientForMain } from '../../../src/main/ux3c-signaling-client.mjs'
import { LocalSignalingClient, RemoteSignalingClient } from '../src/client.mjs'

const token = () => randomBytes(32).toString('base64url')
// Hermetic OS-protection substitute. This is NOT a production cryptography
// implementation. Electron safeStorage is required for actual Windows use.
function mockStorage() {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      return Buffer.concat([nonce, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()])
    },
    decryptString(data) {
      const nonce = data.subarray(0, 12)
      const decipher = createDecipheriv('aes-256-gcm', key, nonce)
      decipher.setAuthTag(data.subarray(data.length - 16))
      return decipher.update(data.subarray(12, -16), undefined, 'utf8') + decipher.final('utf8')
    },
  }
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'capturelink-ux3c3d-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const profile = join(dir, 'profile')
  await mkdir(profile)
  const imported = join(dir, 'private.admission')
  const safeStorage = mockStorage()
  const args = { userData: profile, safeStorage, platform: 'win32' }
  return { dir, profile, imported, args }
}

test('unprovisioned desktop remains on UX3b1 localhost and has no remote admission', async t => {
  const { args } = await fixture(t)
  assert.deepEqual(await loadPilotEnrollment(args), { mode: 'local' })
  const client = createSignalingClientForMain()
  assert.ok(client instanceof LocalSignalingClient)
  assert.notEqual(client instanceof RemoteSignalingClient, true)
})

test('explicit enrollment encrypts a unique installation credential and selects only pinned HTTPS origin', async t => {
  const { imported, profile, args } = await fixture(t)
  const value = token()
  await writeFile(imported, value + '\n')
  assert.deepEqual(await importPilotEnrollment({ ...args, importPath: imported }), { enrolled: true, rotated: false })
  const encrypted = await readFile(join(profile, PILOT_STORE_FILE))
  assert.ok(!encrypted.includes(Buffer.from(value)), 'raw admission must not be on disk in app settings')
  assert.ok(!encrypted.includes(Buffer.from(PILOT_ORIGIN)))
  const mode = await loadPilotEnrollment(args)
  assert.equal(mode.mode, 'remote')
  assert.equal(mode.origin, PILOT_ORIGIN)
  assert.equal(mode.admissionToken, value)
  const client = createSignalingClientForMain({
    mode: 'remote', remote: { enabled: true, endpoint: mode.origin,
      approvedOrigin: PILOT_ORIGIN, admissionToken: mode.admissionToken },
  })
  assert.ok(client instanceof RemoteSignalingClient)
  assert.equal(client.role, null)
  await assert.rejects(importPilotEnrollment({ ...args, importPath: imported }), /pilot_enrollment_invalid/)
})

test('rotation requires an existing enrollment, atomically updates token, preserves origin', async t => {
  const { imported, args } = await fixture(t)
  const first = token(), second = token()
  await writeFile(imported, first + '\n')
  await assert.rejects(importPilotEnrollment({ ...args, importPath: imported, rotate: true }), /pilot_enrollment_invalid/)
  await importPilotEnrollment({ ...args, importPath: imported })
  await writeFile(imported, second + '\n')
  await importPilotEnrollment({ ...args, importPath: imported, rotate: true })
  const stored = await loadPilotEnrollment(args)
  assert.equal(stored.origin, PILOT_ORIGIN)
  assert.equal(stored.admissionToken, second)
  await disablePilotEnrollment(args)
  assert.deepEqual(await loadPilotEnrollment(args), { mode: 'local' })
})

test('unavailable OS-protected storage fails closed, not plaintext or insecure storage', async t => {
  const { imported, args } = await fixture(t)
  await writeFile(imported, token())
  for (const overrides of [
    { platform: 'linux' },
    { safeStorage: { ...args.safeStorage, isEncryptionAvailable: () => false } },
  ]) {
    await assert.rejects(importPilotEnrollment({ ...args, ...overrides, importPath: imported }), /pilot_enrollment_unavailable/)
  }
  await importPilotEnrollment({ ...args, importPath: imported })
  await assert.rejects(loadPilotEnrollment({ ...args, platform: 'linux' }), /pilot_enrollment_unavailable/)
})

test('corrupt or copied enrollment never silently downgrades into localhost', async t => {
  const { imported, profile, args } = await fixture(t)
  await writeFile(imported, token())
  await importPilotEnrollment({ ...args, importPath: imported })
  const path = join(profile, PILOT_STORE_FILE)
  const original = await readFile(path)
  await writeFile(path, Buffer.concat([original, Buffer.from('tamper')]))
  await assert.rejects(loadPilotEnrollment(args), /pilot_enrollment_invalid/)
  await writeFile(path, original)
  await assert.rejects(loadPilotEnrollment({ ...args, safeStorage: mockStorage() }), /pilot_enrollment_invalid/)
  await writeFile(path, Buffer.from('invalid encrypted store'))
  await assert.rejects(importPilotEnrollment({ ...args, importPath: imported, rotate: true }), /pilot_enrollment_invalid/)
})

test('rejects malformed token, symlink import, and symlink destination without following', async t => {
  const { imported, dir, profile, args } = await fixture(t)
  for (const bad of ['oops', token() + ' extra', ' '.repeat(43), token() + '\n\n']) {
    await writeFile(imported, bad)
    await assert.rejects(importPilotEnrollment({ ...args, importPath: imported }), /pilot_enrollment_invalid/)
  }
  const real = join(dir, 'real.admission')
  await writeFile(real, token())
  await rm(imported)
  try { await symlink(real, imported, 'file') }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(error.code)) {
      t.diagnostic('Symlink creation restricted on this Windows runner; malformed import checks still passed')
      return
    }
    throw error
  }
  await assert.rejects(importPilotEnrollment({ ...args, importPath: imported }), /pilot_enrollment_invalid/)
  await rm(imported)
  await writeFile(imported, token())
  try { await symlink(real, join(profile, PILOT_STORE_FILE), 'file') }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(error.code)) {
      t.diagnostic('Destination symlinks restricted on this Windows runner')
      return
    }
    throw error
  }
  await assert.rejects(loadPilotEnrollment(args), /pilot_enrollment_invalid/)
  await assert.rejects(importPilotEnrollment({ ...args, importPath: imported }), /pilot_enrollment_invalid/)
})
