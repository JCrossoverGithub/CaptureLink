/** UX3F-3B2: development-only Auth0 controls, no bearer/token IPC. */
import './capturelink-online-settings.css'

export function installCaptureLinkOnlineSettings(): void {
  const grid = document.querySelector<HTMLElement>('.settings-grid')
  if (!grid) return
  const card = document.createElement('article')
  card.className = 'surface settings-card settings-card--online'
  card.hidden = true // Main process must explicitly enable a trusted development build.
  card.innerHTML = `
    <div class="settings-card__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9"/><path d="m9 12 2 2 5-5"/></svg>
    </div>
    <div class="settings-card__body">
      <div class="eyebrow">DEVELOPMENT ONLY</div>
      <h2>CaptureLink Online</h2>
      <p id="online-auth-status" role="status" aria-live="polite">Checking sign-in…</p>
      <small>Independent of Xbox. Sign-in does not enable public friend invitations.</small>
    </div>
    <button id="online-auth-action" type="button" class="settings-card__action" disabled>Sign in</button>`
  grid.insertBefore(card, grid.children[1] ?? null)
  const status = card.querySelector<HTMLElement>('#online-auth-status')!
  const action = card.querySelector<HTMLButtonElement>('#online-auth-action')!
  let busy = false
  let generation = 0
  async function refresh(): Promise<void> {
    const current = ++generation
    try {
      const value = await window.captureLink.onlineAuthStatus()
      if (current !== generation) return
      card.hidden = !value.enabled
      if (!value.enabled) return
      action.disabled = busy || value.pending
      action.textContent = value.authenticated ? 'Sign out' : 'Sign in'
      status.textContent = value.authenticated ? 'Signed in to CaptureLink Online (development)' :
        value.pending ? 'Complete sign-in in your browser…' : 'Not signed in to CaptureLink Online'
    } catch {
      if (current === generation) card.hidden = true
    }
  }
  action.addEventListener('click', () => {
    if (busy || action.disabled) return
    const signingOut = action.textContent === 'Sign out'
    busy = true
    action.disabled = true
    status.textContent = signingOut ? 'Signing out…' : 'Opening secure browser sign-in…'
    void (async () => {
      try {
        if (signingOut) {
          await window.captureLink.onlineAuthSignOut()
          status.textContent = 'Signed out locally. Your browser Auth0 session may remain active.'
        } else {
          await window.captureLink.onlineAuthBegin()
        }
      } catch {
        status.textContent = 'CaptureLink Online could not complete the operation. Please retry.'
      } finally {
        busy = false
        await refresh()
      }
    })()
  })
  // Poll only this safe boolean status, not tokens, while a login is pending.
  const poll = (): void => { if (!card.hidden && document.visibilityState === 'visible') void refresh() }
  window.setInterval(poll, 1500)
  window.addEventListener('focus', () => { void refresh() })
  void refresh()
}
