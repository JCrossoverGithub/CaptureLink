import { decodeVoiceSignal, encodeVoiceSignal } from './signaling'
import { gatherVoiceIceSnapshot } from './ice-gathering'
import { AudioPathStats, formatAudioPathSample, type AudioPathSample } from './audio-path-stats'

type XboxUplink = { sender: RTCRtpSender; track: MediaStreamTrack }
export type SharedVoiceOptions = {
  audioPanel: HTMLElement
  statusContainer?: HTMLElement
  getXboxUplink(): XboxUplink | null
  // Host permission is explicit; this activation never opens the host microphone.
  ensureGuestXboxUplink?(): Promise<boolean>
  onHostSessionEnded?(): Promise<void>
  getGuestFallbackTrack?(): MediaStreamTrack | null
  getGuestMicrophoneConstraints(): MediaTrackConstraints
  // The host explicitly chooses whether its existing Xbox media is relayed.
  getHostGameMediaStream?(): MediaStream | null
  getHostMicrophoneTrack?(): MediaStreamTrack | null
  canJoinAsGuest?(): boolean
  // Receiver uses the main CaptureLink Stream surface; no controller grant.
  onGuestMediaStream?(stream: MediaStream, playAudio: boolean): void
  onGuestMediaStopped?(): void
}

export type SharedVoiceController = {
  // Host voice session persists when Xbox microphone transmission is disabled.
  onXboxMicrophoneStopped(): void
  onXboxMicrophoneStarted(): void
  onHostMicrophoneChanged(track: MediaStreamTrack | null): void
  onXboxSessionConnected(): void
  hasActiveGuestMix(): boolean
  dispose(): void
  createUnifiedHostOffer(): Promise<string>
  acceptUnifiedGuestAnswer(answer: string): Promise<void>
  joinUnifiedHostOffer(offer: string, allowMicrophone: boolean, playGameAudio?: boolean): Promise<string>
  setUnifiedHostPermissions(permissions: { voice: boolean; watch: boolean }): void
  stopUnified(): void
}

type RoleSession = {
  id: string
  peer: RTCPeerConnection
  media: MediaStream | null
  mixed: VoiceMixer | null
  remoteAudio: MediaStream | null
  mixBusy: boolean
  mixEpoch: number
  restoreOnStop: boolean
  control: RTCDataChannel | null
  gameAudioSender?: RTCRtpSender
  gameVideoSender?: RTCRtpSender
  lastGameAudio?: MediaStreamTrack | null
  lastGameVideo?: MediaStreamTrack | null
  gameMediaBusy?: boolean
  lastHostStatusPayload?: string
  receiving?: MediaStream
  silentGuestContext?: AudioContext
}

const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

function newVoicePeer(): RTCPeerConnection {
  // No gameplay video or controller permissions. Only a lifecycle control channel is allowed.
  return new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })
}

class VoiceMixer {
  private readonly context: AudioContext
  private readonly outputTrack: MediaStreamTrack
  private readonly gain: GainNode
  private hostSource: MediaStreamAudioSourceNode | null = null
  private readonly outputAnalyser: AnalyserNode
  private readonly outputDestination: MediaStreamAudioDestinationNode
  private readonly samples: Uint8Array<ArrayBuffer>
  private readonly original: MediaStreamTrack
  private readonly fallback: () => MediaStreamTrack | null
  private readonly sender: RTCRtpSender
  private closed = false

  getContextState(): string { return this.context.state ?? 'unknown' }

  getXboxSender(): RTCRtpSender { return this.sender }

  // Read-only meter on the *mixed output*; nothing is played to speakers.
  getOutputLevel(): number | null {
    if (this.closed || this.context.state !== 'running') return null
    this.outputAnalyser.getByteTimeDomainData(this.samples)
    let energy = 0
    for (const sample of this.samples) {
      const delta = (sample - 128) / 128
      energy += delta * delta
    }
    return Math.min(1, Math.sqrt(energy / this.samples.length))
  }

  private static async resumeWithDeadline(context: AudioContext): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      await Promise.race([
        context.resume(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(
            'Audio mixer could not start (audio context suspended). Click Retry Xbox mixing.'
          )), 2500)
        })
      ])
      if (context.state && context.state !== 'running') {
        throw new Error('Audio mixer remains suspended. Click Retry Xbox mixing.')
      }
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  private constructor(
    context: AudioContext,
    outputTrack: MediaStreamTrack,
    gain: GainNode,
    outputAnalyser: AnalyserNode,
    outputDestination: MediaStreamAudioDestinationNode,
    uplink: XboxUplink,
    fallback: () => MediaStreamTrack | null
  ) {
    this.context = context
    this.outputTrack = outputTrack
    this.gain = gain
    this.outputAnalyser = outputAnalyser
    this.outputDestination = outputDestination
    this.samples = new Uint8Array(new ArrayBuffer(outputAnalyser.fftSize))
    this.original = uplink.track
    this.fallback = fallback
    this.sender = uplink.sender
  }

  static async create(uplink: XboxUplink, guest: MediaStream, gain: number, isCurrent: () => boolean, fallback: () => MediaStreamTrack | null = () => null): Promise<VoiceMixer> {
    const context = new AudioContext({ latencyHint: 'interactive' })
    try {
      const localTrack = uplink.track
      const guestTrack = guest.getAudioTracks().find(t => t.readyState === 'live')
      if (localTrack.readyState !== 'live' || !guestTrack) {
        throw new Error('Host or guest microphone track is not live.')
      }
      const output = context.createMediaStreamDestination()
      const hostSource = context.createMediaStreamSource(new MediaStream([localTrack]))
      const guestSource = context.createMediaStreamSource(new MediaStream([guestTrack]))
      const guestGain = context.createGain()
      guestGain.gain.value = gain
      hostSource.connect(output)
      guestSource.connect(guestGain)
      guestGain.connect(output)
      const outputTrack = output.stream.getAudioTracks()[0]
      if (!outputTrack) throw new Error('Could not create mixed microphone output.')
      const outputAnalyser = context.createAnalyser()
      outputAnalyser.fftSize = 512
      context.createMediaStreamSource(output.stream).connect(outputAnalyser)
      await VoiceMixer.resumeWithDeadline(context)
      // Do not replace a sender that changed while the mixer was starting
      // (Xbox mic toggled, Xbox reconnected, session ended, or user retried).
      if (!isCurrent() || uplink.sender.track !== uplink.track) {
        throw new Error('Xbox uplink changed while mixing was starting; retry when ready.')
      }
      // Retain the Xbox WebRTC transceiver and established session. No new SDP.
      await uplink.sender.replaceTrack(outputTrack)
      const mixed = new VoiceMixer(context, outputTrack, guestGain, outputAnalyser, output, uplink, fallback)
      mixed.hostSource = hostSource
      return mixed
    } catch (error) {
      await context.close().catch(() => undefined)
      throw error
    }
  }

  isAttached(): boolean {
    return !this.closed && this.sender.track === this.outputTrack
  }

  // Replace only the LOCAL capture source. The guest route and Xbox sender stay live.
  setHostTrack(track: MediaStreamTrack | null): void {
    if (this.closed) return
    this.hostSource?.disconnect()
    this.hostSource = null
    if (track?.readyState === 'live') {
      const source = this.context.createMediaStreamSource(new MediaStream([track]))
      source.connect(this.outputDestination)
      this.hostSource = source
    }
  }

  setGuestGain(value: number): void {
    if (!this.closed) this.gain.gain.value = value
  }

  // On exit, the caller handles releasing guest-only Xbox transport separately.
  // On an ordinary guest exit, restore the same live host microphone track.
  // If Xbox is stopping, disable the outgoing mixed track instead.
  async close(restoreHostMic: boolean): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.gain.gain.value = 0
    try {
      // Do not clobber a new sender track if the Xbox app has renegotiated.
      if (this.sender.track === this.outputTrack) {
        const original = this.original.readyState === 'live' ? this.original : this.fallback()
        await this.sender.replaceTrack(restoreHostMic && original?.readyState === 'live' ? original : null)
      }
    } catch (error) {
      console.warn('[CaptureLink:Voice] Could not restore Xbox mic sender:', error)
      // Do not let a stale mixed track keep broadcasting after a failure.
    } finally {
      this.outputTrack.stop()
      await this.context.close().catch(() => undefined)
    }
  }
}

export function installSharedVoice(options: SharedVoiceOptions): SharedVoiceController {
  const card = document.createElement('article')
  card.className = 'surface shared-voice-card'
  card.innerHTML = `
    <div class="shared-voice-heading">
      <div>
        <div class="eyebrow">EXPERIMENTAL · ONE GUEST</div>
        <h3>Shared Microphone</h3>
        <p>Let a friend speak through your Xbox game-chat uplink, and optionally watch or hear your Xbox gameplay. Controller access is always separate.</p>
      </div>
    </div>
    <p class="shared-voice-warning">Only share invites privately. Voice is broadcast through the host's Xbox account. Guests must explicitly join with their microphone. STUN-only V1 may not connect on restrictive networks.</p>
    <div class="sv-session-overview" aria-label="Voice session overview">
      <div class="sv-status-grid">
        <div><small>Connection</small><strong id="sv-host-connection">Not connected</strong></div>
        <div><small>Xbox broadcast</small><strong id="sv-host-xbox-state">Not active</strong></div>
        <div><small>Shared game media</small><strong id="sv-host-media-state">Off</strong></div>
      </div>
      <h4>Connected microphones</h4>
      <div class="sv-participant" id="sv-host-me"><span class="sv-participant-name">You · Host</span><span id="sv-host-me-note">Xbox mic off</span><progress id="sv-host-me-meter" max="100" value="0" aria-label="Host microphone activity"></progress></div>
      <div class="sv-participant" id="sv-host-friend"><span class="sv-participant-name">Friend · Guest</span><span id="sv-host-friend-note">Not connected</span><progress id="sv-host-friend-meter" max="100" value="0" aria-label="Guest microphone activity"></progress></div>
    </div>
    <div class="shared-voice-columns">
      <section class="shared-voice-role" aria-label="Host voice sharing">
        <h4>Host · Xbox player</h4>
        <p>Invite a friend without opening your own microphone. Authorize their Xbox voice forwarding separately below.</p>
        <label class="shared-voice-checkbox"><input id="sv-host-allow-guest" type="checkbox" /> Allow friend to speak through my Xbox (my microphone stays independently off)</label>
        <p class="sv-media-note">Permission applies only to this session. Your friend controls their own mute; you can revoke voice access at any time. Their voice uses your Xbox identity.</p>
        <button id="sv-host-start" type="button">Create voice invite</button>
        <label for="sv-host-offer">Invite to send privately</label>
        <textarea id="sv-host-offer" rows="3" readonly spellcheck="false"></textarea>
        <button id="sv-host-copy" type="button">Copy invite</button>
        <label for="sv-host-response">Paste friend's voice response</label>
        <textarea id="sv-host-response" rows="3" spellcheck="false" placeholder="CAPTURELINK-VOICE-V1:..."></textarea>
        <button id="sv-host-accept" type="button">Accept voice response</button>
        <div class="sv-section-heading">Media to friend <span>Off until you share it</span></div>
        <label class="shared-voice-checkbox"><input id="sv-host-share-audio" type="checkbox" /> Share Xbox game audio with friend</label>
        <label class="shared-voice-checkbox"><input id="sv-host-share-video" type="checkbox" /> Share Xbox gameplay video with friend</label>
        <p class="sv-media-note" id="sv-host-share-note">Shares Xbox game output, which may include other players' voice chat or private gameplay. No PC-wide sounds or controller access. Obtain consent before sharing.</p>
        <label class="shared-voice-checkbox"><input id="sv-host-monitor" type="checkbox" /> Hear friend's microphone locally (headphones recommended)</label>
        <label for="sv-host-volume">Friend's Xbox microphone volume <output id="sv-host-volume-label">100%</output></label>
        <input id="sv-host-volume" type="range" min="0" max="150" value="100" step="5" />
        <label class="shared-voice-checkbox"><input id="sv-host-mute" type="checkbox" /> Mute friend to Xbox</label>
        <div class="sv-section-heading">Audio path diagnostics <span>Local evidence, not proof of in-game audibility</span></div>
        <div class="sv-status-grid sv-diagnostics" aria-label="Host audio-path diagnostics">
          <div><small>Guest packets received</small><strong id="sv-host-rtp-in">Not measured</strong></div>
          <div><small>Xbox packets sent</small><strong id="sv-host-rtp-xbox">Not measured</strong></div>
          <div><small>Audio mixer</small><strong id="sv-host-mixer">Not attached</strong></div>
          <div><small>Mixed output level</small><strong id="sv-host-mix-level">Not measured</strong></div>
        </div>
        <button id="sv-host-retry-mix" type="button">Retry Xbox microphone mixing</button>
        <button id="sv-host-copy-diagnostics" type="button">Copy safe diagnostic report</button>
        <button id="sv-host-stop" type="button">End voice sharing</button>
        <p id="sv-host-status" role="status" aria-live="polite">Not sharing. Xbox microphone is not required to create an invite.</p>
      </section>
      <section class="shared-voice-role" aria-label="Join voice sharing">
        <h4>Friend · Voice guest</h4>
        <div class="sv-guest-overview" aria-label="Guest session status">
          <div class="sv-status-grid">
            <div><small>Connection</small><strong id="sv-guest-connection">Not connected</strong></div>
            <div><small>Your mic to host</small><strong id="sv-guest-mic-state">Off</strong></div>
            <div><small>Xbox broadcast</small><strong id="sv-guest-xbox-state">Unknown</strong></div>
          </div>
          <div class="sv-participant"><span class="sv-participant-name">You · Guest</span><span id="sv-guest-me-note">Not sharing</span><progress id="sv-guest-me-meter" max="100" value="0" aria-label="Guest microphone activity"></progress></div>
          <div class="sv-participant"><span class="sv-participant-name">Host</span><span id="sv-guest-host-note">No game media shared</span><progress id="sv-guest-host-meter" max="100" value="0" aria-label="Received game audio activity"></progress></div>
        </div>
        <p>Paste the host's invite, then choose Join. CaptureLink will request access to your selected microphone.</p>
        <label for="sv-guest-offer">Paste host invite</label>
        <textarea id="sv-guest-offer" rows="3" spellcheck="false" placeholder="CAPTURELINK-VOICE-V1:..."></textarea>
        <button id="sv-guest-join" type="button">Join with my microphone</button>
        <label for="sv-guest-answer">Response to send privately to host</label>
        <textarea id="sv-guest-answer" rows="3" readonly spellcheck="false"></textarea>
        <button id="sv-guest-copy" type="button">Copy response</button>
        <label class="shared-voice-checkbox"><input id="sv-guest-mute" type="checkbox" /> Mute my microphone to host</label>
        <div class="sv-section-heading">Receive host media <span>Controlled by host</span></div>
        <label class="shared-voice-checkbox"><input id="sv-guest-play-audio" type="checkbox" /> Play received Xbox game audio</label>
        <p id="sv-guest-media-status" class="sv-media-note">Waiting for host to share game audio or video. Video opens in CaptureLink's Stream view.</p>
        <div class="sv-section-heading">Audio path diagnostics <span>Sending packets does not prove Xbox audibility</span></div>
        <div class="sv-status-grid sv-diagnostics" aria-label="Guest audio-path diagnostics">
          <div><small>Microphone capture</small><strong id="sv-guest-track">Not active</strong></div>
          <div><small>Packets sent to host</small><strong id="sv-guest-rtp-out">Not measured</strong></div>
        </div>
        <button id="sv-guest-copy-diagnostics" type="button">Copy safe diagnostic report</button>
        <button id="sv-guest-leave" type="button">Leave voice session</button>
        <p id="sv-guest-status" role="status" aria-live="polite">Your mic is not shared. No Xbox account is needed for voice-only joining.</p>
      </section>
    </div>`
  const livePill = document.createElement('div')
  livePill.className = 'sv-live-pill'
  livePill.hidden = true
  livePill.setAttribute('role', 'status')
  livePill.setAttribute('aria-live', 'polite')
  options.statusContainer?.appendChild(livePill)
  const panel = options.audioPanel.querySelector('.audio-device-grid')
  if (!panel) throw new Error('CaptureLink audio device panel is missing.')
  panel.after(card)

  function get<T extends HTMLElement>(id: string): T {
    const el = card.querySelector<T>(`#${id}`)
    if (!el) throw new Error(`Shared microphone control missing: ${id}`)
    return el
  }
  const hStart = get<HTMLButtonElement>('sv-host-start')
  const hOffer = get<HTMLTextAreaElement>('sv-host-offer')
  const hCopy = get<HTMLButtonElement>('sv-host-copy')
  const hResponse = get<HTMLTextAreaElement>('sv-host-response')
  const hAccept = get<HTMLButtonElement>('sv-host-accept')
  const hStop = get<HTMLButtonElement>('sv-host-stop')
  const hStatus = get<HTMLElement>('sv-host-status')
  const hVolume = get<HTMLInputElement>('sv-host-volume')
  const hVolumeLabel = get<HTMLOutputElement>('sv-host-volume-label')
  const hMute = get<HTMLInputElement>('sv-host-mute')
  const hAllowGuest = get<HTMLInputElement>('sv-host-allow-guest')
  const gOffer = get<HTMLTextAreaElement>('sv-guest-offer')
  const gJoin = get<HTMLButtonElement>('sv-guest-join')
  const gAnswer = get<HTMLTextAreaElement>('sv-guest-answer')
  const gCopy = get<HTMLButtonElement>('sv-guest-copy')
  const gLeave = get<HTMLButtonElement>('sv-guest-leave')
  const gStatus = get<HTMLElement>('sv-guest-status')
  const hConnection = get<HTMLElement>('sv-host-connection')
  const hXboxState = get<HTMLElement>('sv-host-xbox-state')
  const hMediaState = get<HTMLElement>('sv-host-media-state')
  const hMeNote = get<HTMLElement>('sv-host-me-note')
  const hFriendNote = get<HTMLElement>('sv-host-friend-note')
  const hMeMeter = get<HTMLProgressElement>('sv-host-me-meter')
  const hFriendMeter = get<HTMLProgressElement>('sv-host-friend-meter')
  const hShareAudio = get<HTMLInputElement>('sv-host-share-audio')
  const hShareVideo = get<HTMLInputElement>('sv-host-share-video')
  const hShareNote = get<HTMLElement>('sv-host-share-note')
  const hMonitor = get<HTMLInputElement>('sv-host-monitor')
  const gConnection = get<HTMLElement>('sv-guest-connection')
  const gMicState = get<HTMLElement>('sv-guest-mic-state')
  const gXboxState = get<HTMLElement>('sv-guest-xbox-state')
  const gMeNote = get<HTMLElement>('sv-guest-me-note')
  const gHostNote = get<HTMLElement>('sv-guest-host-note')
  const gMeMeter = get<HTMLProgressElement>('sv-guest-me-meter')
  const gHostMeter = get<HTMLProgressElement>('sv-guest-host-meter')
  const gMute = get<HTMLInputElement>('sv-guest-mute')
  const gPlayAudio = get<HTMLInputElement>('sv-guest-play-audio')
  const gMediaStatus = get<HTMLElement>('sv-guest-media-status')
  const hRtpIn = get<HTMLElement>('sv-host-rtp-in')
  const hRtpXbox = get<HTMLElement>('sv-host-rtp-xbox')
  const hMixerState = get<HTMLElement>('sv-host-mixer')
  const hMixerLevel = get<HTMLElement>('sv-host-mix-level')
  const gLocalTrack = get<HTMLElement>('sv-guest-track')
  const gRtpOut = get<HTMLElement>('sv-guest-rtp-out')
  const hRetryMix = get<HTMLButtonElement>('sv-host-retry-mix')
  const hCopyDiagnostics = get<HTMLButtonElement>('sv-host-copy-diagnostics')
  const gCopyDiagnostics = get<HTMLButtonElement>('sv-guest-copy-diagnostics')

  let host: RoleSession | null = null
  let guest: RoleSession | null = null
  let hostBusy = false
  let guestBusy = false
  let disposed = false
  let epoch = 0
  let guestEpoch = 0
  let hostDisconnectTimer: number | null = null
  let guestDisconnectTimer: number | null = null
  let muted = false
  let guestActivationBusy = false
  let guestHostState: {
    xbox: boolean; audio: boolean; video: boolean; muted: boolean
    xboxRtp?: AudioPathSample['state']
  } | null = null
  const rtpStats = new AudioPathStats()
  const unavailable: AudioPathSample = {
    state: 'unavailable', packetsDelta: null, bytesDelta: null, audioLevel: null
  }
  let hostInbound: AudioPathSample = unavailable
  let xboxOutbound: AudioPathSample = unavailable
  let guestOutbound: AudioPathSample = unavailable
  let statsBusy = false
  const monitor = document.createElement('audio')
  monitor.autoplay = false
  monitor.muted = true
  monitor.hidden = true
  card.appendChild(monitor)
  // Meters are read-only and are never connected to the audio destination.
  const meters = new Map<string, { context: AudioContext; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer>; track: MediaStreamTrack }>()
  function sampleMeter(key: string, track: MediaStreamTrack | null, element: HTMLProgressElement): void {
    if (!track || track.readyState !== 'live') {
      const old = meters.get(key)
      if (old) { meters.delete(key); void old.context.close().catch(() => undefined) }
      element.value = 0
      return
    }
    let meter = meters.get(key)
    if (!meter || meter.track !== track) {
      if (meter) void meter.context.close().catch(() => undefined)
      try {
        const context = new AudioContext({ latencyHint: 'interactive' })
        const source = context.createMediaStreamSource(new MediaStream([track]))
        const analyser = context.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser) // DO NOT connect to speakers or mic sender.
        meter = { context, analyser, data: new Uint8Array(new ArrayBuffer(analyser.fftSize)), track }
        meters.set(key, meter)
        void context.resume().catch(() => undefined)
      } catch {
        element.value = 0
        return
      }
    }
    meter.analyser.getByteTimeDomainData(meter.data)
    let energy = 0
    for (const sample of meter.data) { const delta = (sample - 128) / 128; energy += delta * delta }
    const rms = Math.sqrt(energy / meter.data.length)
    element.value = Math.min(100, Math.round(rms * 260))
  }
  function sendHostState(): void {
    if (!host || host.control?.readyState !== 'open') return
    const payload = JSON.stringify({
      type: 'status',
      xbox: !!host.mixed?.isAttached() && host.mixed.getContextState() === 'running',
      xboxRtp: xboxOutbound.state,
      audio: !!host.lastGameAudio,
      video: !!host.lastGameVideo,
      muted: muted || !hAllowGuest.checked
    })
    if (host.lastHostStatusPayload === payload) return
    try {
      host.control.send(payload)
      host.lastHostStatusPayload = payload
    } catch { /* Remote connection closed while state changed. */ }
  }
  // The offer reserves media directions up front. Changing sources later does not
  // require changing the Xbox SDP or repeating the two-code voice handshake.
  async function updateHostGameMedia(session: RoleSession): Promise<void> {
    if (session !== host || session.gameMediaBusy || !session.gameAudioSender || !session.gameVideoSender ||
        session.peer.connectionState !== 'connected') return
    session.gameMediaBusy = true
    try {
      const media = options.getHostGameMediaStream?.() ?? null
      const audio = hShareAudio.checked ? media?.getAudioTracks().find(t => t.readyState === 'live') ?? null : null
      const video = hShareVideo.checked ? media?.getVideoTracks().find(t => t.readyState === 'live') ?? null : null
      if (session.lastGameAudio !== audio) {
        await session.gameAudioSender.replaceTrack(audio)
        session.lastGameAudio = audio
      }
      if (session.lastGameVideo !== video) {
        await session.gameVideoSender.replaceTrack(video)
        session.lastGameVideo = video
      }
      hShareNote.textContent = !media && (hShareAudio.checked || hShareVideo.checked)
        ? 'Waiting for Xbox gameplay media. The friend will receive nothing until the stream is available.'
        : 'Only the checked game media is shared. Controller access is never granted.'
      sendHostState()
    } catch (error) {
      hShareNote.textContent = `Could not update friend media: ${String(error)}`
      console.warn('[CaptureLink:Voice] Guest media sharing failed:', error)
    } finally { session.gameMediaBusy = false }
    updateDashboard()
  }
  // Some WebRTC implementations can leave getStats unresolved during teardown.
  // Bound diagnostic sampling so the panel can recover instead of freezing.
  async function boundedStats(
    target: RTCPeerConnection | RTCRtpSender | null | undefined
  ): Promise<RTCStatsReport | null> {
    if (!target || typeof target.getStats !== 'function') return null
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        target.getStats(),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1200) })
      ])
    } catch {
      return null
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  // Collect only aggregate RTP counters. Never expose ICE/SDP, device labels,
  // SSRCs, addresses, or any microphone recordings in diagnostic reports.
  async function pollAudioPath(): Promise<void> {
    if (disposed || statsBusy) return
    statsBusy = true
    const currentHost = host
    const currentGuest = guest
    try {
      if (currentHost) {
        const hostReport = await boundedStats(currentHost.peer)
        if (host !== currentHost) return
        hostInbound = rtpStats.read('host-in', hostReport, 'inbound')
        const sender = currentHost.mixed?.getXboxSender() ?? options.getXboxUplink()?.sender
        const senderReport = await boundedStats(sender)
        if (host !== currentHost) return
        xboxOutbound = rtpStats.read('xbox-out', senderReport, 'outbound')
      } else {
        hostInbound = unavailable
        xboxOutbound = unavailable
      }
      if (currentGuest) {
        const guestReport = await boundedStats(currentGuest.peer)
        if (guest !== currentGuest) return
        guestOutbound = rtpStats.read('guest-out', guestReport, 'outbound')
      } else guestOutbound = unavailable
    } catch {
      // A failed poll must never change connection or sharing state.
      if (host === currentHost) { hostInbound = unavailable; xboxOutbound = unavailable }
      if (guest === currentGuest) guestOutbound = unavailable
    } finally {
      statsBusy = false
      if (!disposed) updateDashboard()
    }
  }

  function updateDashboard(): void {
    if (disposed) return
    const hostConnected = host?.peer.connectionState === 'connected'
    const guestConnected = guest?.peer.connectionState === 'connected'
    livePill.hidden = !(host || guest)
    livePill.textContent = host ? (hostConnected
      ? `Shared Session · Guest connected · ${
          host.mixed?.isAttached() ? 'Xbox mixer attached (audibility unverified)' : 'Xbox guest mic off'
        }`
      : 'Shared Session · Waiting for guest') : guest ? (guestConnected
      ? `Shared Session · Connected to host · ${
          guestHostState?.xbox ? 'Host reports Xbox mixer attached' : 'Xbox forwarding off'
        }`
      : 'Shared Session · Connecting to host') : ''
    hConnection.textContent = hostConnected ? 'Connected · 2 people' : host ? 'Connecting / waiting' : 'Not connected'
    hXboxState.textContent = host?.mixed?.isAttached()
      ? 'Mix attached · verify with listener' : 'Not broadcasting guest'
    hMediaState.textContent = host?.lastGameAudio || host?.lastGameVideo
      ? `${host.lastGameAudio ? 'Audio' : ''}${host.lastGameAudio && host.lastGameVideo ? ' + ' : ''}${host.lastGameVideo ? 'Video' : ''} shared`
      : 'Off'
    hMeNote.textContent = options.getHostMicrophoneTrack?.()?.readyState === 'live' ? 'Your mic enabled' : 'Your mic off'
    hFriendNote.textContent = hostConnected ? (!hAllowGuest.checked ? 'Xbox voice blocked by host' : muted ? 'Muted by host' : 'Connected to host') : 'Not connected'
    gConnection.textContent = guestConnected ? 'Connected to host' : guest ? 'Connecting / waiting' : 'Not connected'
    gMicState.textContent = guestConnected && guest?.media?.getAudioTracks()[0]?.enabled
      ? (guestOutbound.state === 'packets-moving' ? 'Sending RTP' : 'Mic enabled · checking RTP')
      : 'Not transmitting'
    gXboxState.textContent = !guestConnected ? 'Unknown'
      : guestHostState?.xboxRtp === 'packets-moving' && guestHostState?.xbox
        ? 'Host reports Xbox RTP sending · verify in game'
        : guestHostState?.xbox ? 'Host says mix attached'
          : 'Not broadcasting'
    gMeNote.textContent = gMute.checked ? 'Muted by you' : guestConnected && guestHostState?.muted ? 'Muted by host' : guestConnected ? 'Sent to host' : 'Not connected'
    const receivingAudio = guest?.receiving?.getAudioTracks().some(t => t.readyState === 'live' && !t.muted)
    const receivingVideo = guest?.receiving?.getVideoTracks().some(t => t.readyState === 'live' && !t.muted)
    gHostNote.textContent = receivingAudio || receivingVideo
      ? `Receiving ${receivingAudio ? 'audio' : ''}${receivingAudio && receivingVideo ? ' + ' : ''}${receivingVideo ? 'video' : ''}`
      : guestHostState?.audio || guestHostState?.video ? 'Host sharing · waiting for media' : 'No game media shared'
    hRtpIn.textContent = formatAudioPathSample(hostInbound)
    hRtpXbox.textContent = formatAudioPathSample(xboxOutbound)
    hMixerState.textContent = host?.mixed?.isAttached()
      ? `Attached · ${host.mixed.getContextState()}` : host?.mixBusy ? 'Starting…' : 'Not attached'
    const mixedLevel = host?.mixed?.getOutputLevel() ?? null
    hMixerLevel.textContent = mixedLevel === null
      ? 'Not measured' : `${(mixedLevel * 100).toFixed(1)}% (RMS)`
    hRetryMix.disabled = !host || !host.remoteAudio || !hAllowGuest.checked || host.mixBusy
    const localTrack = guest?.media?.getAudioTracks()[0]
    gLocalTrack.textContent = !localTrack ? 'Not active'
      : localTrack.readyState !== 'live' ? 'Stopped'
        : !localTrack.enabled ? 'Muted by you'
          : localTrack.muted ? 'No input samples' : 'Live'
    gRtpOut.textContent = formatAudioPathSample(guestOutbound)
    sampleMeter('host', host ? options.getHostMicrophoneTrack?.() ?? null : null, hMeMeter)
    sampleMeter('friend', host?.remoteAudio?.getAudioTracks()[0] ?? null, hFriendMeter)
    sampleMeter('guest', guest?.media?.getAudioTracks()[0] ?? null, gMeMeter)
    sampleMeter('guest-game', guest?.receiving?.getAudioTracks()[0] ?? null, gHostMeter)
  }
  const dashboardTimer = window.setInterval(() => {
    updateDashboard()
    void pollAudioPath()
    if (host) {
      sendHostState()
      void updateHostGameMedia(host)
    }
  }, 700)

  function guestGain(): number {
    return muted ? 0 : Number(hVolume.value) / 100
  }
  function redraw(): void {
    hStart.disabled = hostBusy || !!host || disposed
    hAccept.disabled = hostBusy || !host || !!host.peer.currentRemoteDescription || disposed
    hCopy.disabled = !hOffer.value || disposed
    hStop.disabled = !host || disposed
    hAllowGuest.disabled = !host || disposed
    gJoin.disabled = guestBusy || !!guest || disposed
    gCopy.disabled = !gAnswer.value || disposed
    gLeave.disabled = !guest || disposed
    hVolumeLabel.value = `${hVolume.value}%`
    updateDashboard()
  }
  function hostMessage(message: string): void { hStatus.textContent = message }
  function guestMessage(message: string): void { gStatus.textContent = message }

  function stopHost(restoreHostMic = true): void {
    if (hostDisconnectTimer !== null) {
      window.clearTimeout(hostDisconnectTimer)
      hostDisconnectTimer = null
    }
    ++epoch
    hostBusy = false
    const old = host
    host = null
    rtpStats.reset('host-in')
    rtpStats.reset('xbox-out')
    hostInbound = unavailable
    xboxOutbound = unavailable
    hOffer.value = ''
    hResponse.value = ''
    monitor.pause()
    monitor.srcObject = null
    hAllowGuest.checked = false
    hShareAudio.checked = false
    hShareVideo.checked = false
    hMonitor.checked = false
    monitor.muted = true
    if (old) {
      old.restoreOnStop = restoreHostMic
      old.mixEpoch++
      old.remoteAudio = null
      old.peer.ontrack = null
      old.peer.onconnectionstatechange = null
      if (old.control?.readyState === 'open') {
        try { old.control.send('end') } catch { /* Already closing */ }
      }
      old.control?.close()
      old.peer.close()
      old.mixed?.setGuestGain(0)
      // Keep the UI and connection teardown synchronous. Track restoration can finish asynchronously.
      void (async () => {
        if (old.mixed) await old.mixed.close(restoreHostMic)
        if (!host) await options.onHostSessionEnded?.()
      })().catch(error => console.warn('[CaptureLink:Voice] Guest uplink cleanup:', error))
    }
    hostMessage('Voice sharing ended. Guest permission revoked; Xbox uplink is being restored.')
    redraw()
  }

  function stopGuest(): void {
    if (guestDisconnectTimer !== null) {
      window.clearTimeout(guestDisconnectTimer)
      guestDisconnectTimer = null
    }
    ++guestEpoch
    guestBusy = false
    const old = guest
    guest = null
    rtpStats.reset('guest-out')
    guestOutbound = unavailable
    gAnswer.value = ''
    guestHostState = null
    gPlayAudio.checked = false
    gMute.checked = false
    if (old?.silentGuestContext) void old.silentGuestContext.close().catch(() => undefined)
    options.onGuestMediaStopped?.()
    if (old) {
      old.peer.onconnectionstatechange = null
      old.control?.close()
      old.peer.close()
      old.media?.getTracks().forEach(track => track.stop())
    }
    guestMessage('Left session. Your microphone is no longer shared.')
    redraw()
  }

  async function activateGuestUplink(session: RoleSession): Promise<void> {
    if (host !== session || disposed || guestActivationBusy || !hAllowGuest.checked ||
        !session.remoteAudio || session.peer.connectionState !== 'connected') return
    if (options.getXboxUplink()) { tryAttachGuestToXbox(session); return }
    if (!options.ensureGuestXboxUplink) return
    guestActivationBusy = true
    hostMessage('Preparing an Xbox voice uplink without opening your microphone…')
    try {
      const ready = await options.ensureGuestXboxUplink()
      if (host === session && ready && hAllowGuest.checked) tryAttachGuestToXbox(session)
      else if (host === session && !ready) hostMessage('Xbox uplink not ready. Check Xbox connection and retry.')
    } catch (error) {
      if (host === session) hostMessage(`Could not enable guest-only Xbox voice: ${String(error)}`)
    } finally {
      guestActivationBusy = false
      updateDashboard()
    }
  }

  function tryAttachGuestToXbox(session: RoleSession): void {
    if (host !== session || disposed || session.mixBusy || session.mixed || !session.remoteAudio || !hAllowGuest.checked) return
    const uplink = options.getXboxUplink()
    if (!uplink || uplink.track.readyState !== 'live') {
      hostMessage(session.peer.connectionState === 'connected'
        ? 'Friend connected. Authorize guest Xbox voice to activate the uplink without your microphone.'
        : 'Friend audio negotiated. Waiting for peer connection; you can enable Xbox microphone later.')
      return
    }
    const requestedEpoch = session.mixEpoch
    session.mixBusy = true
    void VoiceMixer.create(
      uplink, session.remoteAudio, hAllowGuest.checked ? guestGain() : 0,
      () => host === session && !disposed && requestedEpoch === session.mixEpoch,
      () => options.getGuestFallbackTrack?.() ?? null
    ).then(mixed => {
        if (host !== session || disposed || requestedEpoch !== session.mixEpoch ||
            !mixed.isAttached() || uplink.track.readyState !== 'live') {
          // The sender now holds the *mixed* track, so querying the original
          // mic-to-sender mapping here would incorrectly return null.
          const restore = host !== session && session.restoreOnStop &&
            uplink.track.readyState === 'live'
          void mixed.close(restore)
          return
        }
        session.mixed = mixed
        mixed.setHostTrack(options.getHostMicrophoneTrack?.() ?? null)
        mixed.setGuestGain(hAllowGuest.checked ? guestGain() : 0)
        hostMessage('Mixed microphone is attached to Xbox sender. Confirm reception with an independent in-game listener.')
        sendHostState()
      })
      .catch(error => {
        if (host === session && requestedEpoch === session.mixEpoch) {
          hostMessage(`Friend is still connected, but Xbox mixing failed: ${String(error)}`)
        }
      })
      .finally(() => {
        session.mixBusy = false
        // If the Xbox microphone changed while mixing was in flight, retry only
        // for that new generation, never indefinitely after an actual failure.
        if (host === session && requestedEpoch !== session.mixEpoch) tryAttachGuestToXbox(session)
      })
  }

  function monitorHost(session: RoleSession): void {
    session.peer.onconnectionstatechange = () => {
      if (host !== session) return
      const state = session.peer.connectionState
      if (state === 'connected') {
        if (session.control) {
          session.control.onopen = () => sendHostState()
        }
        sendHostState()
        void updateHostGameMedia(session)
        if (hostDisconnectTimer !== null) window.clearTimeout(hostDisconnectTimer)
        hostDisconnectTimer = null
        if (session.mixed) {
          hostMessage('Friend connected; voice mixer attached to Xbox microphone.')
        } else {
          hostMessage('Friend connected. Waiting for guest Xbox voice authorization or uplink.')
          void activateGuestUplink(session)
        }
      } else if (state === 'failed' || state === 'closed') stopHost()
      else if (state === 'disconnected') {
        hostMessage('Friend connection interrupted. Ending if it does not recover…')
        if (hostDisconnectTimer !== null) window.clearTimeout(hostDisconnectTimer)
        hostDisconnectTimer = window.setTimeout(() => {
          if (host === session && session.peer.connectionState === 'disconnected') stopHost()
        }, 10_000)
      }
    }
    session.peer.ontrack = (event: RTCTrackEvent) => {
      if (host !== session || event.track.kind !== 'audio') return
      session.remoteAudio = event.streams[0] ?? new MediaStream([event.track])
      monitor.srcObject = session.remoteAudio
      if (hMonitor.checked) void monitor.play().catch(err => hostMessage(`Friend monitoring unavailable: ${String(err)}`))
      void activateGuestUplink(session)
      event.track.addEventListener('ended', () => {
        if (host === session) stopHost()
      }, { once: true })
    }
  }

  // UX2 exposes the same underlying peer operations to the unified coordinator.
  // The legacy buttons call these functions too, so there is only one transport implementation.
  async function createUnifiedHostOffer(): Promise<string> {
    if (hostBusy || host || disposed) throw new Error('A voice invitation is already active.')
    const currentEpoch = ++epoch
    hostBusy = true
    hostMessage('Discovering network candidates for your private invite…')
    redraw()
    hAllowGuest.checked = false
    const session: RoleSession = {
      id: crypto.randomUUID(), peer: newVoicePeer(), media: null, mixed: null,
      remoteAudio: null, mixBusy: false, mixEpoch: 0, restoreOnStop: true, control: null
    }
    session.control = session.peer.createDataChannel('voice-lifecycle', { ordered: true })
    session.control.onopen = () => sendHostState()
    host = session
    monitorHost(session)
    session.gameAudioSender = session.peer.addTransceiver('audio', { direction: 'sendrecv' }).sender
    session.gameVideoSender = session.peer.addTransceiver('video', { direction: 'sendonly' }).sender
    try {
      await session.peer.setLocalDescription(await session.peer.createOffer())
      const ice = await gatherVoiceIceSnapshot(session.peer)
      if (host !== session || currentEpoch !== epoch) throw new Error('Voice invitation cancelled.')
      const result = encodeVoiceSignal({ version: 1, type: 'offer', id: session.id, sdp: ice.sdp })
      hOffer.value = result
      const localOnly = !ice.candidateTypes.includes('srflx') && !ice.candidateTypes.includes('relay')
      hostMessage(localOnly
        ? 'Invite ready with local-network candidates only. It may fail across different networks without a TURN relay. Xbox mic is optional.'
        : 'Invite ready. Send it privately and paste the friend response. You can enable Xbox mic later.')
      return result
    } catch (error) {
      if (host === session) stopHost()
      hostMessage(`Could not create voice invite: ${String(error)}`)
      throw error
    } finally {
      if (currentEpoch === epoch) hostBusy = false
      redraw()
    }
  }

  async function acceptUnifiedGuestAnswer(wire: string): Promise<void> {
    if (hostBusy || !host || disposed) throw new Error('Create a voice invitation first.')
    const session = host
    hostBusy = true
    redraw()
    try {
      const response = decodeVoiceSignal(wire)
      if (response.type !== 'answer' || response.id !== session.id) {
        throw new Error('Response does not belong to this voice invitation.')
      }
      await session.peer.setRemoteDescription({ type: 'answer', sdp: response.sdp })
      hostMessage('Voice response accepted. Waiting for peer connection and Xbox forwarding diagnostics.')
      updateDashboard()
    } catch (error) {
      hostMessage(`Could not accept voice response: ${String(error)}`)
      throw error
    } finally {
      if (host === session) hostBusy = false
      redraw()
    }
  }

  async function joinUnifiedHostOffer(wire: string, allowMicrophone: boolean, playGameAudio = false): Promise<string> {
    if (guestBusy || guest || disposed) throw new Error('A guest voice connection already exists.')
    const invite = decodeVoiceSignal(wire)
    if (invite.type !== 'offer') throw new Error('Expected a host voice invitation.')
    if (options.canJoinAsGuest && !options.canJoinAsGuest()) throw new Error('Disconnect your own Xbox session before joining a host.')
    guestBusy = true
    guestHostState = null
    gPlayAudio.checked = playGameAudio
    const currentEpoch = ++guestEpoch
    guestMessage(allowMicrophone ? 'Requesting your microphone…' : 'Joining as a watch-only guest without opening your microphone…')
    redraw()
    const session: RoleSession = {
      id: invite.id, peer: newVoicePeer(), media: null, mixed: null,
      remoteAudio: null, mixBusy: false, mixEpoch: 0, restoreOnStop: true, control: null
    }
    guest = session
    session.peer.ondatachannel = event => {
      if (event.channel.label !== 'voice-lifecycle') {
        event.channel.close()
        return
      }
      session.control = event.channel
      event.channel.onmessage = message => {
        if (guest !== session) return
        if (message.data === 'end') { stopGuest(); return }
        try {
          if (typeof message.data !== 'string' || message.data.length > 2048) return
          const state: unknown = JSON.parse(message.data)
          if (state && typeof state === 'object' && 'type' in state && state.type === 'status' &&
              'xbox' in state && typeof state.xbox === 'boolean' &&
              'audio' in state && typeof state.audio === 'boolean' &&
              'video' in state && typeof state.video === 'boolean' &&
              'muted' in state && typeof state.muted === 'boolean') {
            const xboxRtp = 'xboxRtp' in state &&
              (state.xboxRtp === 'packets-moving' || state.xboxRtp === 'no-new-packets' ||
               state.xboxRtp === 'sampling' || state.xboxRtp === 'unavailable')
              ? state.xboxRtp : null
            guestHostState = {
              xbox: state.xbox, audio: state.audio, video: state.video, muted: state.muted,
              ...(xboxRtp !== null ? { xboxRtp } : {})
            }
            updateDashboard()
            gMediaStatus.textContent = state.audio || state.video
              ? 'Host has enabled game media. Audio playback requires your Play audio checkbox; video appears in Stream.'
              : 'Host is not sharing game audio or video.'
          }
        } catch { /* Ignore malformed state messages. */ }
      }
    }
    session.receiving = new MediaStream()
    session.peer.ontrack = event => {
      if (guest !== session || !session.receiving) return
      const receiving = session.receiving
      if (!receiving.getTracks().includes(event.track)) receiving.addTrack(event.track)
      const update = () => {
        if (guest !== session) return
        options.onGuestMediaStream?.(receiving, gPlayAudio.checked)
        updateDashboard()
      }
      event.track.addEventListener('unmute', update)
      event.track.addEventListener('mute', update)
      event.track.addEventListener('ended', update)
      update()
    }
    session.peer.onconnectionstatechange = () => {
      if (guest !== session) return
      const state = session.peer.connectionState
      if (state === 'connected') {
        if (guestDisconnectTimer !== null) window.clearTimeout(guestDisconnectTimer)
        guestDisconnectTimer = null
        guestMessage('Connected to host. Your mic is available to the host; Xbox forwarding is displayed separately and still needs in-game verification.')
        updateDashboard()
      } else if (state === 'failed' || state === 'closed') stopGuest()
      else if (state === 'disconnected') {
        guestMessage('Connection interrupted. Microphone will stop if it does not recover…')
        if (guestDisconnectTimer !== null) window.clearTimeout(guestDisconnectTimer)
        guestDisconnectTimer = window.setTimeout(() => {
          if (guest === session && session.peer.connectionState === 'disconnected') stopGuest()
        }, 10_000)
      }
    }
    try {
      await session.peer.setRemoteDescription({ type: 'offer', sdp: invite.sdp })
      let media: MediaStream
      if (allowMicrophone) {
        media = await navigator.mediaDevices.getUserMedia({
          audio: options.getGuestMicrophoneConstraints(), video: false
        })
      } else {
        // Watch-only sessions negotiate a silent sender; never open the user's microphone.
        const context = new AudioContext({ latencyHint: 'interactive' })
        session.silentGuestContext = context
        const track = context.createMediaStreamDestination().stream.getAudioTracks()[0]
        if (!track) throw new Error('Could not initialize watch-only audio transport.')
        media = new MediaStream([track])
      }
      if (guest !== session || currentEpoch !== guestEpoch || disposed) {
        media.getTracks().forEach(track => track.stop())
        throw new Error('Guest invitation cancelled.')
      }
      session.media = media
      const track = media.getAudioTracks()[0]
      if (!track) throw new Error('No audio track available for signaling.')
      track.enabled = allowMicrophone && !gMute.checked
      session.peer.addTrack(track, media)
      await session.peer.setLocalDescription(await session.peer.createAnswer())
      const ice = await gatherVoiceIceSnapshot(session.peer)
      if (guest !== session || currentEpoch !== guestEpoch) throw new Error('Guest invitation cancelled.')
      const result = encodeVoiceSignal({ version: 1, type: 'answer', id: session.id, sdp: ice.sdp })
      gAnswer.value = result
      const localOnly = !ice.candidateTypes.includes('srflx') && !ice.candidateTypes.includes('relay')
      guestMessage(localOnly
        ? 'Response ready with local-only candidates. Send privately; a different network may need a TURN relay.'
        : 'Response ready. Copy privately to host. Host controls Xbox broadcasting.')
      return result
    } catch (error) {
      if (guest === session) stopGuest()
      guestMessage(`Could not join voice/media: ${String(error)}`)
      throw error
    } finally {
      if (currentEpoch === guestEpoch) guestBusy = false
      redraw()
    }
  }

  function setUnifiedHostPermissions(permissions: { voice: boolean; watch: boolean }): void {
    if (!host) throw new Error('No host voice session is active.')
    hAllowGuest.checked = permissions.voice
    hShareAudio.checked = permissions.watch
    hShareVideo.checked = permissions.watch
    hAllowGuest.dispatchEvent(new Event('change', { bubbles: true }))
    hShareAudio.dispatchEvent(new Event('change', { bubbles: true }))
    hShareVideo.dispatchEvent(new Event('change', { bubbles: true }))
  }

  hStart.addEventListener('click', () => { void createUnifiedHostOffer().catch(() => undefined) })
  hAccept.addEventListener('click', () => { void acceptUnifiedGuestAnswer(hResponse.value).catch(() => undefined) })
  gJoin.addEventListener('click', () => { void joinUnifiedHostOffer(gOffer.value, true).catch(() => undefined) })

  hCopy.addEventListener('click', () => {
    void navigator.clipboard.writeText(hOffer.value).catch(err => hostMessage(`Clipboard unavailable: ${String(err)}`))
  })
  gCopy.addEventListener('click', () => {
    void navigator.clipboard.writeText(gAnswer.value).catch(err => guestMessage(`Clipboard unavailable: ${String(err)}`))
  })
  hShareAudio.addEventListener('change', () => { if (host) void updateHostGameMedia(host); updateDashboard() })
  hShareVideo.addEventListener('change', () => { if (host) void updateHostGameMedia(host); updateDashboard() })
  hMonitor.addEventListener('change', () => {
    monitor.muted = !hMonitor.checked
    if (hMonitor.checked && host?.remoteAudio) {
      void monitor.play().catch(error => hostMessage(`Could not play friend's microphone: ${String(error)}`))
    } else monitor.pause()
  })
  gMute.addEventListener('change', () => {
    const track = guest?.media?.getAudioTracks()[0]
    if (track) track.enabled = !gMute.checked
    updateDashboard()
  })
  gPlayAudio.addEventListener('change', () => {
    if (guest?.receiving) options.onGuestMediaStream?.(guest.receiving, gPlayAudio.checked)
    updateDashboard()
  })
  hRetryMix.addEventListener('click', () => {
    const session = host
    if (!session || !session.remoteAudio) return
    ++session.mixEpoch
    const previous = session.mixed
    session.mixed = null
    hostMessage('Retrying Xbox microphone mix. This does not resend an invitation.')
    sendHostState()
    if (previous) {
      previous.setGuestGain(0)
      void previous.close(true).then(() => {
        if (host === session) void activateGuestUplink(session)
      })
    } else void activateGuestUplink(session)
  })
  function trackState(track: MediaStreamTrack | null | undefined): string {
    if (!track) return 'absent'
    if (track.readyState !== 'live') return 'ended'
    if (!track.enabled) return 'disabled'
    return track.muted ? 'muted-by-source' : 'live'
  }
  function safeReport(side: 'host' | 'guest'): string {
    const session = side === 'host' ? host : guest
    const friendTrack = host?.remoteAudio?.getAudioTracks()[0]
    const guestTrack = guest?.media?.getAudioTracks()[0]
    const report = {
      schema: 'CaptureLink.SharedAudioDiagnostics/1',
      side,
      peerConnectionState: session?.peer.connectionState ?? 'none',
      microphoneTrackState: trackState(side === 'host' ? options.getHostMicrophoneTrack?.() : guestTrack),
      guestReceivedTrackState: side === 'host' ? trackState(friendTrack) : 'not-applicable',
      guestMutedLocally: side === 'guest' ? gMute.checked : null,
      guestMutedByHost: side === 'host' ? muted : guestHostState?.muted ?? null,
      xboxMixerAttached: side === 'host'
        ? !!host?.mixed?.isAttached() : guestHostState?.xbox ?? null,
      mixerAudioContext: side === 'host' ? host?.mixed?.getContextState() ?? 'none' : 'not-applicable',
      mixedOutputRms: side === 'host' ? host?.mixed?.getOutputLevel() ?? null : null,
      gameAudioShared: side === 'host' ? !!host?.lastGameAudio : guestHostState?.audio ?? null,
      gameVideoShared: side === 'host' ? !!host?.lastGameVideo : guestHostState?.video ?? null,
      guestOutboundRtp: side === 'guest' ? guestOutbound : null,
      guestInboundRtp: side === 'host' ? hostInbound : null,
      xboxOutboundRtp: side === 'host' ? xboxOutbound : null,
      limitation: 'Packet counts and sender attachment do not prove the guest is audible in Xbox game chat.'
    }
    return JSON.stringify(report, null, 2)
  }
  hCopyDiagnostics.addEventListener('click', () => {
    if (!navigator.clipboard?.writeText) {
      hostMessage('Clipboard is unavailable on this device.')
      return
    }
    void navigator.clipboard.writeText(safeReport('host')).then(
      () => hostMessage('Safe host diagnostic report copied. No SDP, ICE, device labels, or audio included.'),
      () => hostMessage('Could not copy report. Clipboard permission may be blocked.')
    )
  })
  gCopyDiagnostics.addEventListener('click', () => {
    if (!navigator.clipboard?.writeText) {
      guestMessage('Clipboard is unavailable on this device.')
      return
    }
    void navigator.clipboard.writeText(safeReport('guest')).then(
      () => guestMessage('Safe guest diagnostic report copied. No SDP, ICE, device labels, or audio included.'),
      () => guestMessage('Could not copy report. Clipboard permission may be blocked.')
    )
  })
  hStop.addEventListener('click', () => stopHost())
  gLeave.addEventListener('click', () => stopGuest())
  hVolume.addEventListener('input', () => {
    host?.mixed?.setGuestGain(hAllowGuest.checked ? guestGain() : 0)
    redraw()
  })
  hAllowGuest.addEventListener('change', () => {
    if (!host) { hAllowGuest.checked = false; return }
    host.mixed?.setGuestGain(hAllowGuest.checked ? guestGain() : 0)
    if (hAllowGuest.checked) void activateGuestUplink(host)
    else {
      host.mixEpoch += host.mixBusy ? 1 : 0
      hostMessage('Friend Xbox voice access revoked. Your own microphone is unaffected.')
    }
    sendHostState()
    updateDashboard()
  })
  hMute.addEventListener('change', () => {
    muted = hMute.checked
    host?.mixed?.setGuestGain(hAllowGuest.checked ? guestGain() : 0)
    sendHostState()
    updateDashboard()
  })

  redraw()
  return {
    createUnifiedHostOffer,
    acceptUnifiedGuestAnswer,
    joinUnifiedHostOffer,
    setUnifiedHostPermissions,
    stopUnified() { stopHost(); stopGuest() },
    onXboxMicrophoneStopped() {
      if (!host) return
      host.restoreOnStop = false
      host.mixEpoch++
      const mixed = host.mixed
      host.mixed = null
      if (mixed) {
        mixed.setGuestGain(0)
        void mixed.close(false)
      }
      hostMessage('Xbox voice uplink stopped; friend remains connected.')
      sendHostState()
      updateDashboard()
    },
    hasActiveGuestMix() { return !!host?.mixed?.isAttached() },
    onXboxSessionConnected() { if (host) void activateGuestUplink(host) },
    onHostMicrophoneChanged(track) {
      host?.mixed?.setHostTrack(track)
      if (host && track && !host.mixed) void activateGuestUplink(host)
      sendHostState()
      updateDashboard()
    },
    onXboxMicrophoneStarted() {
      if (host) {
        host.restoreOnStop = true
        if (hAllowGuest.checked) tryAttachGuestToXbox(host)
        sendHostState()
        updateDashboard()
      }
    },
    dispose() {
      if (disposed) return
      stopHost(false)
      stopGuest()
      disposed = true
      window.clearInterval(dashboardTimer)
      for (const meter of meters.values()) void meter.context.close().catch(() => undefined)
      meters.clear()
      monitor.pause()
      monitor.srcObject = null
      livePill.remove()
      card.remove()
    }
  }
}
