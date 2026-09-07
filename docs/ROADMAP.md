# CaptureLink Roadmap

## M0 — Clean desktop foundation

- [x] Create standalone CaptureLink repository
- [x] Use Chromium-based Electron runtime
- [x] Establish secure main/preload/renderer boundaries
- [x] Add initial product shell
- [ ] Establish automated checks

## M1 — Known-good Remote Play parity

- [ ] Integrate Xbox authentication
- [ ] Persist tokens securely outside the repository
- [ ] Discover owned/available Xbox consoles
- [ ] Select a console
- [ ] Start xHome session
- [ ] Complete SDP negotiation in Electron Chromium
- [ ] Complete ICE negotiation
- [ ] Render Xbox video
- [ ] Play Xbox audio
- [ ] Reconfirm incoming game-chat audio
- [ ] Stop/disconnect cleanly

**Exit criterion:** CaptureLink reproduces the exact behavior proven by the XboxLink protocol spike without depending on localhost + an external browser.

## M2 — Existing controls and diagnostics

- [ ] Controller attach/detach
- [ ] Microphone start/stop
- [ ] Supported keyboard/mouse path, if retained
- [ ] Touch path, if retained
- [ ] WebRTC/debug statistics
- [ ] Connection state and error UX

## M3 — Audio recording

- [ ] Tap the incoming Remote Play audio stream
- [ ] Start/stop audio recording
- [ ] Preserve game audio + game chat
- [ ] Save locally
- [ ] Recording timer
- [ ] Clear recording indicator

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
