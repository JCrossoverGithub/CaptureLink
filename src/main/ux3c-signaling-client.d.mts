export type RemoteSignalingPolicy = {
  enabled: true
  endpoint: string
  approvedOrigin: string
  admissionToken: string
}
/** Main-only, default localhost. Remote requires explicitly approved policy. */
export function createSignalingClientForMain(options?: {
  mode?: 'local' | 'remote'
  remote?: RemoteSignalingPolicy | null
  fetchImpl?: typeof fetch
  requestTimeoutMs?: number
}): unknown
