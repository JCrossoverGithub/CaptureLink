export type HostedPermissions = {
  watch: boolean
  voice: boolean
  controller: boolean
  controllerMode: 'shared' | 'player2'
}
export type HostedSnapshot = { role: 'host' | 'guest'; status: string; hasPendingGuest: boolean; guestDisplayName: string | null }
export class HostedSignalingBridge {
  constructor(options?: { clientFactory?: () => unknown })
  readonly role: 'host' | 'guest' | null
  create(permissions: HostedPermissions): Promise<{ inviteCode: string; inviteExpiresAt: number }>
  join(code: string, displayName: string): Promise<{ status: 'pending' }>
  snapshot(): Promise<HostedSnapshot>
  approve(allowed: boolean): Promise<{ status: 'approved' | 'rejected' }>
  send(kind: 'invite' | 'response', payload: string): Promise<{ sent: boolean }>
  messages(): Promise<Array<{ kind: 'invite' | 'response'; payload: string }>>
  end(): Promise<{ ended: boolean }>
}
