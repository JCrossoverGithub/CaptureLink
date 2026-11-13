/** UX3F-3B3C2: exclusive local/pilot OR online session startup in Electron main. */
const valid = new Set(['legacy', 'online'])
export function createCaptureLinkSignalingModeArbiter() {
  let owner = null
  return Object.freeze({
    mode() { return owner?.mode ?? null },
    active(mode) {
      if (!valid.has(mode) || owner?.mode !== mode) throw new Error('not_joined')
    },
    claim(mode, operation) {
      if (!valid.has(mode) || typeof operation !== 'function' || owner) {
        throw new Error('session_already_started')
      }
      const ticket = Object.freeze({ mode })
      owner = ticket
      // MUST invoke synchronously: both session clients install their abort
      // controller before a renderer End/sign-out can release this ticket.
      let work
      try { work = operation() } catch (error) {
        if (owner === ticket) owner = null
        throw error
      }
      return Promise.resolve(work).catch(error => {
        // A late failure from an already-ended session cannot release a newer
        // online/legacy reservation made while that failure was pending.
        if (owner === ticket) owner = null
        throw error
      })
    },
    release(mode) {
      if (!valid.has(mode)) throw new Error('not_joined')
      if (owner?.mode === mode) owner = null
    },
  })
}
