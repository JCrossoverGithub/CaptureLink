/**
 * Privacy-constrained WebRTC audio diagnostics.
 *
 * Read *only* aggregate audio counters. Never serialize RTCStatsReport itself:
 * reports may contain ICE candidate addresses, SSRCs, codec details, and IDs.
 */
export type AudioPathSample = {
  state: 'unavailable' | 'sampling' | 'packets-moving' | 'no-new-packets'
  packetsDelta: number | null
  bytesDelta: number | null
  audioLevel: number | null
}

type AudioCounter = {
  packets: number
  bytes: number
  energy: number | null
  duration: number | null
  at: number
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function empty(): AudioPathSample {
  return { state: 'unavailable', packetsDelta: null, bytesDelta: null, audioLevel: null }
}

export class AudioPathStats {
  private previous = new Map<string, AudioCounter>()

  reset(key: string): void { this.previous.delete(key) }
  clear(): void { this.previous.clear() }

  read(
    key: string,
    report: RTCStatsReport | null,
    direction: 'inbound' | 'outbound',
    now = Date.now()
  ): AudioPathSample {
    if (!report) { this.reset(key); return empty() }

    let selected: {
      packets?: unknown
      bytes?: unknown
      audioLevel?: unknown
      totalAudioEnergy?: unknown
      totalSamplesDuration?: unknown
    } | null = null
    report.forEach((item) => {
      const stat = item as RTCStats & {
        kind?: string; mediaType?: string
        packetsReceived?: number; packetsSent?: number
        bytesReceived?: number; bytesSent?: number
        audioLevel?: number
        totalAudioEnergy?: number; totalSamplesDuration?: number
      }
      if (!selected && stat.type === `${direction}-rtp` &&
          (stat.kind === 'audio' || stat.mediaType === 'audio')) {
        selected = {
          packets: direction === 'inbound' ? stat.packetsReceived : stat.packetsSent,
          bytes: direction === 'inbound' ? stat.bytesReceived : stat.bytesSent,
          audioLevel: stat.audioLevel,
          totalAudioEnergy: stat.totalAudioEnergy,
          totalSamplesDuration: stat.totalSamplesDuration
        }
      }
    })
    if (!selected) { this.reset(key); return empty() }

    const result = selected as {
      packets?: unknown; bytes?: unknown; audioLevel?: unknown
      totalAudioEnergy?: unknown; totalSamplesDuration?: unknown
    }
    const packets = numberOrNull(result.packets)
    const bytes = numberOrNull(result.bytes)
    if (packets === null || bytes === null) { this.reset(key); return empty() }
    const current: AudioCounter = {
      packets, bytes,
      energy: numberOrNull(result.totalAudioEnergy),
      duration: numberOrNull(result.totalSamplesDuration),
      at: now
    }
    const previous = this.previous.get(key)
    this.previous.set(key, current)

    const comparable = previous && now > previous.at && now - previous.at <= 10_000 &&
      current.packets >= previous.packets && current.bytes >= previous.bytes
    const packetsDelta = comparable ? current.packets - previous.packets : null
    const bytesDelta = comparable ? current.bytes - previous.bytes : null

    let level = numberOrNull(result.audioLevel)
    if (level === null && previous && current.energy !== null && current.duration !== null &&
        previous.energy !== null && previous.duration !== null &&
        current.energy >= previous.energy && current.duration > previous.duration) {
      level = Math.sqrt((current.energy - previous.energy) / (current.duration - previous.duration))
    }
    return {
      state: packetsDelta === null ? 'sampling' : packetsDelta > 0 ? 'packets-moving' : 'no-new-packets',
      packetsDelta,
      bytesDelta,
      audioLevel: level === null ? null : Math.min(1, level)
    }
  }
}

export function formatAudioPathSample(value: AudioPathSample): string {
  if (value.state === 'unavailable') return 'Unavailable'
  if (value.state === 'sampling') return 'Sampling…'
  const motion = value.state === 'packets-moving'
    ? `${value.packetsDelta} RTP packets / sample`
    : 'No new RTP packets'
  const level = value.audioLevel === null
    ? 'level unavailable'
    : `audio level ${(value.audioLevel * 100).toFixed(1)}%`
  return `${motion} · ${level}`
}
