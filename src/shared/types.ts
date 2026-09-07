export type ConnectionState =
  | 'signed-out'
  | 'ready'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error'

export interface ConsoleSummary {
  deviceName: string
  serverId: string
  powerState: string
  consoleType: string
}
