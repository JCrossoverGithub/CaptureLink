// Voice-only, single-guest, manually exchanged WebRTC signaling.
// Not interchangeable with the existing game/video/controller Friend protocol.
export const VOICE_SIGNAL_PREFIX = 'CAPTURELINK-VOICE-V1:'
const MAX_SIGNAL_CHARS = 120_000
const MAX_SDP_CHARS = 90_000

export type VoiceSignal =
  | { version: 1; type: 'offer'; id: string; sdp: string }
  | { version: 1; type: 'answer'; id: string; sdp: string }

export function encodeVoiceSignal(signal: VoiceSignal): string {
  return VOICE_SIGNAL_PREFIX + btoa(JSON.stringify(signal))
}

export function decodeVoiceSignal(raw: string): VoiceSignal {
  const text = raw.trim()
  if (!text.startsWith(VOICE_SIGNAL_PREFIX) || text.length > MAX_SIGNAL_CHARS) {
    throw new Error('Paste a valid CaptureLink Voice invitation or response.')
  }
  let value: unknown
  try {
    value = JSON.parse(atob(text.slice(VOICE_SIGNAL_PREFIX.length)))
  } catch {
    throw new Error('Voice invitation or response could not be decoded.')
  }
  if (!value || typeof value !== 'object') {
    throw new Error('Voice signal must be an object.')
  }
  const signal = value as Partial<VoiceSignal>
  if (signal.version !== 1 ||
      (signal.type !== 'offer' && signal.type !== 'answer') ||
      typeof signal.id !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(signal.id) ||
      typeof signal.sdp !== 'string' ||
      signal.sdp.length === 0 || signal.sdp.length > MAX_SDP_CHARS ||
      !signal.sdp.startsWith('v=0\r\n')) {
    throw new Error('Voice signal has invalid version, session ID, or SDP.')
  }
  return { version: 1, type: signal.type, id: signal.id, sdp: signal.sdp }
}
