/**
 * UX3F-3B3C3: renderer-only selection between two already-authorized IPC paths.
 * A choice is frozen when an invitation starts. No automatic fallback can
 * silently switch the trust domain or reuse a failed invitation code.
 * Main's independent signaling-mode arbiter remains authoritative.
 */
const failed = () => new Error('signaling_mode_unavailable')

export function createRendererSignalingModeGate(legacy, online) {
  for (const value of [legacy, online]) {
    if (!value || ['create', 'join', 'snapshot', 'approve', 'send', 'messages', 'end']
      .some(name => typeof value[name] !== 'function')) throw failed()
  }
  let selected = 'legacy'
  let current = null
  let onlineAllowed = false
  const selectedBackend = () => current === 'online' ? online : current === 'legacy' ? legacy : null
  return Object.freeze({
    mode: () => current ?? selected,
    active: () => current !== null,
    allowOnline(value) {
      if (typeof value !== 'boolean') throw failed()
      onlineAllowed = value
      if (!value && !current && selected === 'online') selected = 'legacy'
    },
    select(next) {
      if (current || (next !== 'legacy' && next !== 'online') ||
          (next === 'online' && !onlineAllowed)) throw failed()
      selected = next
    },
    begin() {
      if (current || (selected === 'online' && !onlineAllowed)) throw failed()
      current = selected
      return current === 'online' ? online : legacy
    },
    current: selectedBackend,
    release() {
      const value = selectedBackend()
      current = null
      return value
    },
  })
}
