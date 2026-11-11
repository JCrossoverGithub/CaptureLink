# Shared Microphone — V1 (internal experimental spike)

**V1.1 experimental update:** Invite creation is independent of Xbox microphone state; friend connection persists while Xbox mic is toggled. Manual signaling collects a bounded usable ICE snapshot rather than waiting indefinitely for STUN completion. Cross-network connection remains unverified; TURN relay is not included.

**Purpose.** One remote CaptureLink guest can send microphone audio into a host CaptureLink session; the host mixes it with their selected local microphone and sends the combined signal through the **already-established Xbox Remote Play microphone sender**. The guest does not connect to Xbox or receive gameplay video/controller permissions.

**Do not publish as a generally available feature yet.** This is a P2P proof requiring manual SDP exchange and a real two-PC/Xbox listening test. Do not package it as an accepted feature until the acceptance matrix below passes. The existing FFmpeg redistribution/license and unsigned-installer release gates are separately still open.

## Architecture

- Separate `voice-sharing` module and versioned signal prefix `CAPTURELINK-VOICE-V1:`. Existing Friend Controller signaling is untouched.
- One host/one guest. Host offers `audio/recvonly` with a WebRTC data channel used *only* to signal session closure; guest supplies one `audio` track from `getUserMedia()`.
- Host shares a single session invitation privately, guest returns a single answer privately. `RTCPeerConnection` uses public STUN only; **no TURN relay** in V1, so some NAT combinations cannot connect.
- Host audio mixer includes the *existing local microphone track* and the *guest received track*, with independent guest gain/mute. When the guest track arrives, the host swaps **only the existing Xbox microphone sender** with `RTCRtpSender.replaceTrack`. The original local microphone source and Xbox media/SDP are preserved.
- On friend leave, host stop, window close, or sustained peer disconnect, close peer and microphone media and restore/disable the outgoing track as appropriate. Turning Xbox microphone **off** detaches the mixed Xbox uplink but keeps the friend peer connected. Turning Xbox microphone **on** attempts to attach the guest to the newly live Xbox sender. Guest hears no Xbox audio from this voice-only link.
- No new cloud infrastructure, backend IPC, credential sharing, persistent voice data, microphone capture before clicking Join, or session-code feature.

## Operator procedure

1. On **host JPCMAIN**, open CaptureLink Audio; **you can create a voice invite before connecting to Xbox or enabling the Xbox microphone**. To test game chat broadcast later, connect Xbox and enable the microphone.
2. On host Audio panel → **Shared Microphone** → **Create voice invite**, then **Copy invite** and privately send it to your friend (for the spike, a Discord DM is convenient).
3. On **guest XLAPTOPX**, run the *same V1 CaptureLink build*. The guest need **not** sign into Xbox; open the Audio panel, select/test microphone if needed, paste the invite, then click **Join with my microphone**. The button explicitly requests microphone permission.
4. On guest, **Copy response** and privately send it back. On host, paste it in **Paste friend's voice response** and click **Accept voice response**.
5. Both should show **Connected**. If Xbox mic is still disabled, voice goes only to the host CaptureLink peer, **not Xbox**. Enable Xbox mic when ready, then confirm the mixer attaches. Host can adjust guest volume or use **Mute friend to Xbox**.
6. Have an **independent Xbox game-chat participant** verify they hear host only, then friend only, then both simultaneously. Test host mute, guest Leave, host End, and Xbox microphone Disable. Audio must not loop back into the friend's headphones or into Xbox game sound.

### Acceptance matrix (not yet executed)

- [ ] Both V1 apps build and launch on Windows independently.
- [ ] Host local mic works normally before invitation.
- [ ] Guest can join without Xbox sign-in and without controller/video permissions.
- [ ] Remote mic crosses the network; connected peer reported on both ends.
- [ ] Independent Xbox participant audibly confirms host + guest voices, including overlap.
- [ ] Guest gain/mute changes only guest contribution.
- [ ] Guest Leave and host End restore host mic-only behavior and release guest microphone.
- [ ] Disable Xbox Mic stops *Xbox transmission*, but retains the voice guest connection; re-enable mic reattaches without a new invitation. Xbox disconnect and app exit must not leak outbound mic into Xbox.
- [ ] Recovery after repeated invitation/guest reconnection and at least one 15-minute session.
- [ ] No new failure to Xbox gameplay, controllers, recorded MP4 or normal Friend Mode.

## Threats/limitations

- **Privacy:** Invite and answer include WebRTC ICE/network metadata (including possible local/public IP candidates). Share only with trusted parties, never paste into a public Discord channel or issue tracker.
- **Trust:** V1 has no accounts or identity service. An invitation grants one peer the ability to contribute voice to the **host's Xbox mic** after the host explicitly accepts the matching answer.
- **NAT:** STUN-only signaling is for testing. V1.1 waits briefly for STUN-reflexive candidates and can produce a local-only candidate offer if STUN does not respond; that may work on the same LAN but **will not reliably connect across the Internet**. The UI calls out local-only invites. Future version needs authenticated session codes and a TURN relay.
- **Audio:** `replaceTrack` may reject if Xbox's negotiated audio sender cannot accept the mixed output format. This is explicitly unverified until the two-PC Xbox test.
- **Routing:** All voices appear as the host's single microphone/gamertag. Game/chat privacy policies apply; all guests must understand they are being rebroadcast.
- **Recording:** This feature does not intentionally change CaptureLink's recording sources. Verify resulting recordings before making any promises about whether guest voice is included.
- **Licensing/security:** Existing FFmpeg licensing, signing and dependencies are independent release blockers; this spike does not clear them.

## Tests

`npm.cmd run typecheck`, `npm.cmd run build`, `node scripts/shared-voice-signaling-smoke.mjs`, `node scripts/shared-voice-ice-smoke.mjs`, `node scripts/shared-voice-host-flow-smoke.mjs`, plus the manual two-PC matrix above. Do **not** merge the V1 spike without a successful real Xbox game-chat listening test.
