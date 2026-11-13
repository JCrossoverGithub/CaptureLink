/** UX3F-3B3A/3B3B: offline .test transport only; never renderer-facing. */
export const UX3F3B3A_TEST_ORIGIN: 'https://signal.capturelink.test'
export interface OnlineHostPermissions {
  watch: boolean
  voice: boolean
  controller: boolean
  controllerMode: 'shared' | 'player2'
}
export interface OnlineHttpsHostCandidate {
  status(): { hosting: boolean }
  create(permissions: OnlineHostPermissions, options?: { signal?: AbortSignal }):
    Promise<{ inviteCode: string; inviteExpiresAt: number }>
  end(): Promise<{ ended: boolean }>
}
export function createCaptureLinkOnlineHttpsHostCandidate(config: {
  origin?: string
  accessToken(): string | null
  fetchImpl?: typeof fetch
  now?: () => number
}): OnlineHttpsHostCandidate
