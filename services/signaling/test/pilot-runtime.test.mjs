import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, writeFile, chmod, mkdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createTcpServer } from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validatePilotRuntimeConfig, loadPilotRuntimeConfig, startPilotRuntime } from '../src/pilot-runtime.mjs'
import { provisionPrivatePilotBundle } from '../../../scripts/ux3c3a-provision.mjs'

const LINUX = process.platform === 'linux'
const token = () => randomBytes(32).toString('base64url')
const config = () => ({ version: 1, port: 8788, installations: [
  { id: 'pilot_host_1', token: token() }, { id: 'pilot_guest_1', token: token() }
], maxSessions: 4 })
const WATCH = { watch: true, voice: false, controller: false, controllerMode: 'shared' }

async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cl-ux3c3a-'))
  t.after(async () => rm(dir, { recursive: true, force: true }))
  const output = join(dir, 'private')
  const data = await provisionPrivatePilotBundle(output)
  const configPath = join(output, 'pilot.config.json')
  return { dir, output, data, configPath }
}
async function availablePort() {
  const s = createTcpServer()
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve))
  const port = s.address().port
  await new Promise(resolve => s.close(resolve))
  return port
}
async function writeConfig(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
}

// Pure validation works in both Windows CI and Linux CI.
test('runtime rejects ambiguous ports, unknown keys, bad admission and oversized limits', () => {
  assert.equal(validatePilotRuntimeConfig(config()).version, 1)
  const mutations = [
    { version: 2 }, { port: 0 }, { port: 65536 }, { port: '8788' },
    { host: '0.0.0.0' }, { installations: [config().installations[0]] },
    { maxSessions: 13 }, { limits: { read: 999999 } }, { limits: { bogus: 1 } },
  ]
  for (const mutation of mutations) {
    assert.throws(() => validatePilotRuntimeConfig({ ...config(), ...mutation }), /pilot_config_invalid/)
  }
})

test('Linux pilot provisioning creates separate files without printing credentials', { skip: !LINUX }, async t => {
  const h = await workspace(t)
  const raw = await readFile(h.configPath, 'utf8')
  const parsed = JSON.parse(raw)
  const host = (await readFile(join(h.output, 'host.admission'), 'utf8')).trim()
  const guest = (await readFile(join(h.output, 'guest.admission'), 'utf8')).trim()
  assert.match(host, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(host, guest)
  assert.equal(parsed.installations[0].token, host)
  assert.equal(parsed.installations[1].token, guest)
  assert.equal((await loadPilotRuntimeConfig(h.configPath)).port, 8788)
  await assert.rejects(() => provisionPrivatePilotBundle(h.output))
  await assert.rejects(() => provisionPrivatePilotBundle(join(fileURLToPath(new URL('../../..', import.meta.url)), 'not-allowed')))
})

test('runtime rejects permissive files, directories, symlinks, nonfiles and bad JSON', { skip: !LINUX }, async t => {
  const h = await workspace(t)
  await chmod(h.configPath, 0o644)
  await assert.rejects(() => loadPilotRuntimeConfig(h.configPath), /pilot_config_invalid/)
  await chmod(h.configPath, 0o600)
  await chmod(h.output, 0o755)
  await assert.rejects(() => loadPilotRuntimeConfig(h.configPath), /pilot_config_invalid/)
  await chmod(h.output, 0o700)
  const link = join(h.output, 'link.json')
  await symlink(h.configPath, link)
  await assert.rejects(() => loadPilotRuntimeConfig(link), /pilot_config_invalid/)
  await assert.rejects(() => loadPilotRuntimeConfig(h.output), /pilot_config_invalid/)
  await assert.rejects(() => loadPilotRuntimeConfig('relative.json'), /pilot_config_invalid/)
  await writeFile(h.configPath, '{BAD}', { mode: 0o600 })
  await assert.rejects(() => loadPilotRuntimeConfig(h.configPath), /pilot_config_invalid/)
  await writeFile(h.configPath, 'x'.repeat(65 * 1024), { mode: 0o600 })
  await assert.rejects(() => loadPilotRuntimeConfig(h.configPath), /pilot_config_invalid/)
})

test('runtime remains loopback-only, requires admission and shuts down cleanly', { skip: !LINUX }, async t => {
  const h = await workspace(t)
  const port = await availablePort()
  const conf = JSON.parse(await readFile(h.configPath))
  conf.port = port
  await writeConfig(h.configPath, conf)
  const runtime = await startPilotRuntime({ configPath: h.configPath })
  t.after(() => runtime.close())
  assert.equal(runtime.app.server.address().address, '127.0.0.1')
  const root = `http://127.0.0.1:${port}`
  const health = await fetch(root + '/healthz')
  assert.deepEqual(await health.json(), { status: 'ok' })
  const unauthorized = await fetch(root + '/v1/sessions', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ permissions: WATCH }) })
  assert.equal(unauthorized.status, 401)
  const created = await fetch(root + '/v1/sessions', { method: 'POST',
    headers: { 'content-type': 'application/json', 'X-CaptureLink-Admission': 'Bearer ' + conf.installations[0].token },
    body: JSON.stringify({ permissions: WATCH }) })
  assert.equal(created.status, 201)
  const body = await created.json()
  assert.equal(typeof body.inviteCode, 'string')
  const rejected = await fetch(root + '/v1/sessions', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4',
      'X-CaptureLink-Admission': 'Bearer ' + conf.installations[0].token },
    body: JSON.stringify({ permissions: WATCH }) })
  assert.equal(rejected.status, 400)
  await runtime.close()
  await runtime.close()  // idempotent shutdown
  await assert.rejects(() => fetch(root + '/healthz'))
})

test('CLI fails closed and logs no secret when permission checks fail', { skip: !LINUX }, async t => {
  const h = await workspace(t)
  const original = await readFile(h.configPath, 'utf8')
  await chmod(h.configPath, 0o644)
  const cmd = fileURLToPath(new URL('../src/pilot-runtime.mjs', import.meta.url))
  const child = spawn(process.execPath, [cmd], { env: { ...process.env, CAPTURELINK_PILOT_CONFIG_PATH: h.configPath }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  for await (const part of child.stderr) output += part
  const exit = await new Promise(resolve => child.once('exit', resolve))
  assert.equal(exit, 1)
  assert.match(output, /refused startup/)
  assert.ok(!output.includes(JSON.parse(original).installations[0].token))
  assert.ok(!output.includes(h.configPath))
})

test('standalone runtime handles SIGTERM cleanly without disclosing credential material', { skip: !LINUX }, async t => {
  const h = await workspace(t)
  const conf = JSON.parse(await readFile(h.configPath))
  conf.port = await availablePort()
  await writeConfig(h.configPath, conf)
  const runtimeFile = fileURLToPath(new URL('../src/pilot-runtime.mjs', import.meta.url))
  const child = spawn(process.execPath, [runtimeFile], {
    env: { ...process.env, CAPTURELINK_PILOT_CONFIG_PATH: h.configPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => { if (!child.killed) child.kill('SIGKILL') })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const root = `http://127.0.0.1:${conf.port}`
  let available = false
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) break
    try {
      const response = await fetch(root + '/healthz')
      if (response.status === 200) { available = true; break }
    } catch { /* waiting for child startup */ }
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  assert.equal(available, true, stderr)
  child.kill('SIGTERM')
  let timeout
  const code = await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('shutdown_timeout')), 7000) }),
  ]).finally(() => clearTimeout(timeout))
  assert.equal(code, 0)
  assert.match(stdout, /127\.0\.0\.1/)
  assert.ok(!stdout.includes(conf.installations[0].token))
  assert.ok(!stderr.includes(conf.installations[1].token))
})
