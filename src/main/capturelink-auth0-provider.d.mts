export interface CaptureLinkAuth0Provider {
  issuer: string
  authorizationEndpoint: string
  clientId: string
  audience: string
  scope: string
  exchangeCode(args: object): Promise<unknown>
  exchangeRefresh(args: object): Promise<unknown>
  verifyTokens(args: object): Promise<unknown>
  verifyHostAccessToken(token: string): Promise<unknown>
}
export function createCaptureLinkAuth0Provider(config: {
  domain: string
  clientId: string
  audience: string
}): CaptureLinkAuth0Provider
