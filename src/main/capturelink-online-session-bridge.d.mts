import type { OnlineHttpsPermissions, OnlineHttpsSessionCandidate } from './capturelink-online-https-session-candidate.mjs'
export interface OnlineSessionStatus { role: 'host' | 'guest' | null; active: boolean }
export class CaptureLinkOnlineSessionBridge {
  constructor(options?: { candidateFactory?: (options: { accessToken: (() => string | null) | null }) => OnlineHttpsSessionCandidate })
  authenticatedHostAdapter(accessToken: () => string | null): {
    status(): { hosting: boolean }
    create(permissions: OnlineHttpsPermissions): Promise<{ inviteCode: string; inviteExpiresAt: number }>
    end(): Promise<{ ended: true }>
  }
  status(): OnlineSessionStatus
  join(code: string, displayName: string): Promise<{ status: 'pending' }>
  snapshot(): Promise<{ role: 'host' | 'guest'; status: string; hasPendingGuest: boolean; guestDisplayName: string | null; permissions: OnlineHttpsPermissions }>
  approve(allow: boolean): Promise<{ status: 'approved' | 'rejected' }>
  send(kind: 'invite' | 'response', wire: string): Promise<{ sent: true }>
  messages(): Promise<Array<{ kind: 'invite' | 'response'; payload: string }>>
  end(): Promise<{ ended: true }>
}
