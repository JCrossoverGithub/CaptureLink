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
      <div id="stream-holder" class="stream-holder">
        <div id="stream-placeholder" class="stream-placeholder">
          <div class="stream-mark">CL</div>
          <p>Choose an Xbox below to start Remote Play.</p>
        </div>
      </div>

      <div class="controls">
        <span id="stream-status" class="stream-state" aria-live="polite">
          Remote Play idle
        </span>

        <button
          id="disconnect-session"
          type="button"
          disabled
        >
          Disconnect
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

        <button
          id="sign-in"
          type="button"
        >
          Sign in with Microsoft
        </button>

        <pre
          id="auth-output"
          class="auth-output"
          aria-live="polite"
        ></pre>
      </article>

      <article>
        <h2>Current milestone</h2>

        <p>
          Remote Play integration: xHome session signalling plus Chromium
          WebRTC video, game audio, and incoming game-chat audio.
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
    <article class="console-section">
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

const streamHolder =
  requireElement<HTMLDivElement>('#stream-holder')

const streamStatus =
  requireElement<HTMLSpanElement>('#stream-status')

const disconnectButton =
  requireElement<HTMLButtonElement>('#disconnect-session')

let signedIn = false
let streamBusy = false
let activeServerId: string | null = null
let activePlayer: CaptureLinkPlayer | null = null

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
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function setStreamStatus(message: string): void {
  streamStatus.textContent = message
}

function showStreamPlaceholder(message: string): void {
  let placeholder =
    streamHolder.querySelector<HTMLDivElement>('#stream-placeholder')

  if (!placeholder) {
    placeholder = document.createElement('div')
    placeholder.id = 'stream-placeholder'
    placeholder.className = 'stream-placeholder'
    placeholder.innerHTML = `
      <div class="stream-mark">CL</div>
      <p></p>
    `
    streamHolder.prepend(placeholder)
  }

  const text = placeholder.querySelector<HTMLParagraphElement>('p')

  if (text) {
    text.textContent = message
  }

  placeholder.hidden = false
}

function hideStreamPlaceholder(): void {
  const placeholder =
    streamHolder.querySelector<HTMLDivElement>('#stream-placeholder')

  if (placeholder) {
    placeholder.hidden = true
  }
}

function resetStreamHolder(message = 'Choose an Xbox below to start Remote Play.'): void {
  streamHolder.querySelectorAll('video, audio').forEach((element) => {
    element.remove()
  })

  showStreamPlaceholder(message)
}

function updateInteractiveState(): void {
  const sessionActive = activeServerId !== null
  const locked = streamBusy || sessionActive

  refreshConsolesButton.disabled = !signedIn || locked
  disconnectButton.disabled = !sessionActive || streamBusy

  consoleList
    .querySelectorAll<HTMLButtonElement>('.console-connect')
    .forEach((button) => {
      button.disabled = !signedIn || locked
    })
}

function resetConsoleButtonLabels(): void {
  consoleList
    .querySelectorAll<HTMLButtonElement>('.console-connect')
    .forEach((button) => {
      button.textContent = 'Connect'
    })
}

async function loadConsoles(): Promise<void> {
  if (streamBusy || activeServerId) {
    return
  }

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
              title="Start Xbox Remote Play"
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
    updateInteractiveState()
  }
}

function setAuthenticated(): void {
  signedIn = true
  accountStatus.textContent = 'Signed in'
  authMessage.textContent =
    'Xbox authentication is available.'

  signInButton.textContent = 'Signed in'
  signInButton.disabled = true

  updateInteractiveState()
  void loadConsoles()
}

function setSignedOut(): void {
  signedIn = false
  accountStatus.textContent = 'Signed out'
  authMessage.textContent =
    'Sign in with the Microsoft account associated with your Xbox.'

  signInButton.textContent = 'Sign in with Microsoft'
  signInButton.disabled = false

  consoleList.innerHTML = ''
  consoleMessage.textContent =
    'Sign in to discover your Xbox consoles.'

  updateInteractiveState()
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

function destroyPlayer(): void {
  if (!activePlayer) {
    return
  }

  try {
    activePlayer.destroy()
  } catch (error) {
    console.warn('[CaptureLink] Player cleanup failed:', error)
  }

  activePlayer = null
}

async function disconnectFromConsole(): Promise<void> {
  if (!activeServerId && !streamBusy) {
    return
  }

  streamBusy = true
  updateInteractiveState()
  setStreamStatus('Disconnecting...')

  destroyPlayer()

  try {
    await window.captureLink.stopXboxStream()
  } catch (error) {
    console.warn('[CaptureLink] Remote Play stop failed:', error)
  } finally {
    activeServerId = null
    streamBusy = false
    resetConsoleButtonLabels()
    resetStreamHolder()
    setStreamStatus('Remote Play idle')
    updateInteractiveState()
  }
}

async function connectToConsole(
  serverId: string,
  button: HTMLButtonElement
): Promise<void> {
  if (streamBusy || activeServerId) {
    return
  }

  const playerConstructor =
    window.xCloudPlayer?.Player ??
    window.xCloudPlayer?.default?.Player

  if (!playerConstructor) {
    consoleMessage.textContent =
      'Xbox WebRTC player bundle is missing. Run npm run vendor:xbox-player and restart CaptureLink.'
    return
  }

  streamBusy = true
  activeServerId = serverId
  button.textContent = 'Connecting...'
  showStreamPlaceholder('Starting Xbox Remote Play...')
  setStreamStatus('Starting Remote Play...')
  updateInteractiveState()

  try {
    await window.captureLink.startXboxStream(serverId)

    setStreamStatus('Creating Chromium WebRTC connection...')

    const player = new playerConstructor('stream-holder')
    activePlayer = player

    player.onConnectionStateChange((state) => {
      console.log(`[CaptureLink] WebRTC connection state: ${state}`)
      setStreamStatus(`WebRTC: ${state}`)

      if (state === 'connected') {
        hideStreamPlaceholder()
      }

      if (state === 'failed' || state === 'disconnected') {
        showStreamPlaceholder(`WebRTC ${state}. Disconnect and try again.`)
      }
    })

    const offer = await player.createOffer()

    if (!offer.sdp) {
      throw new Error('Chromium did not generate a WebRTC SDP offer.')
    }

    const remoteSdp =
      await window.captureLink.exchangeXboxSdp(offer.sdp)

    player.setRemoteOffer(remoteSdp.sdp)

    const localCandidates = player
      .getIceCandidates()
      .map((candidate): CaptureLinkIceCandidate => ({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        usernameFragment: candidate.usernameFragment ?? null
      }))

    const remoteCandidates =
      await window.captureLink.exchangeXboxIce(localCandidates)

    player.setRemoteIceCandidates(remoteCandidates)

    streamBusy = false
    button.textContent = 'Connected'
    updateInteractiveState()
  } catch (error) {
    console.error('[CaptureLink] Remote Play connection failed:', error)

    const message =
      error instanceof Error
        ? error.message
        : 'Remote Play connection failed.'

    setStreamStatus('Remote Play failed')
    showStreamPlaceholder(message)
    consoleMessage.textContent = message

    destroyPlayer()

    try {
      await window.captureLink.stopXboxStream()
    } catch (stopError) {
      console.warn('[CaptureLink] Failed to clean up Xbox session:', stopError)
    }

    activeServerId = null
    streamBusy = false
    button.textContent = 'Connect'
    updateInteractiveState()
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

disconnectButton.addEventListener('click', () => {
  void disconnectFromConsole()
})

consoleList.addEventListener('click', (event) => {
  const target = event.target

  if (!(target instanceof Element)) {
    return
  }

  const button = target.closest<HTMLButtonElement>('.console-connect')

  if (!button || button.disabled) {
    return
  }

  const card = button.closest<HTMLElement>('.console-card')
  const serverId = card?.dataset.serverId

  if (serverId) {
    void connectToConsole(serverId, button)
  }
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

window.captureLink.onXboxStreamStatus((status) => {
  setStreamStatus(status)
})

window.addEventListener('beforeunload', () => {
  destroyPlayer()
  void window.captureLink.stopXboxStream()
})

void refreshAuthStatus()
