import type { UnifiedSessionCoordinator, SessionCapabilities } from './unified-session-core'
import { installHostedSessionUx } from './hosted-session-ux'
/**
 * CaptureLink UX1b — guided Friend panel on top of proven V1.5 transports.
 * This module owns navigation only. All actual P2P, mic permissions, Xbox
 * sender control and gamepad handling remain with their existing components.
 */
export interface UnifiedSessionSnapshot {
  role: 'idle' | 'host' | 'guest'
  consoleName: string | null
  connecting: boolean
  xboxConnected: boolean
  controllerPeer: 'host' | 'guest' | null
  guestVoiceForwarding: boolean
}

export interface UnifiedSessionUxOptions {
  startXbox: () => void
  coordinator: UnifiedSessionCoordinator
  getState: () => UnifiedSessionSnapshot
}

export interface UnifiedSessionUx {
  refresh: () => void
  close: () => void
}

type FlowRole = 'invite' | 'join'
type Page = 'home' | 'options' | 'setup' | 'session'
type Channel = 'controller' | 'voice'

export function installUnifiedSessionUx(
  options: UnifiedSessionUxOptions
): UnifiedSessionUx | null {
  const panel = document.querySelector<HTMLElement>('.view-panel[data-panel="stream"]')
  const workspace = panel?.querySelector<HTMLElement>('.stream-workspace')
  const rail = workspace?.querySelector<HTMLElement>('.context-rail')
  const hub = document.querySelector<HTMLElement>('#capturelink-shared-session-hub')
  if (!panel || !workspace || !rail || !hub) {
    console.warn('[CaptureLink:UX1b] Required V1.5 Stream elements were not found')
    return null
  }

  const header = document.createElement('header')
  header.className = 'clux1-header'
  header.setAttribute('aria-label', 'Session controls')
  header.innerHTML = `
    <div class="clux1-header-copy">
      <div class="clux1-eyebrow">CAPTURELINK</div>
      <h1 id="clux1-stream-heading">Play together</h1>
      <p id="clux1-stream-summary" role="status">Connect to an Xbox, or join a friend.</p>
    </div>
    <div class="clux1-actions">
      <button id="clux1-play" type="button" class="clux1-action clux1-action-primary">Play on my Xbox</button>
      <button id="clux1-join" type="button" class="clux1-action">Join a friend</button>
      <button id="clux1-invite" type="button" class="clux1-action clux1-action-primary" hidden>Invite friend</button>
      <button id="clux1-participants" type="button" class="clux1-action" hidden>Play together</button>
      <button id="clux1-end-hosted" type="button" class="clux1-action clux3-end-action" hidden>End friend session</button>
      <button id="clux1-details" type="button" class="clux1-action clux1-action-quiet" aria-expanded="false" aria-controls="clux1-console-details">Details</button>
    </div>`
  panel.prepend(header)

  // Move existing stateful components — never clone them or their handlers.
  const extras = document.createElement('details')
  extras.id = 'clux1-console-details'
  extras.className = 'clux1-console-details'
  extras.innerHTML = '<summary>Console and connection details</summary>'
  workspace.after(extras)
  extras.append(rail)

  const overlay = document.createElement('div')
  overlay.className = 'clux1-drawer-overlay'
  overlay.id = 'clux1-drawer-overlay'
  overlay.hidden = true
  overlay.innerHTML = `
    <aside class="clux1-drawer" role="dialog" aria-modal="true" aria-labelledby="clux1-drawer-title" aria-describedby="clux1-drawer-description">
      <div class="clux1-drawer-head">
        <div>
          <div class="clux1-eyebrow">PLAY TOGETHER</div>
          <h2 id="clux1-drawer-title">Friends</h2>
          <p id="clux1-drawer-description">Invite someone or join their session.</p>
        </div>
        <button id="clux1-close" type="button" class="clux1-close" aria-label="Close Friend panel">Close</button>
      </div>
      <div class="clux1-drawer-scroll">
        <section id="clux2-home" class="clux2-page" aria-label="Friends">
          <div class="clux2-choices">
            <button id="clux2-invite-choice" class="clux2-choice" type="button">
              <span class="clux2-choice-icon" aria-hidden="true">+</span>
              <span><strong>Invite a friend</strong><small>Let someone watch, talk, or play on your Xbox.</small></span>
              <span aria-hidden="true">›</span>
            </button>
            <button id="clux2-join-choice" class="clux2-choice" type="button">
              <span class="clux2-choice-icon" aria-hidden="true">↗</span>
              <span><strong>Join a friend</strong><small>Connect without signing in to their Xbox account.</small></span>
              <span aria-hidden="true">›</span>
            </button>
          </div>
          <div class="clux2-session-line"><span>Your session</span><strong id="clux2-home-status">No guests connected</strong></div>
          <button id="clux2-home-session" class="clux2-subtle" type="button" hidden>Manage active sharing</button>
        </section>

        <section id="clux2-options" class="clux2-page" aria-labelledby="clux2-options-title" hidden>
          <button id="clux2-options-back" type="button" class="clux2-back">← Friends</button>
          <h3 id="clux2-options-title">Invite a friend</h3>
          <p id="clux2-options-description" class="clux2-muted">What would you like them to do?</p>
          <div class="clux2-permissions">
            <label class="clux2-permission"><span><strong>Watch & listen</strong><small>Share gameplay video and Xbox audio.</small></span><input id="clux2-watch" type="checkbox"></label>
            <label class="clux2-permission"><span><strong>Voice chat</strong><small>Speak through the host's Xbox identity.</small></span><input id="clux2-voice" type="checkbox"></label>
            <label class="clux2-permission"><span><strong>Controller</strong><small>Play together or as Player 2.</small></span><input id="clux2-controller" type="checkbox" checked></label>
            <fieldset class="clux2-controller-mode" id="clux2-controller-mode">
              <legend>Controller mode</legend>
              <label><input type="radio" name="clux2-mode" value="shared" checked> Shared Controller (Player 1 together)</label>
              <label><input type="radio" name="clux2-mode" value="player2"> Separate Player 2 controller</label>
            </fieldset>
          </div>
          <p id="clux2-permission-note" class="clux2-muted">Your friend never gets Xbox account access. Permissions are confirmed during setup.</p>
          <button id="clux2-continue" type="button" class="clux2-primary">Continue</button>
        </section>

        <section id="clux2-setup" class="clux2-page" aria-labelledby="clux2-setup-title" hidden>
          <button id="clux2-setup-back" type="button" class="clux2-back">← Sharing options</button>
          <div id="clux2-step-count" class="clux1-eyebrow">STEP 1 OF 1</div>
          <h3 id="clux2-setup-title">Controller connection</h3>
          <p id="clux2-setup-description" class="clux2-muted"></p>
          <div id="clux2-unified-flow" class="clux2-unified-flow">
            <div id="clux2-unified-host" hidden>
              <button id="clux2-create-invite" type="button" class="clux2-primary">Create invitation</button>
              <label for="clux2-bundle-offer">Private invitation — send this to your friend</label>
              <textarea id="clux2-bundle-offer" rows="4" readonly spellcheck="false"></textarea>
              <button id="clux2-copy-offer" type="button" class="clux2-subtle">Copy invitation</button>
              <label for="clux2-bundle-answer">Guest response — paste here</label>
              <textarea id="clux2-bundle-answer" rows="4" spellcheck="false"></textarea>
              <button id="clux2-accept-answer" type="button" class="clux2-primary">Complete connection</button>
            </div>
            <div id="clux2-unified-guest" hidden>
              <label for="clux2-guest-offer">Paste invitation from the host</label>
              <textarea id="clux2-guest-offer" rows="4" spellcheck="false"></textarea>
              <label class="clux2-permission"><span><strong>Allow microphone when invited</strong><small>Only for voice-enabled invitations. Watch-only will not open your microphone.</small></span><input id="clux2-guest-mic-consent" type="checkbox"></label>
              <button id="clux2-join-invite" type="button" class="clux2-primary">Join session</button>
              <label for="clux2-guest-answer">Your response — send privately to the host</label>
              <textarea id="clux2-guest-answer" rows="4" readonly spellcheck="false"></textarea>
              <button id="clux2-copy-answer" type="button" class="clux2-subtle">Copy response</button>
            </div>
            <p class="clux2-muted">Manual fallback: exchange one private invitation and one response. Avoid sharing signaling data publicly.</p>
            <p id="clux2-unified-status" role="status" aria-live="polite"></p>
            <button id="clux2-unified-end" type="button" class="clux2-subtle">Cancel / end setup</button>
          </div>
          <details id="clux2-legacy-details" class="clux2-advanced">
            <summary>Troubleshoot separate connections</summary>
            <p class="clux2-codes-note">For troubleshooting only: older separate controller and voice invitation flows are preserved.</p>
            <div id="clux1-legacy-slot" class="clux1-legacy-slot"></div>
          </details>
          <div class="clux2-flow-actions">
            <button id="clux2-previous-step" type="button" class="clux2-subtle" hidden>Previous step</button>
            <button id="clux2-next-step" type="button" class="clux2-primary" hidden>Next: Voice connection</button>
            <button id="clux2-done" type="button" class="clux2-primary" hidden>View session</button>
          </div>
        </section>

        <section id="clux2-session" class="clux2-page" aria-labelledby="clux2-session-title" hidden>
          <button id="clux2-session-back" type="button" class="clux2-back">← Friends</button>
          <h3 id="clux2-session-title">Your session</h3>
          <p class="clux2-muted">Session negotiation is coordinated. Controller, video and Xbox chat status must still be checked independently.</p>
          <div class="clux2-status-row"><span>Controller</span><strong id="clux2-controller-status">Not started</strong></div>
          <div class="clux2-status-row"><span>Xbox voice mixer</span><strong id="clux2-voice-status">Not attached</strong></div>
          <p class="clux2-muted">An active mixer does not prove that players in Xbox chat can hear the guest.</p>
          <button id="clux3-session-end" class="clux2-subtle" type="button" hidden>End hosted session</button>
          <button id="clux2-manage-controller" class="clux2-choice clux2-choice-compact" type="button">Manage controller connection <span aria-hidden="true">›</span></button>
          <button id="clux2-manage-voice" class="clux2-choice clux2-choice-compact" type="button">Manage microphone and media <span aria-hidden="true">›</span></button>
        </section>
      </div>
      <div id="clux3-active-bar" class="clux3-active-bar" hidden>
        <div class="clux3-active-label"><span class="clux3-live-dot" aria-hidden="true"></span><span>Friend invitation or sharing active</span></div>
        <button id="clux3-end-footer" class="clux3-end-action" type="button">End session</button>
      </div>
    </aside>`
  document.body.append(overlay)
  const confirmDialog = document.createElement('dialog')
  confirmDialog.id = 'clux3-end-confirm'
  confirmDialog.className = 'clux3-end-confirm'
  confirmDialog.setAttribute('aria-labelledby', 'clux3-confirm-heading')
  confirmDialog.setAttribute('aria-describedby', 'clux3-confirm-description')
  confirmDialog.innerHTML = `
    <h2 id="clux3-confirm-heading">End this friend session?</h2>
    <p id="clux3-confirm-description">This stops your hosted invitation and locally releases the friend controller, microphone and media connections. Your Xbox Remote Play connection stays open.</p>
    <div class="clux3-confirm-actions">
      <button id="clux3-confirm-keep" type="button">Keep session</button>
      <button id="clux3-confirm-end" class="clux3-end-action" type="button">End session</button>
    </div>`
  document.body.append(confirmDialog)
  const legacySlot = overlay.querySelector<HTMLElement>('#clux1-legacy-slot')!
  legacySlot.append(hub)
  const legacyDetails = overlay.querySelector<HTMLDetailsElement>('#clux2-legacy-details')!
  const unifiedFlow = overlay.querySelector<HTMLElement>('#clux2-unified-flow')!
  const unifiedStatus = overlay.querySelector<HTMLElement>('#clux2-unified-status')!
  let legacyRecovery = false

  const playButton = header.querySelector<HTMLButtonElement>('#clux1-play')!
  const joinButton = header.querySelector<HTMLButtonElement>('#clux1-join')!
  const inviteButton = header.querySelector<HTMLButtonElement>('#clux1-invite')!
  const participantsButton = header.querySelector<HTMLButtonElement>('#clux1-participants')!
  const headerEndButton = header.querySelector<HTMLButtonElement>('#clux1-end-hosted')!
  const activeBar = overlay.querySelector<HTMLElement>('#clux3-active-bar')!
  const footerEndButton = overlay.querySelector<HTMLButtonElement>('#clux3-end-footer')!
  const keepButton = confirmDialog.querySelector<HTMLButtonElement>('#clux3-confirm-keep')!
  const confirmEndButton = confirmDialog.querySelector<HTMLButtonElement>('#clux3-confirm-end')!
  const detailsButton = header.querySelector<HTMLButtonElement>('#clux1-details')!
  const heading = header.querySelector<HTMLElement>('#clux1-stream-heading')!
  const summary = header.querySelector<HTMLElement>('#clux1-stream-summary')!
  const title = overlay.querySelector<HTMLElement>('#clux1-drawer-title')!
  const description = overlay.querySelector<HTMLElement>('#clux1-drawer-description')!
  const closeButton = overlay.querySelector<HTMLButtonElement>('#clux1-close')!
  const inviteChoice = overlay.querySelector<HTMLButtonElement>('#clux2-invite-choice')!
  const joinChoice = overlay.querySelector<HTMLButtonElement>('#clux2-join-choice')!
  const controllerPanel = hub.querySelector<HTMLDetailsElement>('#session-hub-controller')
  const voicePanel = hub.querySelector<HTMLDetailsElement>('#session-hub-voice')
  // Keep advanced diagnostics available without putting them in the default flow.
  // These are the original elements: moving them retains all existing listeners.
  const moveIntoAdvanced = (section: HTMLElement | null, label: string, selectors: string[]): void => {
    if (!section) return
    const details = document.createElement('details')
    details.className = 'clux2-advanced'
    const summary = document.createElement('summary')
    summary.textContent = label
    details.append(summary)
    let count = 0
    for (const selector of selectors) {
      const element = section.querySelector<HTMLElement>(selector)
      if (element) { details.append(element); count++ }
    }
    if (count) section.append(details)
  }
  moveIntoAdvanced(hub.querySelector<HTMLElement>('.friend-controller-card'), 'Controller details', [
    '.friend-controller-facts', '#friend-controller-mode-tip'
  ])
  moveIntoAdvanced(hub.querySelector<HTMLElement>('.shared-voice-role[aria-label="Host voice sharing"]'), 'Voice settings & diagnostics', [
    'label:has(#sv-host-monitor)', 'label[for="sv-host-volume"]', '#sv-host-volume',
    '.sv-diagnostics', '#sv-host-retry-mix', '#sv-host-copy-diagnostics'
  ])
  moveIntoAdvanced(hub.querySelector<HTMLElement>('.shared-voice-role[aria-label="Join voice sharing"]'), 'Voice diagnostics', [
    '.sv-diagnostics', '#sv-guest-copy-diagnostics'
  ])

  const optionControls = {
    watch: overlay.querySelector<HTMLInputElement>('#clux2-watch')!,
    voice: overlay.querySelector<HTMLInputElement>('#clux2-voice')!,
    controller: overlay.querySelector<HTMLInputElement>('#clux2-controller')!
  }

  for (const button of [joinButton, inviteButton, participantsButton]) {
    button.setAttribute('aria-controls', 'clux1-drawer-overlay')
    button.setAttribute('aria-haspopup', 'dialog')
    button.setAttribute('aria-expanded', 'false')
  }
  let opener: HTMLElement | null = null
  let page: Page = 'home'
  let flowRole: FlowRole = 'invite'
  let channels: Channel[] = []
  let stageIndex = 0

  const showPage = (next: Page, focus = true): void => {
    page = next
    for (const name of ['home', 'options', 'setup', 'session'] as const) {
      overlay.querySelector<HTMLElement>(`#clux2-${name}`)!.hidden = name !== next
    }
    const titles: Record<Page, [string, string]> = {
      home: ['Play together', 'Invite a friend or join their session.'],
      options: [flowRole === 'invite' ? 'Invite a friend' : 'Join a friend', 'Choose how you want to connect.'],
      setup: [flowRole === 'invite' ? 'Invite a friend' : 'Join a session', 'Local host approval and automatic exchange. Manual fallback available.'],
      session: ['Your session', 'Manage the connections you have started.']
    }
    title.textContent = titles[next][0]
    description.textContent = titles[next][1]
    if (focus) {
      const target = next === 'home' ? overlay.querySelector<HTMLElement>('#clux2-invite-choice')
        : next === 'options' ? overlay.querySelector<HTMLElement>('#clux2-options-back')
          : next === 'setup' ? overlay.querySelector<HTMLElement>('#clux2-setup-back')
            : overlay.querySelector<HTMLElement>('#clux2-session-back')
      target?.focus()
    }
  }

  const hostedUx = installHostedSessionUx(overlay, options.coordinator, () => {
    const controller = optionControls.controller.checked
    return {
      controller, watch: optionControls.watch.checked || controller,
      voice: optionControls.voice.checked,
      controllerMode: overlay.querySelector<HTMLInputElement>('input[name="clux2-mode"]:checked')?.value === 'player2' ? 'player2' : 'shared'
    }
  }, () => { refresh(); showPage('session') }, () => refresh())

  const refresh = (): void => {
    const state = options.getState()
    const unified = options.coordinator.snapshot()
    const hostedActive = hostedUx.isActive()
    headerEndButton.hidden = !hostedActive
    activeBar.hidden = !hostedActive
    const host = state.role === 'host' || unified.role === 'host'
    const guest = state.role === 'guest' || unified.role === 'guest'
    playButton.hidden = host || guest
    joinButton.hidden = host || guest
    inviteButton.hidden = !host
    participantsButton.hidden = !host && !guest
    playButton.disabled = state.connecting
    inviteChoice.disabled = guest || state.connecting
    joinChoice.disabled = host || state.connecting
    const inviteHint = inviteChoice.querySelector<HTMLElement>('small')
    const joinHint = joinChoice.querySelector<HTMLElement>('small')
    if (inviteHint) inviteHint.textContent = guest
      ? 'Leave the current guest session to host.' : 'Let someone watch, talk, or play on your Xbox.'
    if (joinHint) joinHint.textContent = host
      ? 'Disconnect your Xbox session before joining another host.'
      : 'Connect without signing in to their Xbox account.'
    heading.textContent = guest ? 'Playing with a friend'
      : host ? (state.consoleName ?? 'Your Xbox') : 'Play together'
    summary.textContent = state.connecting ? 'Connecting to Xbox…'
      : guest ? 'You joined a friend’s session.'
        : host ? (state.xboxConnected ? 'Xbox connected. Invite a friend to play.' : 'Xbox session preparing. Check connection details.')
          : 'Connect to your Xbox or join a friend.'
    const controllerStatus = state.controllerPeer ? 'Started — check transport details' : 'Not started'
    const voiceStatus = state.guestVoiceForwarding ? 'Mixer attached (audibility unverified)' : 'Not attached'
    overlay.querySelector<HTMLElement>('#clux2-home-status')!.textContent =
      state.controllerPeer || state.guestVoiceForwarding ? 'Sharing activity detected' : hostedActive ? 'Invitation active' : unified.phase !== 'idle' && unified.phase !== 'failed' ? 'Invite in progress' : 'No guests connected'
    overlay.querySelector<HTMLElement>('#clux2-controller-status')!.textContent = controllerStatus
    overlay.querySelector<HTMLElement>('#clux2-voice-status')!.textContent = voiceStatus
    overlay.querySelector<HTMLButtonElement>('#clux3-session-end')!.hidden = !hostedActive
    const session = overlay.querySelector<HTMLButtonElement>('#clux2-home-session')!
    session.hidden = !hostedActive && !state.controllerPeer && !state.guestVoiceForwarding && (unified.phase === 'idle' || unified.phase === 'failed')
    participantsButton.textContent = state.controllerPeer || state.guestVoiceForwarding ? 'Manage sharing' : 'Play together'
  }

  const say = (message: string): void => { unifiedStatus.textContent = message }
  const unifiedButtons = ['#clux2-create-invite', '#clux2-accept-answer', '#clux2-join-invite'] as const
  let processing = false
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (processing) return
    processing = true
    for (const selector of unifiedButtons) overlay.querySelector<HTMLButtonElement>(selector)!.disabled = true
    try { await action() }
    catch (error) { say(error instanceof Error ? error.message : 'Connection setup failed.') }
    finally {
      processing = false
      for (const selector of unifiedButtons) overlay.querySelector<HTMLButtonElement>(selector)!.disabled = false
      refresh()
    }
  }
  const unifiedSetup = (role: FlowRole): void => {
    flowRole = role
    legacyRecovery = false
    legacyDetails.hidden = false
    legacyDetails.open = false
    unifiedFlow.hidden = false
    overlay.querySelector<HTMLElement>('#clux2-unified-host')!.hidden = role !== 'invite'
    overlay.querySelector<HTMLElement>('#clux2-unified-guest')!.hidden = role !== 'join'
    overlay.querySelector<HTMLElement>('#clux2-step-count')!.hidden = true
    overlay.querySelector<HTMLElement>('#clux2-setup-title')!.textContent = role === 'invite' ? 'Create invitation' : 'Join a friend'
    overlay.querySelector<HTMLElement>('#clux2-setup-description')!.textContent = role === 'invite'
      ? 'Create one local invitation. Your friend requests to join, and you decide whether to approve. Manual exchange is optional below.'
      : 'Enter the local invitation code and request access. Your microphone stays off unless you enable it.'
    for (const id of ['clux2-previous-step','clux2-next-step','clux2-done']) overlay.querySelector<HTMLElement>(`#${id}`)!.hidden = true
    hostedUx.open(role === 'invite' ? 'host' : 'guest')
    say('')
    showPage('setup')
  }
  overlay.querySelector('#clux2-create-invite')?.addEventListener('click', () => void run(async () => {
    const controller = optionControls.controller.checked
    const watch = optionControls.watch.checked || controller
    const caps: SessionCapabilities = {
      controller, watch, voice: optionControls.voice.checked,
      controllerMode: overlay.querySelector<HTMLInputElement>('input[name="clux2-mode"]:checked')?.value === 'player2' ? 'player2' : 'shared'
    }
    say('Preparing your private invitation…')
    const invite = await options.coordinator.createInvitation(caps)
    overlay.querySelector<HTMLTextAreaElement>('#clux2-bundle-offer')!.value = invite
    say('Invitation ready. Send it privately and paste the guest response when received.')
  }))
  overlay.querySelector('#clux2-accept-answer')?.addEventListener('click', () => void run(async () => {
    await options.coordinator.acceptResponse(overlay.querySelector<HTMLTextAreaElement>('#clux2-bundle-answer')!.value.trim())
    refresh(); showPage('session')
  }))
  overlay.querySelector('#clux2-join-invite')?.addEventListener('click', () => void run(async () => {
    say('Joining the invited session…')
    const reply = await options.coordinator.joinInvitation(
      overlay.querySelector<HTMLTextAreaElement>('#clux2-guest-offer')!.value.trim(),
      overlay.querySelector<HTMLInputElement>('#clux2-guest-mic-consent')!.checked
    )
    overlay.querySelector<HTMLTextAreaElement>('#clux2-guest-answer')!.value = reply
    say('Response ready. Copy it and send it to the host. Your voice is muted or off according to your selection.')
  }))
  const copyFrom = (id: string): void => {
    const value = overlay.querySelector<HTMLTextAreaElement>(`#${id}`)!.value
    if (!value) { say('Generate an invitation or response first.'); return }
    void navigator.clipboard.writeText(value).then(() => say('Copied. Share privately.'), () => say('Clipboard access failed. Copy from the text box manually.'))
  }
  overlay.querySelector('#clux2-copy-offer')?.addEventListener('click', () => copyFrom('clux2-bundle-offer'))
  overlay.querySelector('#clux2-copy-answer')?.addEventListener('click', () => copyFrom('clux2-guest-answer'))
  overlay.querySelector('#clux2-unified-end')?.addEventListener('click', () => {
    try { options.coordinator.reset(); say('Shared session ended.') }
    catch (error) { say(String(error)) }
  })

  const renderStage = (): void => {
    const channel = channels[stageIndex]
    if (!channel) return
    const host = flowRole === 'invite'
    overlay.querySelector<HTMLElement>('.clux1-drawer')!.dataset.clux1Role = flowRole
    legacyRecovery = true
    unifiedFlow.hidden = true
    legacyDetails.hidden = false
    legacyDetails.open = true
    overlay.querySelector<HTMLElement>('#clux2-step-count')!.hidden = false
    legacySlot.dataset.clux2Channel = channel
    const current = channel === 'controller' ? controllerPanel : voicePanel
    if (controllerPanel) controllerPanel.open = channel === 'controller'
    if (voicePanel) voicePanel.open = channel === 'voice'
    overlay.querySelector<HTMLElement>('#clux2-step-count')!.textContent =
      `STEP ${stageIndex + 1} OF ${channels.length}`
    overlay.querySelector<HTMLElement>('#clux2-setup-title')!.textContent =
      channel === 'controller' ? 'Controller connection' : 'Microphone & gameplay media'
    const copy = channel === 'controller'
      ? host ? 'Choose how your friend plays, create a controller invite, then exchange the response.'
        : 'Use the controller invite your friend sent you. Return the generated response.'
      : host ? 'Create a separate voice/media invite. Authorize Xbox voice and game media in the controls below before sharing.'
        : 'Join the voice/media invite your friend sent. This version requests microphone access even if you only want to watch; you can mute locally.'
    overlay.querySelector<HTMLElement>('#clux2-setup-description')!.textContent = copy
    overlay.querySelector<HTMLButtonElement>('#clux2-previous-step')!.hidden = stageIndex === 0
    const next = overlay.querySelector<HTMLButtonElement>('#clux2-next-step')!
    next.hidden = stageIndex >= channels.length - 1
    next.textContent = `Next: ${channels[stageIndex + 1] === 'voice' ? 'Microphone & media' : 'Controller'}`
    overlay.querySelector<HTMLButtonElement>('#clux2-done')!.hidden = stageIndex !== channels.length - 1
    // Apply host's selected controller mode to the existing authoritative radio.
    if (channel === 'controller' && host && !options.getState().controllerPeer) {
      const chosen = overlay.querySelector<HTMLInputElement>('input[name="clux2-mode"]:checked')?.value ?? 'shared'
      const original = hub.querySelector<HTMLInputElement>(`input[name="friend-controller-mode"][value="${chosen}"]`)
      if (original && !original.disabled && !original.checked) {
        original.checked = true
        original.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
    current?.querySelector('summary')?.scrollIntoView({ block: 'nearest' })
  }

  const startOptions = (role: FlowRole): void => {
    flowRole = role
    if (role === 'join') { unifiedSetup('join'); return }
    const inviting = role === 'invite'
    optionControls.watch.checked = inviting
    optionControls.voice.checked = false // Xbox voice must be affirmatively authorized.
    optionControls.controller.checked = true
    overlay.querySelector<HTMLElement>('#clux2-controller-mode')!.hidden = false
    overlay.querySelector<HTMLElement>('#clux2-options-title')!.textContent = inviting ? 'Invite a friend' : 'Join a friend'
    overlay.querySelector<HTMLElement>('#clux2-options-description')!.textContent = inviting
      ? 'What would you like your friend to do?'
      : 'What are you joining with?'
    overlay.querySelector<HTMLElement>('#clux2-permission-note')!.textContent = inviting
      ? 'These choices guide the setup; actual sharing and Xbox voice permission are confirmed in the connection controls.'
      : 'Joining gameplay and voice uses separate invites. A voice/media join may request microphone access even if you only want to watch.'
    const mode = overlay.querySelector<HTMLElement>('#clux2-controller-mode')!
    mode.hidden = !inviting
    showPage('options')
  }

  const beginSetup = (): void => {
    if (!optionControls.controller.checked && !optionControls.voice.checked && !optionControls.watch.checked) {
      const message = overlay.querySelector<HTMLElement>('#clux2-permission-note')!
      message.textContent = 'Select at least one activity.'
      message.setAttribute('role', 'alert')
      return
    }
    unifiedSetup('invite')
  }

  const openDrawer = (trigger: HTMLElement, initial: Page = 'home'): void => {
    opener = trigger
    overlay.hidden = false
    document.body.classList.add('clux1-drawer-open')
    refresh()
    showPage(initial)
    for (const button of [joinButton, inviteButton, participantsButton]) {
      button.setAttribute('aria-expanded', String(button === trigger))
    }
  }

  const close = (): void => {
    if (overlay.hidden) return
    overlay.hidden = true
    document.body.classList.remove('clux1-drawer-open')
    for (const button of [joinButton, inviteButton, participantsButton]) {
      button.setAttribute('aria-expanded', 'false')
    }
    if (opener?.isConnected && !opener.hidden) opener.focus()
    opener = null
  }

  playButton.addEventListener('click', options.startXbox)
  joinButton.addEventListener('click', () => openDrawer(joinButton))
  inviteButton.addEventListener('click', () => openDrawer(inviteButton, hostedUx.isActive() ? 'setup' : 'home'))
  participantsButton.addEventListener('click', () => openDrawer(participantsButton, 'session'))
  closeButton.addEventListener('click', close)
  // The drawer closes only via the explicit Close button or Escape.
  // Backdrop clicks can be retargeted during native dialog transitions and
  // must never dismiss the active invitation while selecting a code.
  overlay.querySelector('#clux2-invite-choice')?.addEventListener('click', () => startOptions('invite'))
  overlay.querySelector('#clux2-join-choice')?.addEventListener('click', () => startOptions('join'))
  overlay.querySelector('#clux2-options-back')?.addEventListener('click', () => showPage('home'))
  overlay.querySelector('#clux2-setup-back')?.addEventListener('click', () => showPage('options'))
  overlay.querySelector('#clux2-session-back')?.addEventListener('click', () => showPage('home'))
  overlay.querySelector('#clux2-home-session')?.addEventListener('click', () => showPage('session'))
  // A single confirmation governs every hosted-session exit surface.
  let endRequestedFrom: HTMLElement | null = null
  const requestEnd = (source: HTMLElement): void => {
    if (!hostedUx.isActive() || confirmDialog.open) return
    endRequestedFrom = source
    confirmDialog.showModal()
    keepButton.focus()
  }
  const dismissEndDialog = (): void => {
    if (confirmDialog.open) confirmDialog.close()
    if (endRequestedFrom?.isConnected && !endRequestedFrom.hidden) endRequestedFrom.focus()
    endRequestedFrom = null
  }
  const confirmEnd = async (): Promise<void> => {
    if (!hostedUx.isActive()) { dismissEndDialog(); return }
    confirmEndButton.disabled = true
    keepButton.disabled = true
    try {
      await hostedUx.end()
      refresh()
      showPage('home', !overlay.hidden)
      dismissEndDialog()
    } finally {
      confirmEndButton.disabled = false
      keepButton.disabled = false
    }
  }
  headerEndButton.addEventListener('click', () => requestEnd(headerEndButton))
  footerEndButton.addEventListener('click', () => requestEnd(footerEndButton))
  overlay.querySelector<HTMLButtonElement>('#clux3-session-end')!.addEventListener('click', event => requestEnd(event.currentTarget as HTMLElement))
  keepButton.addEventListener('click', dismissEndDialog)
  confirmEndButton.addEventListener('click', () => void confirmEnd())
  confirmDialog.addEventListener('cancel', event => { event.preventDefault(); dismissEndDialog() })
  overlay.querySelector('#clux2-continue')?.addEventListener('click', beginSetup)
  overlay.querySelector('#clux2-controller')?.addEventListener('change', () => {
    if (optionControls.controller.checked) optionControls.watch.checked = true
    overlay.querySelector<HTMLElement>('#clux2-controller-mode')!.hidden = !optionControls.controller.checked || flowRole === 'join'
  })
  overlay.querySelector('#clux2-watch')?.addEventListener('change', () => {
    if (!optionControls.watch.checked && optionControls.controller.checked) optionControls.controller.checked = false
    overlay.querySelector<HTMLElement>('#clux2-controller-mode')!.hidden = !optionControls.controller.checked
  })
  overlay.querySelector('#clux2-next-step')?.addEventListener('click', () => { stageIndex++; renderStage() })
  overlay.querySelector('#clux2-previous-step')?.addEventListener('click', () => { stageIndex--; renderStage() })
  overlay.querySelector('#clux2-done')?.addEventListener('click', () => { refresh(); showPage('session') })
  overlay.querySelector('#clux2-manage-controller')?.addEventListener('click', () => {
    flowRole = options.getState().role === 'guest' ? 'join' : 'invite'
    channels = ['controller']; stageIndex = 0; renderStage(); showPage('setup')
  })
  overlay.querySelector('#clux2-manage-voice')?.addEventListener('click', () => {
    flowRole = options.getState().role === 'guest' ? 'join' : 'invite'
    channels = ['voice']; stageIndex = 0; renderStage(); showPage('setup')
  })

  detailsButton.addEventListener('click', () => {
    extras.open = !extras.open
    detailsButton.setAttribute('aria-expanded', String(extras.open))
    if (extras.open) extras.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
  extras.addEventListener('toggle', () => {
    detailsButton.setAttribute('aria-expanded', String(extras.open))
  })
  panel.querySelector<HTMLButtonElement>('#fullscreen-video')?.addEventListener('click', close)
  document.querySelectorAll<HTMLElement>('.nav-item[data-view]')
    .forEach(item => item.addEventListener('click', close))

  document.addEventListener('keydown', event => {
    if (confirmDialog.open || overlay.hidden) return
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key !== 'Tab') return
    const focusable = Array.from(overlay.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, a[href]'
    )).filter(element => element.getClientRects().length > 0 && !element.closest('[hidden]'))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  })

  options.coordinator.subscribe(() => refresh())
  refresh()
  return { refresh, close }
}
