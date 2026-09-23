# CaptureLink Project History

## The problem

CaptureLink did not begin as an attempt to build an Xbox Remote Play client.

It began with a friend asking for help with a much simpler problem:

**How do I record Xbox gameplay and game-chat audio at the same time?**

With a software background, the initial assumption was that this should already be easy.

It was not.

## The workaround rabbit hole

The first research focused on ordinary gameplay recording.

There were software workarounds. An Xbox stream could be brought to a PC and recorded there, including through applications such as Discord.

That solved only part of the problem.

Gameplay video and normal game audio could be captured, but the desired game-chat audio was missing.

The next obvious answer was the same one console players had used for years: a capture card.

A capture card solved the HDMI video and game-audio problem, but game-chat audio still did not simply appear in the capture.

The working hardware solution required audio to be routed physically from the Xbox controller into the capture setup.

That created another problem: the headset being used was wireless.

A cheap wired headset was purchased simply to verify the routing setup. It worked, proving that gameplay video, game audio, and game-chat audio could finally be captured together.

But the resulting setup was exactly the kind of system the original question was trying to avoid: additional hardware, additional cables, headset compromises, controller-side audio routing, and more opportunities for failure.

Then another issue appeared.

During longer recordings, audio could progressively fall out of synchronization with the video. The practical workaround was to periodically stop and restart the recording before the delay became too noticeable.

At that point the question changed.

Instead of asking how to make the capture-card workflow less painful, the project started asking why all of this hardware was necessary in the first place.

## The key observation

Xbox already supports Remote Play.

A Remote Play client must receive the console's video and audio somehow. If the same voice audio the player hears during a game is also present in that Remote Play stream, then a computer already has access to the media that the capture-card setup was attempting to reconstruct externally.

That possibility became the core research question.

Research into the Xbox streaming ecosystem led to the xHome Remote Play path and to open-source projects that had already implemented important pieces of Xbox authentication and streaming.

The most important reference was `xbox-xcloud-player` by Jim Kroon / UnknownSKL, an open-source TypeScript project capable of connecting to Xbox xCloud/xHome streams through WebRTC.

Rather than reverse-engineering every part of the protocol independently, the project used that prior work to establish whether the product idea was technically viable.

## XboxLink: the protocol spike

The first implementation was called **XboxLink**.

XboxLink was intentionally a proof of concept rather than a polished application. Its job was to answer a small number of high-risk questions:

1. Can the user authenticate with Microsoft/Xbox?
2. Can the user's physical Xbox be discovered?
3. Can an xHome Remote Play session be created?
4. Can a desktop Chromium client negotiate the WebRTC session?
5. Does the PC receive usable Xbox video?
6. Does the PC receive Xbox game audio?
7. Most importantly, does incoming in-game voice chat appear in the same received audio?

The spike produced several important findings.

Xbox authentication worked.

The physical Xbox could be discovered.

An xHome session could be created and provisioned.

Chromium/Edge could successfully negotiate and render the Remote Play WebRTC session. Firefox failed during SDP exchange in the tested implementation, making a Chromium-based desktop runtime the safer target.

Video worked.

Game audio worked.

And the product-defining result was confirmed: **incoming in-game voice chat was audible in the Remote Play audio received by the PC in the tested configuration.**

That meant CaptureLink did not need to invent a separate voice interception subsystem merely to capture what the user was already hearing through Remote Play.

The proof of concept had answered the question.

## From XboxLink to CaptureLink

Once the media path was proven, development moved away from treating the experimental checkout as a product.

The application was renamed **CaptureLink** and rebuilt as a standalone Electron + TypeScript desktop application.

Electron was selected in part because the protocol spike had already demonstrated that Chromium could successfully negotiate the Xbox WebRTC session.

The goal was no longer just:

> Can this stream work?

It became:

> Can this be turned into a reliable, understandable Windows desktop application for viewing and recording the stream?

## Building the application

CaptureLink developed incrementally around the known-good Remote Play path.

### Authentication and console discovery

Microsoft/Xbox authentication was integrated through `xal-node`.

Authentication data is stored outside the repository in the Electron application-data area.

Console discovery was then added so the application could locate Xbox consoles available to the signed-in account.

### xHome session control

CaptureLink implemented its application-owned xHome orchestration around the streaming tokens and session endpoints required to start a Remote Play session.

The application handles:

- session creation
- session-state polling
- connection token delivery
- SDP exchange
- ICE exchange
- microphone/chat SDP renegotiation
- keepalive traffic
- clean session shutdown

One lesson carried directly from the original spike was that an HTTP response was not enough to assume SDP or ICE negotiation data was ready. CaptureLink waits for semantically usable exchange data before proceeding.

### WebRTC player integration

CaptureLink uses a pinned browser bundle from `xbox-xcloud-player` for the browser-side player/control implementation.

That upstream work provides important Remote Play/WebRTC functionality, including the player, media connection behavior, control channels, gamepad integration, and chat/microphone functionality.

CaptureLink wraps that capability in its own desktop application architecture and product workflow rather than claiming the underlying player implementation as original work.

### Session controls

With basic streaming stable, CaptureLink added controls around the live session:

- controller attach/detach
- keyboard support exposed by the player adapter
- microphone start/stop
- microphone device selection
- microphone input meter
- microphone monitor/test behavior
- speaker/output selection where available
- local playback mute
- local playback volume
- connection diagnostics

Microphone chat uplink was validated with another player during development.

### Recording

The next goal was the original reason for the project.

CaptureLink records the media tracks already received from Xbox instead of changing the Remote Play negotiation to create a separate capture stream.

The native capture path uses Chromium's `MediaRecorder` and WebM.

Audio-only recording was implemented first.

Video plus audio recording followed.

The implementation then moved away from keeping an entire recording in renderer memory. Recording data is written in chunks through Electron IPC to an open file in the main process, allowing longer recordings without memory usage growing linearly with recording duration.

CaptureLink also checks available storage and preserves already-written recording data when possible if a session ends unexpectedly.

### Microphone recording mix

The user's local microphone and the microphone audio sent back to Xbox are separate concerns from the incoming Xbox audio.

CaptureLink can optionally include the local microphone in the saved recording.

The recording path creates an audio mix containing the incoming Xbox audio plus the local microphone source. A separate recording-only microphone gain lets the user balance their own voice in the recording without changing the level sent to other players through Xbox.

### Recording library

Completed recordings are indexed locally and surfaced in a recording library.

The library supports:

- recording metadata
- opening recordings
- revealing recordings in the file manager
- renaming
- deletion
- original-file export
- converted exports

WebM remains the capture master rather than forcing real-time capture into a more complicated delivery format.

### MP4, MP3, and WAV export

FFmpeg was added as a post-recording conversion layer.

Video recordings can be exported to MP4.

Audio recordings can be exported to MP3 or WAV.

The original WebM can also be copied without conversion.

For MP4, CaptureLink preserves the captured frame timing rather than allowing FFmpeg to blindly interpret Chromium MediaRecorder's nominal WebM time base as a fixed high frame rate.

### Audio drift diagnostics and recovery

The capture-card setup that originally motivated the project had demonstrated how frustrating long-session synchronization problems could be.

CaptureLink therefore added WebRTC diagnostic visibility and local recovery controls.

The renderer monitors statistics including audio/video timing and jitter-buffer behavior.

A manual audio resynchronization action can rebuild the local playback path without renegotiating the Xbox session.

A conservative automatic resynchronization mode can perform the same recovery after sustained evidence of late audio, with thresholds and a cooldown designed to avoid repeatedly interrupting healthy playback.

### Fullscreen and Picture-in-Picture

The video presentation layer later gained fullscreen and Picture-in-Picture support so CaptureLink could function as more than a small diagnostic Remote Play window.

### Self-contained Windows runtime

Early development depended more heavily on the surrounding development environment.

The Windows release work moved runtime dependencies into the application distribution.

The selected `xbox-xcloud-player` bundle is now preserved in the repository with source metadata and a SHA-256 integrity check.

Packaged builds include the FFmpeg executable used for exports.

### Windows packaging

CaptureLink now builds an NSIS Windows installer with application branding, installer branding, Start Menu integration, a desktop shortcut, and packaged runtime resources.

Version `0.1.0` is therefore no longer merely a protocol experiment. It is an installable Windows application undergoing release-readiness work.

## A controller-ownership discovery

Development also uncovered behavior that initially looked like a CaptureLink controller bug.

In some games, including NBA 2K and Minecraft during testing, a controller physically connected to the Xbox could continue controlling Xbox system UI but stop controlling gameplay if Remote Play was already active when gameplay initialized.

A controller connected through CaptureLink's Remote Play input path could still control the game.

Importantly, similar behavior was reproduced with Microsoft's own Xbox Remote Play client.

CaptureLink therefore documents the issue rather than making invasive changes to a stable Remote Play implementation without evidence that CaptureLink itself causes it.

The investigation and current workaround are documented in `docs/known-issues/xbox-controller-ownership.md`.

## What is original to CaptureLink

CaptureLink builds on prior open-source and platform work. It should be explicit about that.

The project does **not** claim to have invented:

- Xbox Remote Play
- Microsoft's xHome services
- WebRTC
- the `xbox-xcloud-player` implementation
- Xbox authentication provided by `xal-node`
- FFmpeg

CaptureLink's work is the product and engineering layer built around those foundations:

- Electron desktop architecture
- application-owned session orchestration
- IPC and privilege boundaries
- desktop user experience
- device-selection workflow
- diagnostics
- audio resynchronization behavior
- recording pipeline
- disk-backed recording persistence
- local microphone recording mix
- recording library
- export workflow
- failure handling
- Windows packaging
- product-specific testing and known-issue analysis

The distinction matters.

Crediting upstream work accurately makes it clearer which problems CaptureLink itself solves.

## Current direction

CaptureLink remains Windows-first and local-first.

The immediate goal is not to add a cloud platform around it. The goal is to make the existing local application understandable, reproducible, legally reviewable, and reliable enough for a technical preview.

Current release-readiness work includes:

- documentation
- third-party attribution
- distribution/license review
- privacy and recording disclosure
- native-Windows regression testing
- installer-signing strategy
- release packaging

The original motivation remains unchanged:

**Recording the Xbox media already arriving at a computer should not require rebuilding that same media path with unnecessary hardware.**

---

## From capture utility to Friend experimentation

After the core Remote Play and recording workflow became reliable, CaptureLink
started exploring a second question:

**Could the same Remote Play foundation allow another person to interact with
the Host's Xbox from another CaptureLink client?**

The first experiments focused only on controller state.

A second Windows PC captured its locally connected controller through the
browser Gamepad API and sent that state to the Host over a WebRTC DataChannel.

The Host translated the remote controller state back into the xHome controller
frames already used by CaptureLink.

That experiment successfully controlled the physical Xbox.

## Direct Internet peer-to-peer

The controller experiment was then moved beyond a local/manual proof.

STUN-assisted WebRTC traversal established a direct Internet peer-to-peer path
between two physical Windows computers without requiring TURN in the tested
network configuration.

Measured controller-path RTT during successful tests was in the single-digit
millisecond range.

This changed the project from a purely local capture application into an
experiment in extending local Xbox gameplay across the network.

## Friend video

The next milestone forwarded the Host's received Xbox video to the Friend peer.

CaptureLink progressively tested:

- direct Friend video
- video-only streaming
- receiver jitter-buffer behavior
- 720p60 low-latency tuning
- 1080p60 streaming
- bitrate and decode diagnostics

Under the validated test conditions, the 1080p60 path sustained approximately
10 Mbps with low decode and network latency.

These results are test observations rather than guaranteed performance across
all networks or hardware.

## Remote local multiplayer

The original remote-controller path controlled the same Xbox controller as the
Host.

CaptureLink then tested two separate product concepts.

### Shared Controller

Host and Friend controller state can be combined into one logical Xbox
controller.

Buttons and triggers are cooperative, while stick arbitration chooses the
stronger movement for each stick.

The mixer prototype worked during earlier validation, but the current
Bluetooth-era build requires another controlled Shared Controller retest.

### Player 2

CaptureLink also created a second independent xHome controller.

The Host became Xbox controller 1 and the Friend became Xbox controller 2.

This was successfully validated in NBA 2K Blacktop using two physical Windows
PCs, demonstrating that CaptureLink could extend a game's local multiplayer
controller interface across the network.

A later test also validated the Friend controller path using a
Bluetooth-connected controller.

## Direct Invite

Early Friend experiments exchanged raw WebRTC offer and answer information
manually.

CaptureLink later wrapped that exchange in Direct Invite.

The Host creates an invite and sends it to the Friend. The Friend joins from
the copied invite and returns a response. The Host monitors for the response
and completes the connection automatically.

The signaling exchange itself requires no CaptureLink-hosted service.

After signaling, gameplay video and controller traffic travel directly between
the peers.

An optional short-code WebSocket rendezvous prototype was preserved under:

~~~text
experiments/signaling-broker/
~~~

It is not required by the current Direct Invite workflow.

## Controller compatibility

Friend controller capture originally assumed the first browser-visible
gamepad.

The compatibility path was later hardened to:

- prefer Chromium's `standard` gamepad mapping
- support Windows-visible USB controllers
- support Windows-visible Bluetooth controllers
- normalize controller arrays for the Xbox mapping
- handle disconnect/reconnect
- avoid coupling controller sampling to video rendering

The transport itself does not need to know whether Windows received a
controller through USB or Bluetooth.

## Current direction

CaptureLink remains a local-first Xbox Remote Play and recording application.

Friend Mode is now a significant experimental extension of that foundation,
with Player 2 and Direct Invite proven end-to-end and Shared Controller still
requiring additional validation.

The project continues to avoid making a CaptureLink-operated cloud backend a
requirement for its core workflows.
