export {}

declare global {
  interface Window {
    captureLink: {
      platform: string
      version: string

      getXboxAuthStatus(): Promise<{
        authenticated: boolean
      }>

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
