export {}

declare global {
  interface CaptureLinkIceCandidate {
    candidate: string
    sdpMid: string | null
    sdpMLineIndex: number | null
    usernameFragment: string | null
  }

  interface CaptureLinkGamepad {
    attach(player: CaptureLinkPlayer): void
    detach(): void
  }

  interface CaptureLinkPlayer {
    _peerConnection: RTCPeerConnection
    _channels: {
      chat: {
        startMicrophone(): void
        stopMicrophone(): void
        _micStream?: MediaStream
      }
    }

    onConnectionStateChange(
      callback: (state: string) => void
    ): void

    setChatSdpHandler(
      callback: (offer: RTCSessionDescriptionInit) => void
    ): void

    createOffer(): Promise<RTCSessionDescriptionInit>

    setRemoteOffer(sdp: string): void

    getIceCandidates(): RTCIceCandidate[]

    setRemoteIceCandidates(candidates: unknown[]): void

    getAudioElement(): HTMLAudioElement | undefined

    toggleDebugOverlay(): void

    destroy(): void
  }

  interface CaptureLinkPlayerExports {
    Player?: new (
      elementId: string,
      options?: Record<string, unknown>
    ) => CaptureLinkPlayer

    Gamepad?: new (
      index: number,
      options?: {
        enable_keyboard?: boolean
        enable_gamepad?: boolean
        enable_vibration?: boolean
        gamepad_force_capture?: boolean
      }
    ) => CaptureLinkGamepad
  }


  interface CaptureLinkRecordingItem {
    id: string
    kind: 'audio' | 'video'
    filePath: string
    fileName: string
    createdAt: string
    durationMs: number
    bytes: number
    exists: boolean
  }

  interface Window {
    xCloudPlayer?: CaptureLinkPlayerExports & {
      default?: CaptureLinkPlayerExports
    }

    captureLink: {
      platform: string
      version: string

      getXboxAuthStatus(): Promise<{
        authenticated: boolean
      }>

      signOutXbox(): Promise<{ signedOut: boolean }>

      getXboxConsoles(): Promise<
        Array<{
          serverId: string
          deviceName: string
          powerState: string
          consoleType: string
        }>
      >

      startXboxAuth(): Promise<{
        started: boolean
        reason?: string
      }>

      startXboxStream(serverId: string): Promise<{
        sessionId: string
        state: string
      }>

      exchangeXboxSdp(sdp: string): Promise<{
        sdp: string
      }>

      exchangeXboxIce(
        candidates: CaptureLinkIceCandidate[]
      ): Promise<unknown[]>

      exchangeXboxChatSdp(sdp: string): Promise<{
        sdp: string
      }>

      stopXboxStream(): Promise<void>

      setWindowFullscreen(
        fullscreen: boolean
      ): Promise<{
        fullscreen: boolean
      }>


      beginRecording(
        kind: 'audio' | 'video',
        suggestedName: string
      ): Promise<{
        started: boolean
        recordingId?: string
        filePath?: string
        availableBytes?: number
      }>

      appendRecordingChunk(
        recordingId: string,
        data: ArrayBuffer
      ): Promise<{
        bytesWritten: number
        availableBytes: number
      }>

      finalizeRecording(
        recordingId: string
      ): Promise<{
        saved: boolean
        filePath: string
        bytesWritten: number
      }>

      cancelRecording(
        recordingId: string
      ): Promise<{
        canceled: boolean
        filePath: string
        bytesWritten: number
      }>

      getRecordings(): Promise<CaptureLinkRecordingItem[]>

      openRecording(id: string): Promise<{ opened: boolean }>

      showRecording(id: string): Promise<{ shown: boolean }>

      renameRecording(
        id: string,
        name: string
      ): Promise<{
        renamed: boolean
        filePath: string
        fileName: string
      }>

      deleteRecording(id: string): Promise<{ deleted: boolean }>

      exportOriginalRecording(id: string): Promise<{
        exported: boolean
        filePath?: string
      }>

      getRecordingExportSupport(): Promise<{
        available: boolean
        detail: string
      }>

      exportRecording(
        id: string,
        format: 'mp4' | 'mp3' | 'wav'
      ): Promise<{
        exported: boolean
        filePath?: string
        format?: 'mp4' | 'mp3' | 'wav'
      }>


      onXboxAuthOutput(
        callback: (message: string) => void
      ): void

      onXboxAuthComplete(
        callback: (
          result: {
            success: boolean
            message: string
          }
        ) => void
      ): void

      onRecordingStopRequested(
        callback: () => void
      ): void

      onRecordingExportProgress(
        callback: (progress: {
          id: string
          format: 'mp4' | 'mp3' | 'wav'
          percent: number
        }) => void
      ): void

      onWindowFullscreenChanged(
        callback: (fullscreen: boolean) => void
      ): void
      onXboxStreamStatus(
        callback: (status: string) => void
      ): void
    }
  }
}
