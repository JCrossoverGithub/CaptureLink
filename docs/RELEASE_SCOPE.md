# CaptureLink v0.1 Release Scope

## Release goal

CaptureLink v0.1 is a Windows-first technical preview of the local Xbox Remote Play and recording workflow.

The purpose of v0.1 is to establish a usable, installable application around the media path already proven during XboxLink research.

It is not intended to be a complete streaming platform or cloud service.

## Included

### Xbox connection

- Microsoft/Xbox sign-in
- persisted authentication outside the repository
- Xbox console discovery
- console selection
- xHome Remote Play session creation
- SDP and ICE exchange
- session keepalive
- connect/disconnect behavior

### Media

- live Xbox video
- live Xbox game audio
- incoming in-game voice chat when present in the received Remote Play stream
- local playback volume
- local mute
- supported speaker/output selection
- fullscreen
- Picture-in-Picture

### Input and chat controls

- optional PC-connected controller
- keyboard controls provided through the player adapter
- microphone device selection
- microphone input meter
- Remote Play microphone uplink
- microphone start/stop controls

### Diagnostics

- connection state
- WebRTC statistics
- audio/video timing information
- audio jitter-buffer information
- manual audio resynchronization
- conservative automatic audio resynchronization

### Recording

- audio-only recording
- video + audio recording
- optional local microphone inclusion
- independent recording-microphone gain
- disk-backed recording writes
- disk-space checks
- elapsed recording state
- safe finalization during expected shutdown/disconnect paths

### Recording library

- persisted recording metadata
- recording history
- open recording
- reveal in folder
- rename
- delete
- missing-file handling

### Export

- original WebM copy
- MP4 export for video
- MP3 export for audio
- WAV export for audio
- export progress
- bundled FFmpeg runtime in packaged Windows builds

### Windows distribution

- Electron desktop build
- NSIS installer
- CaptureLink executable identity
- application icon
- installer icon
- desktop shortcut
- Start Menu shortcut
- packaged Xbox player bundle
- packaged FFmpeg runtime

## Explicitly deferred

The following are not requirements for v0.1:

- CaptureLink cloud accounts
- CaptureLink-hosted control plane
- cloud recording storage
- remote relay infrastructure
- transcription
- GPULink integration
- collaborative workflows
- built-in editing suite
- direct streaming to third-party platforms
- guaranteed macOS or Linux releases
- touch-control productization
- dedicated mouse-input productization
- Party Chat claims until separately validated

## Known limitation accepted for v0.1

Some games can assign gameplay controller ownership to the Remote Play endpoint when Remote Play is active during gameplay initialization.

This behavior has also been reproduced with Microsoft's own Remote Play client.

For v0.1, CaptureLink documents the behavior and workaround rather than modifying the stable Remote Play protocol path aggressively.

See:

```text
docs/known-issues/xbox-controller-ownership.md
```

## Remaining release-readiness work

Before calling v0.1 a public technical preview, the project still needs to complete or explicitly resolve:

- Microsoft/Xbox service-terms review
- trademark/product-naming review
- third-party licensing and attribution review
- FFmpeg redistribution review
- application-license decision
- user-facing recording/privacy disclosure
- native-Windows regression testing
- long-session testing
- installer/code-signing strategy
- final release artifact verification

## Product positioning

CaptureLink is a local Xbox Remote Play viewing and recording application.

Recording should be described as local capture of media received through the user's own Remote Play session.

CaptureLink should not imply that it is an official Xbox application or that Microsoft endorses the project.
