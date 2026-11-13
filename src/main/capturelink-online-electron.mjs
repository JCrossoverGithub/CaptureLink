/**
 * UX3F-3B2: injectable, main-process-only Auth0 login lifecycle for Electron.
 * Privileged dependencies are supplied ONLY from trusted main, never IPC.
 * No public v2 session routing, renderer token, Xbox auth or pilot changes.
 */
import { createCaptureLinkOnlineAuth } from './capturelink-online-auth.mjs'
import { createCaptureLinkOnlineLoopback } from './capturelink-online-loopback.mjs'

const failed = () => new Error('online_auth_unavailable')
const hostFailed = () => new Error('online_signaling_unavailable')
const REDIRECT_PATH = '/capturelink-online/callback'

export function createCaptureLinkOnlineElectron({ provider, vault, redirectPort,
  openBrowser, createLoopback = createCaptureLinkOnlineLoopback,
  // Trusted Electron-main injection only; never constructed from IPC.
  hostFactory = null } = {}) {
  if (!provider || !vault || typeof openBrowser !== 'function' ||
      typeof createLoopback !== 'function' ||
      (hostFactory !== null && typeof hostFactory !== 'function') ||
      !Number.isInteger(redirectPort) ||
      redirectPort < 1024 || redirectPort > 65535) throw failed()
  const redirectUri = `http://127.0.0.1:${redirectPort}${REDIRECT_PATH}`
  const makeAuth = () => createCaptureLinkOnlineAuth({
    issuer: provider.issuer,
    authorizationEndpoint: provider.authorizationEndpoint,
    redirectUri,
    clientId: provider.clientId,
    audience: provider.audience,
    scope: provider.scope,
    openBrowser,
    exchangeCode: provider.exchangeCode,
    exchangeRefresh: provider.exchangeRefresh,
    verifyTokens: provider.verifyTokens,
    vault,
  })
  let auth = makeAuth()
  let listener = null
  let pending = false
  let started = false
  let destroyed = false
  let generation = 0
  let operation = Promise.resolve()
  let signOutRequested = false
  let hostCreatePending = false
  // The token accessor only ever reaches an explicitly trusted main-process
  // candidate factory. No token or host capability becomes a controller return,
  // preload API, IPC handler or renderer value.
  const host = hostFactory?.({ accessToken: () => {
    if (!started || destroyed || signOutRequested || !auth.status().authenticated) return null
    return auth.accessToken()
  } }) ?? null
  if (hostFactory && (!host || typeof host.create !== 'function' ||
      typeof host.end !== 'function' || typeof host.status !== 'function' ||
      typeof host.status().hosting !== 'boolean')) throw failed()
  const stopHost = () => {
    try { return Promise.resolve(host?.end() ?? { ended: true }) }
    catch { return Promise.reject(hostFailed()) }
  }

  // Serialize state-changing commands. Only one browser transaction can exist.
  const serialize = callback => {
    const work = operation.then(callback, callback)
    operation = work.then(() => {}, () => {})
    return work
  }
  async function stopListener() {
    const current = listener
    listener = null
    if (current) await current.close().catch(() => {})
  }
  function safeStatus() {
    return Object.freeze({ enabled: !destroyed, authenticated: !destroyed && auth.status().authenticated,
      pending: !destroyed && pending })
  }
  return Object.freeze({
    status: safeStatus,
    // Main-process-only operations. There are deliberately NO matching IPC
    // handlers or preload functions in UX3F-3B3B.
    hostingStatus() {
      return Object.freeze({ hosting: !destroyed && (host?.status().hosting === true) })
    },
    async createHostSession(permissions) {
      if (!host || !started || destroyed || signOutRequested || pending || hostCreatePending ||
          !auth.status().authenticated) throw hostFailed()
      const epoch = generation
      hostCreatePending = true
      try {
        const invitation = await host.create(permissions)
        if (epoch !== generation || destroyed || signOutRequested ||
            !auth.status().authenticated) {
          await stopHost()
          throw hostFailed()
        }
        return invitation // invite only: no access or host-session bearer
      } catch { throw hostFailed() }
      finally { hostCreatePending = false }
    },
    async endHostSession() {
      if (!host || !started || destroyed) throw hostFailed()
      try { return await stopHost() } catch { throw hostFailed() }
    },
    async initialize() {
      return serialize(async () => {
        if (started || destroyed) throw failed()
        started = true
        try { await auth.renew() } catch { /* No existing account; do not erase vault. */ }
        return safeStatus()
      })
    },
    async begin() {
      return serialize(async () => {
        if (!started || destroyed || pending || signOutRequested || hostCreatePending ||
            host?.status().hosting || auth.status().authenticated) throw failed()
        const epoch = ++generation
        let current
        try {
          current = createLoopback({ port: redirectPort,
            onRedirect: uri => auth.completeRedirect(uri) })
          const actual = await current.listen()
          if (actual !== redirectUri || epoch !== generation || destroyed) throw failed()
          listener = current
          pending = true
          const result = await auth.beginLogin()
          if (!result || result.started !== true || epoch !== generation || destroyed) throw failed()
          // Do not keep IPC waiting for the user to finish in the browser.
          void current.wait().then(() => {
            if (epoch === generation) pending = false
          }, () => {
            if (epoch === generation) {
              pending = false
              // A rejected callback or timeout consumes the transaction.
              // Discard the state machine so the user can retry immediately.
              auth = makeAuth()
            }
          }).finally(() => {
            if (listener === current) listener = null
            void current.close().catch(() => {})
          })
          return { started: true }
        } catch {
          pending = false
          if (epoch === generation) auth = makeAuth()
          if (listener === current) listener = null
          await current?.close().catch(() => {})
          throw failed()
        }
      })
    },
    async signOut() {
      // Invalidate a pending callback before waiting for an in-flight command.
      ++generation
      pending = false
      signOutRequested = true
      // Drop host authority and abort any pending creation synchronously,
      // before waiting for queued Auth0/browser operations.
      const ended = stopHost()
      return serialize(async () => {
        try {
          if (!started || destroyed) throw failed()
          await stopListener()
          // Clear the local refresh credential even if remote revocation fails.
          const [signedOut, stopped] = await Promise.allSettled([auth.signOut(), ended])
          if (signedOut.status !== 'fulfilled' || stopped.status !== 'fulfilled') throw failed()
          auth = makeAuth()
          return safeStatus()
        } catch { throw failed() }
        finally { signOutRequested = false }
      })
    },
    async shutdown() {
      ++generation
      destroyed = true
      pending = false
      signOutRequested = true
      const ended = stopHost()
      await stopListener()
      await ended.catch(() => {})
      // Keep encrypted refresh credentials for the next normal app launch.
      return { stopped: true }
    },
  })
}
