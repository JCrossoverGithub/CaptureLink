# CaptureLink Release Scope

## Current phase

CaptureLink is pre-release Windows software.

Current development version:

~~~text
0.2.1
~~~

The published GitHub release may lag behind the development version while
features are being validated.

## Core product scope

CaptureLink is a Windows-first Xbox Remote Play application focused on:

- Xbox Remote Play
- local Xbox media playback
- incoming in-game voice-chat capture when present in the Remote Play audio
- microphone uplink
- local recording
- recording-library management
- media export
- diagnostics
- controller input

CaptureLink also contains experimental Friend functionality for direct
peer-to-peer gameplay and controller transport.

## Xbox Remote Play

Included:

- Microsoft/Xbox sign-in
- authentication persistence outside the repository
- Xbox console discovery
- xHome Remote Play session creation
- SDP/ICE negotiation
- session lifecycle handling
- Xbox video
- Xbox game audio
- incoming in-game voice chat when present in the received stream
- audio-only Remote Play mode
- PC-connected controller input
- microphone uplink
- fullscreen
- Picture-in-Picture
- diagnostics
- audio resynchronization

## Recording

Included:

- audio-only recording
- video + Xbox-audio recording
- optional local microphone recording mix
- recording-only microphone gain
- disk-backed recording
- disk-space checks
- recording library
- rename
- delete
- open
- reveal in folder
- original WebM export

WebM is CaptureLink's native recording format.

## Converted exports

CaptureLink supports FFmpeg-based conversion paths for:

- MP4
- MP3
- WAV

The current CaptureLink Windows installer does **not** bundle an FFmpeg
executable.

Converted exports therefore require an FFmpeg runtime that CaptureLink can
resolve separately.

The native WebM recording path does not require FFmpeg.

## Friend Direct

Current experimental Friend functionality includes:

- direct CaptureLink-to-CaptureLink WebRTC
- STUN-assisted Internet traversal
- serverless Direct Invite signaling
- direct Friend video
- low-latency controller DataChannel
- Shared Controller mode
- Player 2 mode
- USB and Bluetooth Windows gamepad support
- controller reconnect handling
- Friend media diagnostics

Player 2 has been validated with a remote Bluetooth-connected controller.

Shared Controller still requires additional validation.

The current Friend media path is video-only. Xbox audio is not yet forwarded
to the Friend.

There is currently no TURN fallback.

## Distribution

Current Windows distribution includes:

- Electron desktop application
- NSIS installer
- CaptureLink executable and installer identity
- CaptureLink icon
- desktop shortcut
- Start Menu shortcut
- pinned Xbox player browser bundle
- third-party notices and provenance metadata

The installer is currently unsigned.

## Explicitly out of core scope

CaptureLink does not currently require:

- CaptureLink cloud accounts
- a CaptureLink-hosted control plane
- cloud recording storage
- GPU infrastructure
- transcription infrastructure
- a required signaling backend
- a required TURN service
- a built-in editing suite
- third-party livestream-platform integration
- macOS support
- Linux support

Optional infrastructure may be explored later without becoming a requirement
for the core application.

## Known limitations

Current limitations include:

- Shared Controller needs further validation.
- Direct Friend connectivity can fail on restrictive NAT/firewall combinations.
- Friend audio is not yet transported.
- Some games have title-specific Remote Play controller-ownership behavior.
- Party Chat has not been independently validated.
- Converted exports depend on an external FFmpeg runtime.
- The Windows installer is unsigned.

See:

~~~text
docs/known-issues/
~~~

## Release-readiness work

Before a broader public release, CaptureLink should explicitly resolve or
accept:

- Microsoft/Xbox service-terms review
- product naming/trademark review
- CaptureLink repository-license decision
- recording/privacy disclosure
- native-Windows regression testing
- long-session testing
- installed-build testing
- code-signing strategy
- release artifact checksum verification

## Product positioning

CaptureLink is an independent local Xbox Remote Play and recording application
with experimental direct Friend functionality.

It should not imply Microsoft or Xbox endorsement.

Recording should be described as capture of media received through the user's
own Remote Play session.
