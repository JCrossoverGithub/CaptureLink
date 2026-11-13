/**
 * UX3F-3B1: one-shot system-browser loopback callback listener, main-process only.
 * Bind before shell.openExternal. Use the exact port configured in Auth0's
 * Allowed Callback URLs; random ports are for hermetic tests only.
 * Does not log callback query, state, authorization code or errors.
 */
import { createServer } from 'node:http'

const error = () => new Error('online_auth_unavailable')
const PATH = '/capturelink-online/callback'
const HEADERS = Object.freeze({
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'no-store, private',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'",
})

export function createCaptureLinkOnlineLoopback({ port, onRedirect, timeoutMs = 300_000 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 ||
      typeof onRedirect !== 'function' || !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 100 || timeoutMs > 300_000) throw error()
  let server
  let bound = false
  let settled = false
  let timeout
  let resolveDone, rejectDone
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject })
  // Explicitly consume rejections for callers using stop() without waiting.
  done.catch(() => {})
  const finish = (err, result) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    if (err) rejectDone(error())
    else resolveDone(result)
  }
  const respond = (res, status) => {
    res.writeHead(status, HEADERS)
    res.end(status === 200 ? 'CaptureLink Online sign-in completed. You can close this tab.' :
      'CaptureLink Online sign-in could not be completed. Return to CaptureLink.')
  }
  return Object.freeze({
    async listen() {
      if (server || settled) throw error()
      server = createServer(async (req, res) => {
        const expectedHost = `127.0.0.1:${server.address()?.port}`
        if (settled || req.method !== 'GET' || typeof req.url !== 'string' || req.url.length > 4096 ||
            !req.url.startsWith(PATH + '?') || req.headers.host !== expectedHost ||
            req.headers.origin !== undefined || req.headers.authorization !== undefined ||
            req.headers.cookie !== undefined || req.headers['content-length'] !== undefined ||
            req.headers['transfer-encoding'] !== undefined ||
            Object.keys(req.headers).some(k => k.startsWith('x-forwarded-') || k === 'forwarded')) {
          respond(res, 404)
          return
        }
        // One callback attempt; no second code can reach the coordinator.
        settled = true
        clearTimeout(timeout)
        try {
          const outcome = await onRedirect(`http://${expectedHost}${req.url}`)
          if (!outcome || outcome.authenticated !== true) throw error()
          respond(res, 200)
          resolveDone({ authenticated: true })
        } catch {
          respond(res, 400)
          rejectDone(error())
        }
      })
      server.maxConnections = 12
      server.headersTimeout = 10_000
      server.requestTimeout = 30_000
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject)
          server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve() })
        })
      } catch { await new Promise(r => server.close(() => r())); throw error() }
      bound = true
      timeout = setTimeout(() => finish(error()), timeoutMs)
      timeout.unref?.()
      return `http://127.0.0.1:${server.address().port}${PATH}`
    },
    wait() { if (!bound) throw error(); return done },
    async close() {
      finish(error())
      if (server?.listening) {
        server.closeAllConnections?.()
        await new Promise((resolve, reject) => server.close(err => err ? reject(error()) : resolve()))
      }
    },
  })
}
