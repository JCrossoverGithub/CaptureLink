# CaptureLink Roadmap

CaptureLink has completed the original protocol-parity and core recording milestones.

The project is now primarily in Windows release-readiness work for v0.1.

## Completed foundation

### M0 - Desktop foundation

- [x] Standalone CaptureLink repository
- [x] Chromium-based Electron runtime
- [x] main/preload/renderer boundaries
- [x] initial application shell

### M1 - Xbox Remote Play parity

- [x] Microsoft/Xbox authentication
- [x] authentication persistence outside the repository
- [x] Xbox console discovery
- [x] console selection
- [x] xHome session creation
- [x] SDP negotiation
- [x] ICE negotiation
- [x] Xbox video
- [x] Xbox audio
- [x] incoming in-game voice-chat validation
- [x] clean disconnect behavior

### M2 - Controls and diagnostics

- [x] controller attach/detach
- [x] keyboard input through the player adapter
- [x] microphone device selection
- [x] microphone input meter
- [x] microphone chat uplink
- [x] microphone start/stop
- [x] local stream mute
- [x] local volume
- [x] supported speaker/output selection
- [x] WebRTC diagnostics
- [x] microphone audibility validation with another player

### M3 - Audio recording

- [x] capture incoming Xbox audio
- [x] audio-only recording
- [x] game-audio validation
- [x] incoming game-chat validation
- [x] recording state and elapsed time
- [x] local playback controls remain independent from captured media

### M4 - Video recording and hardening

- [x] combined video + Xbox audio recording
- [x] real gameplay A/V validation
- [x] disk-backed recording chunks
- [x] pre-recording disk-space checks
- [x] continued disk-space checks while recording
- [x] recording preservation during supported failure paths
- [x] close-during-recording protection

### M5 - Recording library and exports

- [x] persisted recording metadata
- [x] recording library
- [x] open recording
- [x] reveal in folder
- [x] rename
- [x] delete
- [x] missing-file handling
- [x] original WebM export
- [x] MP4 export
- [x] MP3 export
- [x] WAV export
- [x] conversion progress
- [x] MP4 frame-timing correction

### Pre-release usability

- [x] optional local microphone recording mix
- [x] independent recording-only microphone gain
- [x] onboarding/session UI polish
- [x] A/V timing diagnostics
- [x] audio jitter-buffer diagnostics
- [x] manual audio resync
- [x] conservative automatic audio resync
- [x] fullscreen
- [x] Picture-in-Picture

### Windows runtime and packaging

- [x] native Windows authentication foundation
- [x] improved session failure diagnostics
- [x] vendored/pinned Xbox player bundle
- [x] SHA-256 verification for Xbox player bundle
- [x] FFmpeg export integration
- [x] application identity
- [x] application icon
- [x] installer branding
- [x] NSIS installer
- [x] desktop shortcut
- [x] Start Menu shortcut
- [x] packaged-build smoke testing foundation

## Current phase - v0.1 release readiness

- [x] merge completed implementation into `main`
- [x] remove historical feature branches
- [x] begin full repository documentation refresh
- [ ] complete documentation refresh
- [ ] complete third-party notices
- [ ] preserve required third-party license texts
- [ ] Microsoft/Xbox service-terms review
- [ ] product naming/trademark review
- [x] FFmpeg binary redistribution review - v0.1 does not bundle the audited GPLv3 executable
- [ ] choose CaptureLink's own repository license
- [ ] add user-facing recording/privacy disclosure
- [ ] repeat long-session testing on native Windows
- [ ] final installed-build regression pass
- [ ] decide code-signing strategy
- [ ] decide public technical-preview readiness

## Post-v0.1 candidates

These are possibilities, not commitments.

### Reliability

- reconnect action that cleanly rebuilds the xHome/WebRTC session
- broader title-specific controller-ownership testing
- additional long-duration recording tests
- improved recovery from console sleep/network changes
- more detailed diagnostic export

### Recording

- additional codec/export choices
- configurable export presets
- recording notes/tags
- richer recording-library search and filtering
- optional lightweight trimming

### Input

- evaluate dedicated mouse-input support
- evaluate touch controls
- investigate Remote Play controller ownership/player-slot behavior further

### Platform

- evaluate macOS feasibility
- evaluate Linux feasibility

Cross-platform support should not compromise the known-good Windows/Chromium implementation.

### Optional future services

Possible future features such as transcription, cloud storage, remote workflows, or GPU-assisted processing should remain optional extensions.

They are not prerequisites for CaptureLink's core local Xbox recording use case.

## Future: Remote Local Multiplayer

A future CaptureLink generation should investigate remote second-player controller support.

The goal is to allow another CaptureLink user on a different computer or network to contribute controller input to the host user's Xbox session as though a second controller were physically connected locally.

A representative use case is NBA 2K Blacktop.

Player 1 owns and runs the Xbox and CaptureLink session. Player 1 launches a local multiplayer mode that normally expects two controllers connected to the same Xbox.

Player 2 is somewhere else and joins Player 1 through CaptureLink. Player 2 connects a controller to their own PC. CaptureLink transports that controller state over the network to Player 1's CaptureLink session and presents it to the Xbox as a distinct second local controller.

The game should therefore behave as though Player 1 and Player 2 are sitting together with two locally connected controllers even though Player 2 is remote.

This differs from normal Xbox online multiplayer. CaptureLink would effectively extend a game's local multiplayer controller interface across the network.

### Desired architecture

Player 2 controller
-> Player 2 CaptureLink client
-> low-latency encrypted controller-input transport
-> Player 1 CaptureLink host
-> second logical Xbox controller/input channel
-> host Xbox
-> local multiplayer game

Player 2 would also receive the host Remote Play video/audio stream so the remote player has the feedback needed to play.

### Research questions

Future work should investigate:

- whether xHome or Xbox Remote Play supports multiple independent controller/input slots
- whether xbox-xcloud-player can represent more than one controller
- whether a second logical controller can be negotiated directly with the Xbox
- whether Windows virtual-gamepad technology is required
- how controller identity and player-slot assignment are represented
- how Player 2 joins and leaves without disturbing Player 1
- latency requirements for sports, fighting, racing, and other timing-sensitive games
- synchronization between Player 2 input and the Remote Play stream
- secure invitation and explicit host authorization
- prevention of unauthorized remote input
- controller disconnect and reconnect behavior
- vibration and other controller return-channel features

### Product goal

The eventual experience should be simple:

1. Player 1 starts CaptureLink.
2. Player 1 chooses an option such as **Invite Remote Controller**.
3. Player 2 joins the CaptureLink session.
4. Player 2 connects or selects their controller.
5. CaptureLink assigns that controller as Player 2 on the host Xbox.
6. The Xbox game sees two local controllers even though one player is remote.

The game itself should not need to support online multiplayer.

This feature is intentionally deferred beyond v0.1. The current Remote Play, controller, recording, and stability foundations should remain stable before multi-user controller transport is introduced.
