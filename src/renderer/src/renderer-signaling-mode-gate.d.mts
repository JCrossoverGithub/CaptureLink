export type SignalMode = 'legacy' | 'online'
export declare function createRendererSignalingModeGate<TLegacy, TOnline>(
  legacy: TLegacy,
  online: TOnline
): Readonly<{
  mode(): SignalMode
  active(): boolean
  allowOnline(value: boolean): void
  select(mode: SignalMode): void
  begin(): TLegacy | TOnline
  current(): TLegacy | TOnline | null
  release(): TLegacy | TOnline | null
}>
