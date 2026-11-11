# CaptureLink Shared Session V1.5 — test preparation

Status: **experimental and unmerged**. This patch requires **V1.4 plus the one-line TypeScript nullability fix** in `src/renderer/src/main.ts`; do not apply it to main or older V1.3.1 sources. V1.4 guest-only Xbox microphone is still awaiting live Xbox acceptance because xHome was returning HTTP 504 and Microsoft's Remote Play browser client also failed.

## Improvements made

1. **Stream view → Shared Session** groups the *existing* Direct Friend controller and Shared Microphone controls into collapsible panels. Both underlying peers and their independent consent models remain intact. The current Direct invite still uses two-code manual signaling; voice uses a separate pair. This is not yet a single-code, server-signaled system.
2. **Controller and microphone coexistence for a guest**: the guest may join the voice peer while a Friend controller/gameplay session is active. Voice media will not take over the controller's gameplay video surface. Host still has to authorize Xbox voice explicitly; guest can still mute and stop voice.
3. **Default-hidden Friend diagnostics**: the dock Diagnostics button (host or guest) shows/hides the overlay, the overlay has a Hide button, and its visibility preference persists. Friend stats remain in Settings → WebRTC session health → Friend P2P diagnostics (live), even when the overlay is hidden.
4. **Picture-proportional stream card**: during Friend sessions, the card sizes to the video's intrinsic aspect ratio rather than expanding a forced grid row. The `contain` video policy stays in place, so game edges/HUD aren't cropped. The app retains ordinary Xbox and fullscreen layouts outside the Friend-session layout.
5. **End shared access** button ends the existing voice and controller connections. This does not disconnect the host's Xbox Remote Play; the app's separate Disconnect control handles Xbox.

## Repeatable Windows verification (Windows PowerShell, not WSL)

```powershell
cd C:\Users\thede\projects\CaptureLink-shared-mic
npm.cmd run typecheck
npm.cmd run build
node scripts/shared-session-hub-smoke.mjs
node scripts/shared-voice-signaling-smoke.mjs
node scripts/shared-voice-ice-smoke.mjs
node scripts/shared-voice-host-flow-smoke.mjs
node scripts/shared-voice-audio-path-smoke.mjs
node scripts/shared-voice-guest-uplink-smoke.mjs
npm.cmd run test:recording-mp4
npm.cmd run test:recording-finalization
```

**Test in Xbox only after Microsoft's official Remote Play works**. Rebuild/install **this same source version on the guest laptop** before checking controller + voice simultaneously. Existing voice-only V1.3.1 doesn't include the guest-side controller/voice coexisting gate.

## One focused two-PC / Xbox acceptance

1. Confirm Microsoft's browser Remote Play can start, then start host CaptureLink on JPCMAIN. On XLAPTOPX, start this same V1.5 build and keep local Xbox disconnected.
2. Both go to **Stream → Shared Session → Controller and gameplay**. Host selects Shared Controller (or Player 2) **before** inviting, clicks Host Direct, sends the clipboard invite privately. Guest clicks Join from Clipboard, sends the response. Host copies response and its clipboard monitor should accept automatically.
3. Watch gameplay on both machines. Resize each application to verify no oversized fixed black bands and no crop. Test fullscreen and return to windowed. Toggle Diagnostics on both, then Hide; confirm Settings retains metrics. Test guest controller input; for Shared Controller, host physical controller must be connected to JPCMAIN, not directly to Xbox, if you expect it to merge with guest input.
4. Open **Microphone and voice permissions** on both. Create and exchange the separate voice invitation/response. After guest voice connects, host explicitly authorizes **Allow friend to speak through my Xbox** and guest unmutes. Keep host physical mic off. An independent Xbox Party listener confirms whether guest is audible.
5. Test host mic enable/disable, guest mute, and host revoke. **End shared access** should terminate both guest connections without signing out or ending the Xbox session. Verify normal Xbox video, controller, recording, and audio still work.

Do not call this Xbox-accepted until the actual end-to-end test succeeds. The new layout has been checked in headless Chromium with simulated card geometry and multiple viewport/aspect ratios; it has **not** been validated against a real xHome session or complete Windows Electron runtime.

## Follow-up architecture, intentionally deferred

**Single invite code / session token** would require a versioned combined signaling envelope and robust atomic lifecycle handling for controller/voice peers, ideally paired with a small authenticated signaling and TURN service. Do not implicitly grant mic/controller permission from joining a video share. Keep the present private peer handshakes until a new protocol passes cross-version, disconnect, privacy, and network-failure testing. A separate future task should consolidate or replace the duplicate P2P transports instead of synthesizing a fragile UI-driven code merger.
