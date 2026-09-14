# CaptureLink Architecture

## Overview

CaptureLink is a Windows-first Electron desktop application that connects to a user's Xbox through the Xbox Remote Play/xHome path, presents the WebRTC media session locally, and records the media received by the application.

The application is intentionally local-first.

CaptureLink currently has no CaptureLink-hosted control plane, user-account backend, transcription backend, remote recording service, or GPU service.

## System boundary

```text
                 Microsoft / Xbox services
                           |
             authentication + console discovery
                           |
                           v
                 xHome session control
                           |
                           v
                      Xbox console
                           |
                           | WebRTC
                           v
+--------------------------------------------------+
| CaptureLink Desktop                              |
|                                                  |
| Electron main process                            |
|   - application lifecycle                        |
|   - authentication orchestration                 |
|   - Xbox console discovery                       |
|   - xHome session control                        |
|   - privileged filesystem access                 |
|   - disk-backed recording writes                 |
|   - recording-library persistence                |
|   - FFmpeg process execution                     |
|   - native dialogs / shell integration           |
|                                                  |
| Preload                                          |
|   - contextBridge                                |
|   - narrow typed IPC surface                     |
|                                                  |
| Chromium renderer                                |
|   - user interface                               |
|   - xbox-xcloud-player integration               |
|   - RTCPeerConnection / media presentation       |
|   - controller and microphone controls           |
|   - device selection                             |
|   - WebRTC diagnostics                           |
|   - MediaRecorder                                |
|   - microphone recording mix                     |
|   - fullscreen / Picture-in-Picture              |
+--------------------------------------------------+
                           |
                           v
                Local recording files
                           |
                           v
                  FFmpeg-derived exports
```

## Why Electron

The original XboxLink protocol spike tested the Remote Play media path in multiple browsers.

Chromium/Edge successfully negotiated and rendered the tested xHome WebRTC session.

Firefox failed during the SDP-exchange path in that implementation.

Electron therefore provides two useful properties:

1. CaptureLink controls the Chromium version used by the desktop application.
2. Browser media APIs and native desktop capabilities can be combined behind explicit main/preload/renderer boundaries.

The decision is primarily about controlling the known-good runtime rather than requiring users to launch an external browser.

## Process boundaries

### Main process

`src/main/index.ts` owns privileged desktop responsibilities.

Its current responsibilities include:

- BrowserWindow lifecycle
- native-window fullscreen state
- Xbox authentication orchestration
- authentication status
- Xbox console discovery
- xHome session operations
- recording-file creation
- incremental recording writes
- recording finalization/cancellation
- disk-space checks
- recording-library metadata
- open/reveal/rename/delete operations
- original recording export
- converted recording export
- FFmpeg process execution
- shutdown behavior while recording
- status/event delivery to the renderer

The main process is the only CaptureLink layer that should directly own arbitrary local filesystem operations.

### Preload

`src/preload/index.ts` exposes the renderer-facing API with `contextBridge`.

The preload bridge intentionally exposes specific operations instead of Node.js or Electron primitives.

Current IPC groups include:

**Xbox**

- authentication status
- authentication start
- console discovery
- session start
- SDP exchange
- ICE exchange
- chat SDP exchange
- session stop

**Window**

- native fullscreen state

**Recording**

- begin recording
- append recording chunk
- finalize
- cancel
- list recordings
- open recording
- reveal recording
- rename
- delete
- export original
- query conversion support
- export converted media

**Events**

- authentication output
- authentication completion
- stream status
- recording stop request
- export progress
- fullscreen changes

This boundary keeps renderer code from receiving unrestricted Electron or filesystem access.

### Renderer

`src/renderer/src/main.ts` owns the interactive application and browser media behavior.

Its responsibilities include:

- sign-in UX
- console selection
- Remote Play connection lifecycle
- player creation/destruction
- Xbox video presentation
- Xbox audio presentation
- speaker selection
- local volume/mute
- microphone selection
- microphone metering
- microphone monitor/test behavior
- microphone chat uplink controls
- controller attachment
- live WebRTC diagnostics
- audio resynchronization
- recording controls
- recording microphone gain
- media-track selection
- recording audio mixing
- `MediaRecorder`
- recording progress/status
- recording-library UI
- fullscreen
- Picture-in-Picture

## Authentication

CaptureLink uses `xal-node` for Xbox Authentication Library functionality.

Authentication data is persisted outside the repository under Electron's application-data directory.

The repository does not require checked-in user tokens.

Console discovery loads the stored token material, requests an Xbox web token, and queries the Xbox device service for consoles available to the account.

The renderer receives only the console information needed by the UI rather than unrestricted token-store access.

## Xbox console discovery

`src/main/xbox/consoles.ts` is responsible for console enumeration.

The discovery result is normalized into a small application-owned shape:

```text
ConsoleSummary
  - serverId
  - deviceName
  - powerState
  - consoleType
```

Keeping that model small prevents Xbox service response details from leaking unnecessarily throughout the UI.

## xHome session management

`src/main/xbox/xhome.ts` owns CaptureLink's application-side xHome session control.

The high-level sequence is:

```text
load authentication
       |
       v
request xHome streaming token
       |
       v
select host / region
       |
       v
POST home/play session
       |
       v
poll session state
       |
       +--> ReadyToConnect
       |        |
       |        v
       |   send Microsoft session token
       |
       v
   Provisioned
       |
       v
begin WebRTC exchange
```

Once provisioned, CaptureLink maintains the xHome session with periodic keepalive requests.

Stopping the session clears the keepalive and asks Xbox to delete the active session.

## SDP and ICE exchange

The original protocol spike exposed an important behavior: a successful HTTP request does not necessarily mean the corresponding SDP or ICE response is ready for use.

CaptureLink therefore polls for semantically valid exchange content.

For SDP, it waits for an exchange response containing a usable SDP answer.

For ICE, it waits for a non-empty candidate response.

This prevents pending/placeholder responses from being treated as completed negotiation.

## xbox-xcloud-player boundary

CaptureLink vendors a pinned browser bundle from `xbox-xcloud-player`.

That upstream project supplies important browser-side Xbox streaming functionality.

CaptureLink treats it as a dependency rather than pretending the player implementation is application-owned code.

The vendored source artifact is stored under:

```text
third_party/xbox-xcloud-player/
```

`SOURCE.json` records identifying metadata and a SHA-256 digest.

`scripts/vendor-xbox-player.mjs` verifies that digest before copying the player bundle into the renderer's Vite public directory.

This makes the build self-contained and prevents an unnoticed player-bundle change from silently entering a CaptureLink build.

Exact third-party provenance and licensing are documented separately from this architecture document.

## Media path

Once WebRTC connects, the renderer receives Xbox media through the player.

Conceptually:

```text
Xbox WebRTC session
       |
       +--> video track -------> video presentation
       |                            |
       |                            +--> video recording
       |
       +--> audio track -------> audio playback
                                    |
                                    +--> audio recording
                                    |
                                    +--> recording audio mix
```

Incoming in-game voice chat has been verified in the received Remote Play audio in tested configurations.

CaptureLink therefore does not currently implement a separate incoming game-chat interception subsystem.

Party Chat has not been independently validated.

## Microphone paths

The local microphone can participate in two conceptually separate paths.

### Remote Play microphone uplink

The selected microphone can be enabled for Xbox chat through the player/chat channel.

That path controls what is transmitted back through the Remote Play session.

### Recording microphone mix

CaptureLink can separately add the local microphone to a saved recording.

A recording-only microphone gain is applied to this mix.

Changing the saved-recording microphone gain is not intended to change the microphone level transmitted to Xbox.

Keeping these paths conceptually separate avoids tying recording balance to live-chat behavior.

## Recording architecture

CaptureLink uses browser-native `MediaRecorder` for real-time capture.

WebM is the native recording format.

The recorder operates on media streams assembled from the incoming Xbox tracks and, when selected, the local microphone mix.

The renderer does not retain the entire recording until stop.

Instead:

```text
MediaRecorder
     |
     | periodic Blob chunks
     v
renderer
     |
     | narrow IPC call
     v
Electron main process
     |
     | append to open file
     v
local WebM master
```

This disk-backed design keeps recording memory usage from scaling directly with session duration.

The main process also performs available-space checks and retains already-written data where possible when recording ends abnormally.

## Recording library

Finalized recordings are represented by persisted metadata separate from the media file itself.

Library entries include information such as:

- identifier
- recording kind
- file path
- creation time
- duration
- byte size

The UI resolves current existence state so a missing file can be represented explicitly rather than crashing the library.

Filesystem mutations such as rename and delete remain main-process operations.

## Export pipeline

CaptureLink keeps the original WebM recording unchanged and performs common-format conversion afterward.

Current derived formats are:

```text
Video WebM  -> MP4
Audio WebM  -> MP3
Audio WebM  -> WAV
Any WebM    -> original copy
```

FFmpeg runs as a separate native process.

Runtime resolution currently supports, in order:

1. `CAPTURELINK_FFMPEG`, when explicitly configured
2. the FFmpeg executable bundled in packaged application resources
3. the `ffmpeg-static` development dependency
4. an FFmpeg executable available on `PATH`

### MP4

The preferred path uses H.264 video with AAC audio.

CaptureLink explicitly preserves variable frame timing during conversion because Chromium MediaRecorder WebM can expose a nominal time base that should not be interpreted as the actual gameplay frame cadence.

If the resolved FFmpeg build does not expose `libx264`, CaptureLink can retry MP4 conversion with FFmpeg's MPEG-4 video encoder.

### MP3

Audio export uses MP3 at 192 kbps.

### WAV

WAV export uses signed 16-bit PCM.

Export progress is reported back to the renderer.

A failed derived conversion should not destroy or modify the original WebM master.

## Diagnostics and audio resynchronization

The renderer collects WebRTC statistics during active sessions.

Diagnostics include connection/media information and timing information used to identify sustained late-audio behavior.

CaptureLink provides:

- manual local audio resynchronization
- optional conservative automatic resynchronization
- a sustained-late threshold
- multiple required samples before automatic action
- a cooldown between automatic resynchronizations

The recovery path targets local presentation and does not require rebuilding the entire Xbox Remote Play session.

## Controller input

Controller integration is provided through the player/control-channel layer.

CaptureLink exposes controller attachment as an explicit user control rather than assuming a PC gamepad must always participate in the session.

A separate known issue exists around Xbox/game controller ownership in some titles when Remote Play is active during gameplay initialization.

That issue is documented in:

```text
docs/known-issues/xbox-controller-ownership.md
```

It has also been reproduced with Microsoft's own Remote Play client, so CaptureLink currently treats it as an Xbox Remote Play/title interaction rather than altering the stable protocol path aggressively.

## Video presentation

The received video can be displayed in three primary modes:

- normal application layout
- fullscreen
- Picture-in-Picture

Native Electron fullscreen state is synchronized through the main/preload boundary.

Picture-in-Picture uses the browser media presentation path in the renderer.

## Security defaults

CaptureLink follows Electron privilege separation rather than exposing desktop capabilities directly to page code.

Important principles include:

- `contextIsolation: true`
- `nodeIntegration: false`
- sandboxed renderer
- narrow preload API
- renderer does not receive unrestricted filesystem APIs
- authentication files live outside the repository
- Xbox service tokens are not intentionally exposed through the UI layer
- recording writes occur through explicit IPC operations
- external/native operations remain in the main process

## Local-first scope

CaptureLink v0.1 intentionally avoids a CaptureLink-operated backend.

There is currently no architectural requirement for:

- CaptureLink cloud accounts
- cloud recording storage
- remote relay infrastructure
- transcription
- GPU inference
- GPULink integration
- collaborative editing
- remote media processing

Those features can be evaluated later without making them prerequisites for the core Xbox recording use case.

## Distribution boundary

Development and distribution are separate concerns.

The application can run from source using Electron development tooling.

Packaged Windows builds use electron-builder and NSIS and include runtime resources required by the current application, including the selected player bundle and FFmpeg executable.

The installer is currently unsigned.

Third-party licensing, Microsoft/Xbox terms, recording/privacy disclosure, and application-license selection remain release-readiness concerns rather than architectural assumptions.
