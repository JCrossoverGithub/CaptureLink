// Manual, non-trickle WebRTC signaling needs an SDP *snapshot* containing ICE
// candidates. Do not require iceGatheringState=complete: a nonresponsive STUN
// server can leave gathering in progress long after a usable candidate exists.
export type VoiceIceSnapshot = {
  sdp: string
  candidateTypes: Array<'host' | 'srflx' | 'relay' | 'prflx'>
  partial: boolean
}

export function voiceIceCandidateTypes(sdp: string): VoiceIceSnapshot['candidateTypes'] {
  const types = new Set<VoiceIceSnapshot['candidateTypes'][number]>()
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith('a=candidate:')) continue
    const type = /\btyp\s+(host|srflx|relay|prflx)\b/.exec(line)?.[1]
    if (type === 'host' || type === 'srflx' || type === 'relay' || type === 'prflx') {
      types.add(type)
    }
  }
  return [...types]
}

export function gatherVoiceIceSnapshot(
  peer: RTCPeerConnection,
  timings: { minWaitMs?: number; maxWaitMs?: number } = {}
): Promise<VoiceIceSnapshot> {
  const minWaitMs = timings.minWaitMs ?? 1200
  const maxWaitMs = timings.maxWaitMs ?? 7000
  if (minWaitMs < 0 || maxWaitMs <= 0 || minWaitMs > maxWaitMs) {
    return Promise.reject(new Error('Invalid ICE wait limits.'))
  }

  return new Promise<VoiceIceSnapshot>((resolve, reject) => {
    let settled = false
    let minimumElapsed = false
    let maximumElapsed = false
    let minTimer: ReturnType<typeof setTimeout>
    let maxTimer: ReturnType<typeof setTimeout>

    const cleanup = (): void => {
      clearTimeout(minTimer)
      clearTimeout(maxTimer)
      peer.removeEventListener('icegatheringstatechange', changed)
      peer.removeEventListener('icecandidate', changed)
      peer.removeEventListener('signalingstatechange', changed)
    }
    const finish = (result: VoiceIceSnapshot): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const fail = (reason: string): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(reason))
    }
    const changed = (): void => {
      if (settled) return
      if (peer.signalingState === 'closed') {
        fail('Voice invitation was cancelled before ICE discovery finished.')
        return
      }
      const sdp = peer.localDescription?.sdp ?? ''
      const candidateTypes = voiceIceCandidateTypes(sdp)
      const complete = peer.iceGatheringState === 'complete'
      if (complete || maximumElapsed) {
        if (candidateTypes.length === 0) {
          fail('No ICE candidates were discovered. Check your network, VPN and firewall; a TURN relay may be required.')
        } else {
          finish({ sdp, candidateTypes, partial: !complete })
        }
        return
      }
      // Prefer a public/STUN-reflexive or relay candidate, when available. A
      // local-only host candidate is retained after maxWaitMs for LAN tests.
      if (minimumElapsed && (candidateTypes.includes('srflx') || candidateTypes.includes('relay'))) {
        finish({ sdp, candidateTypes, partial: true })
      }
    }

    peer.addEventListener('icegatheringstatechange', changed)
    peer.addEventListener('icecandidate', changed)
    peer.addEventListener('signalingstatechange', changed)
    minTimer = setTimeout(() => { minimumElapsed = true; changed() }, minWaitMs)
    maxTimer = setTimeout(() => { maximumElapsed = true; changed() }, maxWaitMs)
    changed()
  })
}
