export interface OnlineHttpsPermissions {
  watch: boolean
  voice: boolean
  controller: boolean
  controllerMode: 'shared' | 'player2'
}
export interface OnlineHttpsSessionCandidate {
  status(): Readonly<{ role: 'host' | 'guest' | null; active: boolean }>
  create(permissions: OnlineHttpsPermissions, options?: { signal?: AbortSignal }): Promise<Readonly<{ inviteCode: string; inviteExpiresAt: number }>>
  join(inviteCode: string, options: { displayName: string; signal?: AbortSignal }): Promise<Readonly<{ status: 'pending' }>>
  snapshot(options?: { signal?: AbortSignal }): Promise<Readonly<{ role: 'host' | 'guest'; status: 'open' | 'pending' | 'approved' | 'rejected'; hasPendingGuest: boolean; guestDisplayName: string | null; permissions: OnlineHttpsPermissions }>>
  approve(allow: boolean, options?: { signal?: AbortSignal }): Promise<Readonly<{ status: 'approved' | 'rejected' }>>
  send(kind: 'invite' | 'response', wire: string, options?: { signal?: AbortSignal }): Promise<Readonly<{ sent: true }>>
  messages(options?: { signal?: AbortSignal }): Promise<ReadonlyArray<Readonly<{ kind: 'invite' | 'response'; payload: string }>>>
  end(): Promise<Readonly<{ ended: true }>>
}
export function createCaptureLinkOnlineHttpsSessionCandidate(options?: {
  origin?: string
  accessToken?: (() => string | null) | null
  fetchImpl?: typeof fetch
  now?: () => number
}): OnlineHttpsSessionCandidate
