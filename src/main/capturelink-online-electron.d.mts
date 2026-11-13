export interface OnlineAuthStatus {
  enabled: boolean
  authenticated: boolean
  pending: boolean
}
export interface OnlineAuthController {
  status(): OnlineAuthStatus
  initialize(): Promise<OnlineAuthStatus>
  begin(): Promise<{ started: boolean }>
  // Main-process-only: never expose these functions through Electron IPC.
  hostingStatus(): { hosting: boolean }
  createHostSession(permissions: {
    watch: boolean
    voice: boolean
    controller: boolean
    controllerMode: 'shared' | 'player2'
  }): Promise<{ inviteCode: string; inviteExpiresAt: number }>
  endHostSession(): Promise<{ ended: boolean }>
  signOut(): Promise<OnlineAuthStatus>
  shutdown(): Promise<{ stopped: boolean }>
}
export function createCaptureLinkOnlineElectron(options: {
  provider: {
    issuer: string
    authorizationEndpoint: string
    clientId: string
    audience: string
    scope: string
    exchangeCode(args: object): Promise<unknown>
    exchangeRefresh(args: object): Promise<unknown>
    verifyTokens(args: object): Promise<unknown>
  }
  vault: { load(): Promise<unknown>; save(value: unknown): Promise<void>; clear(): Promise<void> }
  redirectPort: number
  openBrowser(url: string): Promise<unknown>
  hostFactory?: ((options: { accessToken(): string | null }) => {
    status(): { hosting: boolean }
    create(permissions: { watch: boolean; voice: boolean; controller: boolean;
      controllerMode: 'shared' | 'player2' }): Promise<{ inviteCode: string; inviteExpiresAt: number }>
    end(): Promise<{ ended: boolean }>
  }) | null
}): OnlineAuthController
