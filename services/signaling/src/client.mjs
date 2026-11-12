/**
 * CaptureLink UX3b0/UX3c-1: signaling clients for the trusted Electron main process.
 * Local transport is pinned to HTTP loopback. Remote transport requires an explicit
 * exact HTTPS origin approval and a separate installation admission credential.
 * Neither transport stores bearer tokens on disk or reports P2P connectivity.
 */
import { canonicalGuestName } from './protocol.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SECRET = /^[A-Za-z0-9_-]{43}$/
const MAX_JSON = 1_200_000
const ALLOWED_ACTIONS = new Set(['approve', 'reject', 'messages', 'revoke', 'leave'])

export class SignalingClientError extends Error {
  constructor(code, status = 0) {
    super(code)
    this.name = 'SignalingClientError'
    this.code = code
    this.status = status
  }
}

function assertUuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new SignalingClientError('invalid_session_id')
}
function assertSecret(value, code) {
  if (typeof value !== 'string' || !SECRET.test(value)) throw new SignalingClientError(code)
}
function assertPermissions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'controller,controllerMode,voice,watch' ||
      typeof value.watch !== 'boolean' || typeof value.voice !== 'boolean' ||
      typeof value.controller !== 'boolean' || !['shared', 'player2'].includes(value.controllerMode) ||
      (value.controller && !value.watch) || !(value.watch || value.voice || value.controller)) {
    throw new SignalingClientError('invalid_permissions')
  }
}
// Enforce the remote response limit while streaming, not after text() has
// already allocated an arbitrarily large payload. The local client retains
// its accepted UX3b1 reading behavior.
async function boundedRemoteJsonText(response) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_JSON) throw new SignalingClientError('response_too_large')
    return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let length = 0
  let content = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw new SignalingClientError('invalid_server_response')
      length += value.byteLength
      if (length > MAX_JSON) throw new SignalingClientError('response_too_large')
      content += decoder.decode(value, { stream: true })
    }
    return content + decoder.decode()
  } catch (error) {
    void reader.cancel().catch(() => {})
    if (error instanceof SignalingClientError) throw error
    throw new SignalingClientError('invalid_server_response')
  } finally {
    reader.releaseLock()
  }
}

function abortCheck(signal) {
  if (signal?.aborted) throw new SignalingClientError('cancelled')
}
function sleep(ms, signal) {
  abortCheck(signal)
  return new Promise((resolve, reject) => {
    let timer
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
    const cancel = () => { done(); reject(new SignalingClientError('cancelled')) }
    timer = setTimeout(() => { done(); resolve() }, ms)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
  })
}

class SignalingSessionClient {
  #root
  #fetch
  #token = null
  #role = null
  #sessionId = null
  #cursor = 0
  #requestTimeoutMs
  #admissionToken
  #remote
  constructor({ root, fetchImpl, requestTimeoutMs, admissionToken = null, remote = false }) {
    if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 60_000) {
      throw new SignalingClientError('invalid_client_configuration')
    }
    this.#root = root
    this.#fetch = fetchImpl
    this.#requestTimeoutMs = requestTimeoutMs
    this.#admissionToken = admissionToken
    this.#remote = remote
  }
  get role() { return this.#role }
  get sessionId() { return this.#sessionId }

  async #request(method, path, body, { authorized = false, signal } = {}) {
    abortCheck(signal)
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(), this.#requestTimeoutMs)
    try {
      const response = await this.#fetch(this.#root + path, {
        method,
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(authorized ? { Authorization: `Bearer ${this.#requireToken()}` } : {}),
          ...(this.#remote ? { 'X-CaptureLink-Admission': `Bearer ${this.#admissionToken}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (!response || !Number.isInteger(response.status) || !response.headers || typeof response.text !== 'function') {
        throw new SignalingClientError('invalid_server_response')
      }
      // A remote response must be from the exact originally approved origin.
      // Real Fetch enforces redirect:'error'; this also rejects wrong-origin
      // responses supplied by a custom transport in hermetic tests.
      if (this.#remote && (response.redirected === true ||
          (response.url && response.url !== this.#root + path) ||
          !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? ''))) {
        throw new SignalingClientError('invalid_server_response')
      }
      const len = Number(response.headers.get('content-length') ?? '0')
      if (!Number.isFinite(len) || len < 0) throw new SignalingClientError('invalid_server_response')
      if (len > MAX_JSON) throw new SignalingClientError('response_too_large')
      const text = this.#remote ? await boundedRemoteJsonText(response) : await response.text()
      if (text.length > MAX_JSON) throw new SignalingClientError('response_too_large')
      let data
      try { data = JSON.parse(text) } catch { throw new SignalingClientError('invalid_server_response') }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SignalingClientError('invalid_server_response')
      if (response.status < 200 || response.status >= 300) {
        // Only server-defined error codes; never include raw response, secrets, SDP, or ICE.
        const safeCode = typeof data.error === 'string' && /^[a-z_]{1,64}$/.test(data.error) ? data.error : 'server_rejected'
        throw new SignalingClientError(safeCode, response.status)
      }
      return data
    } catch (err) {
      if (err instanceof SignalingClientError) throw err
      if (signal?.aborted) throw new SignalingClientError('cancelled')
      if (controller.signal.aborted) throw new SignalingClientError('request_timeout')
      throw new SignalingClientError('network_unavailable')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
  #requireToken() {
    if (!this.#token || !this.#sessionId) throw new SignalingClientError('not_joined')
    return this.#token
  }
  #requireRole(role) {
    if (this.#role !== role) throw new SignalingClientError('wrong_role')
    assertUuid(this.#sessionId)
  }
  #path(action = '') {
    assertUuid(this.#sessionId)
    if (action && !ALLOWED_ACTIONS.has(action)) throw new SignalingClientError('invalid_action')
    return `/v1/sessions/${this.#sessionId}${action ? '/' + action : ''}`
  }
  async create(permissions, { signal } = {}) {
    if (this.#role) throw new SignalingClientError('session_already_started')
    assertPermissions(permissions)
    const result = await this.#request('POST', '/v1/sessions', { permissions }, { signal })
    assertUuid(result.sessionId)
    assertSecret(result.hostToken, 'invalid_server_response')
    assertSecret(result.inviteCode, 'invalid_server_response')
    this.#role = 'host'; this.#token = result.hostToken; this.#sessionId = result.sessionId
    this.#cursor = 0
    return { sessionId: result.sessionId, inviteCode: result.inviteCode, inviteExpiresAt: result.inviteExpiresAt }
  }
  async join(inviteCode, { signal, displayName } = {}) {
    if (this.#role) throw new SignalingClientError('session_already_started')
    assertSecret(inviteCode, 'invalid_invitation')
    const normalizedName = displayName === undefined ? undefined : canonicalGuestName(displayName)
    if (displayName !== undefined && !normalizedName) throw new SignalingClientError('invalid_display_name')
    const result = await this.#request('POST', '/v1/join',
      normalizedName === undefined ? { inviteCode } : { inviteCode, displayName: normalizedName }, { signal })
    assertUuid(result.sessionId)
    assertUuid(result.guestId)
    assertSecret(result.guestToken, 'invalid_server_response')
    if (result.status !== 'pending') throw new SignalingClientError('invalid_server_response')
    this.#role = 'guest'; this.#token = result.guestToken; this.#sessionId = result.sessionId
    this.#cursor = 0
    return { sessionId: result.sessionId, guestId: result.guestId, status: result.status }
  }
  async snapshot({ signal } = {}) {
    this.#requireToken()
    const result = await this.#request('GET', this.#path(), undefined, { authorized: true, signal })
    if (result.sessionId !== this.#sessionId || result.role !== this.#role) throw new SignalingClientError('invalid_server_response')
    return result
  }
  async approve(guestId, { signal } = {}) {
    this.#requireRole('host'); assertUuid(guestId)
    return this.#request('POST', this.#path('approve'), { guestId }, { authorized: true, signal })
  }
  async reject(guestId, { signal } = {}) {
    this.#requireRole('host'); assertUuid(guestId)
    return this.#request('POST', this.#path('reject'), { guestId }, { authorized: true, signal })
  }
  async send(kind, payload, { signal } = {}) {
    if (kind !== (this.#role === 'host' ? 'invite' : 'response')) throw new SignalingClientError('wrong_direction')
    if (typeof payload !== 'string' || !payload.startsWith('CAPTURELINK-SESSION-V1:') || payload.length > 1_000_000) {
      throw new SignalingClientError('invalid_signaling_envelope')
    }
    return this.#request('POST', this.#path('messages'), { kind, payload }, { authorized: true, signal })
  }
  async messages({ signal } = {}) {
    this.#requireToken()
    const result = await this.#request('GET', `${this.#path('messages')}?after=${this.#cursor}`, undefined, { authorized: true, signal })
    if (!Array.isArray(result.messages) || !Number.isSafeInteger(result.nextCursor) || result.nextCursor < this.#cursor ||
        result.messages.some(m => !Number.isSafeInteger(m.id) || m.id <= this.#cursor ||
          typeof m.payload !== 'string' || !['invite', 'response'].includes(m.kind))) {
      throw new SignalingClientError('invalid_server_response')
    }
    // At-most-once local delivery; retrying the same message is not permitted by the broker.
    this.#cursor = result.nextCursor
    return result.messages
  }
  async until(predicate, { signal, intervalMs = 400, timeoutMs = 120_000 } = {}) {
    if (typeof predicate !== 'function' || !Number.isSafeInteger(intervalMs) || intervalMs < 50 || intervalMs > 10_000 ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900_000) {
      throw new SignalingClientError('invalid_poll_configuration')
    }
    const deadline = Date.now() + timeoutMs
    while (true) {
      abortCheck(signal)
      if (Date.now() >= deadline) throw new SignalingClientError('poll_timeout')
      const data = await this.snapshot({ signal })
      const matched = predicate(data)
      if (matched) return data
      if (data.status === 'rejected') throw new SignalingClientError('host_rejected')
      await sleep(Math.min(intervalMs, Math.max(1, deadline - Date.now())), signal)
    }
  }
  async waitForMessage(kind, { signal, intervalMs = 400, timeoutMs = 120_000 } = {}) {
    if (!['invite', 'response'].includes(kind)) throw new SignalingClientError('invalid_message_kind')
    const deadline = Date.now() + timeoutMs
    while (true) {
      abortCheck(signal)
      if (Date.now() >= deadline) throw new SignalingClientError('poll_timeout')
      const inbox = await this.messages({ signal })
      const message = inbox.find(x => x.kind === kind)
      if (message) return message.payload
      await sleep(Math.min(intervalMs, Math.max(1, deadline - Date.now())), signal)
    }
  }
  async end({ signal } = {}) {
    if (!this.#role) return
    const action = this.#role === 'host' ? 'revoke' : 'leave'
    try { await this.#request('POST', this.#path(action), {}, { authorized: true, signal }) }
    finally { this.clearLocal() }
  }
  clearLocal() { this.#role = null; this.#token = null; this.#sessionId = null; this.#cursor = 0 }
}

/** Headless lifecycle glue. MUST only run after an explicit host approval callback. */
export async function hostSession(client, coordinator, permissions, { presentInvite, approveGuest, signal, intervalMs = 250, timeoutMs = 120_000 } = {}) {
  if (typeof presentInvite !== 'function' || typeof approveGuest !== 'function') throw new SignalingClientError('host_callbacks_required')
  let touchedTransport = false
  try {
    const created = await client.create(permissions, { signal })
    await presentInvite(created.inviteCode, created.inviteExpiresAt)
    const pending = await client.until(s => !!s.pendingGuestId, { signal, intervalMs, timeoutMs })
    const allowed = await approveGuest(pending.pendingGuestId)
    if (allowed !== true) {
      await client.reject(pending.pendingGuestId, { signal })
      throw new SignalingClientError('host_rejected')
    }
    await client.approve(pending.pendingGuestId, { signal })
    touchedTransport = true
    const wire = await coordinator.createInvitation(permissions)
    await client.send('invite', wire, { signal })
    const response = await client.waitForMessage('response', { signal, intervalMs, timeoutMs })
    await coordinator.acceptResponse(response)
    return { phase: 'negotiated', sessionId: created.sessionId } // NOT P2P-connected
  } catch (err) {
    if (touchedTransport) { try { coordinator.reset() } catch { /* caller still owns cleanup */ } }
    try { await client.end() } catch { /* best effort, preserve original failure */ }
    throw err
  }
}

/** The guest must explicitly choose microphone consent; neither broker nor host grants it. */
export async function guestSession(client, coordinator, inviteCode, microphoneConsent, { signal, intervalMs = 250, timeoutMs = 120_000 } = {}) {
  if (typeof microphoneConsent !== 'boolean') throw new SignalingClientError('mic_consent_required')
  let touchedTransport = false
  try {
    const joined = await client.join(inviteCode, { signal })
    await client.until(s => s.status === 'approved', { signal, intervalMs, timeoutMs })
    const wire = await client.waitForMessage('invite', { signal, intervalMs, timeoutMs })
    touchedTransport = true
    const response = await coordinator.joinInvitation(wire, microphoneConsent)
    await client.send('response', response, { signal })
    return { phase: 'response-sent', sessionId: joined.sessionId } // NOT P2P-connected
  } catch (err) {
    if (touchedTransport) { try { coordinator.reset() } catch { /* caller still owns cleanup */ } }
    try { await client.end() } catch { /* best effort */ }
    throw err
  }
}

/** Existing localhost-only API. Its pinned endpoint contract is unchanged. */
export class LocalSignalingClient extends SignalingSessionClient {
  constructor({ endpoint = 'http://127.0.0.1:8787', fetchImpl = fetch, requestTimeoutMs = 10_000 } = {}) {
    let url
    try { url = new URL(endpoint) } catch { throw new SignalingClientError('invalid_endpoint') }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^\d+$/.test(url.port) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new SignalingClientError('endpoint_not_loopback')
    }
    super({ root: url.origin, fetchImpl, requestTimeoutMs })
  }
}

/** Reject hostname aliases, LAN IPs, userinfo, URL paths, and non-canonical origins. */
function exactHttpsOrigin(endpoint) {
  if (typeof endpoint !== 'string') throw new SignalingClientError('invalid_remote_endpoint')
  let url
  try { url = new URL(endpoint) } catch { throw new SignalingClientError('invalid_remote_endpoint') }
  const hostname = url.hostname
  const dnsName = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash || !dnsName.test(hostname) ||
      /\.(?:local|localhost|internal|onion)$/.test(hostname) ||
      (endpoint !== url.origin && endpoint !== `${url.origin}/`)) {
    throw new SignalingClientError('invalid_remote_endpoint')
  }
  return url.origin
}

/**
 * UX3c-1 remote candidate: impossible to construct without a separately
 * approved exact origin, explicit enable bit and per-install admission token.
 * Only trusted main-process code may select this transport, never renderer IPC.
 * TLS validation is owned by the standard Fetch implementation; no insecure
 * dispatcher, redirect following, certificate override or fallback exists here.
 */
export class RemoteSignalingClient extends SignalingSessionClient {
  constructor({ endpoint, approvedOrigin, admissionToken, enabled = false,
    fetchImpl = fetch, requestTimeoutMs = 10_000 } = {}) {
    if (enabled !== true) throw new SignalingClientError('remote_disabled')
    const origin = exactHttpsOrigin(endpoint)
    if (exactHttpsOrigin(approvedOrigin) !== origin) throw new SignalingClientError('remote_origin_not_approved')
    if (typeof admissionToken !== 'string' || !SECRET.test(admissionToken)) {
      throw new SignalingClientError('remote_admission_required')
    }
    // Environment variables that bypass Node TLS verification are never valid
    // remote-client configurations. Do not expose equivalent Electron flags.
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
      throw new SignalingClientError('insecure_tls_configuration')
    }
    super({ root: origin, fetchImpl, requestTimeoutMs, admissionToken, remote: true })
  }
}
