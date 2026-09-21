import {
  FRIEND_PROTOCOL_VERSION,
  parseFriendMessage,
  serializeFriendMessage,
  type FriendGamepadState,
  type FriendWireMessage
} from './protocol'

const CONTROLLER_CHANNEL =
  'capturelink-friend-controller-v1'

const GAMEPAD_SAMPLE_INTERVAL_MS = 16
const ICE_GATHER_TIMEOUT_MS = 10_000

// Competitive gameplay mode.
// Request a very small WebRTC playout buffer.
// The browser may choose a somewhat larger actual target
// based on network conditions.
const COMPETITIVE_JITTER_BUFFER_TARGET_MS = 10

/*
 * F2.5 direct internet P2P experiment.
 *
 * STUN is used only for NAT/public-address discovery.
 *
 * There is intentionally NO TURN server configured.
 *
 * That means:
 *
 * - host candidates = local interfaces
 * - srflx candidates = public NAT mappings discovered through STUN
 * - relay candidates = impossible because no TURN server exists
 *
 * Controller traffic remains peer-to-peer.
 */
const DIRECT_P2P_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302'
    }
  ]
}

export interface FriendMediaDiagnostics {
  role: 'host' | 'guest'

  peerRttMs: number | null

  codec: string | null
  resolution: string | null
  fps: number | null
  bitrateMbps: number | null

  averageEncodeMs: number | null
  averageDecodeMs: number | null

  networkJitterMs: number | null

  averageJitterBufferMs: number | null
  averageTargetBufferMs: number | null
  averageMinimumBufferMs: number | null

  framesDropped: number | null
  packetsLost: number | null
  freezeCount: number | null

  qualityLimitationReason: string | null
  encoderImplementation: string | null
  decoderImplementation: string | null
}

interface FriendControllerPeerOptions {
  onStatus?: (message: string) => void

  onRemoteGamepadState?: (
    state: FriendGamepadState
  ) => void

  onRemoteControlEnded?: () => void

  onRemoteMediaStream?: (
    stream: MediaStream
  ) => void

  onDiagnostics?: (
    diagnostics: FriendMediaDiagnostics
  ) => void
}

type FriendPeerRole =
  | 'host'
  | 'guest'

type CandidateStat = RTCStats & {
  candidateType?: string
  protocol?: string
  address?: string
  port?: number
}

type CandidatePairStat = RTCStats & {
  state?: string
  nominated?: boolean
  localCandidateId?: string
  remoteCandidateId?: string
  currentRoundTripTime?: number
}

type CaptureLinkVideoRtpStat =
  RTCStats & {
    kind?: string
    mediaType?: string

    codecId?: string

    bytesSent?: number
    bytesReceived?: number

    framesEncoded?: number
    framesDecoded?: number
    framesDropped?: number
    framesPerSecond?: number

    totalEncodeTime?: number
    totalDecodeTime?: number

    jitter?: number

    jitterBufferDelay?: number
    jitterBufferTargetDelay?: number
    jitterBufferMinimumDelay?: number
    jitterBufferEmittedCount?: number

    packetsLost?: number
    freezeCount?: number

    qualityLimitationReason?: string

    encoderImplementation?: string
    decoderImplementation?: string

    frameWidth?: number
    frameHeight?: number
  }

type CaptureLinkCodecStat =
  RTCStats & {
    mimeType?: string
  }

function roundDiagnostic(
  value: number | null,
  digits = 2
): number | null {
  if (
    value === null ||
    !Number.isFinite(value)
  ) {
    return null
  }

  const scale =
    10 ** digits

  return (
    Math.round(
      value * scale
    ) / scale
  )
}

function encodeDescription(
  description: RTCSessionDescriptionInit
): string {
  return btoa(
    JSON.stringify({
      type: description.type,
      sdp: description.sdp
    })
  )
}

function decodeDescription(
  encoded: string
): RTCSessionDescriptionInit {
  let parsed: unknown

  try {
    parsed = JSON.parse(
      atob(encoded.trim())
    )
  } catch {
    throw new Error(
      'The CaptureLink peer description is invalid.'
    )
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('type' in parsed) ||
    !('sdp' in parsed)
  ) {
    throw new Error(
      'The CaptureLink peer description is malformed.'
    )
  }

  const type = parsed.type
  const sdp = parsed.sdp

  if (
    type !== 'offer' &&
    type !== 'answer'
  ) {
    throw new Error(
      'Unsupported WebRTC description type.'
    )
  }

  if (typeof sdp !== 'string') {
    throw new Error(
      'WebRTC SDP is missing.'
    )
  }

  return {
    type,
    sdp
  }
}

async function waitForIceGatheringComplete(
  peer: RTCPeerConnection
): Promise<void> {
  if (peer.iceGatheringState === 'complete') {
    return
  }

  await new Promise<void>((resolve) => {
    let settled = false

    const finish = (): void => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve()
    }

    const timeout = window.setTimeout(
      () => {
        console.warn(
          '[CaptureLink:F2] ICE gathering did not reach complete before timeout; continuing with gathered candidates.'
        )

        finish()
      },
      ICE_GATHER_TIMEOUT_MS
    )

    const onStateChange = (): void => {
      console.log(
        '[CaptureLink:F2] ICE gathering state:',
        peer.iceGatheringState
      )

      if (
        peer.iceGatheringState === 'complete'
      ) {
        finish()
      }
    }

    const cleanup = (): void => {
      window.clearTimeout(timeout)

      peer.removeEventListener(
        'icegatheringstatechange',
        onStateChange
      )
    }

    peer.addEventListener(
      'icegatheringstatechange',
      onStateChange
    )
  })
}

function createNeutralRemoteState(): FriendGamepadState {
  return {
    id: 'CaptureLink Remote Controller',
    index: 0,
    timestamp: performance.now(),
    connected: false,
    mapping: 'standard',

    axes: [
      0,
      0,
      0,
      0
    ],

    buttons: Array.from(
      { length: 17 },
      () => ({
        pressed: false,
        touched: false,
        value: 0
      })
    )
  }
}

function findPhysicalGamepad(): Gamepad | null {
  const gamepads =
    Array.from(navigator.getGamepads())

  return gamepads.find(
    (gamepad): gamepad is Gamepad =>
      gamepad !== null &&
      gamepad.connected
  ) ?? null
}

function capturePhysicalGamepad(
  gamepad: Gamepad
): FriendGamepadState {
  return {
    id: gamepad.id,
    index: gamepad.index,
    timestamp:
      gamepad.timestamp || performance.now(),
    connected: gamepad.connected,
    mapping: gamepad.mapping,

    axes: Array.from(gamepad.axes),

    buttons: Array.from(
      gamepad.buttons,
      (button) => ({
        pressed: button.pressed,
        touched: button.touched,
        value: button.value
      })
    )
  }
}

type CaptureLinkLowLatencyReceiver =
  RTCRtpReceiver & {
    jitterBufferTarget?: number
  }

function configureLowLatencyReceiver(
  receiver: RTCRtpReceiver
): void {
  const lowLatencyReceiver =
    receiver as CaptureLinkLowLatencyReceiver

  if (
    !(
      'jitterBufferTarget' in
      lowLatencyReceiver
    )
  ) {
    console.warn(
      '[CaptureLink:F3.1] jitterBufferTarget is unavailable:',
      receiver.track.kind
    )

    return
  }

  try {
    lowLatencyReceiver.jitterBufferTarget =
      COMPETITIVE_JITTER_BUFFER_TARGET_MS

    console.log(
      '[CaptureLink:F3.1] Low-latency receiver configured:',
      {
        kind:
          receiver.track.kind,
        requestedTargetMs:
          COMPETITIVE_JITTER_BUFFER_TARGET_MS,
        receiverTargetMs:
          lowLatencyReceiver
            .jitterBufferTarget
      }
    )
  } catch (error) {
    console.warn(
      '[CaptureLink:F3.1] Could not configure low-latency receiver:',
      {
        kind:
          receiver.track.kind,
        error
      }
    )
  }
}

export class FriendControllerPeer {
  private peer: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null

  private role: FriendPeerRole | null = null

  private guestAnimationFrame:
    number | null = null

  private guestLastSampleAt = 0
  private guestSequence = 0
  private guestHadController = false

  private lastRemoteSequence = -1

  private remoteMediaStream: MediaStream | null = null

  private mediaDiagnosticsTimer:
    number | null = null

  private previousVideoBytes = 0
  private previousStatsTimestamp = 0

  constructor(
    private readonly options:
      FriendControllerPeerOptions = {}
  ) {}

  async createHostOffer(
    hostMedia: MediaStream
  ): Promise<string> {
    this.close()

    this.role = 'host'
    this.peer = this.createPeerConnection()

    const liveTracks =
      hostMedia
        .getTracks()
        .filter(
          (track) =>
            track.readyState === 'live'
        )

    const hasVideo =
      liveTracks.some(
        (track) =>
          track.kind === 'video'
      )

    const hasAudio =
      liveTracks.some(
        (track) =>
          track.kind === 'audio'
      )

    if (!hasVideo || !hasAudio) {
      throw new Error(
        'Host Xbox media must contain a live video and audio track.'
      )
    }

    for (const track of liveTracks) {
      this.peer.addTrack(
        track,
        hostMedia
      )

      console.log(
        '[CaptureLink:F3] Added host media track:',
        {
          kind: track.kind,
          label: track.label,
          id: track.id
        }
      )
    }

    const channel =
      this.peer.createDataChannel(
        CONTROLLER_CHANNEL,
        {
          /*
           * Controller state is ephemeral.
           *
           * If packet N is lost but packet N+1 arrives,
           * waiting to retransmit N only creates latency.
           */
          ordered: false,
          maxRetransmits: 0
        }
      )

    this.bindHostChannel(channel)

    this.status(
      'creating direct P2P host offer'
    )

    const offer =
      await this.peer.createOffer()

    await this.peer.setLocalDescription(
      offer
    )

    await waitForIceGatheringComplete(
      this.peer
    )

    const description =
      this.peer.localDescription

    if (!description) {
      throw new Error(
        'CaptureLink did not generate a host offer.'
      )
    }

    const candidateCount =
      description.sdp
        ?.split('\\n')
        .filter((line) =>
          line.startsWith('a=candidate:')
        ).length ?? 0

    console.log(
      '[CaptureLink:F2] Host SDP ready',
      {
        iceGatheringState:
          this.peer.iceGatheringState,
        candidateCount
      }
    )

    if (candidateCount === 0) {
      console.warn(
        '[CaptureLink:F2] Host SDP currently contains no ICE candidates.'
      )
    }

    this.status(
      `host offer ready · ${candidateCount} ICE candidate${candidateCount === 1 ? '' : 's'}`
    )

    return encodeDescription(description)
  }

  async acceptHostOfferAndCreateAnswer(
    encodedOffer: string
  ): Promise<string> {
    this.close()

    this.role = 'guest'
    this.peer = this.createPeerConnection()

    this.remoteMediaStream =
      new MediaStream()

    this.peer.ontrack = (event) => {
      configureLowLatencyReceiver(
        event.receiver
      )

      const stream =
        this.remoteMediaStream

      if (!stream) {
        return
      }

      const alreadyPresent =
        stream
          .getTracks()
          .some(
            (track) =>
              track.id === event.track.id
          )

      if (!alreadyPresent) {
        stream.addTrack(
          event.track
        )
      }

      console.log(
        '[CaptureLink:F3] Remote media track received:',
        {
          kind: event.track.kind,
          label: event.track.label,
          id: event.track.id,
          streamTracks:
            stream
              .getTracks()
              .map(
                (track) =>
                  track.kind
              )
        }
      )

      this.options
        .onRemoteMediaStream?.(
          stream
        )
    }

    this.peer.ondatachannel = (event) => {
      if (
        event.channel.label !==
        CONTROLLER_CHANNEL
      ) {
        console.warn(
          '[CaptureLink:F2] Ignoring unknown DataChannel:',
          event.channel.label
        )
        return
      }

      this.bindGuestChannel(
        event.channel
      )
    }

    const offer =
      decodeDescription(encodedOffer)

    if (offer.type !== 'offer') {
      throw new Error(
        'Expected a CaptureLink host offer.'
      )
    }

    this.status(
      'accepting direct P2P host offer'
    )

    await this.peer.setRemoteDescription(
      offer
    )

    const answer =
      await this.peer.createAnswer()

    await this.peer.setLocalDescription(
      answer
    )

    this.startMediaDiagnostics()

    await waitForIceGatheringComplete(
      this.peer
    )

    const description =
      this.peer.localDescription

    if (!description) {
      throw new Error(
        'CaptureLink did not generate a guest answer.'
      )
    }

    this.status(
      'guest answer ready'
    )

    return encodeDescription(description)
  }

  async acceptGuestAnswer(
    encodedAnswer: string
  ): Promise<void> {
    if (
      this.role !== 'host' ||
      !this.peer
    ) {
      throw new Error(
        'CaptureLink is not currently acting as the P2P host.'
      )
    }

    const answer =
      decodeDescription(encodedAnswer)

    if (answer.type !== 'answer') {
      throw new Error(
        'Expected a CaptureLink guest answer.'
      )
    }

    await this.peer.setRemoteDescription(
      answer
    )

    this.startMediaDiagnostics()

    this.status(
      'guest answer accepted; establishing direct P2P path'
    )
  }

  close(): void {
    this.stopGuestControllerPump()
    this.stopMediaDiagnostics()

    const channel = this.channel
    this.channel = null

    try {
      channel?.close()
    } catch {
      // Channel may already be closed.
    }

    const peer = this.peer
    this.peer = null

    try {
      peer?.close()
    } catch {
      // Peer may already be closed.
    }

    if (this.role === 'host') {
      this.options
        .onRemoteControlEnded?.()
    }

    this.remoteMediaStream = null

    this.role = null
    this.lastRemoteSequence = -1
    this.guestSequence = 0
    this.guestHadController = false
  }

  private startMediaDiagnostics(): void {
    this.stopMediaDiagnostics()

    this.previousVideoBytes = 0
    this.previousStatsTimestamp = 0

    const peer = this.peer

    if (!peer) {
      return
    }

    const sample = (): void => {
      void this.collectMediaDiagnostics(
        peer
      )
    }

    sample()

    this.mediaDiagnosticsTimer =
      window.setInterval(
        sample,
        1000
      )
  }

  private stopMediaDiagnostics(): void {
    if (
      this.mediaDiagnosticsTimer !==
      null
    ) {
      window.clearInterval(
        this.mediaDiagnosticsTimer
      )

      this.mediaDiagnosticsTimer =
        null
    }

    this.previousVideoBytes = 0
    this.previousStatsTimestamp = 0
  }

  private getSelectedPeerRttMs(
    report: RTCStatsReport
  ): number | null {
    let result: number | null =
      null

    report.forEach((rawStat) => {
      const pair =
        rawStat as CandidatePairStat

      if (
        pair.type ===
          'candidate-pair' &&
        pair.state ===
          'succeeded' &&
        pair.nominated === true &&
        typeof
          pair.currentRoundTripTime ===
          'number'
      ) {
        result =
          pair.currentRoundTripTime *
          1000
      }
    })

    return roundDiagnostic(
      result,
      2
    )
  }

  private async collectMediaDiagnostics(
    peer: RTCPeerConnection
  ): Promise<void> {
    try {
      const report =
        await peer.getStats()

      let videoStat:
        CaptureLinkVideoRtpStat |
        null = null

      report.forEach((rawStat) => {
        const stat =
          rawStat as
            CaptureLinkVideoRtpStat

        const kind =
          stat.kind ??
          stat.mediaType

        if (kind !== 'video') {
          return
        }

        if (
          this.role === 'host' &&
          stat.type ===
            'outbound-rtp'
        ) {
          videoStat = stat
        }

        if (
          this.role === 'guest' &&
          stat.type ===
            'inbound-rtp'
        ) {
          videoStat = stat
        }
      })

      if (!videoStat) {
        return
      }

      const stat =
        videoStat as
          CaptureLinkVideoRtpStat

      const now =
        performance.now()

      const bytes =
        this.role === 'host'
          ? stat.bytesSent ?? 0
          : stat.bytesReceived ?? 0

      let bitrateMbps:
        number | null = null

      if (
        this.previousStatsTimestamp > 0 &&
        now >
          this.previousStatsTimestamp &&
        bytes >=
          this.previousVideoBytes
      ) {
        const elapsedSeconds =
          (
            now -
            this.previousStatsTimestamp
          ) / 1000

        const byteDelta =
          bytes -
          this.previousVideoBytes

        bitrateMbps =
          (
            byteDelta *
            8
          ) /
          elapsedSeconds /
          1_000_000
      }

      this.previousStatsTimestamp =
        now

      this.previousVideoBytes =
        bytes

      const codec =
        stat.codecId
          ? report.get(
              stat.codecId
            ) as
              CaptureLinkCodecStat |
              undefined
          : undefined

      const peerRttMs =
        this.getSelectedPeerRttMs(
          report
        )

      const resolution =
        stat.frameWidth &&
        stat.frameHeight
          ? `${stat.frameWidth}x${stat.frameHeight}`
          : null

      if (this.role === 'host') {
        const framesEncoded =
          stat.framesEncoded ?? 0

        const averageEncodeMs =
          framesEncoded > 0 &&
          typeof
            stat.totalEncodeTime ===
            'number'
            ? (
                stat.totalEncodeTime /
                framesEncoded
              ) * 1000
            : null

        this.options
          .onDiagnostics?.({
            role: 'host',

            peerRttMs,

            codec:
              codec?.mimeType ??
              null,

            resolution,

            fps:
              stat.framesPerSecond ??
              null,

            bitrateMbps:
              roundDiagnostic(
                bitrateMbps
              ),

            averageEncodeMs:
              roundDiagnostic(
                averageEncodeMs
              ),

            averageDecodeMs: null,

            networkJitterMs: null,

            averageJitterBufferMs:
              null,

            averageTargetBufferMs:
              null,

            averageMinimumBufferMs:
              null,

            framesDropped:
              stat.framesDropped ??
              null,

            packetsLost:
              stat.packetsLost ??
              null,

            freezeCount:
              stat.freezeCount ??
              null,

            qualityLimitationReason:
              stat
                .qualityLimitationReason ??
              null,

            encoderImplementation:
              stat
                .encoderImplementation ??
              null,

            decoderImplementation:
              null
          })

        return
      }

      const framesDecoded =
        stat.framesDecoded ?? 0

      const emitted =
        stat
          .jitterBufferEmittedCount ??
        0

      const averageDecodeMs =
        framesDecoded > 0 &&
        typeof
          stat.totalDecodeTime ===
          'number'
          ? (
              stat.totalDecodeTime /
              framesDecoded
            ) * 1000
          : null

      const averageJitterBufferMs =
        emitted > 0 &&
        typeof
          stat.jitterBufferDelay ===
          'number'
          ? (
              stat.jitterBufferDelay /
              emitted
            ) * 1000
          : null

      const averageTargetBufferMs =
        emitted > 0 &&
        typeof
          stat
            .jitterBufferTargetDelay ===
          'number'
          ? (
              stat
                .jitterBufferTargetDelay /
              emitted
            ) * 1000
          : null

      const averageMinimumBufferMs =
        emitted > 0 &&
        typeof
          stat
            .jitterBufferMinimumDelay ===
          'number'
          ? (
              stat
                .jitterBufferMinimumDelay /
              emitted
            ) * 1000
          : null

      const networkJitterMs =
        typeof stat.jitter ===
        'number'
          ? stat.jitter * 1000
          : null

      this.options
        .onDiagnostics?.({
          role: 'guest',

          peerRttMs,

          codec:
            codec?.mimeType ??
            null,

          resolution,

          fps:
            stat.framesPerSecond ??
            null,

          bitrateMbps:
            roundDiagnostic(
              bitrateMbps
            ),

          averageEncodeMs: null,

          averageDecodeMs:
            roundDiagnostic(
              averageDecodeMs
            ),

          networkJitterMs:
            roundDiagnostic(
              networkJitterMs
            ),

          averageJitterBufferMs:
            roundDiagnostic(
              averageJitterBufferMs
            ),

          averageTargetBufferMs:
            roundDiagnostic(
              averageTargetBufferMs
            ),

          averageMinimumBufferMs:
            roundDiagnostic(
              averageMinimumBufferMs
            ),

          framesDropped:
            stat.framesDropped ??
            null,

          packetsLost:
            stat.packetsLost ??
            null,

          freezeCount:
            stat.freezeCount ??
            null,

          qualityLimitationReason:
            null,

          encoderImplementation:
            null,

          decoderImplementation:
            stat
              .decoderImplementation ??
            null
        })
    } catch (error) {
      console.warn(
        '[CaptureLink] Friend media diagnostics failed:',
        error
      )
    }
  }

  private createPeerConnection():
    RTCPeerConnection {
    const peer =
      new RTCPeerConnection(
        DIRECT_P2P_CONFIGURATION
      )

    peer.addEventListener(
      'connectionstatechange',
      () => {
        this.status(
          `peer connection: ${peer.connectionState}`
        )

        if (
          peer.connectionState ===
          'connected'
        ) {
          window.setTimeout(
            () => {
              void this.logSelectedIcePath(
                peer
              )
            },
            500
          )
        }
      }
    )

    peer.addEventListener(
      'iceconnectionstatechange',
      () => {
        console.log(
          '[CaptureLink:F2] ICE:',
          peer.iceConnectionState
        )
      }
    )

    return peer
  }

  private bindHostChannel(
    channel: RTCDataChannel
  ): void {
    this.channel = channel

    channel.onopen = () => {
      this.status(
        'controller DataChannel open'
      )
    }

    channel.onclose = () => {
      this.status(
        'controller DataChannel closed'
      )

      this.options
        .onRemoteControlEnded?.()
    }

    channel.onerror = (event) => {
      console.error(
        '[CaptureLink:F2] Host controller DataChannel error:',
        event
      )
    }

    channel.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        return
      }

      let message: FriendWireMessage

      try {
        message =
          parseFriendMessage(
            event.data
          )
      } catch (error) {
        console.warn(
          '[CaptureLink:F2] Invalid peer message:',
          error
        )
        return
      }

      if (message.type === 'hello') {
        console.log(
          '[CaptureLink:F2] Guest hello:',
          message
        )
        return
      }

      if (message.type !== 'gamepad') {
        return
      }

      if (
        message.sequence <=
        this.lastRemoteSequence
      ) {
        return
      }

      this.lastRemoteSequence =
        message.sequence

      this.options
        .onRemoteGamepadState?.(
          message.state
        )
    }
  }

  private bindGuestChannel(
    channel: RTCDataChannel
  ): void {
    this.channel = channel

    channel.onopen = () => {
      this.status(
        'controller DataChannel open; streaming guest controller'
      )

      channel.send(
        serializeFriendMessage({
          type: 'hello',
          protocolVersion:
            FRIEND_PROTOCOL_VERSION,
          sessionId:
            'f2-direct-p2p-spike',
          role: 'guest'
        })
      )

      this.startGuestControllerPump()
    }

    channel.onclose = () => {
      this.status(
        'controller DataChannel closed'
      )

      this.stopGuestControllerPump()
    }

    channel.onerror = (event) => {
      console.error(
        '[CaptureLink:F2] Guest controller DataChannel error:',
        event
      )
    }
  }

  private startGuestControllerPump():
    void {
    this.stopGuestControllerPump()

    const pump = (
      now: number
    ): void => {
      this.guestAnimationFrame =
        window.requestAnimationFrame(
          pump
        )

      if (
        now -
        this.guestLastSampleAt <
        GAMEPAD_SAMPLE_INTERVAL_MS
      ) {
        return
      }

      this.guestLastSampleAt = now

      const channel = this.channel

      if (
        !channel ||
        channel.readyState !== 'open'
      ) {
        return
      }

      const gamepad =
        findPhysicalGamepad()

      if (!gamepad) {
        if (!this.guestHadController) {
          return
        }

        this.guestHadController = false

        this.sendGamepadState(
          createNeutralRemoteState()
        )

        this.status(
          'guest controller disconnected'
        )

        return
      }

      if (!this.guestHadController) {
        this.guestHadController = true

        this.status(
          `guest controller detected: ${gamepad.id}`
        )
      }

      this.sendGamepadState(
        capturePhysicalGamepad(
          gamepad
        )
      )
    }

    this.guestAnimationFrame =
      window.requestAnimationFrame(
        pump
      )
  }

  private stopGuestControllerPump():
    void {
    if (
      this.guestAnimationFrame !== null
    ) {
      window.cancelAnimationFrame(
        this.guestAnimationFrame
      )

      this.guestAnimationFrame = null
    }

    this.guestLastSampleAt = 0
  }

  private sendGamepadState(
    state: FriendGamepadState
  ): void {
    const channel = this.channel

    if (
      !channel ||
      channel.readyState !== 'open'
    ) {
      return
    }

    this.guestSequence += 1

    channel.send(
      serializeFriendMessage({
        type: 'gamepad',
        sequence:
          this.guestSequence,
        state
      })
    )
  }

  private async logSelectedIcePath(
    peer: RTCPeerConnection
  ): Promise<void> {
    try {
      const report =
        await peer.getStats()

      let selectedPair:
        CandidatePairStat | null = null

      report.forEach((stat) => {
        const candidate =
          stat as CandidatePairStat

        if (
          candidate.type ===
            'candidate-pair' &&
          candidate.state ===
            'succeeded' &&
          candidate.nominated === true
        ) {
          selectedPair = candidate
        }
      })

      if (!selectedPair) {
        console.log(
          '[CaptureLink:F2] No nominated ICE pair found yet.'
        )
        return
      }

      const pair =
        selectedPair as CandidatePairStat

      const local =
        pair.localCandidateId
          ? report.get(
              pair.localCandidateId
            ) as CandidateStat | undefined
          : undefined

      const remote =
        pair.remoteCandidateId
          ? report.get(
              pair.remoteCandidateId
            ) as CandidateStat | undefined
          : undefined

      const rttMs =
        typeof pair.currentRoundTripTime ===
        'number'
          ? Math.round(
              pair.currentRoundTripTime *
              1000
            )
          : null

      console.log(
        '[CaptureLink:F2] DIRECT ICE PATH',
        {
          localCandidateType:
            local?.candidateType,
          remoteCandidateType:
            remote?.candidateType,
          protocol:
            local?.protocol,
          localAddress:
            local?.address,
          remoteAddress:
            remote?.address,
          roundTripMs:
            rttMs
        }
      )

      this.status(
        rttMs === null
          ? 'direct P2P controller path connected'
          : `direct P2P controller path connected · ${rttMs} ms RTT`
      )
    } catch (error) {
      console.warn(
        '[CaptureLink:F2] Could not inspect ICE path:',
        error
      )
    }
  }

  private status(
    message: string
  ): void {
    console.log(
      `[CaptureLink:F2] ${message}`
    )

    this.options.onStatus?.(
      message
    )
  }
}
