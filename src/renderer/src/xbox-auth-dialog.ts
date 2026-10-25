/** Human-readable code prompt for Microsoft's device-code sign-in flow.
 * No device_code or token enters the renderer. Only the short user_code is displayed.
 */
export interface MicrosoftDeviceCodeInfo {
  userCode: string
  verificationUri: string
  expiresIn: number
}

export function installXboxAuthDialog(options: {
  openMicrosoftPage: () => Promise<void>
  retry: () => void
}): {
  start: () => void
  present: (info: MicrosoftDeviceCodeInfo) => void
  finish: (result: { success: boolean; message: string }) => void
  failToStart: (reason: string) => void
  reopen: () => void
  isPending: () => boolean
} {
  if (document.querySelector('#xbox-auth-dialog')) {
    throw new Error('Xbox authentication dialog installed twice')
  }
  const dialog = document.createElement('dialog')
  dialog.id = 'xbox-auth-dialog'
  dialog.className = 'xbox-auth-dialog'
  dialog.dataset.stage = 'loading'
  dialog.setAttribute('aria-labelledby', 'xbox-auth-dialog-title')
  dialog.innerHTML = `
    <div class="xbox-auth-dialog__inner">
      <div class="xbox-auth-dialog__heading">
        <div class="xbox-auth-dialog__brand">
          <span class="xbox-auth-dialog__brand-symbol" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="6" y="10" width="12" height="10" rx="2"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/></svg>
          </span>
          <span>CAPTURELINK / MICROSOFT SIGN-IN</span>
        </div>
        <button type="button" class="xbox-auth-dialog__close" aria-label="Hide sign-in instructions">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19"/></svg>
        </button>
      </div>
      <h2 id="xbox-auth-dialog-title">Sign in to your Xbox</h2>
      <p class="xbox-auth-dialog__description">Use the Microsoft account you play Xbox with. CaptureLink never sees your password.</p>
      <div class="xbox-auth-dialog__task">
        <div class="xbox-auth-dialog__step"><span class="xbox-auth-dialog__step-index">1</span><span>Your one-time code</span></div>
        <div class="xbox-auth-dialog__code-row">
          <strong id="xbox-auth-user-code" aria-label="Microsoft sign-in code">Requesting code…</strong>
          <button type="button" id="xbox-auth-copy" class="xbox-auth-dialog__quiet-button" disabled>Copy code</button>
        </div>
        <div class="xbox-auth-dialog__step"><span class="xbox-auth-dialog__step-index">2</span><span>Finish in your browser</span></div>
        <button type="button" id="xbox-auth-open-microsoft" class="xbox-auth-dialog__primary" disabled>
          Open Microsoft sign-in
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>
        </button>
      </div>
      <p id="xbox-auth-dialog-status" role="status" aria-live="polite">Requesting a temporary sign-in code…</p>
      <details class="xbox-auth-dialog__account-help">
        <summary>Need to use a different Microsoft account?</summary>
        <p>Choose <strong>Use another account</strong> on Microsoft's page if it appears. If Microsoft automatically selects the wrong email, open a private browser window, visit <strong>microsoft.com/devicelogin</strong>, enter the same code, and use your Xbox account.</p>
        <button type="button" id="xbox-auth-copy-address" class="xbox-auth-dialog__quiet-button">Copy sign-in address</button>
        <p>You don't need to remove or sign out of your other Microsoft accounts.</p>
      </details>
      <div class="xbox-auth-dialog__footer">
        <button id="xbox-auth-try-again" type="button" hidden>Try again</button>
        <button id="xbox-auth-dismiss" type="button">Hide for now</button>
      </div>
      <p class="xbox-auth-dialog__footnote">Only enter this code for a sign-in you started yourself in CaptureLink. Never share it with anyone.</p>
    </div>
  `
  document.body.append(dialog)
  const codeEl = dialog.querySelector<HTMLElement>('#xbox-auth-user-code')!
  const statusEl = dialog.querySelector<HTMLElement>('#xbox-auth-dialog-status')!
  const copyBtn = dialog.querySelector<HTMLButtonElement>('#xbox-auth-copy')!
  const openBtn = dialog.querySelector<HTMLButtonElement>('#xbox-auth-open-microsoft')!
  const retryBtn = dialog.querySelector<HTMLButtonElement>('#xbox-auth-try-again')!
  const closeBtn = dialog.querySelector<HTMLButtonElement>('.xbox-auth-dialog__close')!
  const dismissBtn = dialog.querySelector<HTMLButtonElement>('#xbox-auth-dismiss')!
  const copyAddress = dialog.querySelector<HTMLButtonElement>('#xbox-auth-copy-address')!

  let pending = false
  let code = ''
  let url = 'https://microsoft.com/devicelogin'

  function show(): void {
    if (!dialog.open) dialog.showModal()
  }
  function hide(): void {
    if (dialog.open) dialog.close()
  }
  function reset(): void {
    code = ''
    dialog.dataset.stage = 'loading'
    codeEl.textContent = 'Requesting code…'
    copyBtn.disabled = true
    openBtn.disabled = true
    retryBtn.hidden = true
  }
  async function copy(value: string, button: HTMLButtonElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      const prior = button.textContent
      button.textContent = 'Copied!'
      window.setTimeout(() => { button.textContent = prior }, 1800)
    } catch {
      try {
        // Desktop preload clipboard support is available even when browser clipboard permission isn't.
        await window.captureLink.writeFriendClipboard(value)
        button.textContent = 'Copied!'
      } catch {
        statusEl.textContent = 'Clipboard unavailable. Select and copy the code, or type it on Microsoft’s page.'
      }
    }
  }
  copyBtn.addEventListener('click', () => { if (code) void copy(code, copyBtn) })
  copyAddress.addEventListener('click', () => { void copy(url, copyAddress) })
  openBtn.addEventListener('click', () => {
    void options.openMicrosoftPage().catch((error: unknown) => {
      statusEl.textContent = error instanceof Error ? error.message : 'Could not open browser. Use the address above in your browser.'
    })
  })
  retryBtn.addEventListener('click', () => { hide(); options.retry() })
  closeBtn.addEventListener('click', hide)
  dismissBtn.addEventListener('click', hide)
  return {
    start: () => {
      pending = true
      reset()
      statusEl.textContent = 'Requesting a temporary Microsoft sign-in code…'
      show()
    },
    present: (info) => {
      if (!pending) return
      // Only human-readable codes and a trusted verification address are ever displayed.
      const parsed = new URL(info.verificationUri)
      if (parsed.protocol !== 'https:' || !(parsed.hostname === 'microsoft.com' || parsed.hostname.endsWith('.microsoft.com'))) {
        statusEl.textContent = 'The verification address was unexpected. Please restart sign-in.'
        return
      }
      dialog.dataset.stage = 'waiting'
      code = info.userCode
      url = parsed.toString()
      codeEl.textContent = code
      copyBtn.disabled = false
      openBtn.disabled = false
      statusEl.textContent = 'Waiting for Microsoft. This code expires automatically.'
      show()
    },
    finish: (result) => {
      pending = false
      dialog.dataset.stage = result.success ? 'success' : 'failed'
      code = ''
      codeEl.textContent = result.success ? 'Connected' : 'Sign-in incomplete'
      copyBtn.disabled = true
      openBtn.disabled = true
      retryBtn.hidden = result.success
      statusEl.textContent = result.success ? 'Xbox account connected successfully.' : `Sign-in failed or expired: ${result.message}`
      if (result.success) hide()
      else show()
    },
    failToStart: (reason) => {
      pending = false
      dialog.dataset.stage = 'failed'
      code = ''
      codeEl.textContent = 'Unable to start'
      copyBtn.disabled = true
      openBtn.disabled = true
      retryBtn.hidden = false
      statusEl.textContent = reason
      show()
    },
    reopen: show,
    isPending: () => pending
  }
}
