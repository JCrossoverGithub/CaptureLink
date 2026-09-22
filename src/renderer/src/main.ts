import {
  RemoteGamepadAdapter,
  createNeutralFriendGamepadState,
  createSyntheticButtonGamepadState
} from './friend-control/remote-gamepad'

import {
  FriendControllerPeer,
  type FriendMediaDiagnostics
} from './friend-control/p2p-controller'

type XboxReceiveMode =
  | 'full'
  | 'audio-only'

const XBOX_RECEIVE_MODE_STORAGE_KEY =
  'capturelink.xboxReceiveMode'

function parseXboxReceiveMode(
  value: string | null
): XboxReceiveMode {
  return value === 'audio-only'
    ? 'audio-only'
    : 'full'
}

function loadXboxReceiveMode():
  XboxReceiveMode {
  return parseXboxReceiveMode(
    window.localStorage.getItem(
      XBOX_RECEIVE_MODE_STORAGE_KEY
    )
  )
}

function saveXboxReceiveMode(
  mode: XboxReceiveMode
): void {
  window.localStorage.setItem(
    XBOX_RECEIVE_MODE_STORAGE_KEY,
    mode
  )
}

let xboxReceiveMode:
  XboxReceiveMode =
    loadXboxReceiveMode()

// The active session keeps the mode it negotiated with.
// Changing the setting applies to the next connection.
let activeXboxReceiveMode:
  XboxReceiveMode | null = null

function configureXboxReceiveMode(
  player: CaptureLinkPlayer,
  mode: XboxReceiveMode
): void {
  const transceivers =
    player._peerConnection
      .getTransceivers()

  const video =
    transceivers.find(
      (transceiver) =>
        transceiver.receiver.track.kind ===
        'video'
    )

  const audio =
    transceivers.find(
      (transceiver) =>
        transceiver.receiver.track.kind ===
        'audio'
    )

  if (!audio) {
    throw new Error(
      'Xbox player did not create an audio transceiver.'
    )
  }

  if (!video) {
    throw new Error(
      'Xbox player did not create a video transceiver.'
    )
  }

  /*
   * Leave Xbox audio alone.
   *
   * xbox-xcloud-player creates audio as sendrecv,
   * preserving microphone/game-chat negotiation.
   *
   * Audio Only makes the Xbox video transceiver
   * inactive before the initial SDP offer.
   */
  video.direction =
    mode === 'audio-only'
      ? 'inactive'
      : 'recvonly'

  console.log(
    '[CaptureLink:XboxMediaMode]',
    {
      mode,

      audioDirection:
        audio.direction,

      videoDirection:
        video.direction,

      transceivers:
        transceivers.map(
          (transceiver) => ({
            kind:
              transceiver
                .receiver
                .track
                .kind,

            direction:
              transceiver.direction,

            currentDirection:
              transceiver
                .currentDirection
          })
        )
    }
  )
}

async function inspectXboxInboundMedia(
  player: CaptureLinkPlayer
): Promise<void> {
  const report =
    await player._peerConnection.getStats()

  let audioBytes = 0
  let videoBytes = 0

  report.forEach((rawStat) => {
    const stat =
      rawStat as RTCInboundRtpStreamStats

    if (
      stat.type !== 'inbound-rtp'
    ) {
      return
    }

    const kind =
      (
        stat as RTCInboundRtpStreamStats & {
          kind?: string
          mediaType?: string
        }
      ).kind ??
      (
        stat as RTCInboundRtpStreamStats & {
          mediaType?: string
        }
      ).mediaType

    if (
      kind === 'audio' &&
      typeof stat.bytesReceived === 'number'
    ) {
      audioBytes +=
        stat.bytesReceived
    }

    if (
      kind === 'video' &&
      typeof stat.bytesReceived === 'number'
    ) {
      videoBytes +=
        stat.bytesReceived
    }
  })

  const formatBytes = (
    bytes: number
  ): string => {
    if (bytes < 1024) {
      return `${bytes} B`
    }

    if (bytes < 1024 * 1024) {
      return `${(
        bytes / 1024
      ).toFixed(1)} KB`
    }

    return `${(
      bytes /
      1024 /
      1024
    ).toFixed(2)} MB`
  }

  console.log(
    '[CaptureLink:XboxMediaMode] Inbound media',
    {
      audioBytes,
      videoBytes
    }
  )

  if (
    activeXboxReceiveMode ===
    'audio-only'
  ) {
    setStreamStatus(
      `Audio Only · audio ${formatBytes(
        audioBytes
      )} · video ${formatBytes(
        videoBytes
      )}`
    )
  }
}

function inspectXboxOfferMedia(
  sdp: string
): {
  audioDirection: string | null
  videoDirection: string | null
} {
  const sections =
    sdp.split(/(?=m=)/)

  const findDirection = (
    media: 'audio' | 'video'
  ): string | null => {
    const section =
      sections.find(
        (candidate) =>
          candidate.startsWith(
            `m=${media} `
          )
      )

    if (!section) {
      return null
    }

    const match =
      section.match(
        /^a=(sendrecv|sendonly|recvonly|inactive)$/m
      )

    return match?.[1] ?? null
  }

  return {
    audioDirection:
      findDirection('audio'),

    videoDirection:
      findDirection('video')
  }
}

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('CaptureLink app root not found')
}

// CAPTURELINK_MINIMALIST_UI_SHELL
root.innerHTML = `
  <main class="shell app-shell">
    <header class="app-topbar">
      <div class="brand-lockup" aria-label="CaptureLink">
        <div class="brand-mark">CL</div>
        <div class="brand-name">CaptureLink</div>
      </div>

      <div class="topbar-account">
        <span id="account-status" class="status status--idle topbar-account-status">
          Checking account...
        </span>

        <span
          id="topbar-account-divider"
          class="topbar-account-divider"
          aria-hidden="true"
          hidden
        ></span>

        <details id="topbar-account-menu" class="topbar-account-menu" hidden>
          <summary
            id="topbar-account-trigger"
            class="topbar-account-trigger"
            aria-label="Xbox account menu"
          >
            <span class="topbar-account-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9"/>
                <path d="M7.5 8.2c2.7-2.2 6.3-2.2 9 0M8 16.5c1.1-3.1 2.7-5.5 4-7 1.3 1.5 2.9 3.9 4 7"/>
              </svg>
            </span>

            <span class="topbar-account-copy">
              <strong>Xbox account</strong>
              <small>Remote Play</small>
            </span>

            <svg class="topbar-account-chevron" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m8 10 4 4 4-4"/>
            </svg>
          </summary>

          <div id="topbar-account-popover" class="topbar-account-popover">
            <div class="topbar-account-popover__identity">
              <span class="topbar-account-avatar topbar-account-avatar--large" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9"/>
                  <path d="M7.5 8.2c2.7-2.2 6.3-2.2 9 0M8 16.5c1.1-3.1 2.7-5.5 4-7 1.3 1.5 2.9 3.9 4 7"/>
                </svg>
              </span>
              <div>
                <strong>Microsoft / Xbox</strong>
                <span>Signed in for Remote Play</span>
              </div>
            </div>
          </div>
        </details>

        <button
          id="sign-in"
          class="topbar-auth"
          type="button"
        >
          Sign in
        </button>
      </div>
    </header>

    <div class="app-frame">
      <aside class="sidebar-nav" aria-label="CaptureLink navigation">
        <nav class="sidebar-nav__items">
          <button class="nav-item" type="button" data-view="connect">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/>
              <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/>
            </svg>
            <span>Connect</span>
          </button>

          <button class="nav-item is-active" type="button" data-view="stream" aria-current="page">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 11h12a3 3 0 0 1 2.7 4.3l-1.4 3a2 2 0 0 1-3.2.6L14 17h-4l-2.1 1.9a2 2 0 0 1-3.2-.6l-1.4-3A3 3 0 0 1 6 11Z"/>
              <path d="M8 14v2M7 15h2M16 14h.01M18 16h.01"/>
            </svg>
            <span>Stream</span>
          </button>

          <button class="nav-item" type="button" data-view="audio">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 5 6 9H3v6h3l5 4Z"/>
              <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/>
            </svg>
            <span>Audio</span>
          </button>

          <button class="nav-item" type="button" data-view="recordings">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2"/>
              <path d="m10 9 5 3-5 3Z"/>
            </svg>
            <span>Recordings</span>
          </button>

          <button class="nav-item" type="button" data-view="settings">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>
            </svg>
            <span>Settings</span>
          </button>
        </nav>

        <div class="sidebar-nav__footer">
          <span>CaptureLink</span>
          <small>v0.2.0</small>
        </div>
      </aside>

      <div class="workspace">
        <section class="view-panel" data-panel="connect">
          <div class="view-heading view-heading--compact">
            <div>
              <div class="eyebrow">CONNECT</div>
              <h1>Xbox connection</h1>
              <p class="view-heading__support">
                Sign in, confirm Remote Play, and choose the Xbox you want to capture.
              </p>
            </div>
          </div>

          <div class="connect-overview">
            <article class="surface connect-account-card">
              <div class="connect-card__icon connect-card__icon--xbox">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9"/>
                  <path d="M7.5 8.2c2.7-2.2 6.3-2.2 9 0M8 16.5c1.1-3.1 2.7-5.5 4-7 1.3 1.5 2.9 3.9 4 7"/>
                </svg>
              </div>

              <div class="connect-card__copy">
                <div class="connect-card__label">Xbox account</div>
                <strong id="connect-account-state">Checking account…</strong>
                <p id="auth-message" aria-live="polite">Checking authentication status...</p>
              </div>

              <div class="connect-card__status" id="connect-account-badge">
                Checking
              </div>

              <pre
                id="auth-output"
                class="auth-output"
                aria-live="polite"
              ></pre>
            </article>

            <article class="surface connect-help-card">
              <div class="connect-card__icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 11h12a3 3 0 0 1 2.7 4.3l-1.4 3a2 2 0 0 1-3.2.6L14 17h-4l-2.1 1.9a2 2 0 0 1-3.2-.6l-1.4-3A3 3 0 0 1 6 11Z"/>
                  <path d="M8 14v2M7 15h2M16 14h.01M18 16h.01"/>
                </svg>
              </div>

              <div class="connect-card__copy">
                <div class="connect-card__label">Remote Play</div>
                <strong>Xbox setup</strong>
                <p>Enable Remote features and Sleep mode before connecting.</p>
              </div>

              <button
                id="connect-setup-toggle"
                class="connect-card__action"
                type="button"
                aria-expanded="false"
              >
                View steps
              </button>
            </article>
          </div>

          <article class="surface console-section console-surface">
            <div class="section-heading section-heading--minimal">
              <div>
                <div class="eyebrow">CONSOLES</div>
                <h2>Your Xboxes</h2>
                <p id="console-message" aria-live="polite">Sign in to discover your Xbox consoles.</p>
              </div>

              <button id="refresh-consoles" type="button" disabled>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 6v5h-5M4 18v-5h5"/>
                  <path d="M6.1 9a7 7 0 0 1 11.4-2.4L20 11M4 13l2.5 4.4A7 7 0 0 0 17.9 15"/>
                </svg>
                <span>Refresh</span>
              </button>
            </div>

            <div id="remote-play-setup-slot" class="remote-play-setup-slot"></div>
            <div id="console-list" class="console-list console-list--minimal"></div>
          </article>
        </section>

        <section class="view-panel is-active" data-panel="stream">
          <div class="stream-workspace">
            <div class="stream-primary">
              <section class="stream-card" aria-label="Remote Play preview">
                <div id="stream-holder" class="stream-holder">
                  <div id="stream-placeholder" class="stream-placeholder">
                    <div class="stream-mark">CL</div>
                    <p>Choose an Xbox in Connect to start Remote Play.</p>
                  </div>
                </div>

                <div class="stream-meta">
                  <div class="stream-meta__left">
                    <span class="live-dot" aria-hidden="true"></span>
                    <span id="stream-status" class="stream-state" aria-live="polite">
                      Remote Play idle
                    </span>
                  </div>

                  <div class="stream-meta__recording" aria-live="polite" aria-atomic="true">
                    <span id="recording-indicator" class="recording-indicator" hidden>
                      ● REC
                    </span>
                    <span id="recording-timer" class="recording-timer">00:00</span>
                    <span id="recording-status" class="recording-status">Ready</span>
                    <span id="recording-size" class="recording-size" hidden>0 B</span>
                    <span id="recording-space" class="recording-space" hidden>— free</span>
                  </div>
                </div>
              </section>

              <div class="controls control-dock control-dock--mockup">
                <div class="control-group control-group--audio">
                  <div class="control-group__label">AUDIO</div>

                  <button
                    id="microphone-toggle"
                    class="dock-button dock-button--square icon-mic"
                    type="button"
                    disabled
                    aria-pressed="false"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/></svg><span class="dock-button__label">Enable Microphone</span>
                  </button>

                  <div class="audio-controls" aria-label="Stream audio controls">
                    <button id="audio-mute" class="icon-volume" type="button" disabled>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/><path d="m16 9 5 6M21 9l-5 6"/></svg><span class="dock-button__label">Mute</span>
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
                </div>

                <div class="control-group control-group--stream-controls">
                  <div class="control-group__label">STREAM CONTROLS</div>

                  <button
                    id="controller-toggle"
                    class="dock-button dock-button--square icon-controller"
                    type="button"
                    disabled
                    aria-pressed="false"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 11h12a3 3 0 0 1 2.7 4.3l-1.4 3a2 2 0 0 1-3.2.6L14 17h-4l-2.1 1.9a2 2 0 0 1-3.2-.6l-1.4-3A3 3 0 0 1 6 11Z"/><path d="M8 14v2M7 15h2M16 14h.01M18 16h.01"/></svg><span class="dock-button__label">Enable Controller</span>
                  </button>

                  <button
                    id="picture-in-picture"
                    data-static-title="true"
                    class="dock-button dock-button--square icon-pip"
                    type="button"
                    disabled
                    title="Show the Xbox stream in a floating Picture-in-Picture window"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="5" rx="1"/></svg><span class="dock-button__label">Picture in Picture</span>
                  </button>

                  <button
                    id="record-video"
                    data-static-title="true"
                    type="button"
                    class="record dock-button dock-button--primary-record icon-record-video"
                    disabled
                    title="Record Xbox video with game audio, incoming game chat, and your microphone when enabled"
                  >
                    <span class="primary-record-dot" aria-hidden="true"></span>
                    <span class="dock-button__label">Record Video</span>
                  </button>

                  <button
                    id="fullscreen-video"
                    data-static-title="true"
                    class="dock-button dock-button--square icon-fullscreen"
                    type="button"
                    disabled
                    title="Show the Xbox stream fullscreen"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg><span class="dock-button__label">Fullscreen</span>
                  </button>
                </div>

                <div class="control-group control-group--actions">
                  <div class="control-group__label">ACTIONS</div>

                  <button
                    id="record-audio"
                    data-static-title="true"
                    type="button"
                    class="record dock-button dock-button--action-label icon-record-audio"
                    disabled
                    title="Record Xbox game audio, incoming game chat, and your microphone when enabled"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M4 12h2M18 12h2"/></svg><span class="dock-button__label">Record Audio</span>
                  </button>

                  <button
                    id="diagnostics-toggle"
                    class="dock-button dock-button--action-label dock-button--quiet icon-diagnostics"
                    type="button"
                    aria-pressed="false"
                    disabled
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg><span class="dock-button__label">Diagnostics</span>
                  </button>

                  <button
                    id="disconnect-session"
                    class="dock-button dock-button--action-label dock-button--danger icon-disconnect"
                    type="button"
                    disabled
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1"/><path d="M15 12a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1"/><path d="m4 4 16 16"/></svg><span class="dock-button__label">Disconnect</span>
                  </button>
                </div>
              </div>
            </div>

            <aside class="context-rail" aria-label="Stream context">
              <article class="rail-card rail-card--console">
                <div class="rail-card__heading">
                  <span>Console</span>
                  <span id="rail-console-status" class="rail-status">Idle</span>
                </div>

                <div class="rail-console rail-console--select">
                  <div class="rail-console__icon rail-console__icon--device" aria-hidden="true">
                    <svg viewBox="0 0 32 32">
                      <rect x="7" y="3.5" width="11" height="25" rx="2"/>
                      <circle cx="12.5" cy="8" r="1.2"/>
                      <path d="M21 18.5h4.5a3 3 0 0 1 2.7 4.3l-.9 1.9a1.7 1.7 0 0 1-2.8.5L23 24h-3l-1.5 1.2"/>
                    </svg>
                  </div>

                  <div class="rail-console__copy">
                    <strong id="rail-console-name">No console selected</strong>
                    <span id="rail-console-detail">Choose one in Connect</span>
                  </div>

                  <svg class="rail-console__chevron" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m8 10 4 4 4-4"/>
                  </svg>
                </div>

                <button class="rail-link rail-link--with-icon view-jump" type="button" data-view-target="connect">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 6v5h-5M4 18v-5h5"/>
                    <path d="M6.1 9a7 7 0 0 1 11.4-2.4L20 11M4 13l2.5 4.4A7 7 0 0 0 17.9 15"/>
                  </svg>
                  <span>Manage consoles</span>
                </button>
              </article>

              <article class="rail-card rail-card--session">
                <div class="rail-card__heading">
                  <span>Session</span>
                  <span id="rail-session-state" class="rail-status">Idle</span>
                </div>

                <dl class="session-facts session-facts--visual">
                  <div>
                    <dt>
                      <span class="session-fact__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a6 6 0 0 1 8 0M11 18.5a2 2 0 0 1 2 0"/>
                        </svg>
                      </span>
                      <span>Network</span>
                    </dt>
                    <dd id="rail-session-connection">Waiting</dd>
                  </div>
                  <div>
                    <dt>
                      <span class="session-fact__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <rect x="3" y="5" width="18" height="13" rx="2"/>
                          <path d="M8 21h8M12 18v3"/>
                        </svg>
                      </span>
                      <span>Video</span>
                    </dt>
                    <dd id="rail-session-video">—</dd>
                  </div>
                  <div>
                    <dt>
                      <span class="session-fact__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path d="M5 19v-3M9 19v-6M13 19V9M17 19V6M21 19V3"/>
                        </svg>
                      </span>
                      <span>Latency</span>
                    </dt>
                    <dd id="rail-session-latency">—</dd>
                  </div>
                </dl>
              </article>

              <article class="rail-card rail-card--recording">
                <div class="rail-card__heading">
                  <span>Last recording</span>
                  <button class="rail-card__icon-button view-jump" type="button" data-view-target="recordings" title="Open recordings">
                    →
                  </button>
                </div>

                <div class="last-recording">
                  <div class="last-recording__icon">▶</div>
                  <div>
                    <strong id="rail-last-recording-name">No recordings yet</strong>
                    <span id="rail-last-recording-meta">Capture something to get started</span>
                  </div>
                </div>

                <button class="rail-link rail-link--with-icon view-jump" type="button" data-view-target="recordings">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 7h7l2 2h9v10H3Z"/>
                  </svg>
                  <span>Open recordings</span>
                </button>
              </article>
            </aside>
          </div>
        </section>

        <section class="view-panel" data-panel="audio">
          <div class="view-heading view-heading--compact">
            <div>
              <div class="eyebrow">AUDIO</div>
              <h1>Audio routing</h1>
              <p class="view-heading__support">
                Choose what CaptureLink sends to Xbox and where incoming audio plays.
              </p>
            </div>

            <button id="refresh-audio-devices" class="view-heading__action" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 6v5h-5M4 18v-5h5"/>
                <path d="M6.1 9a7 7 0 0 1 11.4-2.4L20 11M4 13l2.5 4.4A7 7 0 0 0 17.9 15"/>
              </svg>
              <span>Refresh devices</span>
            </button>
          </div>

          <article
            class="surface xbox-stream-mode-card"
            aria-labelledby="xbox-stream-mode-title"
          >
            <div class="xbox-stream-mode-card__heading">
              <div>
                <div class="eyebrow">XBOX STREAM</div>
                <h2 id="xbox-stream-mode-title">
                  Remote Play media
                </h2>
                <p>
                  Choose whether CaptureLink requests Xbox video and audio,
                  or audio only. The setting applies the next time you connect.
                </p>
              </div>

              <span
                id="xbox-stream-mode-badge"
                class="device-state"
              >
                Video + Audio
              </span>
            </div>

            <div
              class="xbox-stream-mode-options"
              role="radiogroup"
              aria-label="Xbox Remote Play media mode"
            >
              <label class="xbox-stream-mode-option">
                <input
                  type="radio"
                  name="xbox-stream-mode"
                  value="full"
                />

                <span class="xbox-stream-mode-option__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <rect x="3" y="5" width="18" height="13" rx="2"/>
                    <path d="M8 21h8M12 18v3"/>
                  </svg>
                </span>

                <span class="xbox-stream-mode-option__copy">
                  <strong>Video + Audio</strong>
                  <small>
                    Standard Xbox Remote Play with the full video stream.
                  </small>
                </span>
              </label>

              <label class="xbox-stream-mode-option">
                <input
                  type="radio"
                  name="xbox-stream-mode"
                  value="audio-only"
                />

                <span class="xbox-stream-mode-option__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M11 5 6 9H3v6h3l5 4Z"/>
                    <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/>
                  </svg>
                </span>

                <span class="xbox-stream-mode-option__copy">
                  <strong>Audio Only</strong>
                  <small>
                    Receive Xbox audio without requesting video.
                    Uses substantially less bandwidth.
                  </small>
                </span>
              </label>
            </div>

            <p
              id="xbox-stream-mode-message"
              class="device-message"
              aria-live="polite"
            >
              Video + Audio will be used for the next connection.
            </p>
          </article>

          <section class="audio-devices-panel audio-devices-panel--minimal" aria-label="Audio devices">
            <div class="audio-summary-strip">
              <div class="audio-summary-item">
                <span class="audio-summary-item__icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="11" rx="3"/>
                    <path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/>
                  </svg>
                </span>
                <span>
                  <small>Microphone</small>
                  <strong id="audio-summary-mic">System default</strong>
                </span>
                <span id="mic-device-state" class="device-state">Idle</span>
              </div>

              <div class="audio-summary-item">
                <span class="audio-summary-item__icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M11 5 6 9H3v6h3l5 4Z"/>
                    <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/>
                  </svg>
                </span>
                <span>
                  <small>Speakers</small>
                  <strong id="audio-summary-speaker">System default</strong>
                </span>
                <span id="speaker-device-state" class="device-state">Default</span>
              </div>
            </div>

            <div class="audio-device-grid audio-device-grid--minimal">
              <article class="audio-device-card audio-device-card--minimal">
                <div class="audio-device-title">
                  <div>
                    <div class="eyebrow">MICROPHONE</div>
                    <h3>Xbox game-chat input</h3>
                    <p>Choose and test the microphone CaptureLink sends to Xbox.</p>
                  </div>
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

                <div class="audio-device-actions-row">
                  <button id="test-microphone" type="button">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5v14l11-7Z"/>
                    </svg>
                    <span>Test microphone</span>
                  </button>
                </div>

                <p id="microphone-device-message" class="device-message" aria-live="polite">
                  Choose a microphone, then test it before enabling Xbox chat.
                </p>
              </article>

              <article class="audio-device-card audio-device-card--minimal">
                <div class="audio-device-title">
                  <div>
                    <div class="eyebrow">SPEAKERS</div>
                    <h3>Xbox playback output</h3>
                    <p>Choose where incoming Xbox audio should play.</p>
                  </div>
                </div>

                <label class="device-field" for="speaker-device">
                  <span>Output device</span>
                  <select id="speaker-device">
                    <option value="">System default</option>
                  </select>
                </label>

                <div class="audio-device-actions-row">
                  <button id="choose-speaker" type="button">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M11 5 6 9H3v6h3l5 4Z"/>
                      <path d="M15.5 8.5a5 5 0 0 1 0 7"/>
                    </svg>
                    <span>Choose output</span>
                  </button>

                  <button
                    id="resync-audio"
                    data-static-title="true"
                    type="button"
                    disabled
                    title="Rebuild local audio playback without reconnecting to Xbox"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20 6v5h-5M4 18v-5h5"/>
                      <path d="M6.1 9a7 7 0 0 1 11.4-2.4L20 11M4 13l2.5 4.4A7 7 0 0 0 17.9 15"/>
                    </svg>
                    <span>Resync</span>
                  </button>
                </div>

                <label class="toggle-field toggle-field--card" for="auto-audio-resync">
                  <input id="auto-audio-resync" type="checkbox" checked />
                  <span>
                    <strong>Automatic resync</strong>
                    <small>Repair sustained playback delay without reconnecting the Xbox session.</small>
                  </span>
                </label>

                <p id="speaker-device-message" class="device-message" aria-live="polite">
                  CaptureLink uses the system default output until another device is selected.
                </p>
              </article>
            </div>

            <article class="recording-mic-card">
              <div>
                <div class="eyebrow">RECORDING</div>
                <h3>Microphone level in saved recordings</h3>
                <p>This changes your microphone level in local captures only. Xbox game-chat volume is unchanged.</p>
              </div>

              <label class="recording-mic-control" for="recording-mic-gain">
                <input
                  id="recording-mic-gain"
                  type="range"
                  min="0"
                  max="200"
                  step="5"
                  value="100"
                />
                <output id="recording-mic-gain-value" for="recording-mic-gain">100%</output>
              </label>
            </article>
          </section>
        </section>

        <section class="view-panel" data-panel="recordings">
          <div class="view-heading view-heading--compact recordings-heading">
            <div>
              <div class="eyebrow">RECORDINGS</div>
              <h1>Capture library</h1>
              <p class="view-heading__support">
                Open recent captures quickly. Export, rename, and file-management actions stay one click away.
              </p>
            </div>

            <button id="refresh-recording-library" class="view-heading__action" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 6v5h-5M4 18v-5h5"/>
                <path d="M6.1 9a7 7 0 0 1 11.4-2.4L20 11M4 13l2.5 4.4A7 7 0 0 0 17.9 15"/>
              </svg>
              <span>Refresh</span>
            </button>
          </div>

          <section class="recording-library-panel recording-library-panel--minimal" aria-label="Recording library">
            <div class="recording-toolbar">
              <label class="recording-search" for="recording-search">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="7"/>
                  <path d="m20 20-4-4"/>
                </svg>
                <input
                  id="recording-search"
                  type="search"
                  placeholder="Search recordings"
                  autocomplete="off"
                />
              </label>

              <div class="recording-toolbar__status">
                <span id="recording-library-message" role="status" aria-live="polite">
                  Finished recordings will appear here automatically.
                </span>
                <span id="recording-export-status" role="status" aria-live="polite">
                  Checking export support…
                </span>
              </div>
            </div>

            <div
              id="recording-library-list"
              class="recording-library-list recording-library-list--minimal"
              aria-live="polite"
            ></div>
          </section>
        </section>

        <section class="view-panel" data-panel="settings">
          <div class="view-heading view-heading--compact">
            <div>
              <div class="eyebrow">SETTINGS</div>
              <h1>CaptureLink settings</h1>
              <p class="view-heading__support">
                Account controls, Remote Play help, and advanced session diagnostics.
              </p>
            </div>
          </div>

          <div class="settings-grid">
            <article class="surface settings-card settings-card--account">
              <div class="settings-card__icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>
                </svg>
              </div>

              <div class="settings-card__body">
                <div class="eyebrow">ACCOUNT</div>
                <h2>Xbox account</h2>
                <p id="settings-account-state">Checking account…</p>
              </div>

              <button id="settings-sign-out" type="button" class="settings-card__action" hidden>
                Sign out
              </button>
            </article>

            <article class="surface settings-card">
              <div class="settings-card__icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 12h4l2-5 4 10 2-5h6"/>
                </svg>
              </div>

              <div class="settings-card__body">
                <div class="eyebrow">DIAGNOSTICS</div>
                <h2>WebRTC session health</h2>
                <p>Inspect connection, audio, microphone, and video statistics for the active Remote Play session.</p>
              </div>

              <button
                id="settings-diagnostics-toggle"
                type="button"
                class="settings-card__action"
                disabled
              >
                Show diagnostics
              </button>
            </article>

            <article class="surface settings-card">
              <div class="settings-card__icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9"/>
                  <path d="M9.7 9a2.5 2.5 0 1 1 4.6 1.3c-.9 1.3-2.3 1.5-2.3 3.2M12 17h.01"/>
                </svg>
              </div>

              <div class="settings-card__body">
                <div class="eyebrow">REMOTE PLAY</div>
                <h2>Xbox setup help</h2>
                <p>Review the console settings CaptureLink needs before connecting.</p>
              </div>

              <button
                id="settings-open-connect"
                type="button"
                class="settings-card__action view-jump"
                data-view-target="connect"
              >
                Open setup
              </button>
            </article>
          </div>

          <section
            id="diagnostics-panel"
            class="diagnostics-panel diagnostics-panel--settings"
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
        </section>
      </div>
    </div>
  </main>
`

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Required CaptureLink element not found: ${selector}`)
  }

  return element
}

const workspace =
  requireElement<HTMLElement>('.workspace')

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

const fullscreenVideoButton =
  requireElement<HTMLButtonElement>('#fullscreen-video')

const pictureInPictureButton =
  requireElement<HTMLButtonElement>('#picture-in-picture')

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

const xboxStreamModeInputs =
  Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[name="xbox-stream-mode"]'
    )
  )

const xboxStreamModeBadge =
  requireElement<HTMLElement>(
    '#xbox-stream-mode-badge'
  )

const xboxStreamModeMessage =
  requireElement<HTMLElement>(
    '#xbox-stream-mode-message'
  )

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

const connectAccountState =
  requireElement<HTMLElement>('#connect-account-state')
const connectAccountBadge =
  requireElement<HTMLElement>('#connect-account-badge')
const connectSetupToggle =
  requireElement<HTMLButtonElement>('#connect-setup-toggle')
const remotePlaySetupSlot =
  requireElement<HTMLElement>('#remote-play-setup-slot')
const audioSummaryMic =
  requireElement<HTMLElement>('#audio-summary-mic')
const audioSummarySpeaker =
  requireElement<HTMLElement>('#audio-summary-speaker')
const recordingSearch =
  requireElement<HTMLInputElement>('#recording-search')
const settingsAccountState =
  requireElement<HTMLElement>('#settings-account-state')
const settingsSignOutButton =
  requireElement<HTMLButtonElement>('#settings-sign-out')
const settingsDiagnosticsButton =
  requireElement<HTMLButtonElement>('#settings-diagnostics-toggle')
const topbarAccountDivider =
  requireElement<HTMLElement>('#topbar-account-divider')
const topbarAccountMenu =
  requireElement<HTMLDetailsElement>('#topbar-account-menu')
const topbarAccountPopover =
  requireElement<HTMLElement>('#topbar-account-popover')

const railConsoleName =
  requireElement<HTMLElement>('#rail-console-name')
const railConsoleDetail =
  requireElement<HTMLElement>('#rail-console-detail')
const railConsoleStatus =
  requireElement<HTMLElement>('#rail-console-status')
const railSessionState =
  requireElement<HTMLElement>('#rail-session-state')
const railSessionConnection =
  requireElement<HTMLElement>('#rail-session-connection')
const railSessionVideo =
  requireElement<HTMLElement>('#rail-session-video')
const railSessionLatency =
  requireElement<HTMLElement>('#rail-session-latency')
const railLastRecordingName =
  requireElement<HTMLElement>('#rail-last-recording-name')
const railLastRecordingMeta =
  requireElement<HTMLElement>('#rail-last-recording-meta')

function updateXboxReceiveModeUi(): void {
  xboxStreamModeInputs.forEach(
    (input) => {
      input.checked =
        input.value ===
        xboxReceiveMode
    }
  )

  const audioOnly =
    xboxReceiveMode ===
    'audio-only'

  xboxStreamModeBadge.textContent =
    audioOnly
      ? 'Audio Only'
      : 'Video + Audio'

  xboxStreamModeMessage.textContent =
    audioOnly
      ? 'Audio Only will be used for the next Xbox connection. Video will not be requested.'
      : 'Video + Audio will be used for the next Xbox connection.'
}

xboxStreamModeInputs.forEach(
  (input) => {
    input.addEventListener(
      'change',
      () => {
        if (!input.checked) {
          return
        }

        const nextMode:
          XboxReceiveMode =
            input.value ===
            'audio-only'
              ? 'audio-only'
              : 'full'

        xboxReceiveMode =
          nextMode

        saveXboxReceiveMode(
          nextMode
        )

        updateXboxReceiveModeUi()

        if (activeServerId) {
          xboxStreamModeMessage.textContent +=
            ' Disconnect and reconnect to apply the change.'
        }
      }
    )
  }
)

updateXboxReceiveModeUi()

type CaptureLinkView = 'connect' | 'stream' | 'audio' | 'recordings' | 'settings'

const navItems = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.nav-item[data-view]')
)

const viewPanels = Array.from(
  document.querySelectorAll<HTMLElement>('.view-panel[data-panel]')
)

function setActiveView(view: CaptureLinkView): void {
  navItems.forEach((item) => {
    const active = item.dataset.view === view
    item.classList.toggle('is-active', active)

    if (active) {
      item.setAttribute('aria-current', 'page')
    } else {
      item.removeAttribute('aria-current')
    }
  })

  viewPanels.forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.panel === view)
  })

  document.body.dataset.activeView = view
  workspace.scrollTop = 0
}

navItems.forEach((item) => {
  item.addEventListener('click', () => {
    const view = item.dataset.view as CaptureLinkView | undefined
    if (view) {
      setActiveView(view)
    }
  })
})

navItems.forEach((item, index) => {
  item.addEventListener('keydown', (event) => {
    let nextIndex: number | null = null

    if (event.key === 'ArrowDown') {
      nextIndex = (index + 1) % navItems.length
    } else if (event.key === 'ArrowUp') {
      nextIndex = (index - 1 + navItems.length) % navItems.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = navItems.length - 1
    }

    if (nextIndex === null) {
      return
    }

    event.preventDefault()
    const nextItem = navItems[nextIndex]
    nextItem?.focus()
    nextItem?.click()
  })
})

document.querySelectorAll<HTMLButtonElement>('.view-jump[data-view-target]')
  .forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.viewTarget as CaptureLinkView | undefined
      if (view) {
        setActiveView(view)
      }
    })
  })

setActiveView('stream')

let signedIn = false
let streamBusy = false
let activeServerId: string | null = null
let activePlayer: CaptureLinkPlayer | null = null
let webRtcConnected = false
let activeGamepad: CaptureLinkGamepad | null = null
let controllerAttached = false

// F1 research spike: synthetic remote controller.
let remoteGamepadAdapter: RemoteGamepadAdapter | null = null
let remoteSyntheticReleaseTimer: number | null = null

// F2 research spike: direct CaptureLink-to-CaptureLink WebRTC.
let friendControllerPeer: FriendControllerPeer | null = null
let friendPeerRole: 'host' | 'guest' | null = null

let friendGuestMediaVideo: HTMLVideoElement | null = null

let friendDiagnosticsPanel:
  HTMLDivElement | null = null
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
let recordingSearchQuery = ''
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


function setButtonLabel(button: HTMLButtonElement, label: string): void {
  const labelElement = button.querySelector<HTMLElement>('.dock-button__label')

  if (labelElement) {
    labelElement.textContent = label
  } else {
    button.textContent = label
  }

  button.setAttribute('aria-label', label)

  if (!button.dataset.staticTitle) {
    button.title = label
  }
}

function setInlineButtonLabel(
  button: HTMLButtonElement,
  label: string
): void {
  const labelElement = button.querySelector<HTMLElement>('span')

  if (labelElement) {
    labelElement.textContent = label
  } else {
    button.textContent = label
  }

  button.setAttribute('aria-label', label)

  if (!button.dataset.staticTitle) {
    button.title = label
  }
}

type StatusTone = 'success' | 'busy' | 'warning' | 'danger' | 'muted'

function statusToneForText(value: string): StatusTone {
  const text = value.trim().toLowerCase()

  if (
    text.includes('failed') ||
    text.includes('error') ||
    text.includes('unavailable')
  ) {
    return 'danger'
  }

  if (
    text.includes('checking') ||
    text.includes('signing') ||
    text.includes('connecting') ||
    text.includes('starting') ||
    text.includes('opening') ||
    text.includes('resyncing') ||
    text.includes('sampling') ||
    text.includes('testing') ||
    text.includes('finalizing') ||
    text.includes('stopping') ||
    text.includes('recording')
  ) {
    return 'busy'
  }

  if (
    text.includes('audio late') ||
    text.includes('check metrics') ||
    text.includes('disconnected') ||
    text.includes('unsupported') ||
    text.includes('not connected')
  ) {
    return 'warning'
  }

  if (
    text.includes('signed in') ||
    text === 'ready' ||
    text.includes('online') ||
    text === 'connected' ||
    text === 'healthy' ||
    text === 'live' ||
    text === 'synced' ||
    text === 'saved' ||
    text.includes('export ready') ||
    text.startsWith('exported')
  ) {
    return 'success'
  }

  return 'muted'
}

function applyStatusTone(element: HTMLElement): void {
  const tone = statusToneForText(element.textContent ?? '')

  element.classList.remove(
    'status-tone--success',
    'status-tone--busy',
    'status-tone--warning',
    'status-tone--danger',
    'status-tone--muted'
  )
  element.classList.add(`status-tone--${tone}`)
}

const statusToneElements = [
  accountStatus,
  connectAccountBadge,
  railConsoleStatus,
  railSessionState,
  microphoneDeviceState,
  speakerDeviceState,
  diagnosticsHealth,
  recordingStatus,
  recordingLibraryMessage,
  recordingExportStatus
]

const statusToneObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.target instanceof HTMLElement) {
      applyStatusTone(mutation.target)
    }
  })
})

statusToneElements.forEach((element) => {
  applyStatusTone(element)
  statusToneObserver.observe(element, {
    childList: true,
    characterData: true,
    subtree: true
  })
})

function setRailConsole(
  name: string,
  detail: string,
  status: string
): void {
  railConsoleName.textContent = name
  railConsoleDetail.textContent = detail
  railConsoleStatus.textContent = status
}

function setRailSession(
  state: string,
  connection: string,
  video = '—',
  latency = '—'
): void {
  railSessionState.textContent = state
  railSessionConnection.textContent = connection
  railSessionVideo.textContent = video
  railSessionLatency.textContent = latency
}

function updateRailLastRecording(): void {
  const latest = recordingLibrary[0]

  if (!latest) {
    railLastRecordingName.textContent = 'No recordings yet'
    railLastRecordingMeta.textContent = 'Capture something to get started'
    return
  }

  railLastRecordingName.textContent = latest.fileName
  railLastRecordingMeta.textContent =
    `${formatRecordingDuration(latest.durationMs)} · ${formatRecordingBytes(latest.bytes)}`
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
  refreshAudioDevicesButton.classList.add('is-busy')
  refreshAudioDevicesButton.setAttribute('aria-busy', 'true')

  if (!navigator.mediaDevices?.enumerateDevices) {
    microphoneDeviceMessage.textContent =
      'This Chromium build does not expose media device enumeration.'
    speakerDeviceMessage.textContent =
      'This Chromium build does not expose media device enumeration.'
    refreshAudioDevicesButton.classList.remove('is-busy')
    refreshAudioDevicesButton.setAttribute('aria-busy', 'false')
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

    audioSummaryMic.textContent =
      microphoneDeviceSelect.selectedOptions[0]?.textContent?.trim() || 'System default'
    audioSummarySpeaker.textContent =
      speakerDeviceSelect.selectedOptions[0]?.textContent?.trim() || 'System default'

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
  } finally {
    refreshAudioDevicesButton.classList.remove('is-busy')
    refreshAudioDevicesButton.setAttribute('aria-busy', 'false')
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

  setInlineButtonLabel(microphoneTestButton, 'Test Microphone')

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
    setInlineButtonLabel(microphoneTestButton, 'Stop Test')
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
  setButtonLabel(audioMuteButton, audioMuted ? 'Unmute' : 'Mute')

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
  setInlineButtonLabel(resyncAudioButton, 'Resyncing…')
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
    setInlineButtonLabel(resyncAudioButton, 'Resync')
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
    setButtonLabel(microphoneButton, 'Starting Microphone…')
  } else {
    setButtonLabel(
      microphoneButton,
      microphoneActive ? 'Disable Microphone' : 'Enable Microphone'
    )
  }
  microphoneButton.setAttribute('aria-pressed', String(microphoneActive))
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
  setButtonLabel(controllerButton, 'Enable Controller')
  controllerButton.setAttribute('aria-pressed', 'false')
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

  railSessionConnection.textContent = peerConnection.connectionState === 'connected'
    ? 'Connected'
    : peerConnection.connectionState
  railSessionLatency.textContent = diagRtt.textContent
  railSessionVideo.textContent = [
    diagVideoResolution.textContent,
    diagVideoFps.textContent
  ]
    .filter((value) => value && value !== '—')
    .join(' · ') || '—'

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
  setButtonLabel(diagnosticsButton, visible ? 'Hide Diagnostics' : 'Diagnostics')
  settingsDiagnosticsButton.textContent =
    visible ? 'Hide diagnostics' : 'Show diagnostics'
  settingsDiagnosticsButton.setAttribute('aria-pressed', String(visible))
  diagnosticsButton.setAttribute('aria-pressed', String(visible))

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
  updateRailLastRecording()

  if (recordingLibrary.length === 0) {
    recordingLibraryMessage.textContent = 'No CaptureLink recordings yet.'
    recordingLibraryList.innerHTML = `
      <div class="recording-library-empty">
        <div class="recording-library-empty__icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2"/>
            <path d="m10 9 5 3-5 3Z"/>
          </svg>
        </div>
        <strong>No recordings yet</strong>
        <span>Start a capture from Stream and it will appear here automatically.</span>
      </div>
    `
    return
  }

  const normalizedQuery = recordingSearchQuery.trim().toLowerCase()
  const filteredRecordings = normalizedQuery
    ? recordingLibrary.filter((recording) =>
        recording.fileName.toLowerCase().includes(normalizedQuery)
      )
    : recordingLibrary

  recordingLibraryMessage.textContent = normalizedQuery
    ? `${filteredRecordings.length} of ${recordingLibrary.length} recordings`
    : `${recordingLibrary.length} recording${recordingLibrary.length === 1 ? '' : 's'}`

  if (filteredRecordings.length === 0) {
    recordingLibraryList.innerHTML = `
      <div class="recording-library-empty">
        <div class="recording-library-empty__icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7"/>
            <path d="m20 20-4-4"/>
          </svg>
        </div>
        <strong>No matches</strong>
        <span>Try a different recording name.</span>
      </div>
    `
    return
  }

  recordingLibraryList.innerHTML = filteredRecordings.map((recording) => {
    const typeLabel = recording.kind === 'video' ? 'Video' : 'Audio'
    const duration = formatRecordingDuration(recording.durationMs)
    const size = formatRecordingBytes(recording.bytes)
    const availability = recording.exists ? '' : ' · File missing'
    const disabled = recording.exists ? '' : ' disabled'
    const exportAction = recording.kind === 'video'
      ? 'export-mp4'
      : 'export-mp3'
    const exportLabel = recording.kind === 'video'
      ? 'Export MP4'
      : 'Export MP3'
    const exportDisabled =
      recording.exists && commonExportAvailable ? '' : ' disabled'

    return `
      <article class="recording-library-item recording-library-item--minimal" data-recording-id="${escapeHtml(recording.id)}">
        <div class="recording-library-main recording-library-main--minimal">
          <div class="recording-library-badge recording-library-badge--${recording.kind}">
            ${recording.kind === 'video'
              ? `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3Z"/></svg>`
              : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>`}
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
              <span>${typeLabel}</span>
            </div>

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

        <div class="recording-library-actions recording-library-actions--minimal">
          <button class="recording-action recording-action--primary" type="button" data-action="open"${disabled}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7Z"/></svg>
            <span>Open</span>
          </button>

          <button class="recording-action" type="button" data-action="${exportAction}"${exportDisabled}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
            <span>${exportLabel}</span>
          </button>

          <details class="recording-more">
            <summary title="More actions" aria-label="More actions">•••</summary>
            <div class="recording-more__menu">
              <button type="button" data-action="show"${disabled}>Show in folder</button>
              <button type="button" data-action="rename"${disabled}>Rename</button>
              ${recording.kind === 'audio'
                ? `<button type="button" data-action="export-wav"${exportDisabled}>Export WAV</button>`
                : ''}
              <button type="button" data-action="export-original"${disabled}>Export original</button>
              <button class="recording-more__danger" type="button" data-action="delete">Delete</button>
            </div>
          </details>
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
  refreshRecordingLibraryButton.classList.add('is-busy')
  recordingLibraryList.setAttribute('aria-busy', 'true')
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
    refreshRecordingLibraryButton.classList.remove('is-busy')
    recordingLibraryList.setAttribute('aria-busy', 'false')
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

  const moreMenu = button.closest<HTMLDetailsElement>('.recording-more')
  if (moreMenu) {
    moreMenu.open = false
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
  setButtonLabel(recordAudioButton, 'Record Audio')
  setButtonLabel(recordVideoButton, 'Record Video')
}

function setRecordingUi(
  state: 'ready' | 'recording' | 'saving' | 'saved' | 'canceled' | 'error',
  kind: RecordingKind | null = recordingKind
): void {
  const recording = state === 'recording'
  const showStorage = recording || state === 'saving'

  recordingSize.hidden = !showStorage
  recordingSpace.hidden = !showStorage

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
      setButtonLabel(activeButton, 'Stop Recording')
      recordingStatus.textContent =
        kind === 'video' ? 'Recording video' : 'Recording audio'
      break
    case 'saving':
      setButtonLabel(activeButton, 'Finalizing…')
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
  const mediaReady =
    sessionActive &&
    webRtcConnected &&
    !streamBusy

  const videoMediaReady =
    mediaReady &&
    activeXboxReceiveMode !==
      'audio-only'

  const recordingActive = mediaRecorder?.state === 'recording' ||
    mediaRecorder?.state === 'paused'

  document.body.classList.toggle('session-connected', webRtcConnected)
  document.body.classList.toggle(
    'session-connecting',
    sessionActive && streamBusy && !webRtcConnected
  )
  document.body.classList.toggle('session-recording', recordingActive)
  document.body.classList.toggle('session-saving', recordingSaving)

  refreshConsolesButton.disabled = !signedIn || locked
  disconnectButton.disabled = !sessionActive || streamBusy
  fullscreenVideoButton.disabled =
    !videoMediaReady

  pictureInPictureButton.disabled =
    !videoMediaReady ||
    !document.pictureInPictureEnabled
  controllerButton.disabled = !mediaReady
  microphoneButton.disabled = !mediaReady || microphonePending
  microphoneDeviceSelect.disabled =
    microphoneActive ||
    microphonePending ||
    microphoneMonitorStream !== null
  microphoneTestButton.disabled = microphoneActive || microphonePending
  refreshAudioDevicesButton.disabled = microphonePending
  audioMuteButton.disabled = !mediaReady
  audioVolume.disabled = !mediaReady
  resyncAudioButton.disabled = !mediaReady || audioResyncInProgress
  diagnosticsButton.disabled = !mediaReady
  settingsDiagnosticsButton.disabled = !mediaReady
  recordAudioButton.disabled = recordingSaving ||
    (recordingActive
      ? recordingKind !== 'audio'
      : !mediaReady)
  recordVideoButton.disabled =
    recordingSaving ||
    (
      recordingActive
        ? recordingKind !== 'video'
        : !videoMediaReady
    )

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

function renderConsoleState(
  state: 'loading' | 'empty' | 'error' | 'signed-out',
  title: string,
  message: string
): void {
  const icon = state === 'loading'
    ? '<span class="console-list-state__spinner" aria-hidden="true"></span>'
    : state === 'error'
      ? '<span aria-hidden="true">!</span>'
      : '<span aria-hidden="true">X</span>'

  consoleList.innerHTML = `
    <div class="console-list-state console-list-state--${state}" role="${state === 'error' ? 'alert' : 'status'}">
      <div class="console-list-state__icon">${icon}</div>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(message)}</span>
      </div>
    </div>
  `
}

async function loadConsoles(): Promise<void> {
  if (streamBusy || activeServerId) {
    return
  }

  consoleMessage.textContent = 'Looking for Xbox consoles...'
  consoleList.setAttribute('aria-busy', 'true')
  renderConsoleState(
    'loading',
    'Discovering Xbox consoles',
    'Checking the consoles available to this Microsoft account.'
  )
  refreshConsolesButton.disabled = true
  refreshConsolesButton.classList.add('is-busy')

  try {
    const consoles = await window.captureLink.getXboxConsoles()

    if (consoles.length === 0) {
      consoleMessage.textContent =
        'No Xbox consoles were found for this account.'
      renderConsoleState(
        'empty',
        'No Xbox consoles found',
        'Check the account and confirm Remote features are enabled on the console.'
      )
      setRailConsole('No console found', 'Check your Xbox account and Remote Play settings', 'Unavailable')
      return
    }

    const firstConsole = consoles[0]

    if (firstConsole) {
      setRailConsole(
        firstConsole.deviceName,
        `${formatConsoleType(firstConsole.consoleType)} · ${firstConsole.powerState}`,
        'Ready'
      )
    }

    consoleMessage.textContent =
      `${consoles.length} console${consoles.length === 1 ? '' : 's'} found.`

    consoleList.innerHTML = consoles
      .map(
        (console) => `
          <div
            class="console-card console-card--minimal"
            data-server-id="${escapeHtml(console.serverId)}"
          >
            <div class="console-card__identity">
              <div class="console-card__device" aria-hidden="true">X</div>
              <div>
                <div class="console-name">
                  ${escapeHtml(console.deviceName)}
                </div>

                <div class="console-model">
                  ${escapeHtml(formatConsoleType(console.consoleType))}
                </div>
              </div>
            </div>

            <div class="console-card__actions">
              <div class="console-power">
                <span class="console-power__dot" aria-hidden="true"></span>
                ${escapeHtml(console.powerState)}
              </div>

              <button
                type="button"
                class="console-connect"
                title="Start Xbox Remote Play"
              >
                Connect
              </button>
            </div>
          </div>
        `
      )
      .join('')
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Xbox console discovery failed.'

    consoleMessage.textContent = message
    renderConsoleState(
      'error',
      'Console discovery failed',
      message
    )
    setRailConsole('Console unavailable', 'Discovery failed', 'Error')
  } finally {
    consoleList.setAttribute('aria-busy', 'false')
    refreshConsolesButton.classList.remove('is-busy')
    updateInteractiveState()
  }
}

// CAPTURELINK_REMOTE_PLAY_SETUP_UI
const signOutButton = document.createElement('button')
signOutButton.id = 'sign-out-xbox'
signOutButton.type = 'button'
signOutButton.className = 'xbox-sign-out'
signOutButton.textContent = 'Sign out'
signOutButton.hidden = true
topbarAccountPopover.append(signOutButton)

const xboxSetupBanner = document.createElement('aside')
xboxSetupBanner.className = 'xbox-setup-banner'
xboxSetupBanner.setAttribute('aria-label', 'Xbox Remote Play setup')
xboxSetupBanner.innerHTML = `
  <details class="xbox-setup-details">
    <summary>
      <span>Xbox Remote Play setup</span>
      <small>View steps</small>
    </summary>
    <div class="xbox-setup-details__body">
      <p>
        Before connecting, enable Remote Play on the Xbox you want CaptureLink to use.
      </p>
      <ol>
        <li>Press the <strong>Xbox button</strong> on your controller.</li>
        <li>
          Go to
          <strong>Profile &amp; system → Settings → Devices &amp; connections → Remote features</strong>.
        </li>
        <li>Turn on <strong>Enable remote features</strong>.</li>
        <li>Run <strong>Test remote play</strong> if it is available.</li>
        <li>
          Under <strong>Power options</strong>, choose <strong>Sleep</strong> so the console
          can be reached and woken for Remote Play.
        </li>
      </ol>
      <p class="xbox-setup-banner__note">
        CaptureLink uses Xbox Remote Play / Remote features, not Xbox Cloud Gaming.
      </p>
    </div>
  </details>
`

remotePlaySetupSlot.append(xboxSetupBanner)

const xboxSetupDetails =
  xboxSetupBanner.querySelector<HTMLDetailsElement>('.xbox-setup-details')

connectSetupToggle.addEventListener('click', () => {
  if (!xboxSetupDetails) {
    return
  }

  xboxSetupDetails.open = !xboxSetupDetails.open
})

xboxSetupDetails?.addEventListener('toggle', () => {
  const open = xboxSetupDetails.open
  connectSetupToggle.textContent = open ? 'Hide steps' : 'View steps'
  connectSetupToggle.setAttribute('aria-expanded', String(open))
})

function setAuthenticated(): void {
  signOutButton.hidden = false
  signInButton.hidden = true
  topbarAccountDivider.hidden = false
  topbarAccountMenu.hidden = false
  settingsSignOutButton.hidden = false
  signedIn = true
  accountStatus.textContent = 'Signed in'
  connectAccountState.textContent = 'Microsoft / Xbox connected'
  connectAccountBadge.textContent = 'Signed in'
  connectAccountBadge.classList.add('is-ready')
  settingsAccountState.textContent = 'Signed in and ready for Xbox Remote Play.'
  authMessage.textContent =
    'Xbox authentication is available.'

  signInButton.textContent = 'Signed in'
  signInButton.disabled = true

  updateInteractiveState()
  void loadConsoles()
}

function setSignedOut(): void {
  signOutButton.hidden = true
  signInButton.hidden = false
  topbarAccountDivider.hidden = true
  topbarAccountMenu.hidden = true
  topbarAccountMenu.open = false
  settingsSignOutButton.hidden = true
  signedIn = false
  accountStatus.textContent = 'Signed out'
  connectAccountState.textContent = 'Not signed in'
  connectAccountBadge.textContent = 'Signed out'
  connectAccountBadge.classList.remove('is-ready')
  settingsAccountState.textContent = 'Sign in to connect CaptureLink to your Xbox.'
  authMessage.textContent =
    'Sign in with the Microsoft account associated with your Xbox.'

  signInButton.textContent = 'Sign in with Microsoft'
  signInButton.disabled = false

  renderConsoleState(
    'signed-out',
    'Sign in to discover your Xbox',
    'Use the Microsoft account associated with the console you want to capture.'
  )
  consoleMessage.textContent =
    'Sign in to discover your Xbox consoles.'

  setRailConsole('No console selected', 'Sign in to discover your Xboxes', 'Idle')
  setRailSession('Idle', 'Waiting')
  setActiveView('connect')
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
  activeXboxReceiveMode = null
  if (mediaRecorder && !recordingSaving) {
    void stopRecording()
  }

  detachController()
  closeFriendControllerPeer()
  detachRemoteSyntheticController()
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
    railConsoleStatus.textContent = signedIn ? 'Ready' : 'Idle'
    setRailSession('Idle', 'Waiting')
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

  const consoleCard = button.closest<HTMLElement>('.console-card')
  const consoleName = consoleCard
    ?.querySelector<HTMLElement>('.console-name')
    ?.textContent
    ?.trim() || 'Xbox console'
  const consoleModel = consoleCard
    ?.querySelector<HTMLElement>('.console-model')
    ?.textContent
    ?.trim() || 'Remote Play'

  setRailConsole(consoleName, consoleModel, 'Connecting')
  setRailSession('Connecting', 'Provisioning')
  setActiveView('stream')
  showStreamPlaceholder('Starting Xbox Remote Play...')
  setStreamStatus('Starting Remote Play...')
  updateInteractiveState()

  try {
    await window.captureLink.startXboxStream(serverId)

    setStreamStatus('Creating Chromium WebRTC connection...')

    const player = new playerConstructor('stream-holder')
    activePlayer = player

    activeXboxReceiveMode =
      xboxReceiveMode

    configureXboxReceiveMode(
      player,
      activeXboxReceiveMode
    )

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

        if (
          activeXboxReceiveMode ===
          'audio-only'
        ) {
          window.setTimeout(
            () => {
              void inspectXboxInboundMedia(
                player
              )
            },
            5000
          )
        }

        if (
          activeXboxReceiveMode ===
          'audio-only'
        ) {
          showStreamPlaceholder(
            'Audio-only Remote Play connected. Xbox video is not being received.'
          )

          setStreamStatus(
            'Audio-only Remote Play connected'
          )
        } else {
          hideStreamPlaceholder()
        }
        railConsoleStatus.textContent = 'Online'
        setRailSession('Connected', 'Connected')
        scheduleAudioControlSync()
        startDiagnosticsPolling()
        updateInteractiveState()
      }

      if (state === 'failed' || state === 'disconnected') {
        webRtcConnected = false
        setRailSession(
          state === 'failed' ? 'Failed' : 'Disconnected',
          `WebRTC ${state}`
        )
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

    const offerMedia =
      inspectXboxOfferMedia(
        offer.sdp
      )

    console.log(
      '[CaptureLink:XboxMediaMode] Initial offer',
      offerMedia
    )

    if (
      activeXboxReceiveMode ===
        'audio-only' &&
      offerMedia.videoDirection !==
        'inactive'
    ) {
      throw new Error(
        `Audio-only Xbox offer expected inactive video but got ${offerMedia.videoDirection ?? 'no direction'}.`
      )
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
    railConsoleStatus.textContent = 'Ready'
    setRailSession('Failed', 'Could not connect')
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
    setButtonLabel(controllerButton, 'Disable Controller')
    controllerButton.setAttribute('aria-pressed', 'true')
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

// CAPTURELINK_FRIEND_CONTROL_F1_SPIKE
//
// Temporary developer-only synthetic remote-controller harness.
//
// The purpose of this code is to prove that a FriendGamepadState can
// enter xbox-xcloud-player's existing Xbox input serializer without
// depending on navigator.getGamepads().
//
// Shortcuts while the CaptureLink window is focused:
//
//   Ctrl+Alt+1  A
//   Ctrl+Alt+2  B
//   Ctrl+Alt+3  X
//   Ctrl+Alt+4  Y
//   Ctrl+Alt+5  D-pad Up
//   Ctrl+Alt+6  D-pad Right
//   Ctrl+Alt+7  D-pad Down
//   Ctrl+Alt+8  D-pad Left
//   Ctrl+Alt+9  Xbox / Nexus
//   Ctrl+Alt+0  Detach synthetic controller
//
// Do not enable the normal local controller while running this F1 test.
// Both paths currently target Xbox controller index 0.

function detachRemoteSyntheticController(): void {
  if (remoteSyntheticReleaseTimer !== null) {
    window.clearTimeout(remoteSyntheticReleaseTimer)
    remoteSyntheticReleaseTimer = null
  }

  remoteGamepadAdapter?.detach()
  remoteGamepadAdapter = null
}

function getRemoteSyntheticController(): RemoteGamepadAdapter | null {
  if (!activePlayer || !webRtcConnected) {
    setStreamStatus(
      'F1 remote input test requires an active Xbox Remote Play session'
    )
    return null
  }

  if (controllerAttached) {
    setStreamStatus(
      'Disable the normal local controller before using the F1 remote input test'
    )
    return null
  }

  if (!remoteGamepadAdapter) {
    remoteGamepadAdapter = new RemoteGamepadAdapter(0)
    remoteGamepadAdapter.attach(activePlayer)

    console.log(
      '[CaptureLink:F1] Synthetic remote controller attached as Xbox gamepad 0'
    )
  }

  return remoteGamepadAdapter
}

function pulseRemoteSyntheticButton(
  buttonIndex: number,
  label: string
): void {
  const adapter = getRemoteSyntheticController()

  if (!adapter) {
    return
  }

  if (remoteSyntheticReleaseTimer !== null) {
    window.clearTimeout(remoteSyntheticReleaseTimer)
  }

  adapter.updateState(
    createSyntheticButtonGamepadState(
      buttonIndex,
      1
    )
  )

  console.log(
    `[CaptureLink:F1] Synthetic remote button pressed: ${label}`
  )

  setStreamStatus(
    `F1 synthetic remote controller: ${label}`
  )

  remoteSyntheticReleaseTimer = window.setTimeout(
    () => {
      adapter.updateState(
        createNeutralFriendGamepadState()
      )

      remoteSyntheticReleaseTimer = null
    },
    160
  )
}

document.addEventListener(
  'keydown',
  (event) => {
    if (!event.ctrlKey || !event.altKey || event.repeat) {
      return
    }

    const buttonMap: Record<
      string,
      {
        index: number
        label: string
      }
    > = {
      Digit1: { index: 0, label: 'A' },
      Digit2: { index: 1, label: 'B' },
      Digit3: { index: 2, label: 'X' },
      Digit4: { index: 3, label: 'Y' },
      Digit5: { index: 12, label: 'D-pad Up' },
      Digit6: { index: 15, label: 'D-pad Right' },
      Digit7: { index: 13, label: 'D-pad Down' },
      Digit8: { index: 14, label: 'D-pad Left' },
      Digit9: { index: 16, label: 'Xbox / Nexus' }
    }

    if (event.code === 'Digit0') {
      event.preventDefault()
      event.stopPropagation()

      detachRemoteSyntheticController()

      console.log(
        '[CaptureLink:F1] Synthetic remote controller detached'
      )

      setStreamStatus(
        'F1 synthetic remote controller detached'
      )

      return
    }

    const button = buttonMap[event.code]

    if (!button) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    pulseRemoteSyntheticButton(
      button.index,
      button.label
    )
  },
  true
)

// CAPTURELINK_FRIEND_CONTROL_F2_P2P_SPIKE
//
// Direct peer-to-peer controller transport.
//
// No signaling server.
// No STUN.
// No TURN.
// No port forwarding.
//
// F2 keyboard controls:
//
//   Ctrl+Shift+H  Create HOST offer
//   Ctrl+Shift+J  Join as GUEST and create answer
//   Ctrl+Shift+K  HOST accepts guest answer
//   Ctrl+Shift+X  Disconnect friend P2P session
//
// The offer and answer are manually copied between PCs.
// This intentionally isolates and proves the actual P2P data path.

function getFriendHostMediaStream(): MediaStream | null {
  const video =
    streamHolder
      .querySelector<HTMLVideoElement>(
        'video'
      )

  const videoSource =
    video?.srcObject

  const audio =
    getAudioElement()

  const audioSource =
    audio?.srcObject

  if (
    !(videoSource instanceof MediaStream) ||
    !(audioSource instanceof MediaStream)
  ) {
    return null
  }

  const videoTrack =
    videoSource
      .getVideoTracks()
      .find(
        (track) =>
          track.readyState === 'live'
      )

  const audioTrack =
    audioSource
      .getAudioTracks()
      .find(
        (track) =>
          track.readyState === 'live'
      )

  if (!videoTrack || !audioTrack) {
    return null
  }

  console.log(
    '[CaptureLink:F3] Xbox media ready for friend session:',
    {
      video: {
        label: videoTrack.label,
        id: videoTrack.id,
        settings:
          videoTrack.getSettings()
      },
      audio: {
        label: audioTrack.label,
        id: audioTrack.id,
        settings:
          audioTrack.getSettings()
      }
    }
  )

  return new MediaStream([
    videoTrack,
    audioTrack
  ])
}

function clearFriendGuestMedia(): void {
  const video =
    friendGuestMediaVideo

  if (video) {
    try {
      video.pause()
      video.srcObject = null
    } catch {
      // Media element may already be detached.
    }

    /*
     * Only remove the video element created by Friend Mode.
     *
     * A normal Xbox Remote Play video element belongs to
     * xbox-xcloud-player and must never be removed here.
     */
    if (
      video.dataset.capturelinkSource ===
        'friend'
    ) {
      video.remove()
    }
  }

  friendGuestMediaVideo = null

  /*
   * Friend guests do not have a local Xbox player occupying the
   * stream surface, so return the normal application player to
   * its idle state when the P2P session ends.
   */
  if (
    !activePlayer &&
    !webRtcConnected
  ) {
    showStreamPlaceholder(
      'Choose an Xbox or join a Friend stream.'
    )
  }
}

function showFriendGuestMedia(
  stream: MediaStream
): void {
  /*
   * F4.1:
   *
   * Friend Mode now uses the exact same CaptureLink stream
   * surface as local Xbox Remote Play rather than an experimental
   * full-window overlay.
   */
  let video =
    friendGuestMediaVideo

  if (
    !video ||
    !video.isConnected
  ) {
    video =
      document.createElement('video')

    video.autoplay = true
    video.controls = false
    video.playsInline = true
    video.muted = true

    video.dataset.capturelinkSource =
      'friend'

    /*
     * streamHolder's existing CSS handles sizing/object-fit for
     * direct-child video elements, exactly as it does for the
     * normal Xbox player.
     */
    streamHolder.appendChild(video)

    friendGuestMediaVideo =
      video
  }

  if (
    video.srcObject !== stream
  ) {
    video.srcObject =
      stream
  }

  hideStreamPlaceholder()

  /*
   * Receiving gameplay should take the guest directly to the
   * normal CaptureLink Stream view.
   */
  setActiveView('stream')

  void video
    .play()
    .then(() => {
      console.log(
        '[CaptureLink:F4.1] Friend media attached to main player.'
      )

      setStreamStatus(
        'Friend stream · Direct P2P'
      )
    })
    .catch((error) => {
      console.warn(
        '[CaptureLink:F4.1] Automatic Friend playback was blocked:',
        error
      )

      setStreamStatus(
        'Friend stream received · playback waiting'
      )
    })
}

function formatFriendDiagnostic(
  value: number | null,
  suffix = '',
  digits = 1
): string {
  if (
    value === null ||
    !Number.isFinite(value)
  ) {
    return '—'
  }

  return `${value.toFixed(digits)}${suffix}`
}

function clearFriendDiagnosticsPanel(): void {
  friendDiagnosticsPanel?.remove()
  friendDiagnosticsPanel = null
}

function updateFriendDiagnosticsPanel(
  diagnostics: FriendMediaDiagnostics
): void {
  if (!friendDiagnosticsPanel) {
    const panel =
      document.createElement('div')

    panel.id =
      'capturelink-friend-diagnostics'

    panel.style.position = 'fixed'
    panel.style.right = '18px'
    panel.style.bottom = '18px'
    panel.style.zIndex = '2147483647'

    panel.style.minWidth = '310px'
    panel.style.maxWidth = '390px'

    panel.style.padding = '14px 16px'

    panel.style.border =
      '1px solid rgba(255,255,255,0.18)'

    panel.style.borderRadius = '12px'

    panel.style.background =
      'rgba(5, 8, 12, 0.92)'

    panel.style.boxShadow =
      '0 18px 60px rgba(0,0,0,0.55)'

    panel.style.backdropFilter =
      'blur(12px)'

    panel.style.fontFamily =
      'Consolas, "SFMono-Regular", monospace'

    panel.style.fontSize = '12px'
    panel.style.lineHeight = '1.55'

    panel.style.color =
      'rgba(255,255,255,0.92)'

    panel.style.whiteSpace = 'pre'

    panel.style.pointerEvents =
      'none'

    document.body.appendChild(
      panel
    )

    friendDiagnosticsPanel = panel
  }

  const role =
    diagnostics.role.toUpperCase()

  const video =
    diagnostics.resolution
      ? `${diagnostics.resolution} @ ${
          diagnostics.fps !== null
            ? diagnostics.fps.toFixed(0)
            : '—'
        } fps`
      : '—'

  const oneWayNetworkMs =
    diagnostics.peerRttMs !== null
      ? diagnostics.peerRttMs / 2
      : null

  const knownReceivePathMs =
    diagnostics.role === 'guest' &&
    oneWayNetworkMs !== null
      ? oneWayNetworkMs +
        (
          diagnostics
            .averageJitterBufferMs ??
          0
        ) +
        (
          diagnostics
            .averageDecodeMs ??
          0
        )
      : null

  const lines = [
    'CaptureLink Friend Diagnostics',
    `DIRECT P2P · ${role}`,
    '',
    `RTT                 ${formatFriendDiagnostic(
      diagnostics.peerRttMs,
      ' ms'
    )}`,
    `Video               ${video}`,
    `Codec               ${
      diagnostics.codec ?? '—'
    }`,
    `Bitrate             ${formatFriendDiagnostic(
      diagnostics.bitrateMbps,
      ' Mbps',
      2
    )}`
  ]

  if (diagnostics.role === 'host') {
    lines.push(
      `Encode              ${formatFriendDiagnostic(
        diagnostics.averageEncodeMs,
        ' ms',
        2
      )}`,
      `Quality limit       ${
        diagnostics
          .qualityLimitationReason ??
        '—'
      }`,
      `Encoder             ${
        diagnostics
          .encoderImplementation ??
        '—'
      }`
    )
  } else {
    lines.push(
      `Video requested     ${formatFriendDiagnostic(
        diagnostics.requestedVideoBufferMs,
        ' ms',
        2
      )}`,
      `Video jitter        ${formatFriendDiagnostic(
        diagnostics.networkJitterMs,
        ' ms',
        2
      )}`,
      `Video buffer (1s)   ${formatFriendDiagnostic(
        diagnostics.averageJitterBufferMs,
        ' ms',
        2
      )}`,
      `Video target (1s)   ${formatFriendDiagnostic(
        diagnostics.averageTargetBufferMs,
        ' ms',
        2
      )}`,
      `Video minimum (1s)  ${formatFriendDiagnostic(
        diagnostics.averageMinimumBufferMs,
        ' ms',
        2
      )}`,
      `Audio requested     ${formatFriendDiagnostic(
        diagnostics.requestedAudioBufferMs,
        ' ms',
        2
      )}`,
      `Audio jitter        ${formatFriendDiagnostic(
        diagnostics.audioNetworkJitterMs,
        ' ms',
        2
      )}`,
      `Audio buffer (1s)   ${formatFriendDiagnostic(
        diagnostics.audioAverageJitterBufferMs,
        ' ms',
        2
      )}`,
      `Audio target (1s)   ${formatFriendDiagnostic(
        diagnostics.audioAverageTargetBufferMs,
        ' ms',
        2
      )}`,
      `Audio minimum (1s)  ${formatFriendDiagnostic(
        diagnostics.audioAverageMinimumBufferMs,
        ' ms',
        2
      )}`,
      `Decode              ${formatFriendDiagnostic(
        diagnostics.averageDecodeMs,
        ' ms',
        2
      )}`,
      `Known receive path ~${formatFriendDiagnostic(
        knownReceivePathMs,
        ' ms',
        2
      )}`,
      `Decoder             ${
        diagnostics
          .decoderImplementation ??
        '—'
      }`
    )
  }

  lines.push(
    '',
    `Dropped frames      ${
      diagnostics.framesDropped ??
      '—'
    }`,
    `Packets lost        ${
      diagnostics.packetsLost ??
      '—'
    }`,
    `Freezes             ${
      diagnostics.freezeCount ??
      '—'
    }`
  )

  friendDiagnosticsPanel.textContent =
    lines.join('\n')
}

function closeFriendControllerPeer(): void {
  friendControllerPeer?.close()
  friendControllerPeer = null
  friendPeerRole = null

  clearFriendGuestMedia()
  clearFriendDiagnosticsPanel()
}

function makeFriendControllerPeer(): FriendControllerPeer {
  return new FriendControllerPeer({
    onStatus: (message) => {
      setStreamStatus(
        `F2 P2P: ${message}`
      )
    },

    onRemoteGamepadState: (state) => {
      if (friendPeerRole !== 'host') {
        return
      }

      const adapter =
        getRemoteSyntheticController()

      if (!adapter) {
        return
      }

      adapter.updateState(state)
    },

    onRemoteControlEnded: () => {
      if (friendPeerRole === 'host') {
        detachRemoteSyntheticController()
      }
    },

    onDiagnostics: (diagnostics) => {
      updateFriendDiagnosticsPanel(
        diagnostics
      )
    },

    onRemoteMediaStream: (stream) => {
      if (friendPeerRole !== 'guest') {
        return
      }

      showFriendGuestMedia(
        stream
      )

      setStreamStatus(
        'F3 direct P2P Xbox media received'
      )
    }
  })
}

async function writeFriendClipboard(
  value: string,
  description: string
): Promise<void> {
  try {
    await window.captureLink
      .writeFriendClipboard(value)

    console.log(
      `[CaptureLink:F2] ${description} copied to native Windows clipboard`
    )
  } catch (error) {
    console.error(
      `[CaptureLink:F2] Could not copy ${description}:`,
      error
    )

    throw new Error(
      `Could not copy ${description} to the clipboard.`
    )
  }
}

async function readFriendClipboard(
  description: string
): Promise<string> {
  try {
    const value =
      (
        await window.captureLink
          .readFriendClipboard()
      ).trim()

    if (!value) {
      throw new Error(
        `Clipboard does not contain a ${description}.`
      )
    }

    return value
  } catch (error) {
    console.error(
      `[CaptureLink:F2] Could not read ${description}:`,
      error
    )

    if (error instanceof Error) {
      throw error
    }

    throw new Error(
      `Could not read ${description} from the clipboard.`
    )
  }
}

async function createFriendHostOffer(): Promise<void> {
  if (!activePlayer || !webRtcConnected) {
    setStreamStatus(
      'F2 host requires an active Xbox Remote Play session'
    )
    return
  }

  if (controllerAttached) {
    setStreamStatus(
      'Disable the normal local CaptureLink controller before hosting F2'
    )
    return
  }

  const hostMedia =
    getFriendHostMediaStream()

  if (!hostMedia) {
    setStreamStatus(
      'F3 host requires live Xbox video and audio'
    )
    return
  }

  closeFriendControllerPeer()

  friendPeerRole = 'host'
  friendControllerPeer =
    makeFriendControllerPeer()

  try {
    const offer =
      await friendControllerPeer
        .createHostOffer(
          hostMedia
        )

    await writeFriendClipboard(
      offer,
      'host offer'
    )

    setStreamStatus(
      'F2 host offer copied to clipboard'
    )
  } catch (error) {
    console.error(
      '[CaptureLink:F2] Host offer failed:',
      error
    )

    closeFriendControllerPeer()

    const message =
      error instanceof Error
        ? error.message
        : 'unknown error'

    window.setTimeout(
      () => {
        setStreamStatus(
          `F2 host failed: ${message}`
        )
      },
      0
    )
  }
}

async function joinFriendHost(): Promise<void> {
  if (
    activePlayer ||
    webRtcConnected
  ) {
    setStreamStatus(
      'Disconnect the local Xbox session before joining a Friend stream'
    )
    return
  }

  try {
    const offer =
      await readFriendClipboard(
        'CaptureLink host offer'
      )

    closeFriendControllerPeer()

    friendPeerRole = 'guest'
    friendControllerPeer =
      makeFriendControllerPeer()

    const answer =
      await friendControllerPeer
        .acceptHostOfferAndCreateAnswer(
          offer
        )

    await writeFriendClipboard(
      answer,
      'guest answer'
    )

    setStreamStatus(
      'F2 guest answer copied to clipboard'
    )
  } catch (error) {
    console.error(
      '[CaptureLink:F2] Guest join failed:',
      error
    )

    closeFriendControllerPeer()

    const message =
      error instanceof Error
        ? error.message
        : 'unknown error'

    window.setTimeout(
      () => {
        setStreamStatus(
          `F2 guest failed: ${message}`
        )
      },
      0
    )
  }
}

async function acceptFriendGuestAnswer(): Promise<void> {
  if (
    friendPeerRole !== 'host' ||
    !friendControllerPeer
  ) {
    setStreamStatus(
      'Create an F2 host offer first'
    )
    return
  }

  try {
    const answer =
      await readFriendClipboard(
        'CaptureLink guest answer'
      )

    await friendControllerPeer
      .acceptGuestAnswer(answer)

    setStreamStatus(
      'F2 guest answer accepted; establishing direct P2P connection'
    )
  } catch (error) {
    console.error(
      '[CaptureLink:F2] Guest answer failed:',
      error
    )

    const message =
      error instanceof Error
        ? error.message
        : 'unknown error'

    setStreamStatus(
      `F2 answer failed: ${message}`
    )
  }
}

document.addEventListener(
  'keydown',
  (event) => {
    if (
      !event.ctrlKey ||
      !event.shiftKey ||
      event.repeat
    ) {
      return
    }

    switch (event.code) {
      case 'KeyH':
        event.preventDefault()
        event.stopPropagation()
        void createFriendHostOffer()
        break

      case 'KeyJ':
        event.preventDefault()
        event.stopPropagation()
        void joinFriendHost()
        break

      case 'KeyK':
        event.preventDefault()
        event.stopPropagation()
        void acceptFriendGuestAnswer()
        break

      case 'KeyX':
        event.preventDefault()
        event.stopPropagation()

        closeFriendControllerPeer()
        detachRemoteSyntheticController()

        setStreamStatus(
          'F2 direct P2P session disconnected'
        )
        break
    }
  },
  true
)

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
  const visible = !diagnosticsVisible
  setDiagnosticsVisible(visible)

  if (visible) {
    setActiveView('settings')
  }
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

recordingSearch.addEventListener('input', () => {
  recordingSearchQuery = recordingSearch.value
  renderRecordingLibrary()
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

document.addEventListener('click', (event) => {
  const target = event.target

  if (!(target instanceof Element)) {
    return
  }

  document
    .querySelectorAll<HTMLDetailsElement>('.recording-more[open]')
    .forEach((details) => {
      if (!details.contains(target)) {
        details.open = false
      }
    })

  if (topbarAccountMenu.open && !topbarAccountMenu.contains(target)) {
    topbarAccountMenu.open = false
  }
})

refreshAudioDevicesButton.addEventListener('click', () => {
  void refreshAudioDevices()
})

microphoneDeviceSelect.addEventListener('change', () => {
  stopMicrophoneMonitor()
  selectedMicrophoneId = microphoneDeviceSelect.value || 'default'
  audioSummaryMic.textContent =
    microphoneDeviceSelect.selectedOptions[0]?.textContent?.trim() || 'System default'
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
  audioSummarySpeaker.textContent =
    speakerDeviceSelect.selectedOptions[0]?.textContent?.trim() || 'System default'
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

// CAPTURELINK_XBOX_SIGN_OUT_HANDLER
signOutButton.addEventListener('click', () => {
  void (async () => {
    signOutButton.disabled = true
    settingsSignOutButton.disabled = true
    setStreamStatus('Signing out of Xbox...')

    try {
      // This also finalizes an active recording before the Remote Play
      // session is torn down.
      await disconnectFromConsole()
      await window.captureLink.signOutXbox()
      setSignedOut()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Xbox sign-out error'

      console.error('[CaptureLink] Xbox sign-out failed:', error)
      setStreamStatus(`Xbox sign-out failed: ${message}`)
    } finally {
      signOutButton.disabled = false
      settingsSignOutButton.disabled = false
    }
  })()
})

settingsSignOutButton.addEventListener('click', () => {
  signOutButton.click()
})

settingsDiagnosticsButton.addEventListener('click', () => {
  setDiagnosticsVisible(!diagnosticsVisible)
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

function getStreamVideoElement(): HTMLVideoElement | null {
  return streamHolder.querySelector<HTMLVideoElement>('video')
}

let nativeVideoFullscreen = false

function applyVideoFullscreenState(fullscreen: boolean): void {
  nativeVideoFullscreen = fullscreen

  document.body.classList.toggle(
    'capturelink-native-fullscreen',
    fullscreen
  )

  streamHolder.classList.toggle(
    'capturelink-video-fullscreen',
    fullscreen
  )

  syncVideoPresentationButtons()
}

function syncVideoPresentationButtons(): void {
  setButtonLabel(
    fullscreenVideoButton,
    nativeVideoFullscreen ? 'Exit Fullscreen' : 'Fullscreen'
  )

  setButtonLabel(
    pictureInPictureButton,
    document.pictureInPictureElement ? 'Exit PiP' : 'Picture in Picture'
  )
}

fullscreenVideoButton.addEventListener('click', () => {
  void (async () => {
    const video = getStreamVideoElement()

    if (!video) {
      setStreamStatus(
        'Xbox video is not available for fullscreen'
      )
      return
    }

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      }

      const result =
        await window.captureLink.setWindowFullscreen(
          !nativeVideoFullscreen
        )

      applyVideoFullscreenState(result.fullscreen)
    } catch (error) {
      console.error(
        '[CaptureLink] Native fullscreen failed:',
        error
      )

      setStreamStatus(
        error instanceof Error
          ? `Fullscreen failed: ${error.message}`
          : 'Fullscreen failed.'
      )
    }
  })()
})

pictureInPictureButton.addEventListener('click', () => {
  void (async () => {
    const video = getStreamVideoElement()

    if (!video) {
      setStreamStatus(
        'Xbox video is not available for Picture in Picture'
      )
      return
    }

    if (
      !document.pictureInPictureEnabled ||
      typeof video.requestPictureInPicture !== 'function'
    ) {
      setStreamStatus(
        'Picture in Picture is not available in this Chromium build'
      )
      return
    }

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else {
        if (nativeVideoFullscreen) {
          await window.captureLink.setWindowFullscreen(false)
        }

        video.addEventListener(
          'leavepictureinpicture',
          syncVideoPresentationButtons,
          { once: true }
        )

        await video.requestPictureInPicture()
      }

      syncVideoPresentationButtons()
    } catch (error) {
      console.error(
        '[CaptureLink] Picture in Picture failed:',
        error
      )

      setStreamStatus(
        error instanceof Error
          ? `Picture in Picture failed: ${error.message}`
          : 'Picture in Picture failed.'
      )
    }
  })()
})

window.captureLink.onWindowFullscreenChanged(
  (fullscreen) => {
    applyVideoFullscreenState(fullscreen)
  }
)

document.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Escape') {
      return
    }

    if (nativeVideoFullscreen) {
      event.preventDefault()
      event.stopPropagation()
      void window.captureLink.setWindowFullscreen(false)
      return
    }

    const openRecordingMenu =
      document.querySelector<HTMLDetailsElement>('.recording-more[open]')

    if (openRecordingMenu) {
      event.preventDefault()
      openRecordingMenu.open = false
      openRecordingMenu.querySelector<HTMLElement>('summary')?.focus()
      return
    }

    if (topbarAccountMenu.open) {
      event.preventDefault()
      topbarAccountMenu.open = false
      document.querySelector<HTMLElement>('#topbar-account-trigger')?.focus()
      return
    }

    if (xboxSetupDetails?.open) {
      event.preventDefault()
      xboxSetupDetails.open = false
      connectSetupToggle.focus()
    }
  },
  true
)
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

const dockButtonLabels: Array<[HTMLButtonElement, string]> = [
  [disconnectButton, 'Disconnect'],
  [fullscreenVideoButton, 'Fullscreen'],
  [pictureInPictureButton, 'Picture in Picture'],
  [controllerButton, 'Enable Controller'],
  [microphoneButton, 'Enable Microphone'],
  [audioMuteButton, 'Mute'],
  [recordAudioButton, 'Record Audio'],
  [recordVideoButton, 'Record Video'],
  [diagnosticsButton, 'Diagnostics']
]

dockButtonLabels.forEach(([button, label]) => {
  setButtonLabel(button, label)
})

setInlineButtonLabel(microphoneTestButton, 'Test microphone')
setInlineButtonLabel(resyncAudioButton, 'Resync')

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
