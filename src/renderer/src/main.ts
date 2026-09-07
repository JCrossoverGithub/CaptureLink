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

        <button
          id="controller-toggle"
          type="button"
          disabled
        >
          Controller Off
        </button>

        <button
          id="microphone-toggle"
          type="button"
          disabled
        >
          Microphone Off
        </button>

        <div class="audio-controls" aria-label="Stream audio controls">
          <button
            id="audio-mute"
            type="button"
            disabled
          >
            Mute
          </button>

          <label for="audio-volume">Volume</label>
          <input
            id="audio-volume"
            type="range"
            min="0"
            max="100"
            step="1"
            value="100"
            disabled
          />
          <span id="audio-volume-value">100%</span>
        </div>

        <button
          id="diagnostics-toggle"
          type="button"
          disabled
        >
          Diagnostics
        </button>

        <div class="recording-controls" aria-label="Audio recording controls">
          <span
            id="recording-indicator"
            class="recording-indicator"
            hidden
          >
            ● REC
          </span>
          <span id="recording-timer" class="recording-timer">00:00</span>
          <span id="recording-status" class="recording-status">Ready</span>
          <button
            id="record-audio"
            type="button"
            class="record"
            disabled
            title="Record incoming Xbox game and game-chat audio"
          >
            Record Audio
          </button>
        </div>
      </div>
    </section>

    <section class="audio-devices-panel" aria-label="Audio devices">
      <div class="audio-devices-heading">
        <div>
          <div class="eyebrow">AUDIO DEVICES</div>
          <h2>Microphone and speaker routing</h2>
        </div>

        <button id="refresh-audio-devices" type="button">
          Refresh Devices
        </button>
      </div>

      <div class="audio-device-grid">
        <div class="audio-device-card">
          <div class="audio-device-title">
            <div>
              <h3>Microphone</h3>
              <p>Select the input CaptureLink sends to Xbox game chat.</p>
            </div>
            <span id="mic-device-state" class="device-state">Idle</span>
          </div>

          <label class="device-field" for="microphone-device">
            <span>Input device</span>
            <select id="microphone-device">
              <option value="default">System default</option>
            </select>
          </label>

          <div class="mic-meter-row">
            <div
              id="mic-level-meter"
              class="mic-meter"
              role="meter"
              aria-label="Microphone input level"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow="0"
            >
              <div id="mic-level-fill" class="mic-meter-fill"></div>
            </div>
            <span id="mic-level-value">−∞ dB</span>
          </div>

          <div class="device-actions">
            <button id="test-microphone" type="button">
              Test Microphone
            </button>
          </div>

          <p id="microphone-device-message" class="device-message">
            Choose a microphone, then test it before enabling Xbox chat.
          </p>
        </div>

        <div class="audio-device-card">
          <div class="audio-device-title">
            <div>
              <h3>Speakers</h3>
              <p>Route incoming Xbox audio to a specific output device.</p>
            </div>
            <span id="speaker-device-state" class="device-state">Default</span>
          </div>

          <label class="device-field" for="speaker-device">
            <span>Output device</span>
            <select id="speaker-device">
              <option value="">System default</option>
            </select>
          </label>

          <div class="device-actions">
            <button id="choose-speaker" type="button">
              Choose Output
            </button>
          </div>

          <p id="speaker-device-message" class="device-message">
            CaptureLink uses the system default output until another device is selected.
          </p>
        </div>
      </div>
    </section>

    <section
      id="diagnostics-panel"
      class="diagnostics-panel"
      aria-label="WebRTC diagnostics"
      hidden
    >
      <div class="diagnostics-heading">
        <div>
          <div class="eyebrow">LIVE DIAGNOSTICS</div>
          <h2>WebRTC session health</h2>
        </div>
        <span id="diagnostics-health" class="status">Waiting</span>
      </div>

      <div class="diagnostics-grid">
        <div class="diagnostic-group">
          <h3>Connection</h3>
          <dl>
            <div><dt>State</dt><dd id="diag-connection">—</dd></div>
            <div><dt>Round trip</dt><dd id="diag-rtt">—</dd></div>
          </dl>
        </div>

        <div class="diagnostic-group">
          <h3>Audio</h3>
          <dl>
            <div><dt>Codec</dt><dd id="diag-audio-codec">—</dd></div>
            <div><dt>Bitrate</dt><dd id="diag-audio-bitrate">—</dd></div>
            <div><dt>Packets</dt><dd id="diag-audio-packets">—</dd></div>
            <div><dt>Lost</dt><dd id="diag-audio-lost">—</dd></div>
            <div><dt>Jitter</dt><dd id="diag-audio-jitter">—</dd></div>
          </dl>
        </div>

        <div class="diagnostic-group">
          <h3>Microphone</h3>
          <dl>
            <div><dt>Device</dt><dd id="diag-mic-device">—</dd></div>
            <div><dt>State</dt><dd id="diag-mic-state">Off</dd></div>
            <div><dt>Bitrate</dt><dd id="diag-mic-bitrate">—</dd></div>
            <div><dt>Packets sent</dt><dd id="diag-mic-packets">0</dd></div>
          </dl>
        </div>

        <div class="diagnostic-group">
          <h3>Video</h3>
          <dl>
            <div><dt>Codec</dt><dd id="diag-video-codec">—</dd></div>
            <div><dt>Bitrate</dt><dd id="diag-video-bitrate">—</dd></div>
            <div><dt>Resolution</dt><dd id="diag-video-resolution">—</dd></div>
            <div><dt>Frame rate</dt><dd id="diag-video-fps">—</dd></div>
            <div><dt>Lost</dt><dd id="diag-video-lost">—</dd></div>
          </dl>
        </div>
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

const controllerButton =
  requireElement<HTMLButtonElement>('#controller-toggle')

const microphoneButton =
  requireElement<HTMLButtonElement>('#microphone-toggle')

const audioMuteButton =
  requireElement<HTMLButtonElement>('#audio-mute')

const audioVolume =
  requireElement<HTMLInputElement>('#audio-volume')

const audioVolumeValue =
  requireElement<HTMLSpanElement>('#audio-volume-value')

const diagnosticsButton =
  requireElement<HTMLButtonElement>('#diagnostics-toggle')


const recordAudioButton =
  requireElement<HTMLButtonElement>('#record-audio')

const recordingIndicator =
  requireElement<HTMLSpanElement>('#recording-indicator')

const recordingTimer =
  requireElement<HTMLSpanElement>('#recording-timer')

const recordingStatus =
  requireElement<HTMLSpanElement>('#recording-status')

const refreshAudioDevicesButton =
  requireElement<HTMLButtonElement>('#refresh-audio-devices')

const microphoneDeviceSelect =
  requireElement<HTMLSelectElement>('#microphone-device')

const microphoneTestButton =
  requireElement<HTMLButtonElement>('#test-microphone')

const microphoneDeviceMessage =
  requireElement<HTMLParagraphElement>('#microphone-device-message')

const microphoneDeviceState =
  requireElement<HTMLSpanElement>('#mic-device-state')

const micLevelMeter =
  requireElement<HTMLDivElement>('#mic-level-meter')

const micLevelFill =
  requireElement<HTMLDivElement>('#mic-level-fill')

const micLevelValue =
  requireElement<HTMLSpanElement>('#mic-level-value')

const speakerDeviceSelect =
  requireElement<HTMLSelectElement>('#speaker-device')

const chooseSpeakerButton =
  requireElement<HTMLButtonElement>('#choose-speaker')

const speakerDeviceMessage =
  requireElement<HTMLParagraphElement>('#speaker-device-message')

const speakerDeviceState =
  requireElement<HTMLSpanElement>('#speaker-device-state')

const diagnosticsPanel =
  requireElement<HTMLElement>('#diagnostics-panel')

const diagnosticsHealth =
  requireElement<HTMLSpanElement>('#diagnostics-health')

const diagConnection =
  requireElement<HTMLElement>('#diag-connection')
const diagRtt =
  requireElement<HTMLElement>('#diag-rtt')
const diagAudioCodec =
  requireElement<HTMLElement>('#diag-audio-codec')
const diagAudioBitrate =
  requireElement<HTMLElement>('#diag-audio-bitrate')
const diagAudioPackets =
  requireElement<HTMLElement>('#diag-audio-packets')
const diagAudioLost =
  requireElement<HTMLElement>('#diag-audio-lost')
const diagAudioJitter =
  requireElement<HTMLElement>('#diag-audio-jitter')
const diagMicDevice =
  requireElement<HTMLElement>('#diag-mic-device')
const diagMicState =
  requireElement<HTMLElement>('#diag-mic-state')
const diagMicBitrate =
  requireElement<HTMLElement>('#diag-mic-bitrate')
const diagMicPackets =
  requireElement<HTMLElement>('#diag-mic-packets')
const diagVideoCodec =
  requireElement<HTMLElement>('#diag-video-codec')
const diagVideoBitrate =
  requireElement<HTMLElement>('#diag-video-bitrate')
const diagVideoResolution =
  requireElement<HTMLElement>('#diag-video-resolution')
const diagVideoFps =
  requireElement<HTMLElement>('#diag-video-fps')
const diagVideoLost =
  requireElement<HTMLElement>('#diag-video-lost')

let signedIn = false
let streamBusy = false
let activeServerId: string | null = null
let activePlayer: CaptureLinkPlayer | null = null
let webRtcConnected = false
let activeGamepad: CaptureLinkGamepad | null = null
let controllerAttached = false
let microphoneActive = false
let microphonePending = false
let microphoneTimeout: ReturnType<typeof setTimeout> | null = null
let audioMuted = false
let audioVolumeLevel = 1
let selectedMicrophoneId = 'default'
let selectedSpeakerId = ''
let microphoneMonitorStream: MediaStream | null = null
let microphoneMeterContext: AudioContext | null = null
let microphoneMeterSource: MediaStreamAudioSourceNode | null = null
let microphoneMeterAnalyser: AnalyserNode | null = null
let microphoneMeterFrame: number | null = null
let microphoneMeterMode: 'idle' | 'test' | 'outbound' = 'idle'
let diagnosticsTimer: ReturnType<typeof setInterval> | null = null
let diagnosticsVisible = false
let previousStatsSample: {
  at: number
  audioBytes: number
  videoBytes: number
  outboundAudioBytes: number
} | null = null
let audioRecorder: MediaRecorder | null = null
let audioRecordingChunks: Blob[] = []
let audioRecordingStartedAt: number | null = null
let audioRecordingTimer: ReturnType<typeof setInterval> | null = null
let audioRecordingSuggestedName = ''
let audioRecordingSaving = false
let audioRecordingStopPromise: Promise<void> | null = null
let audioRecordingStopResolve: (() => void) | null = null

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

function getPlayerExports(): CaptureLinkPlayerExports | undefined {
  return window.xCloudPlayer?.default ?? window.xCloudPlayer
}

function getAudioElement(): HTMLAudioElement | undefined {
  return activePlayer?.getAudioElement() ??
    streamHolder.querySelector<HTMLAudioElement>('audio') ??
    undefined
}

function getSelectedMicrophoneConstraints(): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {
    channelCount: 1,
    sampleRate: 24_000,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }

  if (selectedMicrophoneId && selectedMicrophoneId !== 'default') {
    constraints.deviceId = { exact: selectedMicrophoneId }
  }

  return constraints
}

function formatDeviceLabel(
  device: MediaDeviceInfo,
  fallback: string
): string {
  return device.label.trim() || fallback
}

function populateDeviceSelect(
  select: HTMLSelectElement,
  devices: MediaDeviceInfo[],
  selectedValue: string,
  defaultValue: string,
  defaultLabel: string,
  fallbackPrefix: string
): string {
  const options = [
    `<option value="${escapeHtml(defaultValue)}">${escapeHtml(defaultLabel)}</option>`,
    ...devices
      .filter((device) => device.deviceId !== 'default')
      .map((device, index) => `
        <option value="${escapeHtml(device.deviceId)}">
          ${escapeHtml(formatDeviceLabel(device, `${fallbackPrefix} ${index + 1}`))}
        </option>
      `)
  ]

  select.innerHTML = options.join('')

  const hasSelected = Array.from(select.options)
    .some((option) => option.value === selectedValue)

  select.value = hasSelected ? selectedValue : defaultValue
  return select.value
}

async function refreshAudioDevices(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    microphoneDeviceMessage.textContent =
      'This Chromium build does not expose media device enumeration.'
    speakerDeviceMessage.textContent =
      'This Chromium build does not expose media device enumeration.'
    return
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const microphones = devices.filter((device) => device.kind === 'audioinput')
    const speakers = devices.filter((device) => device.kind === 'audiooutput')

    selectedMicrophoneId = populateDeviceSelect(
      microphoneDeviceSelect,
      microphones,
      selectedMicrophoneId,
      'default',
      'System default',
      'Microphone'
    )

    selectedSpeakerId = populateDeviceSelect(
      speakerDeviceSelect,
      speakers,
      selectedSpeakerId,
      '',
      'System default',
      'Speaker'
    )

    microphoneDeviceMessage.textContent = microphones.length > 0
      ? `${microphones.length} microphone source${microphones.length === 1 ? '' : 's'} available.`
      : 'No microphone inputs are currently visible.'

    speakerDeviceMessage.textContent = speakers.length > 0
      ? `${speakers.length} audio output${speakers.length === 1 ? '' : 's'} available.`
      : 'Only the system default output is currently available.'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Device enumeration failed.'
    microphoneDeviceMessage.textContent = message
    speakerDeviceMessage.textContent = message
  }
}

async function applySelectedSpeaker(
  audio = getAudioElement()
): Promise<boolean> {
  if (!audio) {
    return false
  }

  if (typeof audio.setSinkId !== 'function') {
    speakerDeviceState.textContent = 'Unsupported'
    speakerDeviceMessage.textContent =
      'This Chromium build cannot route audio to a selected output device.'
    return false
  }

  try {
    await audio.setSinkId(selectedSpeakerId)
    const selectedLabel = speakerDeviceSelect.selectedOptions[0]?.textContent?.trim()
    speakerDeviceState.textContent = selectedLabel || 'Default'
    return true
  } catch (error) {
    speakerDeviceState.textContent = 'Failed'
    speakerDeviceMessage.textContent = error instanceof Error
      ? `Could not switch output: ${error.message}`
      : 'Could not switch output device.'
    return false
  }
}

function resetMicrophoneMeter(): void {
  micLevelFill.style.width = '0%'
  micLevelMeter.setAttribute('aria-valuenow', '0')
  micLevelValue.textContent = '−∞ dB'
}

function stopMicrophoneMeter(reset = true): void {
  if (microphoneMeterFrame !== null) {
    cancelAnimationFrame(microphoneMeterFrame)
    microphoneMeterFrame = null
  }

  try {
    microphoneMeterSource?.disconnect()
  } catch {
    // Already disconnected.
  }

  microphoneMeterSource = null
  microphoneMeterAnalyser = null

  if (microphoneMeterContext) {
    void microphoneMeterContext.close().catch(() => undefined)
    microphoneMeterContext = null
  }

  microphoneMeterMode = 'idle'

  if (reset) {
    resetMicrophoneMeter()
  }
}

async function startMicrophoneMeter(
  stream: MediaStream,
  mode: 'test' | 'outbound'
): Promise<void> {
  stopMicrophoneMeter(false)

  const audioContext = new AudioContext()
  await audioContext.resume()

  const source = audioContext.createMediaStreamSource(stream)
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.72
  source.connect(analyser)

  microphoneMeterContext = audioContext
  microphoneMeterSource = source
  microphoneMeterAnalyser = analyser
  microphoneMeterMode = mode

  const samples = new Uint8Array(analyser.fftSize)

  const update = (): void => {
    if (!microphoneMeterAnalyser || microphoneMeterMode === 'idle') {
      return
    }

    microphoneMeterAnalyser.getByteTimeDomainData(samples)

    let sumSquares = 0
    for (const sample of samples) {
      const normalized = (sample - 128) / 128
      sumSquares += normalized * normalized
    }

    const rms = Math.sqrt(sumSquares / samples.length)
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity
    const displayDb = Number.isFinite(db) ? Math.max(-60, db) : -60
    const level = Math.max(0, Math.min(100, ((displayDb + 60) / 60) * 100))

    micLevelFill.style.width = `${level.toFixed(1)}%`
    micLevelMeter.setAttribute('aria-valuenow', String(Math.round(level)))
    micLevelValue.textContent = Number.isFinite(db)
      ? `${db.toFixed(1)} dB`
      : '−∞ dB'

    microphoneMeterFrame = requestAnimationFrame(update)
  }

  update()
}

function stopMicrophoneMonitor(): void {
  if (microphoneMonitorStream) {
    microphoneMonitorStream.getTracks().forEach((track) => track.stop())
    microphoneMonitorStream = null
  }

  if (microphoneMeterMode === 'test') {
    stopMicrophoneMeter()
  }

  microphoneTestButton.textContent = 'Test Microphone'

  if (!microphoneActive && !microphonePending) {
    microphoneDeviceState.textContent = 'Idle'
  }
}

async function toggleMicrophoneMonitor(): Promise<void> {
  if (microphoneActive || microphonePending) {
    return
  }

  if (microphoneMonitorStream) {
    stopMicrophoneMonitor()
    microphoneDeviceMessage.textContent = 'Microphone test stopped.'
    updateInteractiveState()
    return
  }

  microphoneTestButton.disabled = true
  microphoneDeviceState.textContent = 'Opening…'
  microphoneDeviceMessage.textContent = 'Opening selected microphone locally…'

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: getSelectedMicrophoneConstraints(),
      video: false
    })

    microphoneMonitorStream = stream
    await startMicrophoneMeter(stream, 'test')
    microphoneTestButton.textContent = 'Stop Test'
    microphoneDeviceState.textContent = 'Testing'
    microphoneDeviceMessage.textContent =
      `Listening locally to ${stream.getAudioTracks()[0]?.label || 'selected microphone'}. Nothing is being sent to Xbox.`

    await refreshAudioDevices()
  } catch (error) {
    stopMicrophoneMonitor()
    microphoneDeviceState.textContent = 'Failed'
    microphoneDeviceMessage.textContent = error instanceof Error
      ? `Microphone test failed: ${error.message}`
      : 'Microphone test failed.'
  } finally {
    updateInteractiveState()
  }
}

function applyAudioControls(): boolean {
  const audio = getAudioElement()

  audioVolumeValue.textContent = `${Math.round(audioVolumeLevel * 100)}%`
  audioMuteButton.textContent = audioMuted ? 'Unmute' : 'Mute'

  if (!audio) {
    return false
  }

  audio.volume = audioVolumeLevel
  audio.muted = audioMuted
  void applySelectedSpeaker(audio)

  void audio.play().catch((error) => {
    console.warn('[CaptureLink] Audio playback did not start automatically:', error)
  })

  return true
}

function scheduleAudioControlSync(attempt = 0): void {
  if (applyAudioControls() || attempt >= 20 || !activePlayer) {
    return
  }

  window.setTimeout(() => scheduleAudioControlSync(attempt + 1), 250)
}

function clearMicrophoneTimeout(): void {
  if (microphoneTimeout) {
    clearTimeout(microphoneTimeout)
    microphoneTimeout = null
  }
}

function updateMicrophoneButton(): void {
  if (microphonePending) {
    microphoneButton.textContent = 'Microphone Starting…'
  } else {
    microphoneButton.textContent = microphoneActive
      ? 'Microphone On'
      : 'Microphone Off'
  }
}

function detachController(): void {
  if (activeGamepad) {
    try {
      activeGamepad.detach()
    } catch (error) {
      console.warn('[CaptureLink] Controller detach failed:', error)
    }
  }

  activeGamepad = null
  controllerAttached = false
  controllerButton.textContent = 'Controller Off'
}

function stopMicrophone(): void {
  clearMicrophoneTimeout()

  if (activePlayer) {
    try {
      activePlayer._channels.chat.stopMicrophone()
    } catch (error) {
      console.warn('[CaptureLink] Microphone stop failed:', error)
    }
  }

  if (microphoneMeterMode === 'outbound') {
    stopMicrophoneMeter()
  }

  microphoneActive = false
  microphonePending = false
  microphoneDeviceState.textContent = 'Idle'
  microphoneDeviceMessage.textContent =
    'Choose a microphone, then test it before enabling Xbox chat.'
  updateMicrophoneButton()
}

function resetDiagnostics(): void {
  previousStatsSample = null
  diagnosticsHealth.textContent = 'Waiting'
  diagConnection.textContent = '—'
  diagRtt.textContent = '—'
  diagAudioCodec.textContent = '—'
  diagAudioBitrate.textContent = '—'
  diagAudioPackets.textContent = '—'
  diagAudioLost.textContent = '—'
  diagAudioJitter.textContent = '—'
  diagMicDevice.textContent = '—'
  diagMicState.textContent = 'Off'
  diagMicBitrate.textContent = '—'
  diagMicPackets.textContent = '0'
  diagVideoCodec.textContent = '—'
  diagVideoBitrate.textContent = '—'
  diagVideoResolution.textContent = '—'
  diagVideoFps.textContent = '—'
  diagVideoLost.textContent = '—'
}

function stopDiagnosticsPolling(): void {
  if (diagnosticsTimer) {
    clearInterval(diagnosticsTimer)
    diagnosticsTimer = null
  }

  previousStatsSample = null
}

function formatBitrate(bytes: number, previousBytes: number, elapsedMs: number): string {
  if (elapsedMs <= 0 || bytes < previousBytes) {
    return '—'
  }

  const megabitsPerSecond = ((bytes - previousBytes) * 8) / elapsedMs / 1000

  if (megabitsPerSecond >= 1) {
    return `${megabitsPerSecond.toFixed(2)} Mbps`
  }

  return `${Math.round(megabitsPerSecond * 1000)} Kbps`
}

type CaptureLinkRtcStat = RTCStats & {
  type: string
  kind?: string
  mediaType?: string
  codecId?: string
  mimeType?: string
  packetsReceived?: number
  packetsLost?: number
  jitter?: number
  bytesReceived?: number
  bytesSent?: number
  packetsSent?: number
  frameWidth?: number
  frameHeight?: number
  framesPerSecond?: number
  currentRoundTripTime?: number
  nominated?: boolean
  state?: string
}

async function refreshDiagnostics(): Promise<void> {
  const peerConnection = activePlayer?._peerConnection

  if (!peerConnection) {
    resetDiagnostics()
    return
  }

  const report = await peerConnection.getStats()
  const stats: CaptureLinkRtcStat[] = []

  report.forEach((stat) => {
    stats.push(stat as CaptureLinkRtcStat)
  })

  const codecs = new Map(
    stats
      .filter((stat) => stat.type === 'codec')
      .map((stat) => [stat.id, stat.mimeType ?? 'Unknown'])
  )

  const audio = stats.find(
    (stat) => stat.type === 'inbound-rtp' &&
      (stat.kind === 'audio' || stat.mediaType === 'audio')
  )

  const video = stats.find(
    (stat) => stat.type === 'inbound-rtp' &&
      (stat.kind === 'video' || stat.mediaType === 'video')
  )

  const outboundAudio = stats.find(
    (stat) => stat.type === 'outbound-rtp' &&
      (stat.kind === 'audio' || stat.mediaType === 'audio')
  )

  const candidatePair = stats.find(
    (stat) => stat.type === 'candidate-pair' &&
      stat.state === 'succeeded' &&
      stat.nominated === true
  )

  const now = performance.now()
  const audioBytes = audio?.bytesReceived ?? 0
  const videoBytes = video?.bytesReceived ?? 0
  const outboundAudioBytes = outboundAudio?.bytesSent ?? 0
  const previous = previousStatsSample

  diagConnection.textContent = peerConnection.connectionState
  diagRtt.textContent = typeof candidatePair?.currentRoundTripTime === 'number'
    ? `${Math.round(candidatePair.currentRoundTripTime * 1000)} ms`
    : '—'

  diagAudioCodec.textContent = audio?.codecId
    ? codecs.get(audio.codecId) ?? 'Unknown'
    : '—'
  diagAudioPackets.textContent = String(audio?.packetsReceived ?? 0)
  diagAudioLost.textContent = String(audio?.packetsLost ?? 0)
  diagAudioJitter.textContent = typeof audio?.jitter === 'number'
    ? `${(audio.jitter * 1000).toFixed(1)} ms`
    : '—'

  const outboundTrack = activePlayer?._channels.chat._micStream?.getAudioTracks()[0]
  diagMicDevice.textContent = outboundTrack?.label ||
    microphoneDeviceSelect.selectedOptions[0]?.textContent?.trim() ||
    '—'
  diagMicState.textContent = microphoneActive
    ? outboundTrack?.readyState ?? 'live'
    : microphonePending
      ? 'Starting'
      : 'Off'
  diagMicPackets.textContent = String(outboundAudio?.packetsSent ?? 0)

  diagVideoCodec.textContent = video?.codecId
    ? codecs.get(video.codecId) ?? 'Unknown'
    : '—'
  diagVideoResolution.textContent = video?.frameWidth && video?.frameHeight
    ? `${video.frameWidth} × ${video.frameHeight}`
    : '—'
  diagVideoFps.textContent = typeof video?.framesPerSecond === 'number'
    ? `${video.framesPerSecond.toFixed(1)} fps`
    : '—'
  diagVideoLost.textContent = String(video?.packetsLost ?? 0)

  if (previous) {
    const elapsed = now - previous.at
    diagAudioBitrate.textContent = formatBitrate(
      audioBytes,
      previous.audioBytes,
      elapsed
    )
    diagVideoBitrate.textContent = formatBitrate(
      videoBytes,
      previous.videoBytes,
      elapsed
    )
    diagMicBitrate.textContent = microphoneActive
      ? formatBitrate(
          outboundAudioBytes,
          previous.outboundAudioBytes,
          elapsed
        )
      : '—'
  } else {
    diagAudioBitrate.textContent = 'Sampling…'
    diagVideoBitrate.textContent = 'Sampling…'
    diagMicBitrate.textContent = microphoneActive ? 'Sampling…' : '—'
  }

  previousStatsSample = {
    at: now,
    audioBytes,
    videoBytes,
    outboundAudioBytes
  }

  const totalLost = (audio?.packetsLost ?? 0) + (video?.packetsLost ?? 0)
  const audioJitterMs = (audio?.jitter ?? 0) * 1000

  diagnosticsHealth.textContent = peerConnection.connectionState !== 'connected'
    ? 'Not connected'
    : totalLost > 0 || audioJitterMs > 30
      ? 'Check metrics'
      : 'Healthy'
}

function startDiagnosticsPolling(): void {
  stopDiagnosticsPolling()
  void refreshDiagnostics()

  diagnosticsTimer = setInterval(() => {
    void refreshDiagnostics().catch((error) => {
      console.warn('[CaptureLink] Diagnostics refresh failed:', error)
    })
  }, 1000)
}

function setDiagnosticsVisible(visible: boolean): void {
  diagnosticsVisible = visible
  diagnosticsPanel.hidden = !visible
  diagnosticsButton.textContent = visible ? 'Hide Diagnostics' : 'Diagnostics'

  if (visible && activePlayer) {
    startDiagnosticsPolling()
  } else {
    stopDiagnosticsPolling()
  }
}

function formatRecordingDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, '0'))
      .join(':')
  }

  return [minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}

function createAudioRecordingName(date = new Date()): string {
  const stamp = date
    .toISOString()
    .replace('T', '_')
    .replace(/[:.]/g, '-')
    .replace('Z', '')

  return `CaptureLink-Audio-${stamp}.webm`
}

function getIncomingAudioRecordingStream(): MediaStream | null {
  const audio = getAudioElement()
  const source = audio?.srcObject

  if (!(source instanceof MediaStream)) {
    return null
  }

  const tracks = source
    .getAudioTracks()
    .filter((track) => track.readyState === 'live')

  return tracks.length > 0
    ? new MediaStream(tracks)
    : null
}

function chooseAudioRecordingMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm'
  ]

  return candidates.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate)
  ) ?? ''
}

function stopAudioRecordingTimer(): void {
  if (audioRecordingTimer) {
    clearInterval(audioRecordingTimer)
    audioRecordingTimer = null
  }
}

function updateAudioRecordingTimer(): void {
  if (audioRecordingStartedAt === null) {
    recordingTimer.textContent = '00:00'
    return
  }

  recordingTimer.textContent = formatRecordingDuration(
    Date.now() - audioRecordingStartedAt
  )
}

function setAudioRecordingUi(
  state: 'ready' | 'recording' | 'saving' | 'saved' | 'canceled' | 'error'
): void {
  const recording = state === 'recording'

  recordingIndicator.hidden = !recording
  recordingIndicator.classList.toggle('recording-indicator--active', recording)
  recordAudioButton.classList.toggle('record--active', recording)

  switch (state) {
    case 'recording':
      recordAudioButton.textContent = 'Stop Recording'
      recordingStatus.textContent = 'Recording'
      break
    case 'saving':
      recordAudioButton.textContent = 'Saving…'
      recordingStatus.textContent = 'Saving'
      break
    case 'saved':
      recordAudioButton.textContent = 'Record Audio'
      recordingStatus.textContent = 'Saved'
      break
    case 'canceled':
      recordAudioButton.textContent = 'Record Audio'
      recordingStatus.textContent = 'Not saved'
      break
    case 'error':
      recordAudioButton.textContent = 'Record Audio'
      recordingStatus.textContent = 'Error'
      break
    default:
      recordAudioButton.textContent = 'Record Audio'
      recordingStatus.textContent = 'Ready'
  }
}

function finishAudioRecordingStop(): void {
  const resolve = audioRecordingStopResolve
  audioRecordingStopResolve = null
  audioRecordingStopPromise = null
  resolve?.()
}

async function finalizeAudioRecording(
  recorder: MediaRecorder,
  suggestedName: string
): Promise<void> {
  audioRecordingSaving = true
  stopAudioRecordingTimer()
  setAudioRecordingUi('saving')
  updateInteractiveState()

  try {
    const type = recorder.mimeType || 'audio/webm'
    const blob = new Blob(audioRecordingChunks, { type })

    if (blob.size === 0) {
      throw new Error('The audio recorder produced an empty file.')
    }

    const data = await blob.arrayBuffer()
    const result = await window.captureLink.saveAudioRecording(
      data,
      suggestedName
    )

    if (result.saved) {
      setAudioRecordingUi('saved')
      setStreamStatus(
        result.filePath
          ? `Audio recording saved: ${result.filePath}`
          : 'Audio recording saved'
      )
    } else {
      setAudioRecordingUi('canceled')
      setStreamStatus('Audio recording was not saved')
    }
  } catch (error) {
    console.error('[CaptureLink] Audio recording save failed:', error)
    setAudioRecordingUi('error')
    setStreamStatus(
      error instanceof Error
        ? `Audio recording failed: ${error.message}`
        : 'Audio recording failed'
    )
  } finally {
    audioRecorder = null
    audioRecordingChunks = []
    audioRecordingStartedAt = null
    audioRecordingSuggestedName = ''
    audioRecordingSaving = false
    updateInteractiveState()
    finishAudioRecordingStop()
  }
}

function startAudioRecording(): void {
  if (
    audioRecorder ||
    audioRecordingSaving ||
    !activePlayer ||
    !webRtcConnected
  ) {
    return
  }

  if (typeof MediaRecorder === 'undefined') {
    setAudioRecordingUi('error')
    setStreamStatus('This Chromium build does not support MediaRecorder')
    return
  }

  const stream = getIncomingAudioRecordingStream()

  if (!stream) {
    setAudioRecordingUi('error')
    setStreamStatus('Xbox audio stream is not available for recording')
    return
  }

  const mimeType = chooseAudioRecordingMimeType()
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream)

  audioRecorder = recorder
  audioRecordingChunks = []
  audioRecordingStartedAt = Date.now()
  audioRecordingSuggestedName = createAudioRecordingName()

  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) {
      audioRecordingChunks.push(event.data)
    }
  }

  recorder.onerror = (event) => {
    console.error('[CaptureLink] MediaRecorder error:', event)
    setStreamStatus('Audio recorder reported an error')
  }

  recorder.onstop = () => {
    void finalizeAudioRecording(
      recorder,
      audioRecordingSuggestedName
    )
  }

  recorder.start(1000)
  updateAudioRecordingTimer()
  audioRecordingTimer = setInterval(updateAudioRecordingTimer, 250)
  setAudioRecordingUi('recording')
  setStreamStatus('Recording incoming Xbox audio')
  updateInteractiveState()
}

function stopAudioRecording(): Promise<void> {
  if (audioRecordingStopPromise) {
    return audioRecordingStopPromise
  }

  if (!audioRecorder) {
    return Promise.resolve()
  }

  audioRecordingStopPromise = new Promise<void>((resolve) => {
    audioRecordingStopResolve = resolve
  })

  if (audioRecorder.state === 'recording' || audioRecorder.state === 'paused') {
    setAudioRecordingUi('saving')
    recordingStatus.textContent = 'Stopping…'
    audioRecorder.stop()
  } else if (!audioRecordingSaving) {
    finishAudioRecordingStop()
  }

  updateInteractiveState()
  return audioRecordingStopPromise ?? Promise.resolve()
}

async function toggleAudioRecording(): Promise<void> {
  if (audioRecorder) {
    await stopAudioRecording()
  } else {
    startAudioRecording()
  }
}

function updateInteractiveState(): void {
  const sessionActive = activeServerId !== null
  const locked = streamBusy || sessionActive
  const mediaReady = sessionActive && webRtcConnected && !streamBusy

  refreshConsolesButton.disabled = !signedIn || locked
  disconnectButton.disabled = !sessionActive || streamBusy
  controllerButton.disabled = !mediaReady
  microphoneButton.disabled = !mediaReady || microphonePending
  microphoneDeviceSelect.disabled = microphoneActive || microphonePending || microphoneMonitorStream !== null
  microphoneTestButton.disabled = microphoneActive || microphonePending
  refreshAudioDevicesButton.disabled = microphonePending
  audioMuteButton.disabled = !mediaReady
  audioVolume.disabled = !mediaReady
  diagnosticsButton.disabled = !mediaReady
  const recordingActive = audioRecorder?.state === 'recording' ||
    audioRecorder?.state === 'paused'
  recordAudioButton.disabled = audioRecordingSaving ||
    (!recordingActive && !mediaReady)

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
  if (audioRecorder && !audioRecordingSaving) {
    void stopAudioRecording()
  }

  detachController()
  stopMicrophoneMonitor()
  stopMicrophone()
  stopDiagnosticsPolling()
  setDiagnosticsVisible(false)
  webRtcConnected = false

  if (!activePlayer) {
    updateInteractiveState()
    return
  }

  try {
    activePlayer.destroy()
  } catch (error) {
    console.warn('[CaptureLink] Player cleanup failed:', error)
  }

  activePlayer = null
  updateInteractiveState()
}

async function disconnectFromConsole(): Promise<void> {
  if (!activeServerId && !streamBusy) {
    return
  }

  if (audioRecorder || audioRecordingSaving) {
    setStreamStatus('Stopping audio recording before disconnect...')
    await stopAudioRecording()
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

  const playerConstructor = getPlayerExports()?.Player

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

    player.setChatSdpHandler((offer) => {
      if (!offer.sdp) {
        microphonePending = false
        microphoneActive = false
        updateMicrophoneButton()
        setStreamStatus('Microphone negotiation failed: empty SDP offer')
        updateInteractiveState()
        return
      }

      void window.captureLink.exchangeXboxChatSdp(offer.sdp)
        .then((answer) => {
          player.setRemoteOffer(answer.sdp)
          clearMicrophoneTimeout()
          microphonePending = false
          microphoneActive = player._channels.chat._micStream?.active === true
          updateMicrophoneButton()
          setStreamStatus(
            microphoneActive
              ? 'Microphone connected to Xbox game chat'
              : 'Microphone negotiation completed'
          )
          updateInteractiveState()
        })
        .catch((error) => {
          console.error('[CaptureLink] Microphone SDP renegotiation failed:', error)
          clearMicrophoneTimeout()
          player._channels.chat.stopMicrophone()
          microphonePending = false
          microphoneActive = false
          updateMicrophoneButton()
          setStreamStatus(
            error instanceof Error
              ? `Microphone failed: ${error.message}`
              : 'Microphone negotiation failed'
          )
          updateInteractiveState()
        })
    })

    player.onConnectionStateChange((state) => {
      console.log(`[CaptureLink] WebRTC connection state: ${state}`)
      setStreamStatus(`WebRTC: ${state}`)

      if (state === 'connected') {
        webRtcConnected = true
        hideStreamPlaceholder()
        scheduleAudioControlSync()
        updateInteractiveState()

        if (diagnosticsVisible) {
          startDiagnosticsPolling()
        }
      }

      if (state === 'failed' || state === 'disconnected') {
        webRtcConnected = false
        showStreamPlaceholder(`WebRTC ${state}. Disconnect and try again.`)
        updateInteractiveState()
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

function toggleController(): void {
  if (!activePlayer || !webRtcConnected) {
    return
  }

  if (controllerAttached) {
    detachController()
    setStreamStatus('Controller input disabled')
    updateInteractiveState()
    return
  }

  const gamepadConstructor = getPlayerExports()?.Gamepad

  if (!gamepadConstructor) {
    setStreamStatus('Controller API is unavailable in the Xbox player bundle')
    return
  }

  try {
    const gamepad = new gamepadConstructor(0, {
      enable_keyboard: true,
      enable_gamepad: true,
      enable_vibration: true,
      gamepad_force_capture: true
    })

    gamepad.attach(activePlayer)
    activeGamepad = gamepad
    controllerAttached = true
    controllerButton.textContent = 'Controller On'
    setStreamStatus('Controller and keyboard input enabled')
  } catch (error) {
    console.error('[CaptureLink] Controller attach failed:', error)
    detachController()
    setStreamStatus(
      error instanceof Error
        ? `Controller failed: ${error.message}`
        : 'Controller input failed'
    )
  }

  updateInteractiveState()
}

async function toggleMicrophone(): Promise<void> {
  if (!activePlayer || !webRtcConnected || microphonePending) {
    return
  }

  if (microphoneActive) {
    stopMicrophone()
    setStreamStatus('Microphone stopped')
    updateInteractiveState()
    return
  }

  stopMicrophoneMonitor()
  microphonePending = true
  microphoneDeviceState.textContent = 'Starting…'
  microphoneDeviceMessage.textContent =
    'Opening the selected microphone and negotiating Xbox game chat…'
  updateMicrophoneButton()
  updateInteractiveState()
  setStreamStatus('Requesting selected microphone…')

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: getSelectedMicrophoneConstraints(),
      video: false
    })

    if (!activePlayer || !webRtcConnected) {
      stream.getTracks().forEach((track) => track.stop())
      throw new Error('Remote Play disconnected while opening the microphone.')
    }

    const track = stream.getAudioTracks()[0]

    if (!track) {
      stream.getTracks().forEach((mediaTrack) => mediaTrack.stop())
      throw new Error('The selected microphone did not provide an audio track.')
    }

    activePlayer._channels.chat._micStream = stream
    activePlayer._peerConnection.addTrack(track, stream)
    await startMicrophoneMeter(stream, 'outbound')

    const offer = await activePlayer.createOffer()

    if (!offer.sdp) {
      throw new Error('Chromium did not generate a microphone SDP offer.')
    }

    setStreamStatus('Negotiating selected microphone with Xbox game chat…')
    const answer = await window.captureLink.exchangeXboxChatSdp(offer.sdp)
    activePlayer.setRemoteOffer(answer.sdp)

    microphonePending = false
    microphoneActive = true
    microphoneDeviceState.textContent = 'Live'
    microphoneDeviceMessage.textContent =
      `Sending ${track.label || 'selected microphone'} to Xbox game chat.`
    updateMicrophoneButton()
    updateInteractiveState()
    setStreamStatus('Microphone connected to Xbox game chat')

    await refreshAudioDevices()
  } catch (error) {
    console.error('[CaptureLink] Selected microphone start failed:', error)
    stopMicrophone()
    microphoneDeviceState.textContent = 'Failed'
    microphoneDeviceMessage.textContent = error instanceof Error
      ? `Microphone failed: ${error.message}`
      : 'Microphone failed to start.'
    setStreamStatus(
      error instanceof Error
        ? `Microphone failed: ${error.message}`
        : 'Microphone failed to start'
    )
    updateInteractiveState()
  }
}

controllerButton.addEventListener('click', () => {
  toggleController()
})

microphoneButton.addEventListener('click', () => {
  void toggleMicrophone()
})

audioMuteButton.addEventListener('click', () => {
  audioMuted = !audioMuted
  applyAudioControls()
})

audioVolume.addEventListener('input', () => {
  const parsed = Number(audioVolume.value)
  const clamped = Math.min(100, Math.max(0, Number.isFinite(parsed) ? parsed : 100))
  audioVolumeLevel = clamped / 100
  audioVolume.value = String(clamped)
  applyAudioControls()
})

diagnosticsButton.addEventListener('click', () => {
  setDiagnosticsVisible(!diagnosticsVisible)
})


recordAudioButton.addEventListener('click', () => {
  void toggleAudioRecording()
})

refreshAudioDevicesButton.addEventListener('click', () => {
  void refreshAudioDevices()
})

microphoneDeviceSelect.addEventListener('change', () => {
  stopMicrophoneMonitor()
  selectedMicrophoneId = microphoneDeviceSelect.value || 'default'
  microphoneDeviceState.textContent = 'Selected'
  microphoneDeviceMessage.textContent =
    `Selected ${microphoneDeviceSelect.selectedOptions[0]?.textContent?.trim() || 'microphone'}. Test it before enabling Xbox chat.`
  updateInteractiveState()
})

microphoneTestButton.addEventListener('click', () => {
  void toggleMicrophoneMonitor()
})

speakerDeviceSelect.addEventListener('change', () => {
  selectedSpeakerId = speakerDeviceSelect.value
  void applySelectedSpeaker()
})

chooseSpeakerButton.addEventListener('click', () => {
  const mediaDevices = navigator.mediaDevices as MediaDevices & {
    selectAudioOutput?: () => Promise<MediaDeviceInfo>
  }

  if (!mediaDevices.selectAudioOutput) {
    speakerDeviceState.textContent = 'Unsupported'
    speakerDeviceMessage.textContent =
      'This Chromium build does not expose the audio-output chooser.'
    return
  }

  void mediaDevices.selectAudioOutput()
    .then(async (device) => {
      selectedSpeakerId = device.deviceId
      await refreshAudioDevices()

      const matchingOption = Array.from(speakerDeviceSelect.options)
        .find((option) => option.value === selectedSpeakerId)

      if (matchingOption) {
        speakerDeviceSelect.value = selectedSpeakerId
      }

      await applySelectedSpeaker()
      speakerDeviceMessage.textContent =
        `Xbox audio will play through ${device.label || 'the selected output'}.`
    })
    .catch((error) => {
      speakerDeviceState.textContent = 'Default'
      speakerDeviceMessage.textContent = error instanceof Error
        ? `Output selection cancelled or failed: ${error.message}`
        : 'Output selection cancelled or failed.'
    })
})

navigator.mediaDevices?.addEventListener('devicechange', () => {
  void refreshAudioDevices()
})

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

void refreshAudioDevices()
void refreshAuthStatus()
