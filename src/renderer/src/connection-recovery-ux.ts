/**
 * CAPTURELINK_XBOX_RECOVERY_PHASE4_2026_10_22
 * Presentation-only, explicit user-initiated retry UI. Existing Xbox
 * session orchestration remains the single source of truth.
 * Error details are classified locally, never displayed, logged or retained.
 */

export type RecoveryIssueKind = 'discovery' | 'xbox'
export type RecoveryIssueStage = 'discovery' | 'start' | 'webrtc-failed' | 'webrtc-disconnected'

interface RecoveryIssue {
  kind: RecoveryIssueKind
  stage: RecoveryIssueStage
  detail?: string
}

interface RecoveryActions {
  retryXbox(): Promise<void>
  refreshConsoles(): Promise<void>
  openSetup(): void
}

export interface ConnectionRecoveryUx {
  show(issue: RecoveryIssue): void
  clear(): void
  clearKind(kind: RecoveryIssueKind): void
}

function explanation(issue: RecoveryIssue): { heading: string; advice: string } {
  if (issue.stage === 'webrtc-disconnected') {
    return {
      heading: 'Xbox stream interrupted',
      advice: 'The video connection dropped. You can try reconnecting to the same Xbox. If it keeps happening, check your network and the Xbox’s Remote Play settings.'
    }
  }
  if (issue.stage === 'webrtc-failed') {
    return {
      heading: 'Xbox stream connection failed',
      advice: 'The video connection could not stay established. Try reconnecting. Network restrictions or an unavailable Xbox may be involved.'
    }
  }
  const detail = (issue.detail ?? '').toLowerCase()
  if (detail.includes('friend session active')) {
    return {
      heading: 'End Friend Mode before reconnecting',
      advice: 'An active Friend session is using the stream. Cancel or leave Friend Mode before restarting the Xbox connection.'
    }
  }
  if (detail.includes('recording is still saving')) {
    return {
      heading: 'Recording is still saving',
      advice: 'Wait for CaptureLink to finish saving the recording, then select Reconnect Xbox again.'
    }
  }
  if (/sign.?in|unauthori[sz]ed|authentication|token|401|403|forbidden/.test(detail)) {
    return {
      heading: 'Microsoft account may need attention',
      advice: 'Check that you are signed into the Microsoft account associated with this Xbox. Open Xbox setup if you need to sign in again.'
    }
  }
  if (/not found|offline|unavailable|sleep|power|wake|console/.test(detail) && issue.kind === 'xbox') {
    return {
      heading: 'Xbox may be unavailable',
      advice: 'Confirm the console has Remote features enabled and can be reached. You can also refresh the console list in Xbox setup.'
    }
  }
  if (/network|timeout|timed out|econn|fetch|connect|dns|ice|sdp|webrtc/.test(detail)) {
    return {
      heading: issue.kind === 'discovery' ? 'Unable to find Xbox consoles' : 'Unable to connect to Xbox',
      advice: 'A network or service interruption may be involved. Check that your PC is online, then try again.'
    }
  }
  if (issue.kind === 'discovery') {
    return {
      heading: 'Could not find your Xboxes',
      advice: 'Try discovering your consoles again. If none appear, verify your Microsoft account and the Xbox Remote Play setup.'
    }
  }
  return {
    heading: 'Could not start Xbox Remote Play',
    advice: 'Try reconnecting. If the problem continues, check Xbox setup and your network connection.'
  }
}

export function installConnectionRecoveryUx(actions: RecoveryActions): ConnectionRecoveryUx {
  const streamPrimary = document.querySelector<HTMLElement>('.stream-primary')
  const streamCard = streamPrimary?.querySelector<HTMLElement>('.stream-card')
  const noop: ConnectionRecoveryUx = {
    show: () => {}, clear: () => {}, clearKind: () => {}
  }
  if (!streamCard || !streamPrimary) {
    console.warn('[CaptureLink] Recovery UI not mounted: Stream panel missing.')
    return noop
  }
  if (document.querySelector('#xbox-recovery-panel')) {
    console.warn('[CaptureLink] Recovery UI already mounted.')
    return noop
  }

  const panel = document.createElement('section')
  panel.id = 'xbox-recovery-panel'
  panel.className = 'xbox-recovery-panel'
  panel.hidden = true
  panel.setAttribute('aria-label', 'Xbox connection recovery')
  panel.innerHTML = `
    <div class="xbox-recovery-panel__copy" role="status" aria-live="polite">
      <strong id="xbox-recovery-heading"></strong>
      <p id="xbox-recovery-advice"></p>
      <p id="xbox-recovery-progress" class="xbox-recovery-panel__progress"></p>
    </div>
    <div class="xbox-recovery-panel__actions">
      <button id="xbox-recovery-primary" type="button">Try again</button>
      <button id="xbox-recovery-setup" type="button">Xbox setup</button>
      <button id="xbox-recovery-dismiss" type="button">Dismiss</button>
    </div>
  `
  streamCard.insertAdjacentElement('afterend', panel)

  const heading = panel.querySelector<HTMLElement>('#xbox-recovery-heading')!
  const advice = panel.querySelector<HTMLElement>('#xbox-recovery-advice')!
  const progress = panel.querySelector<HTMLElement>('#xbox-recovery-progress')!
  const primary = panel.querySelector<HTMLButtonElement>('#xbox-recovery-primary')!
  const setup = panel.querySelector<HTMLButtonElement>('#xbox-recovery-setup')!
  const dismiss = panel.querySelector<HTMLButtonElement>('#xbox-recovery-dismiss')!

  let activeIssue: {kind: RecoveryIssueKind; heading: string; advice: string} | null = null
  let pending = false

  function render(): void {
    panel.hidden = activeIssue === null
    if (!activeIssue) return
    heading.textContent = activeIssue.heading
    advice.textContent = activeIssue.advice
    primary.textContent = activeIssue.kind === 'discovery' ? 'Find Xboxes again' : 'Reconnect Xbox'
    primary.disabled = pending
    setup.disabled = pending
    dismiss.disabled = pending
  }

  const api: ConnectionRecoveryUx = {
    show(issue) {
      // A stale discovery failure must never replace a live connection failure.
      if (activeIssue?.kind === 'xbox' && issue.kind === 'discovery') return
      activeIssue = {kind: issue.kind, ...explanation(issue)}
      progress.textContent = ''
      render()
    },
    clear() {
      activeIssue = null
      progress.textContent = ''
      render()
    },
    clearKind(kind) {
      if (activeIssue?.kind === kind) api.clear()
    }
  }

  primary.addEventListener('click', () => {
    if (!activeIssue || pending) return
    const chosen = activeIssue.kind
    pending = true
    progress.textContent = chosen === 'xbox' ? 'Restarting the Xbox connection…' : 'Searching for Xboxes…'
    render()
    void (async () => {
      try {
        if (chosen === 'xbox') await actions.retryXbox()
        else await actions.refreshConsoles()
      } catch {
        api.show({kind: chosen, stage: chosen === 'xbox' ? 'start' : 'discovery'})
        progress.textContent = 'That attempt did not finish. You can try again or open Xbox setup.'
      } finally {
        pending = false
        render()
      }
    })()
  })
  setup.addEventListener('click', () => actions.openSetup())
  dismiss.addEventListener('click', () => api.clear())
  return api
}
