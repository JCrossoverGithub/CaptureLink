/**
 * UX3c-1 trusted-main signaling selection. No environment or renderer-controlled
 * selection is accepted. Production has no approved remote origin yet.
 * The default (and the call used by index.ts) is exactly the UX3b1 loopback client.
 */
import { LocalSignalingClient, RemoteSignalingClient, SignalingClientError } from '../../services/signaling/src/client.mjs'

export function createSignalingClientForMain({ mode = 'local', remote = null, fetchImpl, requestTimeoutMs } = {}) {
  const options = {
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
  }
  if (mode === 'local' && remote === null) return new LocalSignalingClient(options)
  if (mode !== 'remote') throw new SignalingClientError('invalid_client_configuration')
  if (!remote || remote.enabled !== true) throw new SignalingClientError('remote_disabled')
  // This policy is a trusted main-process input for hermetic test fixtures.
  // There is intentionally no allowlist, admission credential, or remote feature
  // flag in the shipped application. UX3c-3 must explicitly review adding one.
  return new RemoteSignalingClient({
    endpoint: remote.endpoint,
    approvedOrigin: remote.approvedOrigin,
    admissionToken: remote.admissionToken,
    enabled: true,
    ...options,
  })
}
