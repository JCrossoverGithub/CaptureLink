# CaptureLink Recording

## Purpose

Recording is the core use case that led to CaptureLink.

CaptureLink records the media already received by an active Xbox Remote Play session rather than creating a separate Xbox capture negotiation.

## Incoming Xbox media

During an active session, the player supplies the renderer with Xbox media tracks.

The recording path consumes those received tracks.

For video recording:

```text
Xbox video
    +
Xbox audio
    |
    v
MediaRecorder
```

For audio recording:

```text
Xbox audio
    |
    v
MediaRecorder
```

In tested configurations, incoming in-game voice chat is present in the received Xbox audio and therefore becomes part of recordings containing that audio track.

Party Chat has not been independently validated.

## Local microphone

CaptureLink can optionally add the user's local microphone to the saved recording.

The microphone has two conceptually separate uses:

1. Remote Play microphone/chat uplink
2. saved-recording microphone mix

The recording path provides its own microphone gain.

This lets a user balance their voice against incoming Xbox audio without intentionally changing the microphone level transmitted to other players.

## Playback controls versus recording

Local presentation controls are not intended to alter the underlying Xbox tracks captured by the recorder.

This includes:

- application playback volume
- local mute
- speaker/output-device routing

The goal is for a user to be able to mute or reroute local listening without accidentally creating a silent recording.

## Native format

CaptureLink uses Chromium's `MediaRecorder`.

The native master format is WebM.

WebM is kept as the original recording even when the user later exports to another format.

This avoids adding real-time transcoding complexity to the capture path.

## Disk-backed recording

Early recording approaches that retain an entire session in renderer memory do not scale well to long recordings.

CaptureLink instead streams recording chunks through the preload IPC boundary to the Electron main process.

Conceptually:

```text
MediaRecorder
     |
     | Blob chunks
     v
renderer
     |
     | IPC
     v
main process
     |
     | append
     v
WebM file
```

This keeps recording memory usage from scaling directly with session duration.

## Disk-space checks

CaptureLink checks storage availability before recording and while recording is active.

This is intended to fail safely before the filesystem becomes completely exhausted.

Recording UI also surfaces useful size/storage state.

## Disconnect and shutdown behavior

An unexpected Remote Play disconnect should stop/finalize an active recording rather than silently continuing an invalid capture session.

Closing CaptureLink during recording requires recording-aware handling.

The design favors preserving media bytes already written to disk wherever practical.

## Recording library

Finalized recordings are indexed locally.

A recording entry can contain:

- ID
- audio/video type
- creation time
- duration
- file size
- file path
- file existence state

The library supports:

- Open
- Show Folder
- Rename
- Delete
- Export Original
- converted export

If a recording file is removed outside CaptureLink, the UI should represent it as missing instead of failing unexpectedly.

## Export

CaptureLink treats MP4, MP3, and WAV as post-recording delivery formats.

The original capture remains WebM.

See:

```text
docs/EXPORTS.md
```

## Audio/video synchronization

Long-session synchronization matters because audio drift in the original capture-card workflow was one of the problems that motivated CaptureLink.

CaptureLink therefore exposes WebRTC timing diagnostics.

The application supports:

- manual local audio resync
- conservative automatic local audio resync
- A/V timing information
- jitter-buffer timing information

The resynchronization path is aimed at local playback behavior and does not intentionally mutate the media already being captured from the Remote Play tracks.

MP4 export also preserves captured frame timing so a nominal WebM time base is not mistaken for the true gameplay frame rate.

## Recording test checklist

Before release, test at least:

### Audio-only

- start recording
- play normal game audio
- receive in-game voice chat if available
- optionally enable local microphone mix
- stop recording
- play resulting WebM
- verify expected sources

### Video

- start video recording
- exercise moving gameplay
- generate varied audio
- stop recording
- play WebM
- verify video continuity
- verify audio
- verify A/V synchronization

### Long session

- record for an extended period
- monitor storage
- observe memory behavior
- inspect WebRTC diagnostics
- verify final file
- review synchronization near the end of the session

### Failure behavior

Test:

- Remote Play disconnect during recording
- attempted app close during recording
- low-space behavior
- export failure
- missing recording file

No failure in a derived export should destroy the WebM master.

## Privacy

Recordings may contain other people's voices.

A future public release should make this clear to users and should not imply that CaptureLink can determine whether recording is legally permitted or whether another participant has consented.

See:

```text
docs/LEGAL_REVIEW.md
```

## RQ1 MP4 export hardening (2026-10-25)

Video capture continues to be WebM. **MP4 is not yet the automatic post-recording default**; this change prepares that feature without weakening capture recovery.

- Windows release builds explicitly include a verified `ffmpeg.exe` at `resources/bin/ffmpeg.exe`.
- `npm run dist:win` runs a preflight checking the binary and required H.264/AAC encoders. Run `npm run verify:ffmpeg` on Windows to check it independently.
- Export requires true `libx264` H.264 and AAC; older MPEG-4 Part 2 is not silently substituted.
- Conversion writes a unique temporary sibling file and moves it to the chosen destination only after successful encoding. Failed conversions remove only their temporary file, preserving both the WebM source and any existing destination.
- `node scripts/recording-mp4-smoke.mjs` exercises the installed FFmpeg binary on synthetic five-second WebM with audio and verifies MP4 codecs, duration, seeking, and front-loaded `moov` metadata.

**Before distributing installer builds:** examine the **exact** bundled FFmpeg binary's license, compilation options, corresponding-source/distribution obligations, and bundled license notices; H.264/AAC encoder inclusion can have additional obligations. Verify an installed CaptureLink copy on a clean Windows machine with no FFmpeg on `PATH`.

The next milestone will implement automatic post-recording MP4 finalization with WebM master retention and recording-library lifecycle support. It must handle shutdown, rename/delete, retry after failure, and interrupted conversions.


## Automatic MP4 finalization (RQ2)

Video recording now chooses the finished `.mp4` destination before capture. The
live MediaRecorder still writes a unique original WebM file to the adjacent
`.capturelink-sources/` folder. After the recorder stops, CaptureLink registers
that source in the library, runs FFmpeg H.264/AAC conversion, and updates the
same library entry to the playable, seekable MP4 on success. If FFmpeg fails,
the library retains the WebM source and displays the conversion warning. No
user recording is discarded because conversion fails.

The original WebM remains available through **Export WebM source**. Deleting an
MP4 recording in the library deletes its companion source after confirmation;
renaming changes only the primary MP4 name, since the master filename uses the
stable recording ID. For an older WebM recording, the original action continues
to export the source itself. Existing recording library records are supported.

Closing CaptureLink while MP4 finalization is in progress defers closing until
conversion finishes. This version does not attempt background conversion on
next launch after a power outage or process crash; the original WebM remains on
disk in that case and can be recovered manually. Installed application FFmpeg
verification and licensing review remain release requirements.
