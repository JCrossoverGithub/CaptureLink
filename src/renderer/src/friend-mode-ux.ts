/**
 * CAPTURELINK_FRIEND_MODE_UX_PHASE3_2026_10_22
 * Compact, progressive-disclosure presentation for the existing Direct Friend UI.
 * Never starts a session or accesses the clipboard. Existing buttons retain
 * their handlers and DOM identity; this only adds discovery/role guidance.
 */

type FriendFlowRole = 'host' | 'join'

export function installFriendModeUx(): void {
  const card = document.querySelector<HTMLElement>('.friend-controller-card')
  const hostAction = document.querySelector<HTMLButtonElement>('#friend-direct-host')
  const joinAction = document.querySelector<HTMLButtonElement>('#friend-direct-join')
  const cancelAction = document.querySelector<HTMLButtonElement>('#friend-direct-cancel')
  const status = document.querySelector<HTMLElement>('#friend-direct-status')
  if (!card || !hostAction || !joinAction || !cancelAction || !status) {
    console.warn('[CaptureLink] Compact Friend Mode unavailable: original UI is missing.')
    return
  }

  // Keep all existing elements and their listeners in the original container.
  // Only direct-child containers are collapsed, never operational controls.
  const existingSections = Array.from(card.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement
  )
  existingSections.forEach((section) => {
    section.classList.add('friend-ux-advanced-section')
  })

  const entry = document.createElement('section')
  entry.className = 'friend-ux-entry'
  entry.setAttribute('aria-label', 'Friend Mode')
  entry.innerHTML = `
    <div class="friend-ux-heading">
      <div>
        <div class="friend-ux-eyebrow">FRIEND MODE</div>
        <h3>Play with a friend</h3>
      </div>
      <span class="friend-ux-direct">Direct P2P</span>
    </div>
    <p class="friend-ux-intro">Share your Xbox gameplay and controller input with another CaptureLink user.</p>
    <div class="friend-ux-role-picker" role="group" aria-label="Choose how to use Friend Mode">
      <button type="button" class="friend-ux-role" data-friend-role="host" aria-controls="friend-ux-flow" aria-expanded="false">
        <span class="friend-ux-role-label">Host a friend</span>
        <small>Share your Xbox</small>
      </button>
      <button type="button" class="friend-ux-role" data-friend-role="join" aria-controls="friend-ux-flow" aria-expanded="false">
        <span class="friend-ux-role-label">Join a friend</span>
        <small>Play on their Xbox</small>
      </button>
    </div>
    <div id="friend-ux-flow" class="friend-ux-flow" hidden>
      <p id="friend-ux-guidance" class="friend-ux-guidance"></p>
      <p class="friend-ux-limit">Direct Invite exchanges clipboard messages. Friend video is supported; friend game audio is not yet forwarded.</p>
      <button type="button" class="friend-ux-close">Hide Friend Mode options</button>
    </div>
  `
  card.prepend(entry)

  const hostChoice = entry.querySelector<HTMLButtonElement>('[data-friend-role="host"]')
  const joinChoice = entry.querySelector<HTMLButtonElement>('[data-friend-role="join"]')
  const flow = entry.querySelector<HTMLDivElement>('#friend-ux-flow')
  const guidance = entry.querySelector<HTMLParagraphElement>('#friend-ux-guidance')
  const close = entry.querySelector<HTMLButtonElement>('.friend-ux-close')
  if (!hostChoice || !joinChoice || !flow || !guidance || !close) return

  function setExpanded(expanded: boolean, role: FriendFlowRole | null): void {
    card!.dataset.friendUxRole = expanded ? (role ?? 'all') : 'closed'
    for (const section of existingSections) section.hidden = !expanded
    flow!.hidden = !expanded
    hostChoice!.setAttribute('aria-expanded', String(expanded))
    joinChoice!.setAttribute('aria-expanded', String(expanded))
    hostChoice!.setAttribute('aria-pressed', String(expanded && role === 'host'))
    joinChoice!.setAttribute('aria-pressed', String(expanded && role === 'join'))
    if (role === 'host') {
      guidance!.textContent = 'Connect to your Xbox first. Choose a controller mode, then select Host Direct below and share the copied invite. Your friend will return a response.'
    } else if (role === 'join') {
      guidance!.textContent = 'Ask your host for their Direct Invite, copy it to your clipboard, then select Join from Clipboard below. Return the response to your host.'
    } else {
      guidance!.textContent = 'Use the Direct Invite controls below to manage your session.'
    }
  }

  hostChoice.addEventListener('click', () => {
    setExpanded(true, 'host')
    if (!hostAction.disabled) hostAction.focus()
  })
  joinChoice.addEventListener('click', () => {
    setExpanded(true, 'join')
    if (!joinAction.disabled) joinAction.focus()
  })
  close.addEventListener('click', () => {
    // An active invitation should remain visible for Cancel and status access.
    if (!cancelAction.hidden) return
    setExpanded(false, null)
    hostChoice.focus()
  })

  // Direct invitations may also start from keyboard shortcuts or other UI.
  // Never conceal an in-progress Cancel button behind the compact entry.
  const cancelObserver = new MutationObserver(() => {
    if (!cancelAction.hidden && flow.hidden) setExpanded(true, null)
    close.disabled = !cancelAction.hidden
    close.title = close.disabled ? 'End the current invitation before hiding its controls' : ''
  })
  cancelObserver.observe(cancelAction, { attributes: true, attributeFilter: ['hidden'] })
  setExpanded(!cancelAction.hidden, null)
  close.disabled = !cancelAction.hidden
}
