/**
 * CAPTURELINK_FRIEND_INVITE_GUIDE_PHASE3B_2026_10_22
 * UX only. The existing Direct Host/Join/Cancel and P2P handlers remain owners
 * of session lifecycle. Invite/response strings are in-memory only, never
 * logged, persisted, or sent to an external service by this module.
 */

type PayloadKind = 'invite' | 'response'
type ClipboardApi = {
  readFriendClipboard(): Promise<string>
  writeFriendClipboard(value: string): Promise<void>
}

const DIRECT_PREFIX = 'CAPTURELINK-DIRECT-V1:'
const MAX_PAYLOAD_LENGTH = 1_000_000

/** Validates a pasted envelope's role before passing it to existing handlers. */
function matchesDirectEnvelope(value: string, kind: PayloadKind): boolean {
  const trimmed = value.trim()
  if (!trimmed.startsWith(DIRECT_PREFIX) || trimmed.length > MAX_PAYLOAD_LENGTH) {
    return false
  }
  try {
    const candidate: unknown = JSON.parse(atob(trimmed.slice(DIRECT_PREFIX.length)))
    if (candidate === null || typeof candidate !== 'object') return false
    const data = candidate as Record<string, unknown>
    if (data.version !== 1 || data.type !== kind) return false
    if (kind === 'invite') {
      return typeof data.offer === 'string' && data.offer.length > 0 &&
        (data.controllerMode === 'shared' || data.controllerMode === 'player2')
    }
    return typeof data.answer === 'string' && data.answer.length > 0
  } catch {
    return false
  }
}

export function installFriendInviteGuide(): void {
  const card = document.querySelector<HTMLElement>('.friend-controller-card')
  const flow = card?.querySelector<HTMLElement>('#friend-ux-flow')
  const status = card?.querySelector<HTMLElement>('#friend-direct-status')
  const hostAction = card?.querySelector<HTMLButtonElement>('#friend-direct-host')
  const joinAction = card?.querySelector<HTMLButtonElement>('#friend-direct-join')
  const cancelAction = card?.querySelector<HTMLButtonElement>('#friend-direct-cancel')
  const clipboard = (window as Window & { captureLink?: ClipboardApi }).captureLink
  if (!card || !flow || !status || !hostAction || !joinAction || !cancelAction ||
      !clipboard?.readFriendClipboard || !clipboard?.writeFriendClipboard) {
    console.warn('[CaptureLink] Guided Friend invites unavailable; original Direct Invite remains available.')
    return
  }
  if (flow.querySelector('.friend-invite-guide')) return
  // Stable non-null aliases for callbacks that outlive the initial DOM guard.
  const cancelButton = cancelAction
  const joinButton = joinAction
  const api = clipboard

  const guide = document.createElement('section')
  guide.className = 'friend-invite-guide'
  guide.setAttribute('aria-label', 'Direct Friend invitation steps')
  guide.hidden = true
  guide.innerHTML = `
    <div class="friend-invite-guide__host" hidden>
      <p class="friend-invite-guide__step"><strong>1 · Start hosting</strong><span>Connect to your Xbox, choose the controller mode, and use Host Direct below.</span></p>
      <div class="friend-invite-guide__outbound friend-invite-guide__invite" hidden>
        <p class="friend-invite-guide__step"><strong>2 · Share your invite</strong><span>Your invite is ready. Send it privately to the person you want to play with.</span></p>
        <button type="button" class="friend-invite-guide__button" data-invite-copy>Copy invite again</button>
      </div>
      <div class="friend-invite-guide__answer" hidden>
        <p class="friend-invite-guide__step"><strong>3 · Receive their response</strong><span>Paste their reply below, or copy it normally; CaptureLink also watches your clipboard while hosting.</span></p>
        <label for="friend-invite-guide-answer">Friend's response</label>
        <textarea id="friend-invite-guide-answer" rows="3" spellcheck="false" autocomplete="off" placeholder="Paste the CaptureLink response here"></textarea>
        <button type="button" class="friend-invite-guide__button" data-answer-submit>Use this response</button>
      </div>
    </div>
    <div class="friend-invite-guide__guest" hidden>
      <p class="friend-invite-guide__step"><strong>1 · Enter your friend's invite</strong><span>Ask your host for their invite and paste it below. You don't need to copy it to the clipboard first.</span></p>
      <label for="friend-invite-guide-offer">Host's invite</label>
      <textarea id="friend-invite-guide-offer" rows="3" spellcheck="false" autocomplete="off" placeholder="Paste the CaptureLink invite here"></textarea>
      <button type="button" class="friend-invite-guide__button" data-offer-submit>Join using pasted invite</button>
      <div class="friend-invite-guide__outbound friend-invite-guide__response" hidden>
        <p class="friend-invite-guide__step"><strong>2 · Return your response</strong><span>Send the generated response to your host. Their CaptureLink app finishes the connection when they use it.</span></p>
        <button type="button" class="friend-invite-guide__button" data-response-copy>Copy response again</button>
      </div>
    </div>
    <p class="friend-invite-guide__feedback" role="status" aria-live="polite"></p>
    <p class="friend-invite-guide__privacy">Invites and responses can contain connection details. Share only with your intended friend. No invite data is stored by this guide.</p>
  `
  const note = flow.querySelector('.friend-ux-limit')
  flow.insertBefore(guide, note ?? null)

  const hostPanel = guide.querySelector<HTMLElement>('.friend-invite-guide__host')!
  const guestPanel = guide.querySelector<HTMLElement>('.friend-invite-guide__guest')!
  const invitePanel = guide.querySelector<HTMLElement>('.friend-invite-guide__invite')!
  const answerPanel = guide.querySelector<HTMLElement>('.friend-invite-guide__answer')!
  const responsePanel = guide.querySelector<HTMLElement>('.friend-invite-guide__response')!
  const offerInput = guide.querySelector<HTMLTextAreaElement>('#friend-invite-guide-offer')!
  const answerInput = guide.querySelector<HTMLTextAreaElement>('#friend-invite-guide-answer')!
  const offerSubmit = guide.querySelector<HTMLButtonElement>('[data-offer-submit]')!
  const answerSubmit = guide.querySelector<HTMLButtonElement>('[data-answer-submit]')!
  const inviteCopy = guide.querySelector<HTMLButtonElement>('[data-invite-copy]')!
  const responseCopy = guide.querySelector<HTMLButtonElement>('[data-response-copy]')!
  const feedback = guide.querySelector<HTMLElement>('.friend-invite-guide__feedback')!

  let savedInvite: string | null = null
  let savedResponse: string | null = null
  let lastStatus = ''
  let generation = 0
  let pending = false

  const tell = (message: string): void => { feedback.textContent = message }
  const role = (): string => card.dataset.friendUxRole ?? 'closed'
  const currentStatus = (): string => status.textContent?.trim() ?? ''

  function render(): void {
    const currentRole = role()
    const host = currentRole === 'host'
    const guest = currentRole === 'join'
    const active = !cancelButton.hidden
    const connected = /Connected directly to Friend/i.test(currentStatus())
    guide.hidden = !host && !guest
    hostPanel.hidden = !host
    guestPanel.hidden = !guest
    invitePanel.hidden = !host || !active || !savedInvite
    answerPanel.hidden = !host || !active || connected
    responsePanel.hidden = !guest || !active || !savedResponse
    offerSubmit.disabled = pending || joinButton.disabled || active
    answerSubmit.disabled = pending || !active || connected
    inviteCopy.disabled = pending || !savedInvite
    responseCopy.disabled = pending || !savedResponse
  }

  async function captureOutgoing(kind: PayloadKind, ticket: number): Promise<void> {
    try {
      const value = (await api.readFriendClipboard()).trim()
      if (ticket !== generation || !matchesDirectEnvelope(value, kind)) return
      if (kind === 'invite') savedInvite = value
      else savedResponse = value
      render()
    } catch {
      // Keep the original Direct Invite working even when a guide-specific copy fails.
      tell('Could not retain a copy of the message. Use the original clipboard workflow below.')
    }
  }

  function statusChanged(): void {
    const value = currentStatus()
    if (lastStatus !== value) {
      lastStatus = value
      const ticket = generation
      if (value.startsWith('Invite copied.')) void captureOutgoing('invite', ticket)
      if (value.startsWith('Response copied.')) void captureOutgoing('response', ticket)
      if (/Connected directly to Friend/i.test(value)) tell('Friend connected successfully.')
    }
    render()
  }

  // Existing Direct buttons still own connection state. Guide observes only UI state.
  const statusObserver = new MutationObserver(statusChanged)
  statusObserver.observe(status, { childList: true, characterData: true, subtree: true })
  const roleObserver = new MutationObserver(render)
  roleObserver.observe(card, { attributes: true, attributeFilter: ['data-friend-ux-role'] })
  const cancelObserver = new MutationObserver(() => {
    if (cancelButton.hidden) {
      generation += 1
      savedInvite = null
      savedResponse = null
      offerInput.value = ''
      answerInput.value = ''
    }
    render()
  })
  cancelObserver.observe(cancelAction, { attributes: true, attributeFilter: ['hidden'] })

  hostAction.addEventListener('click', () => {
    if (hostAction.disabled) return
    generation += 1
    savedInvite = null
    savedResponse = null
    tell('Creating your invite using the original Direct Host connection flow…')
    render()
  })
  joinAction.addEventListener('click', () => {
    if (joinButton.disabled) return
    generation += 1
    savedResponse = null
    tell('Joining using the current clipboard invite…')
    render()
  })
  cancelAction.addEventListener('click', () => {
    generation += 1
    savedInvite = null
    savedResponse = null
    offerInput.value = ''
    answerInput.value = ''
    tell('Invitation cancelled.')
  })

  offerSubmit.addEventListener('click', () => {
    void (async () => {
      if (pending || joinButton.disabled || !cancelButton.hidden) return
      const value = offerInput.value.trim()
      if (!matchesDirectEnvelope(value, 'invite')) {
        tell('That is not a valid CaptureLink host invite. Check that you pasted the full message.')
        return
      }
      pending = true
      render()
      try {
        // Legacy Join reads from the native clipboard. Reuse it rather than
        // creating a second peer/session implementation.
        await api.writeFriendClipboard(value)
        offerInput.value = ''
        tell('Invite accepted. Creating your response…')
        joinButton.click()
      } catch {
        tell('Could not place the invite on the clipboard. The original Join from Clipboard action is still available.')
      } finally {
        pending = false
        render()
      }
    })()
  })

  answerSubmit.addEventListener('click', () => {
    void (async () => {
      if (pending || cancelButton.hidden) return
      const value = answerInput.value.trim()
      if (!matchesDirectEnvelope(value, 'response')) {
        tell('That is not a valid CaptureLink response. Ask your friend for the complete reply.')
        return
      }
      pending = true
      render()
      try {
        // The existing host response monitor will recognize this clipboard value.
        await api.writeFriendClipboard(value)
        answerInput.value = ''
        tell('Response submitted. CaptureLink is checking it to complete the connection…')
      } catch {
        tell('Could not submit the response. You can still copy it manually while hosting.')
      } finally {
        pending = false
        render()
      }
    })()
  })

  inviteCopy.addEventListener('click', () => {
    void (async () => {
      if (!savedInvite) return
      try {
        await api.writeFriendClipboard(savedInvite)
        tell('Invite copied. Send it privately to your friend.')
      } catch { tell('Could not copy the invite. Try hosting again to create a new invite.') }
    })()
  })
  responseCopy.addEventListener('click', () => {
    void (async () => {
      if (!savedResponse) return
      try {
        await api.writeFriendClipboard(savedResponse)
        tell('Response copied. Send it back to your host.')
      } catch { tell('Could not copy the response. Try the original clipboard workflow.') }
    })()
  })

  lastStatus = currentStatus()
  render()
}
