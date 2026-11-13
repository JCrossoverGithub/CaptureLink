/**
 * UX3F-3B3C2: Electron-main-only online session coordinator.
 *
 * The HTTPS candidate remains pinned to a non-routable .test origin.
 * Browser/renderer IPC receives no bearer, session capability, Auth0 identity,
 * or injected origin. The host role is available only via the existing
 * createCaptureLinkOnlineElectron hostFactory callback. Guests need no account.
 * This deliberately does NOT implement media/controller teardown in renderer.
 */
import { createCaptureLinkOnlineHttpsSessionCandidate } from './capturelink-online-https-session-candidate.mjs'

const unavailable = () => new Error('online_signaling_unavailable')
const CODE = /^[A-Za-z0-9_-]{43}$/
const KINDS = new Set(['invite', 'response'])

export class CaptureLinkOnlineSessionBridge {
  #candidateFactory
  #hostBound = false
  #tokenAccessor = () => null
  #client = null
  #controller = null
  #role = null

  constructor({ candidateFactory = createCaptureLinkOnlineHttpsSessionCandidate } = {}) {
    if (typeof candidateFactory !== 'function') throw unavailable()
    this.#candidateFactory = candidateFactory
  }

  // Invoked only by trusted Electron main as Auth0's hostFactory. The returned
  // object is the ONE host authority used by Auth0's create/end/signOut/shutdown;
  // it cannot create a second invitation through a parallel host candidate.
  authenticatedHostAdapter(accessToken) {
    if (this.#hostBound || typeof accessToken !== 'function') throw unavailable()
    this.#hostBound = true
    this.#tokenAccessor = accessToken
    return Object.freeze({
      status: () => Object.freeze({ hosting: this.#role === 'host' &&
        this.#client?.status().role === 'host' }),
      create: permissions => this.#begin('host', client => client.create(permissions,
        { signal: this.#controller.signal })),
      end: () => this.end(),
    })
  }

  status() {
    const info = this.#client?.status()
    return Object.freeze({ role: info?.role ?? null, active: info?.active === true })
  }

  async #begin(role, operation) {
    if (this.#client || this.#controller ||
        (role === 'host' && !this.#hostBound)) throw unavailable()
    const controller = new AbortController()
    let client
    try {
      client = this.#candidateFactory({
        accessToken: role === 'host' ? this.#tokenAccessor : null,
      })
      if (!client || typeof client.status !== 'function' ||
          typeof client.end !== 'function') throw unavailable()
      this.#client = client
      this.#controller = controller
      this.#role = role
      const value = await operation(client)
      if (this.#client !== client || this.#controller !== controller ||
          controller.signal.aborted || client.status().role !== role) throw unavailable()
      return value
    } catch {
      if (this.#client === client) {
        this.#client = null
        this.#controller = null
        this.#role = null
        controller.abort()
      }
      try { await client?.end() } catch { /* best effort */ }
      throw unavailable()
    }
  }

  async join(code, displayName) {
    if (typeof code !== 'string' || !CODE.test(code)) throw unavailable()
    return this.#begin('guest', client => client.join(code, {
      displayName, signal: this.#controller.signal,
    }))
  }

  #current(role = null) {
    const client = this.#client
    const controller = this.#controller
    if (!client || !controller || controller.signal.aborted ||
        client.status().role !== this.#role ||
        (role && this.#role !== role)) throw unavailable()
    return { client, controller }
  }

  async #operation(role, method) {
    const { client, controller } = this.#current(role)
    try {
      const value = await method(client, controller.signal)
      if (this.#client !== client || this.#controller !== controller ||
          controller.signal.aborted) throw unavailable()
      return value
    } catch { throw unavailable() }
  }

  snapshot() {
    return this.#operation(null, (client, signal) => client.snapshot({ signal }))
  }

  approve(allow) {
    if (typeof allow !== 'boolean') throw unavailable()
    return this.#operation('host', (client, signal) => client.approve(allow, { signal }))
  }

  send(kind, wire) {
    if (!KINDS.has(kind) || typeof wire !== 'string' || wire.length > 1_000_000) throw unavailable()
    return this.#operation(kind === 'invite' ? 'host' : 'guest',
      (client, signal) => client.send(kind, wire, { signal }))
  }

  messages() {
    return this.#operation(null, (client, signal) => client.messages({ signal }))
  }

  async end() {
    const client = this.#client
    const controller = this.#controller
    this.#client = null
    this.#controller = null
    this.#role = null
    controller?.abort()
    try { await client?.end() } catch { /* remote cleanup is best effort */ }
    return Object.freeze({ ended: true })
  }
}
