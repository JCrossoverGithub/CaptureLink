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

        <div class="recording-controls" aria-label="Recording controls">
          <span
            id="recording-indicator"
            class="recording-indicator"
            hidden
          >
            ● REC
          </span>
          <span id="recording-timer" class="recording-timer">00:00</span>
          <span id="recording-status" class="recording-status">Ready</span>
          <span id="recording-size" class="recording-size">0 B</span>
          <span id="recording-space" class="recording-space">— free</span>
          <button
            id="record-audio"
            type="button"
            class="record"
            disabled
            title="Record Xbox game audio, incoming game chat, and your microphone when enabled"
          >
            Record Audio
          </button>

          <button
            id="record-video"
            type="button"
            class="record"
            disabled
            title="Record Xbox video with game audio, incoming game chat, and your microphone when enabled"
          >
            Record Video
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

          <label class="device-field" for="recording-mic-gain">
            <span>Recording mic level</span>
            <div class="range-field">
              <input
                id="recording-mic-gain"
                type="range"
                min="0"
                max="200"
                step="5"
                value="100"
              />
              <output id="recording-mic-gain-value" for="recording-mic-gain">100%</output>
            </div>
          </label>
          <p class="device-hint">
            Changes your microphone level in saved recordings only. Xbox game-chat volume is unchanged.
          </p>

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
            <button
              id="resync-audio"
              type="button"
              disabled
              title="Rebuild local audio playback without reconnecting to Xbox"
            >
              Resync Audio
            </button>
          </div>

          <label class="toggle-field" for="auto-audio-resync">
            <input id="auto-audio-resync" type="checkbox" checked />
            <span>Auto-resync when WebRTC reports sustained audio delay</span>
          </label>

          <p id="speaker-device-message" class="device-message">
            CaptureLink uses the system default output until another device is selected.
            Resync Audio can flush a delayed local playback path without reconnecting the Xbox session.
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
            <div><dt>A/V offset</dt><dd id="diag-av-offset">—</dd></div>
            <div><dt>Buffer avg</dt><dd id="diag-audio-buffer">—</dd></div>
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



    <section class="recording-library-panel" aria-label="Recording library">
      <div class="recording-library-heading">
        <div>
          <div class="eyebrow">RECORDING LIBRARY</div>
          <h2>Your CaptureLink recordings</h2>
          <p id="recording-library-message">
            Finished recordings will appear here automatically.
          </p>
          <p id="recording-export-status">
            Checking MP4 / MP3 / WAV export support…
          </p>
        </div>

        <button id="refresh-recording-library" type="button">
          Refresh Library
        </button>
      </div>

      <div
        id="recording-library-list"
        class="recording-library-list"
        aria-live="polite"
      ></div>
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
        <h2>Quick start</h2>
        <ol class="quick-start-list">
          <li>Sign in and connect to your Xbox.</li>
          <li>Choose and test your microphone if you use game chat.</li>
          <li>Adjust playback and recording levels, then start a capture.</li>
          <li>Open or export finished recordings from the library.</li>
        </ol>
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

const recordVideoButton =
  requireElement<HTMLButtonElement>('#record-video')

const recordingIndicator =
  requireElement<HTMLSpanElement>('#recording-indicator')

const recordingTimer =
  requireElement<HTMLSpanElement>('#recording-timer')

const recordingStatus =
  requireElement<HTMLSpanElement>('#recording-status')

const recordingSize =
  requireElement<HTMLSpanElement>('#recording-size')

const recordingSpace =
  requireElement<HTMLSpanElement>('#recording-space')

const recordingLibraryMessage =
  requireElement<HTMLParagraphElement>('#recording-library-message')

const recordingExportStatus =
  requireElement<HTMLParagraphElement>('#recording-export-status')

const recordingLibraryList =
  requireElement<HTMLDivElement>('#recording-library-list')

const refreshRecordingLibraryButton =
  requireElement<HTMLButtonElement>('#refresh-recording-library')

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

const recordingMicGain =
  requireElement<HTMLInputElement>('#recording-mic-gain')

const recordingMicGainValue =
  requireElement<HTMLOutputElement>('#recording-mic-gain-value')

const speakerDeviceSelect =
  requireElement<HTMLSelectElement>('#speaker-device')

const chooseSpeakerButton =
  requireElement<HTMLButtonElement>('#choose-speaker')

const resyncAudioButton =
  requireElement<HTMLButtonElement>('#resync-audio')

const autoAudioResync =
  requireElement<HTMLInputElement>('#auto-audio-resync')

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
const diagAvOffset =
  requireElement<HTMLElement>('#diag-av-offset')
const diagAudioBuffer =
  requireElement<HTMLElement>('#diag-audio-buffer')
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
let audioResyncInProgress = false
let autoAudioResyncEnabled = true
let audioLateSampleCount = 0
let lastAudioResyncAt = 0
const AUDIO_LATE_THRESHOLD_MS = 750
const AUDIO_LATE_REQUIRED_SAMPLES = 4
const AUDIO_RESYNC_COOLDOWN_MS = 60_000
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
type RecordingKind = 'audio' | 'video'

let mediaRecorder: MediaRecorder | null = null
let recordingKind: RecordingKind | null = null
let recordingFilePath = ''
let recordingBytesWritten = 0
let recordingAvailableBytes: number | null = null
let recordingStartedAt: number | null = null
let recordingTimerHandle: ReturnType<typeof setInterval> | null = null
let recordingSaving = false
let recordingWriteQueue: Promise<void> = Promise.resolve()
let recordingWriteError: Error | null = null
let recordingStopPromise: Promise<void> | null = null
let recordingStopResolve: (() => void) | null = null
let recordingLibrary: CaptureLinkRecordingItem[] = []
let commonExportAvailable = false
let recordingAudioContext: AudioContext | null = null
let recordingXboxAudioSource: MediaStreamAudioSourceNode | null = null
let recordingMicrophoneSource: MediaStreamAudioSourceNode | null = null
let recordingMicrophoneGainNode: GainNode | null = null
let recordingAudioDestination: MediaStreamAudioDestinationNode | null = null
let recordingMicrophoneTrackId = ''
let recordingMicrophoneGainLevel = 1

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

type CaptureLinkAudioReceiver = RTCRtpReceiver & {
  jitterBufferTarget?: number
}

function tuneAudioJitterBufferTarget(): boolean {
  const receiver = activePlayer?._peerConnection
    .getReceivers()
    .find((candidate) => candidate.track?.kind === 'audio') as
      | CaptureLinkAudioReceiver
      | undefined

  if (!receiver || !('jitterBufferTarget' in receiver)) {
    return false
  }

  try {
    // Keep the target conservative. This is only a hint, and Chromium may
    // ignore it. The manual playback rebuild below remains the fallback.
    receiver.jitterBufferTarget = 0.12
    return true
  } catch (error) {
    console.warn('[CaptureLink] Audio jitter-buffer target was not accepted:', error)
    return false
  }
}

async function resyncAudioPlayback(reason: 'manual' | 'automatic'): Promise<boolean> {
  if (audioResyncInProgress || !webRtcConnected) {
    return false
  }

  const audio = getAudioElement()
  const source = audio?.srcObject

  if (!audio || !(source instanceof MediaStream)) {
    speakerDeviceMessage.textContent =
      'Xbox audio is not available to resync yet.'
    return false
  }

  audioResyncInProgress = true
  resyncAudioButton.textContent = 'Resyncing…'
  speakerDeviceState.textContent = 'Resyncing'
  updateInteractiveState()

  try {
    const jitterTargetApplied = tuneAudioJitterBufferTarget()

    // Detaching and reattaching the live MediaStream rebuilds Chromium's
    // local media-element/output path without renegotiating the Xbox session.
    // This is intentionally separate from the raw stream used by recording.
    audio.pause()
    audio.srcObject = null
    await new Promise<void>((resolve) => window.setTimeout(resolve, 80))
    audio.srcObject = source

    audio.volume = audioVolumeLevel
    audio.muted = audioMuted
    await applySelectedSpeaker(audio)
    await audio.play()

    lastAudioResyncAt = Date.now()
    audioLateSampleCount = 0
    speakerDeviceState.textContent = 'Synced'
    speakerDeviceMessage.textContent = reason === 'automatic'
      ? `CaptureLink automatically rebuilt delayed audio playback${jitterTargetApplied ? ' and lowered the WebRTC jitter-buffer target' : ''}.`
      : `Audio playback rebuilt${jitterTargetApplied ? ' with a lower WebRTC jitter-buffer target' : ''}.`
    console.log(`[CaptureLink] Audio playback resynced (${reason})`)
    return true
  } catch (error) {
    console.error('[CaptureLink] Audio resync failed:', error)
    speakerDeviceState.textContent = 'Resync failed'
    speakerDeviceMessage.textContent = error instanceof Error
      ? `Audio resync failed: ${error.message}`
      : 'Audio resync failed.'
    return false
  } finally {
    audioResyncInProgress = false
    resyncAudioButton.textContent = 'Resync Audio'
    updateInteractiveState()
  }
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
  detachRecordingMicrophoneSource()

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
  diagAvOffset.textContent = '—'
  diagAudioBuffer.textContent = '—'
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
  audioLateSampleCount = 0
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
  estimatedPlayoutTimestamp?: number
  jitterBufferDelay?: number
  jitterBufferEmittedCount?: number
  jitterBufferTargetDelay?: number
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

  const avOffsetMs = typeof audio?.estimatedPlayoutTimestamp === 'number' &&
      typeof video?.estimatedPlayoutTimestamp === 'number'
    ? audio.estimatedPlayoutTimestamp - video.estimatedPlayoutTimestamp
    : null

  diagAvOffset.textContent = avOffsetMs === null
    ? '—'
    : avOffsetMs > 0
      ? `${Math.round(avOffsetMs)} ms late`
      : avOffsetMs < 0
        ? `${Math.abs(Math.round(avOffsetMs))} ms early`
        : '0 ms'

  const audioBufferMs = typeof audio?.jitterBufferDelay === 'number' &&
      typeof audio?.jitterBufferEmittedCount === 'number' &&
      audio.jitterBufferEmittedCount > 0
    ? (audio.jitterBufferDelay / audio.jitterBufferEmittedCount) * 1000
    : null

  diagAudioBuffer.textContent = audioBufferMs === null
    ? '—'
    : `${audioBufferMs.toFixed(1)} ms`

  if (autoAudioResyncEnabled && avOffsetMs !== null && avOffsetMs > AUDIO_LATE_THRESHOLD_MS) {
    audioLateSampleCount += 1

    const cooldownExpired = Date.now() - lastAudioResyncAt >= AUDIO_RESYNC_COOLDOWN_MS
    if (audioLateSampleCount >= AUDIO_LATE_REQUIRED_SAMPLES && cooldownExpired) {
      audioLateSampleCount = 0
      void resyncAudioPlayback('automatic')
    }
  } else {
    audioLateSampleCount = 0
  }

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
    : (avOffsetMs ?? 0) > AUDIO_LATE_THRESHOLD_MS
      ? 'Audio late'
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

  // Sync monitoring stays active during a connected session even when the
  // diagnostics panel is hidden. This lets conservative auto-resync work
  // without requiring the user to keep diagnostics open.
  if (activePlayer && webRtcConnected) {
    if (!diagnosticsTimer) {
      startDiagnosticsPolling()
    }
  } else {
    stopDiagnosticsPolling()
  }
}

function formatLibraryDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Unknown date'
    : date.toLocaleString()
}

function renderRecordingLibrary(): void {
  if (recordingLibrary.length === 0) {
    recordingLibraryMessage.textContent = 'No CaptureLink recordings yet.'
    recordingLibraryList.innerHTML = `
      <div class="recording-library-empty">
        Record Xbox audio or video and the finished file will appear here.
      </div>
    `
    return
  }

  recordingLibraryMessage.textContent =
    `${recordingLibrary.length} recording${recordingLibrary.length === 1 ? '' : 's'} in your library.`

  recordingLibraryList.innerHTML = recordingLibrary.map((recording) => {
    const typeLabel = recording.kind === 'video' ? 'Video' : 'Audio'
    const duration = formatRecordingDuration(recording.durationMs)
    const size = formatRecordingBytes(recording.bytes)
    const availability = recording.exists ? '' : ' · File missing'
    const disabled = recording.exists ? '' : ' disabled'

    return `
      <article class="recording-library-item" data-recording-id="${escapeHtml(recording.id)}">
        <div class="recording-library-main">
          <div class="recording-library-badge recording-library-badge--${recording.kind}">
            ${typeLabel}
          </div>

          <div class="recording-library-copy">
            <div class="recording-library-name-row">
              <strong class="recording-library-name">${escapeHtml(recording.fileName)}</strong>
              <span class="recording-library-missing">${escapeHtml(availability)}</span>
            </div>

            <div class="recording-library-meta">
              <span>${escapeHtml(formatLibraryDate(recording.createdAt))}</span>
              <span>${escapeHtml(duration)}</span>
              <span>${escapeHtml(size)}</span>
            </div>

            <div class="recording-library-path">${escapeHtml(recording.filePath)}</div>

            <div class="recording-rename-row" hidden>
              <input
                class="recording-rename-input"
                type="text"
                value="${escapeHtml(recording.fileName)}"
                aria-label="New recording name"
              />
              <button type="button" data-action="save-rename">Save</button>
              <button type="button" data-action="cancel-rename">Cancel</button>
            </div>
          </div>
        </div>

        <div class="recording-library-actions">
          <button type="button" data-action="open"${disabled}>Open</button>
          <button type="button" data-action="show"${disabled}>Show Folder</button>
          <button type="button" data-action="rename"${disabled}>Rename</button>
          ${recording.kind === 'video'
            ? `<button type="button" data-action="export-mp4"${recording.exists && commonExportAvailable ? '' : ' disabled'}>Export MP4</button>`
            : `<button type="button" data-action="export-mp3"${recording.exists && commonExportAvailable ? '' : ' disabled'}>Export MP3</button>
               <button type="button" data-action="export-wav"${recording.exists && commonExportAvailable ? '' : ' disabled'}>Export WAV</button>`}
          <button type="button" data-action="export-original"${disabled}>Export Original</button>
          <button type="button" data-action="delete">Delete</button>
        </div>
      </article>
    `
  }).join('')
}

async function refreshRecordingExportSupport(): Promise<void> {
  recordingExportStatus.textContent = 'Checking MP4 / MP3 / WAV export support…'

  try {
    const support = await window.captureLink.getRecordingExportSupport()
    commonExportAvailable = support.available
    recordingExportStatus.textContent = support.available
      ? 'Common-format export ready: MP4 for video, MP3 / WAV for audio.'
      : `Common-format export unavailable: ${support.detail}`
  } catch (error) {
    commonExportAvailable = false
    recordingExportStatus.textContent = error instanceof Error
      ? `Common-format export unavailable: ${error.message}`
      : 'Common-format export unavailable.'
  }

  renderRecordingLibrary()
}

async function refreshRecordingLibrary(): Promise<void> {
  refreshRecordingLibraryButton.disabled = true
  recordingLibraryMessage.textContent = 'Refreshing recordings…'

  try {
    recordingLibrary = await window.captureLink.getRecordings()
    renderRecordingLibrary()
  } catch (error) {
    console.error('[CaptureLink] Recording library refresh failed:', error)
    recordingLibraryMessage.textContent = error instanceof Error
      ? `Could not load recordings: ${error.message}`
      : 'Could not load recordings.'
  } finally {
    refreshRecordingLibraryButton.disabled = false
  }
}

function findLibraryItem(id: string): CaptureLinkRecordingItem | undefined {
  return recordingLibrary.find((recording) => recording.id === id)
}

function toggleRenameEditor(card: HTMLElement, visible: boolean): void {
  const row = card.querySelector<HTMLElement>('.recording-rename-row')
  const input = card.querySelector<HTMLInputElement>('.recording-rename-input')

  if (!row || !input) {
    return
  }

  row.hidden = !visible

  if (visible) {
    input.focus()
    const extensionIndex = input.value.toLowerCase().lastIndexOf('.webm')
    input.setSelectionRange(0, extensionIndex > 0 ? extensionIndex : input.value.length)
  }
}

async function handleRecordingLibraryAction(button: HTMLButtonElement): Promise<void> {
  const action = button.dataset.action
  const card = button.closest<HTMLElement>('.recording-library-item')
  const id = card?.dataset.recordingId

  if (!action || !card || !id) {
    return
  }

  const recording = findLibraryItem(id)
  if (!recording) {
    await refreshRecordingLibrary()
    return
  }

  if (action === 'rename') {
    toggleRenameEditor(card, true)
    return
  }

  if (action === 'cancel-rename') {
    const input = card.querySelector<HTMLInputElement>('.recording-rename-input')
    if (input) {
      input.value = recording.fileName
    }
    toggleRenameEditor(card, false)
    return
  }

  button.disabled = true

  try {
    switch (action) {
      case 'open':
        await window.captureLink.openRecording(id)
        break
      case 'show':
        await window.captureLink.showRecording(id)
        break
      case 'export-original': {
        const result = await window.captureLink.exportOriginalRecording(id)
        if (result.exported && result.filePath) {
          recordingLibraryMessage.textContent = `Exported original: ${result.filePath}`
        }
        break
      }
      case 'export-mp4':
      case 'export-mp3':
      case 'export-wav': {
        const format = action.replace('export-', '') as 'mp4' | 'mp3' | 'wav'
        recordingExportStatus.textContent =
          `Exporting ${recording.fileName} as ${format.toUpperCase()}…`
        const result = await window.captureLink.exportRecording(id, format)

        if (result.exported && result.filePath) {
          recordingExportStatus.textContent =
            `Exported ${format.toUpperCase()}: ${result.filePath}`
        } else {
          recordingExportStatus.textContent = 'Export canceled.'
        }
        break
      }
      case 'delete': {
        const result = await window.captureLink.deleteRecording(id)
        if (result.deleted) {
          await refreshRecordingLibrary()
        }
        break
      }
      case 'save-rename': {
        const input = card.querySelector<HTMLInputElement>('.recording-rename-input')
        if (!input) {
          return
        }
        await window.captureLink.renameRecording(id, input.value)
        await refreshRecordingLibrary()
        break
      }
    }
  } catch (error) {
    console.error(`[CaptureLink] Recording library ${action} failed:`, error)
    recordingLibraryMessage.textContent = error instanceof Error
      ? error.message
      : `Recording ${action} failed.`
  } finally {
    if (button.isConnected) {
      button.disabled = false
    }
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

function formatRecordingBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.max(0, bytes)
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const decimals = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(decimals)} ${units[unitIndex]}`
}

function updateRecordingStorageUi(): void {
  recordingSize.textContent = formatRecordingBytes(recordingBytesWritten)
  recordingSpace.textContent = recordingAvailableBytes === null
    ? '— free'
    : `${formatRecordingBytes(recordingAvailableBytes)} free`
}

function createRecordingName(
  kind: RecordingKind,
  date = new Date()
): string {
  const stamp = date
    .toISOString()
    .replace('T', '_')
    .replace(/[:.]/g, '-')
    .replace('Z', '')

  const label = kind === 'video' ? 'Video' : 'Audio'
  return `CaptureLink-${label}-${stamp}.webm`
}

function detachRecordingMicrophoneSource(): void {
  try {
    recordingMicrophoneSource?.disconnect()
  } catch {
    // The source may already be disconnected during stream teardown.
  }

  try {
    recordingMicrophoneGainNode?.disconnect()
  } catch {
    // The gain node may already be disconnected during stream teardown.
  }

  recordingMicrophoneSource = null
  recordingMicrophoneGainNode = null
  recordingMicrophoneTrackId = ''
}

function syncRecordingMicrophoneSource(): void {
  const context = recordingAudioContext
  const destination = recordingAudioDestination

  if (!context || !destination) {
    return
  }

  const microphoneStream = activePlayer?._channels.chat._micStream
  const track = microphoneActive
    ? microphoneStream
        ?.getAudioTracks()
        .find((candidate) => candidate.readyState === 'live')
    : undefined

  if (!track) {
    detachRecordingMicrophoneSource()
    return
  }

  if (recordingMicrophoneTrackId === track.id && recordingMicrophoneSource) {
    return
  }

  detachRecordingMicrophoneSource()

  const source = context.createMediaStreamSource(new MediaStream([track]))
  const gain = context.createGain()
  gain.gain.value = recordingMicrophoneGainLevel
  source.connect(gain)
  gain.connect(destination)
  recordingMicrophoneSource = source
  recordingMicrophoneGainNode = gain
  recordingMicrophoneTrackId = track.id

  console.log(
    '[CaptureLink] Recording mix includes microphone:',
    track.label || track.id,
    `at ${Math.round(recordingMicrophoneGainLevel * 100)}%`
  )
}

function cleanupRecordingAudioMix(): void {
  detachRecordingMicrophoneSource()

  try {
    recordingXboxAudioSource?.disconnect()
  } catch {
    // The source may already be disconnected during recording teardown.
  }

  recordingXboxAudioSource = null
  recordingAudioDestination = null

  const context = recordingAudioContext
  recordingAudioContext = null

  if (context) {
    void context.close().catch(() => undefined)
  }
}

async function createRecordingAudioMix(): Promise<MediaStream | null> {
  const incoming = getIncomingAudioRecordingStream()

  if (!incoming) {
    return null
  }

  cleanupRecordingAudioMix()

  const context = new AudioContext()

  try {
    await context.resume()

    const source = context.createMediaStreamSource(incoming)
    const destination = context.createMediaStreamDestination()

    source.connect(destination)

    recordingAudioContext = context
    recordingXboxAudioSource = source
    recordingAudioDestination = destination

    // If Xbox game-chat microphone transmission is already active, mix that
    // exact outbound track into the local recording. If the user toggles the
    // microphone later, toggleMicrophone()/stopMicrophone() resync this bus.
    syncRecordingMicrophoneSource()

    return destination.stream
  } catch (error) {
    void context.close().catch(() => undefined)
    cleanupRecordingAudioMix()
    throw error
  }
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

function getIncomingVideoRecordingStream(
  audioSource: MediaStream
): MediaStream | null {
  const video = streamHolder.querySelector<HTMLVideoElement>('video')
  const videoSource = video?.srcObject

  if (!(videoSource instanceof MediaStream)) {
    return null
  }

  const videoTracks = videoSource
    .getVideoTracks()
    .filter((track) => track.readyState === 'live')

  const audioTracks = audioSource
    .getAudioTracks()
    .filter((track) => track.readyState === 'live')

  if (videoTracks.length === 0 || audioTracks.length === 0) {
    return null
  }

  return new MediaStream([
    ...videoTracks,
    ...audioTracks
  ])
}

function chooseRecordingMimeType(kind: RecordingKind): string {
  const candidates = kind === 'video'
    ? [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
      ]
    : [
        'audio/webm;codecs=opus',
        'audio/webm'
      ]

  return candidates.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate)
  ) ?? ''
}

function stopRecordingTimer(): void {
  if (recordingTimerHandle) {
    clearInterval(recordingTimerHandle)
    recordingTimerHandle = null
  }
}

function updateRecordingTimer(): void {
  if (recordingStartedAt === null) {
    recordingTimer.textContent = '00:00'
    return
  }

  recordingTimer.textContent = formatRecordingDuration(
    Date.now() - recordingStartedAt
  )
}

function resetRecordingButtonLabels(): void {
  recordAudioButton.textContent = 'Record Audio'
  recordVideoButton.textContent = 'Record Video'
}

function setRecordingUi(
  state: 'ready' | 'recording' | 'saving' | 'saved' | 'canceled' | 'error',
  kind: RecordingKind | null = recordingKind
): void {
  const recording = state === 'recording'

  recordingIndicator.hidden = !recording
  recordingIndicator.classList.toggle('recording-indicator--active', recording)
  recordAudioButton.classList.toggle(
    'record--active',
    recording && kind === 'audio'
  )
  recordVideoButton.classList.toggle(
    'record--active',
    recording && kind === 'video'
  )

  resetRecordingButtonLabels()

  const activeButton = kind === 'video'
    ? recordVideoButton
    : recordAudioButton

  switch (state) {
    case 'recording':
      activeButton.textContent = 'Stop Recording'
      recordingStatus.textContent =
        kind === 'video' ? 'Recording video' : 'Recording audio'
      break
    case 'saving':
      activeButton.textContent = 'Finalizing…'
      recordingStatus.textContent = 'Finalizing'
      break
    case 'saved':
      recordingStatus.textContent = 'Saved'
      break
    case 'canceled':
      recordingStatus.textContent = 'Not started'
      break
    case 'error':
      recordingStatus.textContent = 'Error'
      break
    default:
      recordingStatus.textContent = 'Ready'
  }
}

function finishRecordingStop(): void {
  const resolve = recordingStopResolve
  recordingStopResolve = null
  recordingStopPromise = null
  resolve?.()
}

function recordingErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Unknown recording error'
}

function queueRecordingChunk(blob: Blob, recordingId: string): void {
  if (blob.size === 0 || recordingWriteError) {
    return
  }

  recordingWriteQueue = recordingWriteQueue
    .then(async () => {
      const data = await blob.arrayBuffer()
      const result = await window.captureLink.appendRecordingChunk(
        recordingId,
        data
      )

      recordingBytesWritten = result.bytesWritten
      recordingAvailableBytes = result.availableBytes
      updateRecordingStorageUi()
    })
    .catch((error) => {
      if (!recordingWriteError) {
        recordingWriteError = error instanceof Error
          ? error
          : new Error('CaptureLink could not write the recording to disk.')

        console.error('[CaptureLink] Recording write failed:', error)
        setStreamStatus(
          `Recording stopped: ${recordingErrorMessage(recordingWriteError)}`
        )

        void stopRecording()
      }
    })
}

async function finalizeRecording(
  kind: RecordingKind,
  recordingId: string
): Promise<void> {
  recordingSaving = true
  stopRecordingTimer()
  setRecordingUi('saving', kind)
  updateInteractiveState()

  try {
    await recordingWriteQueue

    const result = await window.captureLink.finalizeRecording(recordingId)
    recordingBytesWritten = result.bytesWritten
    updateRecordingStorageUi()

    if (recordingWriteError) {
      setRecordingUi('error', kind)
      setStreamStatus(
        `${kind === 'video' ? 'Video' : 'Audio'} recording stopped early: ` +
        `${recordingWriteError.message}. Partial file preserved: ${result.filePath}`
      )
    } else {
      setRecordingUi('saved', kind)
      setStreamStatus(
        `${kind === 'video' ? 'Video' : 'Audio'} recording saved: ${result.filePath}`
      )
      void refreshRecordingLibrary()
    }
  } catch (error) {
    console.error(`[CaptureLink] ${kind} recording finalize failed:`, error)
    setRecordingUi('error', kind)
    setStreamStatus(
      `${kind === 'video' ? 'Video' : 'Audio'} recording failed: ` +
      recordingErrorMessage(error)
    )
  } finally {
    cleanupRecordingAudioMix()
    mediaRecorder = null
    recordingKind = null
    recordingFilePath = ''
    recordingStartedAt = null
    recordingSaving = false
    recordingWriteQueue = Promise.resolve()
    recordingWriteError = null
    updateInteractiveState()
    finishRecordingStop()
  }
}

async function startRecording(kind: RecordingKind): Promise<void> {
  if (
    mediaRecorder ||
    recordingSaving ||
    !activePlayer ||
    !webRtcConnected
  ) {
    return
  }

  if (typeof MediaRecorder === 'undefined') {
    setRecordingUi('error', kind)
    setStreamStatus('This Chromium build does not support MediaRecorder')
    return
  }

  let recordingAudio: MediaStream | null

  try {
    recordingAudio = await createRecordingAudioMix()
  } catch (error) {
    setRecordingUi('error', kind)
    setStreamStatus(
      `Could not prepare recording audio mix: ${recordingErrorMessage(error)}`
    )
    return
  }

  if (!recordingAudio) {
    setRecordingUi('error', kind)
    setStreamStatus('Xbox audio stream is not available for recording')
    return
  }

  const stream = kind === 'video'
    ? getIncomingVideoRecordingStream(recordingAudio)
    : recordingAudio

  if (!stream) {
    cleanupRecordingAudioMix()
    setRecordingUi('error', kind)
    setStreamStatus('Xbox video stream is not available for recording')
    return
  }

  const mimeType = chooseRecordingMimeType(kind)
  let recorder: MediaRecorder

  try {
    recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream)
  } catch (error) {
    cleanupRecordingAudioMix()
    setRecordingUi('error', kind)
    setStreamStatus(
      `Could not create ${kind} recorder: ${recordingErrorMessage(error)}`
    )
    return
  }

  const suggestedName = createRecordingName(kind)
  setStreamStatus('Choose where to save the recording...')

  let beginResult: Awaited<ReturnType<typeof window.captureLink.beginRecording>>

  try {
    beginResult = await window.captureLink.beginRecording(kind, suggestedName)
  } catch (error) {
    cleanupRecordingAudioMix()
    setRecordingUi('error', kind)
    setStreamStatus(
      `Could not start ${kind} recording: ${recordingErrorMessage(error)}`
    )
    return
  }

  if (
    !beginResult.started ||
    !beginResult.recordingId ||
    !beginResult.filePath
  ) {
    cleanupRecordingAudioMix()
    setRecordingUi('canceled', kind)
    setStreamStatus(`${kind === 'video' ? 'Video' : 'Audio'} recording not started`)
    return
  }

  const recordingId = beginResult.recordingId
  mediaRecorder = recorder
  recordingKind = kind
  recordingFilePath = beginResult.filePath
  recordingBytesWritten = 0
  recordingAvailableBytes = beginResult.availableBytes ?? null
  recordingStartedAt = Date.now()
  recordingWriteQueue = Promise.resolve()
  recordingWriteError = null
  updateRecordingStorageUi()

  recorder.ondataavailable = (event: BlobEvent) => {
    queueRecordingChunk(event.data, recordingId)
  }

  recorder.onerror = (event) => {
    console.error(`[CaptureLink] ${kind} MediaRecorder error:`, event)

    if (!recordingWriteError) {
      recordingWriteError = new Error(
        `${kind === 'video' ? 'Video' : 'Audio'} recorder reported an error.`
      )
    }

    void stopRecording()
  }

  recorder.onstop = () => {
    void finalizeRecording(kind, recordingId)
  }

  try {
    recorder.start(1000)
  } catch (error) {
    mediaRecorder = null
    recordingKind = null
    recordingFilePath = ''
    recordingStartedAt = null
    cleanupRecordingAudioMix()

    await window.captureLink.cancelRecording(recordingId).catch((cancelError) => {
      console.warn('[CaptureLink] Failed to cancel unopened recording:', cancelError)
    })

    setRecordingUi('error', kind)
    setStreamStatus(
      `Could not start ${kind} recorder: ${recordingErrorMessage(error)}`
    )
    updateInteractiveState()
    return
  }

  updateRecordingTimer()
  recordingTimerHandle = setInterval(updateRecordingTimer, 250)
  setRecordingUi('recording', kind)
  const microphoneIncluded = recordingMicrophoneSource !== null
  setStreamStatus(
    kind === 'video'
      ? `Recording Xbox video + audio${microphoneIncluded ? ' + microphone' : ''} to ${recordingFilePath}`
      : `Recording Xbox audio${microphoneIncluded ? ' + microphone' : ''} to ${recordingFilePath}`
  )
  updateInteractiveState()
}

function stopRecording(): Promise<void> {
  if (recordingStopPromise) {
    return recordingStopPromise
  }

  if (!mediaRecorder) {
    return Promise.resolve()
  }

  recordingStopPromise = new Promise<void>((resolve) => {
    recordingStopResolve = resolve
  })

  if (
    mediaRecorder.state === 'recording' ||
    mediaRecorder.state === 'paused'
  ) {
    setRecordingUi('saving', recordingKind)
    recordingStatus.textContent = 'Stopping…'
    mediaRecorder.stop()
  } else if (!recordingSaving) {
    finishRecordingStop()
  }

  updateInteractiveState()
  return recordingStopPromise ?? Promise.resolve()
}

async function toggleRecording(kind: RecordingKind): Promise<void> {
  if (mediaRecorder) {
    if (recordingKind === kind) {
      await stopRecording()
    }
    return
  }

  await startRecording(kind)
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
  resyncAudioButton.disabled = !mediaReady || audioResyncInProgress
  diagnosticsButton.disabled = !mediaReady
  const recordingActive = mediaRecorder?.state === 'recording' ||
    mediaRecorder?.state === 'paused'
  recordAudioButton.disabled = recordingSaving ||
    (recordingActive
      ? recordingKind !== 'audio'
      : !mediaReady)
  recordVideoButton.disabled = recordingSaving ||
    (recordingActive
      ? recordingKind !== 'video'
      : !mediaReady)

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
  if (mediaRecorder && !recordingSaving) {
    void stopRecording()
  }

  detachController()
  stopMicrophoneMonitor()
  stopMicrophone()
  webRtcConnected = false
  stopDiagnosticsPolling()
  setDiagnosticsVisible(false)

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

  if (mediaRecorder || recordingSaving) {
    setStreamStatus('Stopping recording before disconnect...')
    await stopRecording()
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
        startDiagnosticsPolling()
        updateInteractiveState()
      }

      if (state === 'failed' || state === 'disconnected') {
        webRtcConnected = false
        stopDiagnosticsPolling()

        if (mediaRecorder || recordingSaving) {
          setStreamStatus(`WebRTC ${state}; finalizing recording...`)
          void stopRecording().finally(() => {
            showStreamPlaceholder(`WebRTC ${state}. Disconnect and try again.`)
            updateInteractiveState()
          })
        } else {
          showStreamPlaceholder(`WebRTC ${state}. Disconnect and try again.`)
          updateInteractiveState()
        }
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
    syncRecordingMicrophoneSource()
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

recordingMicGain.addEventListener('input', () => {
  const parsed = Number(recordingMicGain.value)
  const clamped = Math.min(200, Math.max(0, Number.isFinite(parsed) ? parsed : 100))
  recordingMicrophoneGainLevel = clamped / 100
  recordingMicGain.value = String(clamped)
  recordingMicGainValue.value = `${Math.round(clamped)}%`
  recordingMicGainValue.textContent = `${Math.round(clamped)}%`

  if (recordingMicrophoneGainNode && recordingAudioContext) {
    recordingMicrophoneGainNode.gain.setValueAtTime(
      recordingMicrophoneGainLevel,
      recordingAudioContext.currentTime
    )
  }

  window.localStorage.setItem('capturelink.recordingMicGain', String(clamped))
})

resyncAudioButton.addEventListener('click', () => {
  void resyncAudioPlayback('manual')
})

autoAudioResync.addEventListener('change', () => {
  autoAudioResyncEnabled = autoAudioResync.checked
  audioLateSampleCount = 0
  window.localStorage.setItem(
    'capturelink.autoAudioResync',
    autoAudioResyncEnabled ? 'true' : 'false'
  )
})

diagnosticsButton.addEventListener('click', () => {
  setDiagnosticsVisible(!diagnosticsVisible)
})


recordAudioButton.addEventListener('click', () => {
  void toggleRecording('audio')
})

recordVideoButton.addEventListener('click', () => {
  void toggleRecording('video')
})

window.captureLink.onRecordingStopRequested(() => {
  setStreamStatus('Stopping recording before CaptureLink closes...')
  void stopRecording()
})

refreshRecordingLibraryButton.addEventListener('click', () => {
  void refreshRecordingLibrary()
})

recordingLibraryList.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }

  const button = target.closest<HTMLButtonElement>('button[data-action]')
  if (button && !button.disabled) {
    void handleRecordingLibraryAction(button)
  }
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

const mediaDevicesWithOutputChooser = navigator.mediaDevices as MediaDevices & {
  selectAudioOutput?: () => Promise<MediaDeviceInfo>
}

if (!mediaDevicesWithOutputChooser.selectAudioOutput) {
  chooseSpeakerButton.disabled = true
  chooseSpeakerButton.title = 'Native output chooser is unavailable in this Chromium build.'
}

chooseSpeakerButton.addEventListener('click', () => {
  if (!mediaDevicesWithOutputChooser.selectAudioOutput) {
    speakerDeviceState.textContent = 'Unsupported'
    speakerDeviceMessage.textContent =
      'This Chromium build does not expose the audio-output chooser.'
    return
  }

  void mediaDevicesWithOutputChooser.selectAudioOutput()
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

window.captureLink.onRecordingExportProgress((progress) => {
  const recording = findLibraryItem(progress.id)
  const name = recording?.fileName ?? 'recording'
  recordingExportStatus.textContent =
    `Exporting ${name} as ${progress.format.toUpperCase()}… ${Math.round(progress.percent)}%`
})

window.captureLink.onXboxStreamStatus((status) => {
  setStreamStatus(status)
})

window.addEventListener('beforeunload', () => {
  destroyPlayer()
  void window.captureLink.stopXboxStream()
})

const savedRecordingMicGain = Number(
  window.localStorage.getItem('capturelink.recordingMicGain') ?? '100'
)
const initialRecordingMicGain = Number.isFinite(savedRecordingMicGain)
  ? Math.min(200, Math.max(0, savedRecordingMicGain))
  : 100
recordingMicrophoneGainLevel = initialRecordingMicGain / 100
recordingMicGain.value = String(initialRecordingMicGain)
recordingMicGainValue.value = `${Math.round(initialRecordingMicGain)}%`
recordingMicGainValue.textContent = `${Math.round(initialRecordingMicGain)}%`

const savedAutoAudioResync = window.localStorage.getItem('capturelink.autoAudioResync')
autoAudioResyncEnabled = savedAutoAudioResync !== 'false'
autoAudioResync.checked = autoAudioResyncEnabled

void refreshAudioDevices()
void refreshRecordingLibrary()
void refreshRecordingExportSupport()
void refreshAuthStatus()
