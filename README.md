# CaptureLink

CaptureLink is a Windows desktop application for Xbox Remote Play, local recording, and media export.

It connects to an Xbox console through the user's Microsoft/Xbox account, displays the Remote Play stream locally, exposes session controls and diagnostics, and records the audio and video already being received by the computer.

The original problem CaptureLink set out to solve was simple: recording Xbox gameplay with game chat should not require a capture card, controller audio routing, a wired headset, and a fragile collection of hardware workarounds.

## Why CaptureLink exists

CaptureLink began after a friend asked for help recording Xbox gameplay with game-chat audio.

Recording gameplay itself was possible through existing workarounds. Streaming the console to a PC could capture video and game audio. A traditional capture card could also capture HDMI output.

Game-chat audio was the problem.

The practical workaround eventually required a capture card, a wired headset, controller-side audio routing, and additional cabling. Even after that setup worked, longer recordings could develop noticeable audio/video drift and required periodic restarts.

That led to a different question:

**If Xbox Remote Play can already deliver gameplay video, game audio, and voice audio to another device, why reconstruct those streams with external hardware just to record them?**

Research into Xbox Remote Play and the xHome streaming path showed that the necessary media could already reach a PC through software. An experimental XboxLink protocol spike confirmed that Chromium could establish an xHome WebRTC session and, in the tested configuration, receive gameplay video, game audio, and incoming in-game voice chat.

CaptureLink grew from that proof of concept into a standalone desktop application.

The longer project story is documented in [`docs/PROJECT_HISTORY.md`](docs/PROJECT_HISTORY.md).

## Current status

CaptureLink is currently a pre-release Windows application at version `0.1.0`.

The current implementation supports:

- Microsoft/Xbox authentication
- Xbox console discovery
- xHome Remote Play session creation
- Xbox video playback
- Xbox game-audio playback
- incoming in-game voice chat when it is present in the received Remote Play stream
- connect and disconnect controls
- optional PC-connected controller input
- microphone selection and Remote Play microphone uplink
- microphone input metering
- speaker/output selection where supported by Chromium
- local stream volume and mute controls
- live WebRTC diagnostics
- manual and conservative automatic audio resynchronization
- fullscreen video
- Picture-in-Picture video
- audio-only recording
- video + audio recording
- optional local microphone mixing into saved recordings
- disk-backed recording for longer sessions
- local recording library
- rename, delete, open, and reveal-in-folder actions
- original WebM export
- MP4 video export
- MP3 audio export
- WAV audio export
- optional external FFmpeg integration for MP4, MP3, and WAV exports
- NSIS Windows installer
- CaptureLink application and installer branding

The Windows installer builds successfully. Authenticode code signing is not yet configured.

## What CaptureLink records

CaptureLink records the media already received by the active Xbox Remote Play session.

The native recording format is WebM because Chromium's `MediaRecorder` provides a reliable real-time capture path for the incoming media tracks.

For video recordings, CaptureLink records the incoming Xbox video together with the received Xbox audio.

For audio recordings, CaptureLink records the incoming Xbox audio stream.

In tested configurations, incoming in-game voice chat is part of that received Remote Play audio and therefore appears in recordings along with game audio.

A locally selected microphone can also be mixed into the saved recording at an independently adjustable gain.

Local playback mute, playback volume, and speaker routing do not intentionally alter the underlying Xbox media being recorded.

Party Chat has not been independently validated and should not be inferred from the confirmed in-game voice-chat result.

See [`docs/RECORDING.md`](docs/RECORDING.md) for the recording and export pipeline.

## How it works

At a high level:

```text
Microsoft / Xbox authentication
              |
              v
       Console discovery
              |
              v
      xHome session control
              |
              v
        Xbox console
              |
              | WebRTC
              v
+----------------------------------+
| CaptureLink                      |
|                                  |
| xbox-xcloud-player               |
|        |                         |
|        +--> video                |
|        +--> Xbox audio/chat      |
|        +--> controller input     |
|        +--> microphone uplink    |
|                                  |
| CaptureLink application layer    |
|        +--> UI                   |
|        +--> diagnostics          |
|        +--> recording            |
|        +--> recording library    |
|        +--> FFmpeg export        |
+----------------------------------+
              |
              v
        Local media files
```

CaptureLink does not implement the entire Xbox Remote Play protocol from scratch.

The project uses and credits third-party open-source work, most importantly:

- **xbox-xcloud-player**, by Jim Kroon / UnknownSKL, for the browser-side xCloud/xHome WebRTC player and control layer
- **xal-node**, by UnknownSKL, for Xbox Authentication Library functionality
- **FFmpeg**, distributed in packaged builds through `ffmpeg-static`, for post-recording media conversion

CaptureLink's application-specific work sits around those components: desktop integration, session orchestration, Electron IPC boundaries, UI, diagnostics, device controls, media capture, microphone recording mix, disk-backed recording, recording-library management, export behavior, Windows packaging, and product-level error handling.

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`third_party/`](third_party/) for provenance and attribution information.

## Architecture

CaptureLink uses:

- Electron `44.2.0`
- Chromium through Electron
- TypeScript
- electron-vite
- electron-builder
- `xal-node`
- a pinned/vendored `xbox-xcloud-player` browser bundle
- `ffmpeg-static`

The application is divided into three main security/process boundaries:

**Electron main process**

Owns privileged desktop operations, Xbox authentication/session requests, local file access, recording persistence, recording-library metadata, FFmpeg execution, dialogs, and application lifecycle.

**Preload**

Exposes a narrow typed IPC API to the renderer through Electron's `contextBridge`.

**Renderer**

Owns the desktop UI and browser media behavior: WebRTC player integration, video/audio presentation, device selection, controller and microphone controls, diagnostics, `MediaRecorder`, recording mixes, fullscreen, and Picture-in-Picture.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the detailed design.

## Development

### Requirements

- Windows 11 is the primary target
- Node.js `>=24.19.0`
- npm

Install dependencies:

```bash
npm install
```

Start development mode:

```bash
npm run dev
```

Run TypeScript validation:

```bash
npm run typecheck
```

Build the Electron application:

```bash
npm run build
```

Build the Windows NSIS installer:

```bash
npm run dist:win
```

The Xbox player bundle is prepared automatically before development/build operations and can also be verified manually with:

```bash
npm run vendor:xbox-player
```

The vendoring script verifies the checked-in bundle against the SHA-256 recorded in `third_party/xbox-xcloud-player/SOURCE.json`.

Additional development details belong in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Recording formats

CaptureLink keeps WebM as its native recording/master format.

Derived exports currently include:

| Recording     | Export             |
| ------------- | ------------------ |
| Video WebM    | MP4                |
| Audio WebM    | MP3                |
| Audio WebM    | WAV                |
| Any recording | Original WebM copy |

Packaged Windows builds include an FFmpeg executable for conversion. Development builds can also resolve FFmpeg from the configured environment or development dependency.

See [`docs/RECORDING.md`](docs/RECORDING.md).

## Known limitations

CaptureLink is still pre-release software.

Important current limitations include:

- Remote Play behavior can vary by game and Xbox state.
- Some games may assign gameplay controller ownership to the Remote Play endpoint when Remote Play is connected before gameplay initializes.
- The controller-ownership behavior has also been reproduced with Microsoft's own Remote Play client and is documented as a known Xbox Remote Play/title interaction.
- Audio-output selection depends on Chromium/Windows capabilities exposed on the host.
- Long-session behavior should continue to receive native-Windows testing.
- The installer is currently unsigned.

See [`docs/known-issues/xbox-controller-ownership.md`](docs/known-issues/xbox-controller-ownership.md).

## Project scope

CaptureLink is intentionally a local desktop application.

The current project does not require a CaptureLink cloud backend, account service, remote recording store, transcription service, or GPU service.

Potential future work is tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Third-party work and attribution

CaptureLink would not exist in its current form without open-source work that documented and implemented important pieces of the Xbox streaming ecosystem.

In particular, Jim Kroon / UnknownSKL's `xbox-xcloud-player` project provided the WebRTC/xHome player foundation used by CaptureLink, and `xal-node` provides Xbox authentication functionality.

The project also uses FFmpeg for media conversion.

CaptureLink does not claim authorship of those projects or of Microsoft's Xbox services and protocols.

Detailed versions, provenance, licensing, and notices are maintained separately in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Legal and trademark notice

CaptureLink is an independent project and is not affiliated with, endorsed by, sponsored by, or supported by Microsoft Corporation or Xbox.

Xbox, Microsoft, and related names and marks belong to their respective owners.

Users are responsible for complying with applicable platform terms, laws, privacy obligations, and consent requirements when recording communications or other people.

The repository's application-license and binary-distribution posture is still under review. Third-party components retain their respective licenses.

See [`docs/LEGAL_REVIEW.md`](docs/LEGAL_REVIEW.md).

## Version

Current application version: **0.1.0**

Current phase: **pre-release / Windows release-readiness**
