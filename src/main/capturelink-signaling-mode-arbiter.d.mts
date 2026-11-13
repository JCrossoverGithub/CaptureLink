export interface CaptureLinkSignalingModeArbiter {
  mode(): 'legacy' | 'online' | null
  active(mode: 'legacy' | 'online'): void
  claim<T>(mode: 'legacy' | 'online', operation: () => Promise<T> | T): Promise<T>
  release(mode: 'legacy' | 'online'): void
}
export function createCaptureLinkSignalingModeArbiter(): CaptureLinkSignalingModeArbiter
