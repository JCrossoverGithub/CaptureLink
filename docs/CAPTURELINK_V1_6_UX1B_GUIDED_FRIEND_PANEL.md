# CaptureLink V1.6 UX1b — Guided Friend panel

**Base:** V1.6 UX1a on `feature/unified-session-ux1`, HEAD `0ce9166`; user-installed UX1a source changes uncommitted.
**Status:** Source patch. Tested with isolated TypeScript and Chromium interaction fixtures. Windows production build and real Xbox testing required.

## User-facing changes

- Opening Friends shows only **Invite a friend**, **Join a friend**, and a concise session status. The previous controller and microphone diagnostic cards do not render on the landing page.
- Invite/join selection opens a short activity picker. The host can choose watch/listen, voice, and controller. Controller selection offers Shared Controller or Player 2. No Xbox account authentication is required merely to join as a guest.
- Continue opens *one connection setup at a time*: controller first, then separate microphone/media signaling when selected. No false single-code implication: the V1.5 controller and voice protocols remain independent.
- Only appropriate host or guest voice controls are shown within the guided step. Controller statistics and audio diagnostics remain available under an advanced disclosure.
- A compact **Your session** page shows controller workflow and guest mixer indicators, carefully distinguishing media attachment from true in-game audibility.
- The underlying V1.5 DOM and event listeners are preserved and moved, not duplicated. Nothing automatically opens a microphone, starts controller P2P, or authorizes Xbox voice in response to merely checking a preference.

## Important current limitations (do not hide these from users)

- The activity switches choose *which setup steps* to show. Actual Xbox voice permission and video/audio sharing remain in the established connection controls. This patch does **not** replace the two independent signaling exchanges or introduce verified participant identity binding.
- **Watch-only** currently still uses the voice/media transport; guest joining that path may request microphone permission. This must be corrected in a separate transport/API change before claiming no-mic watch-only joining.
- The host still controls Xbox voice forwarding and controller authorization; the guest retains local microphone mute.
- Existing status information is advisory. Controller workflow started does not prove a connected Xbox gamepad; mixer attached does not prove audibility in Party chat.

## Windows PowerShell gates

```powershell
cd C:\Users\thede\projects\CaptureLink-unified-session
npm.cmd run typecheck
npm.cmd run build
node scripts/unified-session-ux1-smoke.mjs
node scripts/unified-session-ux1b-smoke.mjs
node scripts/shared-session-hub-smoke.mjs
node scripts/shared-voice-signaling-smoke.mjs
node scripts/shared-voice-ice-smoke.mjs
node scripts/shared-voice-host-flow-smoke.mjs
node scripts/shared-voice-audio-path-smoke.mjs
node scripts/shared-voice-guest-uplink-smoke.mjs
npm.cmd run test:recording-mp4
npm.cmd run test:recording-finalization
```

Then run `npm.cmd run dev` and manually inspect Friend landing, invite/join, keyboard focus/Escape, Shared Controller vs Player 2 selection, separately authorized Xbox voice, advanced readouts, fullscreen, video stage aspect, and safe disconnect. Host and guest must each use the current build for a full experience comparison.

## UX2 next milestone

Implement a normalized session/participant model and signed single-invite protocol with host approval, consent, revocation, and TURN-backed connectivity. Avoid conflating peer connections or accounts before verification.
