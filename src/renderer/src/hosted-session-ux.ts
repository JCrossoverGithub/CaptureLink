/**
 * UX3b1 — optional loopback-hosted invitation UI.
 * The UX2 renderer coordinator still owns the actual WebRTC transports.
 * No broker bearer credentials, raw SDP/ICE, or user identity are displayed.
 */
import type { SessionCapabilities, UnifiedSessionCoordinator } from './unified-session-core'

type HostedRole = 'host' | 'guest'

export interface HostedSessionUx {
  open(role: HostedRole): void
  end(): Promise<void>
  isActive(): boolean
}

export function installHostedSessionUx(
  overlay: HTMLElement,
  coordinator: UnifiedSessionCoordinator,
  getCapabilities: () => SessionCapabilities,
  onNegotiated: () => void,
  onActiveChange: (active: boolean) => void = () => {}
): HostedSessionUx {
  const setup = overlay.querySelector<HTMLElement>('#clux2-setup')!
  const manualFlow = overlay.querySelector<HTMLElement>('#clux2-unified-flow')!
  const manual = document.createElement('details')
  manual.id = 'clux3-manual-fallback'
  manual.className = 'clux2-advanced'
  const summary = document.createElement('summary')
  summary.textContent = 'Use manual invitation instead (fallback)'
  manual.append(summary)
  manualFlow.before(manual)
  manual.append(manualFlow) // Original UX2 DOM and event listeners are preserved.

  const hosted = document.createElement('section')
  hosted.id = 'clux3-hosted'
  hosted.className = 'clux3-hosted'
  hosted.setAttribute('aria-label', 'Local hosted invitation')
  hosted.innerHTML = `
    <p class="clux3-note">Local prototype: both CaptureLink clients must use the signaling service on this same computer. Remote joining is not available yet.</p>
    <div id="clux3-host" hidden>
      <button id="clux3-create" class="clux2-primary" type="button">Create local invitation</button>
      <div id="clux3-code-group" hidden>
        <label for="clux3-code">Private, one-use invitation code</label>
        <textarea id="clux3-code" rows="2" readonly spellcheck="false"></textarea>
        <button id="clux3-copy" class="clux2-subtle" type="button">Copy code</button>
      </div>
      <div id="clux3-approval" hidden>
        <p><strong id="clux3-requester">A guest</strong> wants to join your session.</p>
        <p class="clux3-note">This name was entered by the guest and has NOT been verified. Approve only someone you recognize.</p>
        <div class="clux3-actions">
          <button id="clux3-approve" class="clux2-primary" type="button">Approve guest</button>
          <button id="clux3-reject" class="clux2-subtle" type="button">Reject</button>
        </div>
      </div>
    </div>
    <div id="clux3-guest" hidden>
      <label for="clux3-join-code">Invitation code from your friend</label>
      <textarea id="clux3-join-code" rows="2" spellcheck="false" placeholder="Paste the one-use code"></textarea>
      <label class="clux2-permission"><span><strong>Share my microphone</strong><small>Optional unless the host enables Xbox voice. Disabled by default.</small></span><input id="clux3-mic-consent" type="checkbox"></label>
      <button id="clux3-join" class="clux2-primary" type="button">Request to join</button>
    </div>
    <dialog id="clux3-name-dialog" class="clux3-name-dialog" aria-labelledby="clux3-name-title">
      <form id="clux3-name-form">
        <h3 id="clux3-name-title">What should your friend call you?</h3>
        <p>Your host will see this name when deciding whether to let you join. It is not verified.</p>
        <label for="clux3-guest-name">Your display name</label>
        <input id="clux3-guest-name" name="displayName" autocomplete="nickname" maxlength="32" required placeholder="Enter your name">
        <p id="clux3-name-error" class="clux3-name-error" role="alert" hidden>Use 1–32 letters, numbers, spaces, or . _ ' -</p>
        <p id="clux3-name-progress" role="status" aria-live="polite" hidden></p>
        <div class="clux3-name-actions">
          <button id="clux3-name-cancel" class="clux2-subtle" type="button">Cancel</button>
          <button id="clux3-name-submit" class="clux2-primary" type="submit">Send join request</button>
        </div>
      </form>
    </dialog>
    <p id="clux3-status" role="status" aria-live="polite">Ready.</p>
    <p class="clux3-end-hint">End session is always available in the Stream header and at the bottom of Friends while an invitation is active.</p>`
  manual.before(hosted)

  const el = <T extends HTMLElement>(id: string): T => hosted.querySelector<T>(`#${id}`)!
  const hostArea = el<HTMLElement>('clux3-host')
  const guestArea = el<HTMLElement>('clux3-guest')
  const status = el<HTMLElement>('clux3-status')
  const approval = el<HTMLElement>('clux3-approval')
  const createButton = el<HTMLButtonElement>('clux3-create')
  const joinButton = el<HTMLButtonElement>('clux3-join')
  const approveButton = el<HTMLButtonElement>('clux3-approve')
  const rejectButton = el<HTMLButtonElement>('clux3-reject')
  const requester = el<HTMLElement>('clux3-requester')
  const nameDialog = el<HTMLDialogElement>('clux3-name-dialog')
  const nameInput = el<HTMLInputElement>('clux3-guest-name')
  const nameError = el<HTMLElement>('clux3-name-error')
  const nameProgress = el<HTMLElement>('clux3-name-progress')
  const nameSubmitButton = el<HTMLButtonElement>('clux3-name-submit')
  const nameCancelButton = el<HTMLButtonElement>('clux3-name-cancel')
  const codeField = el<HTMLTextAreaElement>('clux3-code')
  let role: HostedRole = 'host'
  let active = false
  let epoch = 0
  let polling = false
  let hostOfferStarted = false
  let hostOfferSent = false
  let guestReplyStarted = false
  let hostAnswerAccepted = false
  let hostApproved = false
  let guestMicConsent = false
  let guestJoinPending = false
  let hostCapabilities: SessionCapabilities | null = null
  let timer: number | undefined

  const say = (text: string): void => { status.textContent = text }
  const stopTimer = (): void => {
    if (timer !== undefined) { window.clearInterval(timer); timer = undefined }
  }
  const resetTransports = (): void => {
    try { coordinator.reset() } catch { /* pending negotiation will reset after returning */ }
  }
  const displayError = (error: unknown): string => {
    const msg = error instanceof Error ? error.message : 'hosted_signaling_unavailable'
    const match = /(?:Error invoking remote method.*?: )?([a-z_]{3,64})$/.exec(msg)
    const code = match?.[1]
    const descriptions: Record<string, string> = {
      network_unavailable: 'Local signaling server unavailable. Start UX3a on this computer or use manual invitation.',
      hosted_signaling_unavailable: 'Local signaling is unavailable. Try the manual invitation.',
      not_found: 'Session ended or expired. Request a new code.',
      invitation_unavailable: 'Invitation expired or was already used.',
      invitation_expired: 'Invitation expired. Start a new session.',
      host_rejected: 'Host declined the join request.',
      no_matching_pending_guest: 'The join request is no longer pending.',
      rate_limited: 'Too many attempts. Try again later.',
      wrong_role: 'End the existing session before switching roles.',
      session_already_started: 'End the existing session before starting another.',
      invalid_invitation: 'Invitation not recognized. Ask the host for a fresh code and check that both apps use this signaling server.',
      invalid_display_name: 'Enter a valid display name before requesting access.',
      request_timeout: 'The local signaling server did not respond.',
    }
    return (code && descriptions[code]) || 'Local session setup failed. Use the manual invitation if needed.'
  }

  const end = async (): Promise<void> => {
    ++epoch
    active = false
    stopTimer()
    approval.hidden = true
    if (nameDialog.open) nameDialog.close()
    guestJoinPending = false
    nameSubmitButton.disabled = false
    nameCancelButton.disabled = false
    nameProgress.hidden = true
    nameInput.value = ''
    requester.textContent = 'A guest'
    codeField.value = ''
    el<HTMLElement>('clux3-code-group').hidden = true
    el<HTMLTextAreaElement>('clux3-join-code').value = ''
    createButton.disabled = false
    joinButton.disabled = false
    hostOfferStarted = false; hostOfferSent = false; guestReplyStarted = false
    hostAnswerAccepted = false; hostApproved = false; hostCapabilities = null
    let remoteRevoked = true
    try { await window.captureLink.hostedEnd() } catch { remoteRevoked = false }
    resetTransports()
    onActiveChange(false)
    say(remoteRevoked
      ? 'Local session ended. Your guest access has been revoked.'
      : 'Local sharing stopped. The broker could not confirm revocation; avoid reusing this invitation.')
  }
  const fail = async (error: unknown): Promise<void> => {
    const message = displayError(error)
    await end()
    say(message)
  }
  const current = (generation: number): boolean => active && generation === epoch

  const beginHostOffer = async (generation: number): Promise<void> => {
    hostOfferStarted = true
    try {
      say('Guest approved. Preparing authorized controller / voice connections…')
      if (!hostCapabilities) throw new Error('invalid_permissions')
      const wire = await coordinator.createInvitation(hostCapabilities)
      if (!current(generation)) { resetTransports(); return }
      await window.captureLink.hostedSend('invite', wire)
      if (!current(generation)) { resetTransports(); return }
      hostOfferSent = true
      say('Invitation delivered. Waiting for the guest response…')
    } catch (error) { if (current(generation)) await fail(error); else resetTransports() }
  }
  const beginGuestReply = async (wire: string, generation: number): Promise<void> => {
    guestReplyStarted = true
    try {
      say('Host approved. Negotiating the permitted connections…')
      const response = await coordinator.joinInvitation(wire, guestMicConsent)
      if (!current(generation)) { resetTransports(); return }
      await window.captureLink.hostedSend('response', response)
      if (!current(generation)) { resetTransports(); return }
      say('Response delivered. Verify controller, gameplay video, and Xbox chat separately.')
      onNegotiated()
    } catch (error) { if (current(generation)) await fail(error); else resetTransports() }
  }

  const poll = async (): Promise<void> => {
    if (!active || polling) return
    polling = true
    const generation = epoch
    try {
      const snap = await window.captureLink.hostedSnapshot()
      if (!current(generation)) return
      if (snap.status === 'rejected') throw new Error('host_rejected')
      if (role === 'host') {
        if (snap.hasPendingGuest && !hostApproved) {
          requester.textContent = snap.guestDisplayName || 'Unnamed guest'
          approval.hidden = false
          say('Join request received. Approve only if you know who has the code.')
        }
        if (snap.status === 'approved' && hostApproved && !hostOfferStarted) {
          void beginHostOffer(generation)
        }
        if (hostOfferSent && !hostAnswerAccepted) {
          const messages = await window.captureLink.hostedMessages()
          if (!current(generation)) return
          const answer = messages.find(x => x.kind === 'response')
          if (answer) {
            hostAnswerAccepted = true
            try {
              await coordinator.acceptResponse(answer.payload)
              if (!current(generation)) { resetTransports(); return }
              say('Response accepted. Verify actual P2P and Xbox chat connections.')
              onNegotiated()
            } catch (error) { await fail(error) }
          }
        }
      } else if (snap.status === 'approved' && !guestReplyStarted) {
        const messages = await window.captureLink.hostedMessages()
        if (!current(generation)) return
        const invite = messages.find(x => x.kind === 'invite')
        if (invite) void beginGuestReply(invite.payload, generation)
      }
    } catch (error) {
      if (current(generation)) await fail(error)
    } finally { polling = false }
  }
  const startPolling = (): void => {
    stopTimer()
    timer = window.setInterval(() => { void poll() }, 650)
  }

  const open = (nextRole: HostedRole): void => {
    if (active && role !== nextRole) {
      say('End the existing local session before switching roles.')
      return
    }
    role = nextRole
    hostArea.hidden = role !== 'host'
    guestArea.hidden = role !== 'guest'
    manual.open = false
    say(active ? 'Local session in progress.' : 'Ready to use the local signaling prototype.')
    // Never silently revoke a session just because the Friend drawer was closed.
  }
  createButton.addEventListener('click', () => {
    if (active) return
    if (coordinator.snapshot().phase !== 'idle' && coordinator.snapshot().phase !== 'failed') {
      say('End the existing manual session before creating a hosted invitation.'); return
    }
    hostCapabilities = getCapabilities()
    manual.open = false
    const generation = ++epoch
    role = 'host'; active = true
    createButton.disabled = true; onActiveChange(true)
    void (async () => {
      try {
        say('Creating a local invitation…')
        const result = await window.captureLink.hostedCreate(hostCapabilities!)
        if (!current(generation)) return
        codeField.value = result.inviteCode
        el<HTMLElement>('clux3-code-group').hidden = false
        say('Share this one-use code privately. Waiting for a join request…')
        startPolling()
      } catch (error) { if (current(generation)) await fail(error) }
    })()
  })
  joinButton.addEventListener('click', () => {
    if (active || nameDialog.open || guestJoinPending) return
    if (coordinator.snapshot().phase !== 'idle' && coordinator.snapshot().phase !== 'failed') {
      say('End the existing manual session before joining a hosted one.'); return
    }
    const code = el<HTMLTextAreaElement>('clux3-join-code').value.trim()
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
      say('Enter a complete, valid invitation code first.'); return
    }
    nameError.hidden = true
    nameProgress.hidden = true
    nameDialog.showModal()
    nameInput.focus()
  })
  nameCancelButton.addEventListener('click', () => {
    if (!guestJoinPending) nameDialog.close()
  })
  nameDialog.addEventListener('cancel', event => {
    // Do not allow Escape to dismiss the modal during an in-flight join request.
    if (guestJoinPending) event.preventDefault()
  })
  el<HTMLFormElement>('clux3-name-form').addEventListener('submit', event => {
    event.preventDefault()
    if (active || guestJoinPending) return
    const name = nameInput.value.normalize('NFKC').trim().replace(/ +/g, ' ')
    if ([...name].length < 1 || [...name].length > 32 ||
        !/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} ._'-]*$/u.test(name)) {
      nameError.textContent = "Use 1–32 letters, numbers, spaces, or . _ ' -"
      nameError.hidden = false
      nameInput.focus()
      return
    }
    const code = el<HTMLTextAreaElement>('clux3-join-code').value.trim()
    guestMicConsent = el<HTMLInputElement>('clux3-mic-consent').checked
    const generation = ++epoch
    role = 'guest'; active = true; guestJoinPending = true
    joinButton.disabled = true; nameSubmitButton.disabled = true; nameCancelButton.disabled = true
    nameError.hidden = true
    nameProgress.textContent = 'Requesting host approval…'
    nameProgress.hidden = false
    onActiveChange(true)
    void (async () => {
      try {
        say('Requesting host approval…')
        await window.captureLink.hostedJoin(code, name)
        if (!current(generation)) return
        // Only dismiss the guest name prompt after the broker accepted the join.
        nameDialog.close()
        nameInput.value = ''
        manual.open = false
        say('Waiting for the host to approve this request…')
        startPolling()
      } catch (error) {
        if (current(generation)) {
          // An invalid/expired code should not erase the guest's name or dismiss
          // the prompt. Keep both inputs available for correction and retry.
          const message = displayError(error)
          try { await window.captureLink.hostedEnd() } catch { /* best-effort local cleanup */ }
          if (current(generation)) {
            active = false
            ++epoch
            joinButton.disabled = false
            onActiveChange(false)
            say(message)
            nameError.textContent = message
            nameError.hidden = false
            nameInput.focus()
          }
        }
      } finally {
        guestJoinPending = false
        nameSubmitButton.disabled = false
        nameCancelButton.disabled = false
        nameProgress.hidden = true
      }
    })()
  })
  // Clicking the invitation field should select it, not dismiss the drawer.
  codeField.addEventListener('click', event => {
    event.stopPropagation()
    if (codeField.value) codeField.select()
  })
  approveButton.addEventListener('click', () => {
    if (!active || role !== 'host' || hostApproved) return
    approveButton.disabled = true
    const generation = epoch
    void (async () => {
      try {
        await window.captureLink.hostedApprove(true)
        if (!current(generation)) return
        hostApproved = true
        approval.hidden = true
        say('Guest approved. Preparing the invitation…')
      } catch (error) { await fail(error) }
      finally { approveButton.disabled = false }
    })()
  })
  rejectButton.addEventListener('click', () => {
    if (!active || role !== 'host') return
    void (async () => {
      try { await window.captureLink.hostedApprove(false) } catch { /* local cleanup still required */ }
      await end()
      say('Join request rejected. No controller, voice, or video was shared.')
    })()
  })
  el<HTMLButtonElement>('clux3-copy').addEventListener('click', () => {
    const value = el<HTMLTextAreaElement>('clux3-code').value
    if (!value) return
    void navigator.clipboard.writeText(value).then(() => say('Code copied. Share privately.'), () => say('Copy failed. Select and copy the code manually.'))
  })
  manual.addEventListener('toggle', () => {
    if (manual.open && active) {
      manual.open = false
      say('End the local hosted session before switching to manual exchange.')
    }
  })
  return { open, end, isActive: () => active }
}
