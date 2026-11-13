export const ONLINE_DEV_CONFIG_FILENAME: string
export const ONLINE_DEV_CLIENT_ID: string
export const ONLINE_DEV_AUDIENCE: string
export function loadCaptureLinkOnlineDevConfig(options?: { home?: string }): Promise<Readonly<{
  domain: string
  clientId: string
  audience: string
  redirectPort: number
}> | null>
