# Immediate Next Steps

CaptureLink should move in small, reversible checkpoints.

## Checkpoint 1 — Run the clean Electron shell

```bash
npm install
npm run dev
```

Confirm that a native CaptureLink window opens and that DevTools/console show no startup errors.

## Checkpoint 2 — Bring over authentication only

Use the XboxLink spike as a behavioral reference, but implement authentication behind a CaptureLink-owned module. Do not copy token files into the repository.

Exit condition: CaptureLink can complete Microsoft/Xbox sign-in and report an authenticated state.

## Checkpoint 3 — Console discovery

Implement the equivalent of the proven `/v6/servers/home` discovery flow.

Exit condition: the UI lists the user's Xbox with device name, console type, and power state.

## Checkpoint 4 — Remote Play parity

Establish the xHome session inside Electron's Chromium renderer. Preserve the response-polling behavior learned during the spike and verify the final SDP/ICE response semantically rather than assuming any non-204 response is ready.

Exit condition:

- video visible
- game audio audible
- incoming in-game chat audible

## Checkpoint 5 — Freeze parity

Only after Checkpoint 4 passes should recording work begin.

The first recording implementation should consume the already-received `MediaStream`; it should not modify Xbox protocol negotiation.


## Checkpoint 6 — Session controls and diagnostics

Add controller attach/detach, microphone chat renegotiation, local stream volume/mute, and live WebRTC diagnostics without changing the proven xHome media path.

Exit condition:

- controller or keyboard input reaches the Xbox
- microphone can be enabled and disabled during a session
- another player can confirm the microphone uplink is audible
- local stream mute/volume works
- diagnostics report connection, audio, and video statistics

Recording remains disabled until this checkpoint is stable.


## Checkpoint 7 — Audio recording

Record the already-received Xbox audio MediaStream without changing xHome or WebRTC negotiation. CaptureLink records the raw incoming audio track, so local speaker mute/volume controls do not alter the saved recording.

Exit condition:

- audio-only recording can start and stop during Remote Play
- a save dialog writes the recording as WebM/Opus
- the saved file contains game audio
- the saved file contains incoming in-game chat
- recording state and elapsed time are obvious in the UI
