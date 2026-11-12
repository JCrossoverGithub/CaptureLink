/**
 * UX3c-3a: opt-in operator runtime for the private pilot broker.
 * Linux-only. Credentials live in a private file, never in env/argv or output.
 * Explicitly binds to loopback via the accepted createPilotSignalingServer factory.
 * This file is NOT a public-deployment authorization.
 */
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPilotSignalingServer } from './server.mjs'

const MAX_CONFIG_BYTES = 64 * 1024
const ERR = 'pilot_config_invalid'

function invalid() { return new Error(ERR) }
function exactKeys(object, required, optional = []) {
  return object && typeof object === 'object' && !Array.isArray(object) &&
    required.every(key => Object.hasOwn(object, key)) &&
    Object.keys(object).every(key => required.includes(key) || optional.includes(key))
}

export function validatePilotRuntimeConfig(config) {
  if (!exactKeys(config, ['version', 'port', 'installations'], ['limits', 'maxSessions']) ||
      config.version !== 1 || !Number.isSafeInteger(config.port) ||
      config.port < 1 || config.port > 65535) throw invalid()
  try {
    // The accepted factory performs strict credential/id/quota validation.
    const instance = createPilotSignalingServer({
      installations: config.installations,
      ...(config.limits === undefined ? {} : { limits: config.limits }),
      ...(config.maxSessions === undefined ? {} : { maxSessions: config.maxSessions }),
    })
    // Construction does not bind any socket.
    instance.server.unref()
  } catch { throw invalid() }
  return config
}

/** The config path is not secret; the file contents ARE. POSIX 0700 dir, 0400/0600 file. */
export async function loadPilotRuntimeConfig(path) {
  if (process.platform !== 'linux' || typeof path !== 'string' || !isAbsolute(path)) throw invalid()
  let handle
  try {
    const directory = await lstat(dirname(path))
    if (!directory.isDirectory() || directory.isSymbolicLink() ||
        (directory.mode & 0o077) !== 0 || (directory.mode & 0o100) === 0 ||
        directory.uid !== process.geteuid()) throw invalid()
    const file = await lstat(path)
    if (!file.isFile() || file.isSymbolicLink() || file.uid !== process.geteuid() ||
        (file.mode & 0o177) !== 0 || (file.mode & 0o400) === 0 ||
        file.size < 2 || file.size > MAX_CONFIG_BYTES) throw invalid()
    // O_NOFOLLOW prevents a symlink swap; O_NONBLOCK avoids a FIFO race hanging startup.
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const opened = await handle.stat()
    if (!opened.isFile() || opened.ino !== file.ino || opened.dev !== file.dev ||
        opened.uid !== process.geteuid() || (opened.mode & 0o177) !== 0 ||
        (opened.mode & 0o400) === 0 || opened.size < 2 || opened.size > MAX_CONFIG_BYTES) throw invalid()
    const raw = await handle.readFile()
    if (raw.length !== opened.size) throw invalid()
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw)
    return validatePilotRuntimeConfig(JSON.parse(decoded))
  } catch { throw invalid() }
  finally { if (handle) await handle.close() }
}

export async function startPilotRuntime({ configPath } = {}) {
  const config = await loadPilotRuntimeConfig(configPath)
  const app = createPilotSignalingServer({
    installations: config.installations,
    ...(config.limits === undefined ? {} : { limits: config.limits }),
    ...(config.maxSessions === undefined ? {} : { maxSessions: config.maxSessions }),
  })
  try { await app.listen(config.port) }
  catch { throw new Error('pilot_bind_failed') }
  // A second listen is impossible; the factory binds to 127.0.0.1 only.
  let closed = null
  return Object.freeze({
    app,
    port: config.port,
    async close() {
      if (closed) return closed
      closed = (async () => {
        // Shutdown is bounded; no unbounded wait on half-finished HTTP clients.
        const timer = setTimeout(() => app.server.closeAllConnections(), 5_000)
        timer.unref()
        try { await app.close() } finally { clearTimeout(timer) }
      })()
      return closed
    },
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const runtime = await startPilotRuntime({ configPath: process.env.CAPTURELINK_PILOT_CONFIG_PATH })
    console.log(`CaptureLink private pilot ready on 127.0.0.1:${runtime.port}; no public listener`)
    let shuttingDown = false
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
      if (shuttingDown) return
      shuttingDown = true
      try { await runtime.close(); process.exitCode = 0 }
      catch { process.exitCode = 1 }
    })
  } catch {
    // Never print config, paths, admission credentials, socket details, or parser errors.
    console.error('CaptureLink private pilot refused startup')
    process.exitCode = 1
  }
}
