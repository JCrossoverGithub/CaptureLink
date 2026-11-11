# CaptureLink Shared Session V1.4 — Independent Guest Xbox Voice

**Status:** Experimental, intentionally unmerged. Base: V1.3.1 diagnostics on `feature/shared-microphone-v1` (`8736837d1ad3ba2fdb17541abd629801c2180139`).

## Purpose

Host previously had to enable the physical microphone to establish an Xbox microphone RTP sender. V1.4 separates the host microphone capture from the Xbox chat uplink. The friend may speak into the host's Xbox chat identity while the host's physical microphone remains off, **only after the host explicitly authorizes it for the current voice session**.

## UI and permission model

1. Host connects CaptureLink to Xbox and creates a Shared Microphone invite.
2. Friend joins from another CaptureLink installation and exchanges the two private invite/response codes.
3. Host checks **Allow friend to speak through my Xbox** in Audio > Shared Microphone. Default is **off** for every new host session.
4. With the guest's RTC audio track connected, the host automatically negotiates an Xbox audio uplink using a synthetic silent Web Audio track. It does **not** call `getUserMedia` on the host.
5. Friend controls their own microphone through **Mute my microphone to host**. Host may separately check **Mute friend to Xbox** or revoke **Allow friend**; guest media transport may remain connected for optional game video/audio.
6. Host **Enable Microphone** adds the selected physical mic to the existing shared voice mixer; **Disable Microphone** removes only the host's mic while guest forwarding continues.
7. Ending the session cleans up the guest-only source and, if host mic is active, restores the host's track. Otherwise the Xbox mic transport is stopped.

## Privacy and security

- Guest's voice is transmitted as the **host's Xbox account**. The Xbox does not represent this guest as a separate signed-in participant.
- Permissions are per-session and off by default. Host can revoke voice without ending game-media viewing.
- Silent transport is generated in Web Audio, not from any capture device. It is not proof of in-game audibility.
- Existing RTP diagnostics report counters/energy and control state only, without raw audio, signaling SDP, IP addresses, ICE candidates, device names or authentication secrets.
- Screen/video sharing remains separate and opt-in; controller permissions remain separate.

## Automated checks

Run on **Windows PowerShell** from the linked worktree:

```powershell
npm.cmd run typecheck
npm.cmd run build
node scripts/shared-voice-signaling-smoke.mjs
node scripts/shared-voice-ice-smoke.mjs
node scripts/shared-voice-host-flow-smoke.mjs
node scripts/shared-voice-audio-path-smoke.mjs
node scripts/shared-voice-guest-uplink-smoke.mjs
npm.cmd run test:recording-mp4
npm.cmd run test:recording-finalization
```

If these pass, conduct one short real-Xbox acceptance test: host mic **off**, guest voice permitted, guest mic **unmuted**, guest speaks; an independent Xbox Party listener must hear the friend. Then mute guest on laptop, revoke permission on host, toggle host mic on and back off, disconnect guest, and confirm status and audio behavior. Do not infer success from a green connection indicator or RTP packets alone. Do not merge before live acceptance.

### Technical limitation

The synthetic source and SDP exchange follow the same API flow as the already-working physical host mic, but **Xbox acceptance of an initially silent source has not been proven locally**. The source-derived harness uses a mock Xbox player and cannot establish in-game reception, network traversal, or live WebRTC behaviors. The one-guest/STUN-only/manual signaling limitations also remain.
