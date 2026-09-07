export {}

declare global {
  interface CaptureLinkIceCandidate {
    candidate: string
    sdpMid: string | null
    sdpMLineIndex: number | null
    usernameFragment: string | null
  }

  interface CaptureLinkPlayer {
    onConnectionStateChange(
      callback: (state: string) => void
    ): void

    createOffer(): Promise<RTCSessionDescriptionInit>

    setRemoteOffer(sdp: string): void

    getIceCandidates(): RTCIceCandidate[]

    setRemoteIceCandidates(candidates: unknown[]): void

    destroy(): void
  }

  interface Window {
    xCloudPlayer?: {
      Player?: new (
        elementId: string,
        options?: Record<string, unknown>
      ) => CaptureLinkPlayer
      default?: {
        Player: new (
          elementId: string,
          options?: Record<string, unknown>
        ) => CaptureLinkPlayer
      }
    }

    captureLink: {
      platform: string
      version: string

      getXboxAuthStatus(): Promise<{
        authenticated: boolean
      }>

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

      stopXboxStream(): Promise<void>

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

      onXboxStreamStatus(
        callback: (status: string) => void
      ): void
    }
  }
}
