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

## Checkpoint 8 — Video + audio recording

Combine the live Xbox video track with the same incoming audio stream already proven by the audio-only recorder. Keep Remote Play signalling unchanged and record the received tracks with Chromium `MediaRecorder`.

Exit condition:

- audio-only recording still works
- video recording can start and stop during Remote Play
- a save dialog writes the recording as WebM video
- the saved video contains Xbox gameplay video
- the saved video contains game audio and incoming in-game chat
- audio and video remain synchronized during a real gameplay sample
- local mute, volume, and speaker routing do not alter the saved media

MP4/MP3/WAV are export targets for a later milestone; M4 keeps WebM as the native capture container.

## Checkpoint 9 — Recording hardening

Move MediaRecorder output off the renderer heap by writing one-second chunks through the Electron main process directly to the user-selected file. Choose the destination before recording starts so long sessions do not require a second full-file copy.

Exit condition:

- recording memory usage no longer scales with recording duration
- file size and remaining disk space are visible while recording
- CaptureLink checks free space before recording and before each chunk write
- an unexpected WebRTC disconnect stops/finalizes the current recording
- closing CaptureLink during recording requires an explicit stop-and-close choice
- renderer failure preserves the bytes already written instead of discarding the entire session
- no hidden temporary recording file is required

With M4 hardened, the next product milestone is the recording library and export layer. MP4, MP3, and WAV remain export targets rather than live-capture formats.


## Checkpoint 10 — Recording library

Persist metadata for finalized CaptureLink recordings and expose a desktop library without changing the capture pipeline.

Exit condition:

- completed recordings appear automatically after finalization
- library shows audio/video type, date, duration, size, and full path
- Open launches the recording with the system default app
- Show Folder reveals the file in the desktop file manager
- Rename updates the file on disk and the library index
- Delete requires confirmation and removes the file plus library entry
- Export Original copies the native WebM recording to a user-selected location
- missing files are shown explicitly instead of crashing the library

The next checkpoint adds common-format transcoding: MP4 for video and MP3/WAV for audio.
