export interface OnlineAuthStatus {
  enabled: boolean
  authenticated: boolean
  pending: boolean
}
export interface OnlineAuthController {
  status(): OnlineAuthStatus
  initialize(): Promise<OnlineAuthStatus>
  begin(): Promise<{ started: boolean }>
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
}): OnlineAuthController
