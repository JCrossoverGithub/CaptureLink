export {}

declare global {
  interface Window {
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
    }
  }
}
