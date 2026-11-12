/**
 * UX2 — one user-facing session with independently authorized transports.
 * Manual private clipboard exchange; NOT a hosted invite code and NOT peer authentication.
 * No secrets, SDP, ICE or IP addresses are logged by this module.
 */
export type SessionPhase = 'idle' | 'creating' | 'invite-ready' | 'joining' |
  'response-ready' | 'accepting' | 'negotiated' | 'failed'
export type SessionRole = 'host' | 'guest'
export type SessionCapabilities = {
  watch: boolean
  voice: boolean
  controller: boolean
  controllerMode: 'shared' | 'player2'
}
export type SessionOverview = {
  phase: SessionPhase
  role: SessionRole | null
  capabilities: SessionCapabilities | null
  message: string
}

type Invite = {
  kind: 'invite'
  version: 1
  sessionId: string
  createdAt: number
  permissions: SessionCapabilities
  transports: { controller?: string; voice?: string }
}
type Response = {
  kind: 'response'
  version: 1
  sessionId: string
  transports: { controller?: string; voice?: string }
}
type Envelope = Invite | Response

export interface UnifiedSessionTransport {
  hostController(mode: 'shared' | 'player2'): Promise<string>
  guestController(invite: string): Promise<string>
  acceptController(response: string): Promise<void>
  stopController(): void
  hostVoice(): Promise<string>
  guestVoice(invite: string, microphoneConsent: boolean, playGameAudio: boolean): Promise<string>
  acceptVoice(response: string): Promise<void>
  setHostVoicePermissions(permissions: { voice: boolean; watch: boolean }): void
  stopVoice(): void
}

const PREFIX = 'CAPTURELINK-SESSION-V1:'
const MAX_WIRE = 1_000_000
const MAX_PART = 400_000
const EXPIRY_MS = 15 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function keysExactly(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join('|') === keys.slice().sort().join('|')
}
function validateCapabilities(value: unknown): value is SessionCapabilities {
  if (!plainObject(value) || !keysExactly(value, ['watch', 'voice', 'controller', 'controllerMode'])) return false
  return typeof value.watch === 'boolean' && typeof value.voice === 'boolean' &&
    typeof value.controller === 'boolean' && (value.controllerMode === 'shared' || value.controllerMode === 'player2') &&
    (!value.controller || value.watch)
}
function validateTransports(value: unknown, kind: 'invite'|'response', cap: SessionCapabilities | null): value is Envelope['transports'] {
  if (!plainObject(value) || Object.keys(value).some(k => k !== 'controller' && k !== 'voice')) return false
  const requiredController = cap?.controller ?? ('controller' in value)
  const requiredVoice = cap ? (cap.voice || (cap.watch && !cap.controller)) : ('voice' in value)
  if (!!value.controller !== requiredController || !!value.voice !== requiredVoice) return false
  if (!requiredController && !requiredVoice) return false
  for (const key of Object.keys(value)) {
    if (typeof value[key] !== 'string' || value[key].length < 8 || value[key].length > MAX_PART) return false
    // These are opaque legacy signaling envelopes; downstream adapters validate the actual protocol.
  }
  return true
}
function encodeEnvelope(value: Envelope): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  if (bytes.length > MAX_WIRE * 0.7) throw new Error('Session invitation is too large to copy safely.')
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  const wire = PREFIX + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  if (wire.length > MAX_WIRE) throw new Error('Session invitation is too large.')
  return wire
}
export function decodeUnifiedEnvelope(wire: string, now = Date.now()): Envelope {
  if (typeof wire !== 'string' || !wire.startsWith(PREFIX) || wire.length > MAX_WIRE || wire.length <= PREFIX.length) {
    throw new Error('This is not a valid CaptureLink unified session invitation or response.')
  }
  const encoded = wire.slice(PREFIX.length)
  if (!/^[a-zA-Z0-9_-]+$/.test(encoded)) throw new Error('Invalid session code encoding.')
  let value: unknown
  try {
    const binary = atob(encoded.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - encoded.length % 4) % 4))
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error('The session code is incomplete or corrupted.')
  }
  if (!plainObject(value) || value.version !== 1 || !UUID.test(String(value.sessionId)) ||
      (value.kind !== 'invite' && value.kind !== 'response')) throw new Error('Unsupported or invalid session code.')
  if (value.kind === 'invite') {
    if (!keysExactly(value, ['kind', 'version', 'sessionId', 'createdAt', 'permissions', 'transports']) ||
        !Number.isSafeInteger(value.createdAt) || typeof value.createdAt !== 'number' || !validateCapabilities(value.permissions) ||
        !validateTransports(value.transports, 'invite', value.permissions)) throw new Error('Invalid session permissions or channels.')
    if (value.createdAt > now + 60_000 || now - Number(value.createdAt) > EXPIRY_MS) {
      throw new Error('This invitation has expired. Request a new one from the host.')
    }
  } else {
    if (!keysExactly(value, ['kind', 'version', 'sessionId', 'transports']) ||
        !validateTransports(value.transports, 'response', null)) throw new Error('Invalid session response.')
  }
  return value as Envelope
}

/** One-invite/one-response orchestrator; transport connection proof remains separate. */
export class UnifiedSessionCoordinator {
  private state: SessionOverview = { phase: 'idle', role: null, capabilities: null, message: '' }
  private pending: Invite | null = null
  private operation = 0
  private ownedController = false
  private ownedVoice = false
  private busy = false
  private subscribers = new Set<(state: SessionOverview) => void>()
  constructor(private readonly transport: UnifiedSessionTransport) {}
  snapshot(): SessionOverview { return { ...this.state, capabilities: this.state.capabilities ? { ...this.state.capabilities } : null } }
  subscribe(fn: (state: SessionOverview) => void): () => void {
    this.subscribers.add(fn); fn(this.snapshot()); return () => { this.subscribers.delete(fn) }
  }
  private update(phase: SessionPhase, role: SessionRole | null, cap: SessionCapabilities | null, message = ''): void {
    this.state = { phase, role, capabilities: cap ? { ...cap } : null, message }
    for (const fn of this.subscribers) fn(this.snapshot())
  }
  private rollback(): void {
    if (this.ownedController) { this.ownedController = false; this.transport.stopController() }
    if (this.ownedVoice) { this.ownedVoice = false; this.transport.stopVoice() }
  }
  private async execute<T>(phase: SessionPhase, role: SessionRole, caps: SessionCapabilities | null, fn: (epoch: number) => Promise<T>): Promise<T> {
    if (this.busy || (this.state.phase !== 'idle' && this.state.phase !== 'failed')) {
      throw new Error('End the existing session setup before starting another.')
    }
    this.busy = true
    const epoch = ++this.operation
    this.update(phase, role, caps)
    try { return await fn(epoch) }
    catch (error) {
      this.pending = null
      this.rollback()
      this.update('failed', role, caps, error instanceof Error ? error.message : 'Session setup failed.')
      throw error
    } finally { this.busy = false }
  }
  async createInvitation(caps: SessionCapabilities): Promise<string> {
    if (!validateCapabilities(caps) || (!caps.controller && !caps.voice && !caps.watch)) {
      throw new Error('Choose at least one valid sharing capability.')
    }
    return this.execute('creating', 'host', caps, async epoch => {
      const transports: Invite['transports'] = {}
      if (caps.controller) {
        transports.controller = await this.transport.hostController(caps.controllerMode)
        this.ownedController = true
      }
      if (caps.voice || (caps.watch && !caps.controller)) {
        transports.voice = await this.transport.hostVoice()
        this.ownedVoice = true
      }
      if (epoch !== this.operation) throw new Error('Session setup cancelled.')
      const invite: Invite = { kind: 'invite', version: 1, sessionId: crypto.randomUUID(), createdAt: Date.now(), permissions: { ...caps }, transports }
      const wire = encodeEnvelope(invite)
      this.pending = invite
      // The host selected these capabilities explicitly. No local host microphone is opened.
      if (caps.voice || (caps.watch && !caps.controller)) this.transport.setHostVoicePermissions({ voice: caps.voice, watch: caps.watch && !caps.controller })
      this.update('invite-ready', 'host', caps, 'Share this private invitation. A guest response is required.')
      return wire
    })
  }
  async joinInvitation(wire: string, microphoneConsent: boolean): Promise<string> {
    const invite = decodeUnifiedEnvelope(wire)
    if (invite.kind !== 'invite') throw new Error('Paste a host invitation, not a response.')
    if (invite.permissions.voice && !microphoneConsent) throw new Error('Enable microphone sharing explicitly, or ask the host for a watch-only invitation.')
    return this.execute('joining', 'guest', invite.permissions, async epoch => {
      const transports: Response['transports'] = {}
      if (invite.transports.controller) {
        transports.controller = await this.transport.guestController(invite.transports.controller)
        this.ownedController = true
      }
      if (invite.transports.voice) {
        transports.voice = await this.transport.guestVoice(invite.transports.voice, microphoneConsent && invite.permissions.voice, invite.permissions.watch && !invite.permissions.controller)
        this.ownedVoice = true
      }
      if (epoch !== this.operation) throw new Error('Session setup cancelled.')
      this.pending = invite
      const response: Response = { kind: 'response', version: 1, sessionId: invite.sessionId, transports }
      const result = encodeEnvelope(response)
      this.update('response-ready', 'guest', invite.permissions, 'Send the response back to the host. Your stream is not yet confirmed connected.')
      return result
    })
  }
  async acceptResponse(wire: string): Promise<void> {
    if (this.busy || !this.pending || this.state.role !== 'host' || this.state.phase !== 'invite-ready') throw new Error('Create a host invitation first.')
    const response = decodeUnifiedEnvelope(wire)
    if (response.kind !== 'response' || response.sessionId !== this.pending.sessionId) throw new Error('Response belongs to another session.')
    if (!validateTransports(response.transports, 'response', this.pending.permissions)) throw new Error('Response capabilities do not match the invitation.')
    // Expiry must be enforced by the host too: a guest may create a reply
    // before expiry and send it after the invitation has gone stale.
    if (Date.now() - this.pending.createdAt > EXPIRY_MS) {
      const caps = this.pending.permissions
      this.pending = null
      this.rollback()
      this.update('failed', 'host', caps, 'Invitation expired. Create a new invitation.')
      throw new Error('Invitation expired. Create a new invitation.')
    }
    this.busy = true
    this.update('accepting', 'host', this.pending.permissions)
    try {
      if (response.transports.controller) await this.transport.acceptController(response.transports.controller)
      if (response.transports.voice) await this.transport.acceptVoice(response.transports.voice)
      this.update('negotiated', 'host', this.pending.permissions, 'Responses accepted. Wait for transport connection and verify audio/video independently.')
    } catch (error) {
      this.rollback()
      this.pending = null
      this.update('failed', 'host', this.state.capabilities, error instanceof Error ? error.message : 'Could not accept response.')
      throw error
    } finally { this.busy = false }
  }
  reset(): void {
    if (this.busy) throw new Error('Cannot end a session during a connection operation.')
    ++this.operation
    this.pending = null
    this.rollback()
    this.update('idle', null, null)
  }
}
