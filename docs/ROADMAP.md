# CaptureLink Roadmap

CaptureLink is a Windows-first Xbox Remote Play application that has expanded
from local viewing and recording into experimental direct Friend streaming and
remote controller transport.

## Completed foundation

### Xbox Remote Play

- [x] Microsoft/Xbox authentication
- [x] console discovery
- [x] xHome session creation
- [x] Xbox video
- [x] Xbox audio
- [x] incoming in-game voice-chat validation
- [x] microphone uplink
- [x] local controller input
- [x] clean disconnect
- [x] audio-only Xbox streaming mode

### Recording

- [x] audio-only recording
- [x] video + audio recording
- [x] local microphone recording mix
- [x] independent recording microphone gain
- [x] disk-backed recording
- [x] recording library
- [x] original WebM export
- [x] MP4 export path
- [x] MP3 export path
- [x] WAV export path

### Desktop UX

- [x] Windows Electron application
- [x] application branding
- [x] NSIS installer
- [x] fullscreen
- [x] Picture-in-Picture
- [x] microphone/output device controls
- [x] WebRTC diagnostics
- [x] audio resync
- [x] Connect / Stream / Audio / Recordings / Settings navigation

## Friend Mode research completed

### Direct peer-to-peer transport

- [x] direct CaptureLink-to-CaptureLink WebRTC
- [x] STUN-assisted Internet NAT traversal
- [x] direct controller DataChannel
- [x] Friend video transport
- [x] low-jitter receiver tuning
- [x] Friend media diagnostics

### Video quality

- [x] 720p60 low-latency validation
- [x] 1080p60 validation
- [x] 10 Mbps 1080p sender ceiling
- [x] maintain-frame-rate degradation preference
- [x] motion content hint

The current implementation uses the validated high-quality sender configuration.

### Friend session UX

- [x] Friend stream integrated into the normal CaptureLink player
- [x] Friend session represented as a first-class application session
- [x] serverless Direct Invite
- [x] automatic Host clipboard response detection
- [x] no manual SDP fields required for normal Direct Invite use

### Remote controllers

- [x] remote controller state transport
- [x] lazy Xbox controller attachment
- [x] Shared Controller mixer prototype
- [x] separate Player 2 controller
- [x] Player 2 validated in NBA 2K local multiplayer
- [x] USB standard-gamepad support
- [x] Bluetooth Windows-gamepad support
- [x] controller disconnect/reconnect handling
- [x] standard-mapping preference
- [x] controller compatibility normalization

## Current priorities

### 1. Shared Controller validation

- [ ] retest with Host controller connected to the Host Windows PC
- [ ] verify Host controller visibility through the browser Gamepad API
- [ ] validate Host + Friend merged input end-to-end
- [ ] investigate the mixer if the correct Host configuration still fails
- [ ] preserve working Player 2 behavior

See `docs/known-issues/shared-controller-input.md`.

### 2. Friend usability

- [ ] visible guest controller device/status
- [ ] explicit controller selection when multiple gamepads are connected
- [ ] improve Direct Invite sharing UX
- [ ] improve reconnect presentation
- [ ] integrate Friend diagnostics into the normal diagnostics UI

### 3. Friend media

- [ ] evaluate Friend audio
- [ ] evaluate A/V synchronization before enabling Friend audio
- [ ] continue latency testing over varied networks
- [ ] expose deliberate quality controls after the sender configuration is productized

### 4. Connectivity hardening

Direct Friend sessions currently depend on successful peer-to-peer ICE
traversal.

Possible future improvements:

- [ ] optional hosted rendezvous / short session codes
- [ ] session binding for Direct Invite responses
- [ ] trickle ICE
- [ ] TURN fallback
- [ ] Friend reconnect flow

The optional broker experiment is preserved under:

~~~text
experiments/signaling-broker/
~~~

## Release readiness

- [x] Windows NSIS installer
- [x] repository CI
- [x] pinned Xbox player artifact
- [x] third-party provenance structure
- [ ] choose CaptureLink repository license
- [ ] finish Microsoft/Xbox service-terms review
- [ ] finish product naming/trademark review
- [ ] add user-facing recording/privacy disclosure
- [ ] complete long-session Windows testing
- [ ] final installed-build regression pass
- [ ] decide code-signing strategy

## Later possibilities

These are not current commitments:

- Friend-session audio
- TURN service
- hosted invite/session service
- controller rumble return channel
- synchronized controller-input recording
- training-data export
- recording trimming/editing
- macOS feasibility
- Linux feasibility

CaptureLink should remain usable without a required CaptureLink-operated cloud
backend.
