# CaptureLink Roadmap

## M0 — Clean desktop foundation

- [x] Create standalone CaptureLink repository
- [x] Use Chromium-based Electron runtime
- [x] Establish secure main/preload/renderer boundaries
- [x] Add initial product shell
- [ ] Establish automated checks

## M1 — Known-good Remote Play parity

- [x] Integrate Xbox authentication
- [x] Persist tokens securely outside the repository
- [x] Discover owned/available Xbox consoles
- [x] Select a console
- [x] Start xHome session
- [x] Complete SDP negotiation in Electron Chromium
- [x] Complete ICE negotiation
- [x] Render Xbox video
- [x] Play Xbox audio
- [x] Reconfirm incoming game-chat audio
- [x] Stop/disconnect cleanly

**Exit criterion:** CaptureLink reproduces the exact behavior proven by the XboxLink protocol spike without depending on localhost + an external browser.

## M2 — Existing controls and diagnostics

- [x] Controller attach/detach
- [x] Microphone start/stop foundation and chat SDP renegotiation
- [x] Keyboard input through the upstream gamepad adapter
- [x] Stream mute and volume controls
- [x] Microphone input selector and live input meter
- [x] Speaker/output selector with Chromium sink routing
- [x] Live WebRTC statistics
- [x] Connection state and error UX
- [x] Validate microphone audibility with another player
- [ ] Decide whether touch or dedicated mouse input belongs in the Windows-first product

**Exit criterion:** controller input, selected-device microphone chat uplink, audio routing controls, and diagnostics all work reliably during a live xHome session.

## M3 — Audio recording

- [x] Tap the incoming Remote Play audio stream
- [x] Start/stop audio recording
- [ ] Verify saved recordings contain game audio + incoming game chat
- [x] Save locally through an Electron save dialog
- [x] Recording timer
- [x] Clear recording indicator
- [x] Preserve local mute/volume independence from recorded media

**Exit criterion:** a saved file audibly contains the same game and game-chat audio heard live.

## M4 — Video + audio recording

- [ ] Record received video + audio together
- [ ] Maintain A/V synchronization
- [ ] Save locally
- [ ] Handle long recordings safely
- [ ] Warn on low disk space
- [ ] Warn before closing during active recording

## M5 — Recording library / export

- [ ] User-selected save location
- [ ] Recording history
- [ ] Open file / open folder
- [ ] Delete recording
- [ ] Export/conversion strategy (MP4/WAV only after native capture is stable)

## M6 — Windows release

- [ ] Product naming/trademark review
- [ ] Microsoft/Xbox terms review
- [ ] Third-party attribution review
- [ ] Privacy/recording disclosure
- [ ] Installer signing strategy
- [ ] NSIS installer
- [ ] Private alpha
- [ ] Public technical preview decision
