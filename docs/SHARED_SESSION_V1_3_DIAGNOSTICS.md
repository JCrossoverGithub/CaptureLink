# CaptureLink Shared Session — V1.3 diagnostic engineering patch

**Status:** local source patch, not merged, not Xbox-validated.
**Reference:** `feature/shared-microphone-v1`, HEAD `8736837d1ad3ba2fdb17541abd629801c2180139`.
**Objective:** diagnose and repair guest microphone forwarding without conflating
peer connection success with Xbox game-chat audibility.

## Media paths (independent)

1. Guest mic (`getUserMedia`) -> guest WebRTC audio `RTCRtpSender`.
2. Host remote WebRTC audio `ontrack` -> guest gain -> Web Audio output.
3. Host mic -> same Web Audio output (host and guest mixed).
4. Mixed audio `MediaStreamTrack` -> existing Xbox audio `RTCRtpSender.replaceTrack()`.
5. Xbox Remote Play/game chat -> in-game listener (must be validated live).
6. Optional host Xbox audio/video -> separate guest RTCRtpSenders, gated by host
   checkboxes and guest playback consent. **Host spoken mic is not returned to
   the guest in V1.2/V1.3.**
7. No controller grant is implied by a shared voice or video session.

## Changes

- The main renderer caches the original Xbox `RTCRtpSender` by player+original
  mic track identity. It can be found again after it has been replaced by
  a mixed output track. The cache is invalidated when the Xbox player or
  original mic track changes, and after the Xbox microphone is disabled.
- The mixer checks its lifecycle generation and sender ownership immediately
  before `replaceTrack`. It uses a 2.5-second `AudioContext.resume()` deadline
  instead of awaiting a suspended context indefinitely.
- The host can explicitly **Retry Xbox microphone mixing**, which silences
  the previous guest input, attempts to restore the original host mic, then
  makes a fresh mixer without recreating the guest invitation.
- Aggregate telemetry is sampled from guest `RTCPeerConnection.getStats()`
  outbound audio, host peer inbound audio, and the Xbox sender
  `RTCRtpSender.getStats()` outbound audio. Counters and audio energy are
  reported as per-sample differences, with unavailable/sampling/no-packets
  states rather than falsely calling the session live.
- A read-only analyser on the mixed Web Audio output reports its RMS.
  It does not route voice into local speakers.
- Host and guest can **Copy safe diagnostic report**. Reports contain only
  enum/boolean/numeric states, RTP packet/byte deltas, and RMS/level values.
  They NEVER serialize the raw RTCStatsReport, ICE candidates, SDP, auth
  state, SSRC IDs, network addresses, device labels, or audio.
- Host may share video without audio or audio without video when the
  corresponding source track is independently available.
- Persistent Stream-view status remains advisory and explicitly distinguishes
  attached mixer from independently confirmed in-game audio.

## Status semantics

| Measurement | Proven | Not proven |
|---|---|---|
| Guest mic live | Local media track exists | Host hears samples |
| Guest outbound packets moving | Guest WebRTC emitted packets | Packets reached host |
| Host inbound packets moving | Host WebRTC received guest packets | Host mixer is running |
| Mixed output RMS | Web Audio mix has signal energy | Correct Xbox RTP encoding |
| Xbox audio sender attached | Sender references mixed track | Xbox receiving voice |
| Xbox outbound packets moving | Local Xbox sender emitted audio RTP | In-game listener audible |
| Third-party in-game listener hears guest | Actual acceptance of guest voice | Universality across games/networks |

Silence can legitimately yield zero audio energy even while RTP packets move.
Unsupported browser stats yield "Unavailable," not zero or an invented pass.
Sampling failures are advisory and never change permissions.

## Regression checks

On JPCMAIN Windows PowerShell inside the worktree:

```powershell
npm.cmd run typecheck
npm.cmd run build
node scripts/shared-voice-signaling-smoke.mjs
node scripts/shared-voice-ice-smoke.mjs
node scripts/shared-voice-host-flow-smoke.mjs
node scripts/shared-voice-audio-path-smoke.mjs
npm.cmd run test:recording-mp4
npm.cmd run test:recording-finalization
```

The smoke tests include suspended AudioContext deadline + explicit retry,
Xbox mic disabled/re-enabled without losing the guest peer, mixed track
restoration on host end, opt-in game media, synthetic RTP counters, audio
energy, counter resets, and diagnostic privacy. Those tests **do not use
live Xbox or the two physical Windows machines**.

## Minimal two-PC acceptance

After building *both* CaptureLink installations from the same experimental
source (do not merge yet):

1. Host establishes Xbox Remote Play, enables host mic, creates invite;
   guest joins from laptop and supplies response. Check both show connected.
2. Speak into guest mic for several seconds; view the guest local meter
   and **Guest packets sent**. Keep speaker muted or use headphones to
   avoid feedback.
3. Host observes **Guest packets received**, **Audio mixer: Attached · running**,
   **Mixed output level**, and **Xbox packets sent**. If mixer is not attached,
   press **Retry Xbox microphone mixing** once on the host.
4. Copy the safe diagnostic report on each side. Share just these text
   reports if a stage is missing; no raw signaling strings or microphone
   recordings.
5. If every stage moves, ask a separate in-game Xbox listener whether
   they hear **both host and guest**. Only that determines real Xbox
   voice acceptance. Repeat with guest mute and host mute.
6. Verify Xbox mic off/on, guest Leave, host End, optional game audio and
   video, fullscreen status, and unaffected controller/recording.

## Known limits and product roadmap

- This is STUN-only, manual two-code signaling, and one guest. TURN and
  authenticated, expiring invitation links are future work. Passing same-LAN
  tests does not prove cross-network connectivity.
- Guest is heard under the **host's Xbox microphone/account identity**,
  not as a distinct Xbox player.
- V1.3 keeps the existing guest join/mute, host mute/volume, and optional
  video/game-audio features. A product-facing Shared Session UX should later
  consolidate role-based permissions (watch, listen, talk, controller),
  explicit guest mic consent/default-muted preference, always-visible mute
  affordance, device selector, participant list, and transparent recovery.
- A guest currently gets Xbox game audio when shared, **not guaranteed direct
  host speaking voice**; genuine conversational full duplex would need
  consented host microphone return and echo/feedback handling.
- Audio track forwarding and game capture can have legal/privacy implications;
  obtain consent for shared in-game voices and recordings. Controller access
  must remain separately authorized.
- Windows Electron runtime/typecheck/build, actual Xbox RTP behavior, game
  chat, FFmpeg release licensing, and installer signing are **not validated
  by this offline source patch**.
