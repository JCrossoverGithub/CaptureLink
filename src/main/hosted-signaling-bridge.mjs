/**
 * UX3b1 — local-only Electron main-process signaling boundary.
 * Opaque session bearer tokens stay inside LocalSignalingClient private fields.
 * Only the one-use guest invitation code and in-memory UX2 SDP envelopes can
 * cross IPC. Never log or persist either. No automatic approval is possible.
 */
import { LocalSignalingClient, SignalingClientError } from '../../services/signaling/src/client.mjs'
import { canonicalGuestName } from '../../services/signaling/src/protocol.mjs'

const CODE = /^[A-Za-z0-9_-]{43}$/
const ENVELOPE = 'CAPTURELINK-SESSION-V1:'
const ACTION_ERRORS = new Set([
  'invalid_permissions', 'invalid_invitation', 'session_already_started',
  'not_joined', 'wrong_role', 'no_pending_guest', 'not_approved',
  'network_unavailable', 'request_timeout', 'invitation_unavailable',
  'rate_limited', 'server_rejected', 'session_expired', 'invitation_expired',
  'signaling_expired', 'message_already_sent', 'awaiting_host_invite',
  'poll_timeout', 'host_rejected', 'invalid_signaling_envelope',
  'invalid_server_response', 'response_too_large', 'cancelled',
  'not_found', 'no_matching_pending_guest', 'wrong_direction',
  'capacity_exceeded', 'invalid_session_id', 'mismatched_signaling_session',
  'invalid_display_name'
])

function safeError(error) {
  const code = error instanceof SignalingClientError ? error.code : error?.code ?? error?.message
  return new Error(ACTION_ERRORS.has(code) ? code : 'hosted_signaling_unavailable')
}

export class HostedSignalingBridge {
  #client = null
  #controller = null
  #pendingGuest = null
  #factory

  constructor({ clientFactory = () => new LocalSignalingClient() } = {}) {
    this.#factory = clientFactory
  }

  get role() { return this.#client?.role ?? null }

  #current(role = null) {
    if (!this.#client || !this.#client.role) throw new Error('not_joined')
    if (role && this.#client.role !== role) throw new Error('wrong_role')
    return { client: this.#client, signal: this.#controller.signal }
  }

  #start() {
    if (this.#client) throw new Error('session_already_started')
    this.#client = this.#factory()
    this.#controller = new AbortController()
    this.#pendingGuest = null
    return this.#client
  }

  async create(permissions) {
    const client = this.#start()
    try {
      const data = await client.create(permissions, { signal: this.#controller.signal })
      if (client !== this.#client) throw new Error('cancelled')
      return { inviteCode: data.inviteCode, inviteExpiresAt: data.inviteExpiresAt }
    } catch (error) {
      if (client === this.#client) { this.#client = null; this.#controller = null }
      try { await client.end() } catch { /* best effort */ }
      throw safeError(error)
    }
  }

  async join(inviteCode, displayName) {
    if (typeof inviteCode !== 'string' || !CODE.test(inviteCode)) throw new Error('invalid_invitation')
    // Native IPC callers cannot bypass the new guest-name requirement.
    const name = canonicalGuestName(displayName)
    if (!name) throw new Error('invalid_display_name')
    const client = this.#start()
    try {
      await client.join(inviteCode, { signal: this.#controller.signal, displayName: name })
      if (client !== this.#client) throw new Error('cancelled')
      return { status: 'pending' }
    } catch (error) {
      if (client === this.#client) { this.#client = null; this.#controller = null }
      try { await client.end() } catch { /* best effort */ }
      throw safeError(error)
    }
  }

  async snapshot() {
    const { client, signal } = this.#current()
    try {
      const result = await client.snapshot({ signal })
      if (client !== this.#client) throw new Error('cancelled')
      this.#pendingGuest = client.role === 'host' ? result.pendingGuestId : null
      return {
        role: client.role,
        status: result.status,
        hasPendingGuest: Boolean(this.#pendingGuest),
        guestDisplayName: client.role === 'host' && typeof result.guestDisplayName === 'string'
          ? canonicalGuestName(result.guestDisplayName) : null,
      }
    } catch (error) { throw safeError(error) }
  }

  async approve(allow) {
    if (typeof allow !== 'boolean') throw new Error('invalid_approval')
    const { client, signal } = this.#current('host')
    try {
      // Recheck identity and state before changing any authorization.
      const snapshot = await client.snapshot({ signal })
      const guestId = snapshot.pendingGuestId
      if (!guestId || guestId !== this.#pendingGuest) throw new Error('no_pending_guest')
      if (allow) await client.approve(guestId, { signal })
      else await client.reject(guestId, { signal })
      this.#pendingGuest = null
      return { status: allow ? 'approved' : 'rejected' }
    } catch (error) { throw safeError(error) }
  }

  async send(kind, payload) {
    const { client, signal } = this.#current()
    if (kind !== (client.role === 'host' ? 'invite' : 'response')) throw new Error('wrong_direction')
    if (typeof payload !== 'string' || !payload.startsWith(ENVELOPE) || payload.length > 1_000_000) {
      throw new Error('invalid_signaling_envelope')
    }
    try {
      await client.send(kind, payload, { signal })
      return { sent: true }
    } catch (error) { throw safeError(error) }
  }

  async messages() {
    const { client, signal } = this.#current()
    try {
      const expected = client.role === 'host' ? 'response' : 'invite'
      const result = await client.messages({ signal })
      if (client !== this.#client) throw new Error('cancelled')
      return result.filter(item => item.kind === expected)
        .map(item => ({ kind: expected, payload: item.payload }))
    } catch (error) { throw safeError(error) }
  }

  async end() {
    const client = this.#client
    this.#client = null
    this.#pendingGuest = null
    this.#controller?.abort()
    this.#controller = null
    if (!client) return { ended: true }
    try { await client.end() } catch { /* broker may already be unreachable; secrets cleared locally */ }
    client.clearLocal()
    return { ended: true }
  }
}
