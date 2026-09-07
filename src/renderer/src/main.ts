import './styles.css'

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('CaptureLink app root not found')
}

root.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">CAPTURELINK</div>
        <h1>Xbox Remote Play, focused on capture.</h1>
        <p class="subtitle">
          Connect to your console, watch the live stream, hear game and
          game-chat audio, control the session, and record locally.
        </p>
      </div>

      <span
        id="account-status"
        class="status status--idle"
      >
        Checking account...
      </span>
    </header>

    <section class="stream-card" aria-label="Remote Play preview">
      <div class="stream-placeholder">
        <div class="stream-mark">CL</div>
        <p>Remote Play stream will appear here.</p>
      </div>

      <div class="controls">
        <button
          id="sign-in"
          type="button"
        >
          Sign in with Microsoft
        </button>

        <button type="button" disabled>
          Connect
        </button>

        <button type="button" disabled>
          Controller
        </button>

        <button type="button" disabled>
          Microphone
        </button>

        <button type="button" disabled>
          Diagnostics
        </button>

        <button
          type="button"
          class="record"
          disabled
        >
          Record
        </button>
      </div>
    </section>

    <section class="grid">
      <article>
        <h2>Xbox account</h2>

        <p id="auth-message">
          Checking authentication status...
        </p>

        <pre
          id="auth-output"
          class="auth-output"
          aria-live="polite"
        ></pre>
      </article>

      <article>
        <h2>Current milestone</h2>

        <p>
          Authenticate with Xbox services inside CaptureLink.
          Console discovery comes next.
        </p>
      </article>
    </section>
  </main>
`

const grid = document.querySelector<HTMLElement>('.grid')

if (!grid) {
  throw new Error('CaptureLink content grid not found')
}

grid.insertAdjacentHTML(
  'beforeend',
  `
    <article>
      <div class="section-heading">
        <div>
          <h2>Your consoles</h2>
          <p id="console-message">
            Sign in to discover your Xbox consoles.
          </p>
        </div>

        <button
          id="refresh-consoles"
          type="button"
          disabled
        >
          Refresh
        </button>
      </div>

      <div
        id="console-list"
        class="console-list"
      ></div>
    </article>
  `
)

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Required CaptureLink element not found: ${selector}`)
  }

  return element
}

const signInButton =
  requireElement<HTMLButtonElement>('#sign-in')

const accountStatus =
  requireElement<HTMLSpanElement>('#account-status')

const authMessage =
  requireElement<HTMLParagraphElement>('#auth-message')

const authOutput =
  requireElement<HTMLPreElement>('#auth-output')

const consoleMessage =
  requireElement<HTMLParagraphElement>('#console-message')

const consoleList =
  requireElement<HTMLDivElement>('#console-list')

const refreshConsolesButton =
  requireElement<HTMLButtonElement>('#refresh-consoles')

function formatConsoleType(consoleType: string): string {
  switch (consoleType) {
    case 'XboxSeriesX':
      return 'Xbox Series X'
    case 'XboxSeriesS':
      return 'Xbox Series S'
    case 'XboxOne':
      return 'Xbox One'
    case 'XboxOneS':
      return 'Xbox One S'
    case 'XboxOneX':
      return 'Xbox One X'
    default:
      return consoleType
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\"', '&quot;')
    .replaceAll("'", '&#039;')
}

async function loadConsoles(): Promise<void> {
  consoleMessage.textContent = 'Looking for Xbox consoles...'
  consoleList.innerHTML = ''
  refreshConsolesButton.disabled = true

  try {
    const consoles = await window.captureLink.getXboxConsoles()

    if (consoles.length === 0) {
      consoleMessage.textContent =
        'No Xbox consoles were found for this account.'
      return
    }

    consoleMessage.textContent =
      `${consoles.length} console${consoles.length === 1 ? '' : 's'} found.`

    consoleList.innerHTML = consoles
      .map(
        (console) => `
          <div
            class="console-card"
            data-server-id="${escapeHtml(console.serverId)}"
          >
            <div>
              <div class="console-name">
                ${escapeHtml(console.deviceName)}
              </div>

              <div class="console-model">
                ${escapeHtml(formatConsoleType(console.consoleType))}
              </div>

              <div class="console-power">
                ${escapeHtml(console.powerState)}
              </div>
            </div>

            <button
              type="button"
              class="console-connect"
              disabled
              title="Remote Play connection comes in the next milestone"
            >
              Connect
            </button>
          </div>
        `
      )
      .join('')
  } catch (error) {
    consoleMessage.textContent =
      error instanceof Error
        ? error.message
        : 'Xbox console discovery failed.'
  } finally {
    refreshConsolesButton.disabled = false
  }
}

function setAuthenticated(): void {
  accountStatus.textContent = 'Signed in'
  authMessage.textContent =
    'Xbox authentication is available.'

  signInButton.textContent = 'Signed in'
  signInButton.disabled = true

  refreshConsolesButton.disabled = false
  void loadConsoles()
}

function setSignedOut(): void {
  accountStatus.textContent = 'Signed out'
  authMessage.textContent =
    'Sign in with the Microsoft account associated with your Xbox.'

  signInButton.textContent = 'Sign in with Microsoft'
  signInButton.disabled = false

  refreshConsolesButton.disabled = true
  consoleList.innerHTML = ''
  consoleMessage.textContent =
    'Sign in to discover your Xbox consoles.'
}

async function refreshAuthStatus(): Promise<void> {
  const status =
    await window.captureLink.getXboxAuthStatus()

  if (status.authenticated) {
    setAuthenticated()
  } else {
    setSignedOut()
  }
}

signInButton.addEventListener('click', async () => {
  signInButton.disabled = true
  signInButton.textContent = 'Waiting for Microsoft...'

  accountStatus.textContent = 'Signing in'
  authMessage.textContent =
    'Follow the Microsoft sign-in instructions.'

  authOutput.textContent = ''

  try {
    const result =
      await window.captureLink.startXboxAuth()

    if (!result.started) {
      authMessage.textContent =
        result.reason ?? 'Could not start authentication.'

      signInButton.disabled = false
      signInButton.textContent = 'Sign in with Microsoft'
    }
  } catch (error) {
    authMessage.textContent =
      error instanceof Error
        ? error.message
        : 'Authentication could not be started.'

    signInButton.disabled = false
    signInButton.textContent = 'Sign in with Microsoft'
  }
})

refreshConsolesButton.addEventListener('click', () => {
  void loadConsoles()
})

window.captureLink.onXboxAuthOutput((message) => {
  authOutput.textContent += message
  authOutput.scrollTop = authOutput.scrollHeight
})

window.captureLink.onXboxAuthComplete((result) => {
  authMessage.textContent = result.message

  if (result.success) {
    setAuthenticated()
  } else {
    setSignedOut()
  }
})

void refreshAuthStatus()
