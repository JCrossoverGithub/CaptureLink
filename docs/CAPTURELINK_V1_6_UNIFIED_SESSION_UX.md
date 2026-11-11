# CaptureLink V1.6 — Unified Session UX

**Status:** UX/architecture proposal for the first V1.6 development branch. **Not implemented or production accepted.**
**Baseline:** V1.5 Shared Session Hub from `feature/shared-microphone-v1`, subject to successful PR merge and fresh `origin/main` checkout.
**Purpose:** Make Xbox Remote Play and a friend's gameplay, controller and voice feel like one understandable session without changing the already-proven transports prematurely.

## 1. Problem statement

V1.5 added a Shared Session panel, but it still exposes implementation details: controller and voice have separate offers/responses, setup steps, duplicated status and independent invitation controls. The player must understand several transport lifecycles to invite a friend.

**Product promise:** *Connect to your Xbox. Invite a friend. Play together.* The remote video and gameplay, not the setup UI, is the principal screen.

## 2. Explicit constraints

- Preserve V1.5 controller/gameplay/video, Xbox audio, guest voice with host physical mic off, permissions, mute, recording, and diagnostics. No release of hidden or newly permissive microphone routing.
- Xbox authentication stays on the host. Guests can watch/join without receiving the host's Microsoft account credentials.
- Host authorizes **each** capability, even if a guest is already connected. Guest microphone permission is independently granted locally by the guest.
- Shared Controller merges host/guest input as the current implementation allows; Player 2 is a separate mode. Both must be explicit and fail safely.
- Retain exact V1.5 signaling under the first UX slices. Do **not** claim one-code joining until a separately authenticated signaling/control-plane milestone is complete.
- Retain diagnostics in Settings and a hideable surface. Do not collect private SDP/ICE, IPs, auth tokens or recordings in copied reports.
- The design inherits the Slate theme and user-selected accent color; no platform-brand impersonation.

## 3. Information architecture

### App-level entry points

**Play on my Xbox** — Xbox account, discovery, connection, gameplay, host session.
**Join a friend** — guest-only join, no Xbox login, local devices and accept/leave.
**Recordings** — unchanged library.
**Settings** — devices, accessibility, advanced stream quality, troubleshooting, connection diagnostics.

The Stream view must be *video-first* and preserve keyboard, mouse and controller navigation.

### When hosting

Top contextual bar: `Xbox Series X · Connected`, `Invite friend`, `Participants (n)`; stream remains the largest element. A compact dock shows `My mic`, `Controller`, `Record`, `Volume`, `Fullscreen`, `More`. Technical counters hidden by default.

### When joining

A simple entry field/link flow; while waiting for permission, display `Waiting for host` rather than misleading `Connected`. On admission: remote video in the normal player, `My mic`, `My controller` if granted, playback volume and `Leave`. No Xbox connection, account or remote mic routing settings.

## 4. Permission model

| Capability | Default | Host authority | Guest authority | Evidence required for status |
|---|---|---|---|---|
| Watch gameplay | on in proposed invite wizard | Grant/revoke | Leave | Remote video track actually receiving frames |
| Hear Xbox audio | on in proposed invite wizard | Grant/revoke | Local playback mute/volume | Remote audio track actually receiving data |
| Speak into Xbox chat | **off** | Explicit allow/revoke, per session | Select local mic, mute/unmute, leave | Guest outgoing audio → host incoming → mixer and Xbox sending; not proof listener heard it |
| Use controller | **off** | Explicit allow/revoke, mode selection | Connect/select controller; stop input | Input channel active plus actual input observation; not proof Xbox accepted every input |

One identity in the **Participants** panel should aggregate several underlying transport statuses, not mistake one established peer connection for a fully usable shared session.

Controller modes: **Control together (Player 1)** and **Play as Player 2**. If Shared Controller requires host pad connected to the Windows host PC, detect and explain that limitation before invitation. Never silently allow new controller authority when reconnecting.

**Xbox chat identity caveat:** Guest voice mixed through the host's Xbox mic is not a separate Xbox party identity. This must be disclosed in the invite permission UI.

## 5. Screen / flow specification

### Host: invite

1. Select `Invite friend` from the stream header, no mandatory detour to the Audio panel.
2. Wizard opens with `Watch gameplay` and `Hear game audio` on by default; `Use controller` and `Speak in Xbox chat` off by default.
3. If controller is selected, require a mode. Show readiness issues before sending invitation.
4. Invitation issued, then show `Waiting for friend`. Host can cancel or edit pending permissions; expired invites cannot be reused.
5. Guest joins; host sees one participant with permissions and measured statuses. The host can revoke either microphone or controller rights without disconnecting Xbox.
6. Active session has one `End sharing` control (not `Disconnect Xbox`) and optional expanded settings.

### Guest: join

1. Select `Join a friend`, enter a code/open a link. Guest is not directed through Xbox sign-in.
2. See session owner identity (when securely available), expected permissions and device checks. Request microphone permission only on an explicit user action.
3. `Waiting for host` → `Connecting` → `Watching` / `Playing` with clearly separate voice routing status.
4. Guest can independently mute microphone, select input/output, adjust game-audio volume, leave and recover from disconnect.
5. Lost session should not silently reconnect a muted microphone or recover revoked controller rights.

### Transitional V1.6 UI limitation

Until the networking milestone lands, create **one invitation workspace** with a clear progress wizard but show the required controller and voice exchange steps truthfully. Do not forge a synthetic single code that conceals separate offer/answer handshakes. A unified invitation code requires a separately approved service design.

## 6. State model (design target)

```text
AppMode: home | hosting | joining | guest
Xbox: disconnected | connecting | connected | recovering | failed
Session: idle | inviting | awaiting-guest | awaiting-host | connecting | active | reconnecting | ended | failed
Transport: idle | signaling | connected | failed | closed
Permissions: watch, hear, xboxVoice, controllerMode (none | shared | player2)
Evidence: videoFrames, gameAudioPackets, guestMicRtp, hostGuestRtp, mixerActive, xboxMicRtp,
          controllerEventsSent, controllerEventsReceived
```

A session coordinator should be independent of DOM layout. Views subscribe to a normalized state. Transports remain modular and independently recoverable; UI never owns the authorizations merely by setting a checkbox.

### Status wording

- `Connected to host` means peer signaling/transport is established.
- `Watching` requires actual video frames.
- `Mic muted`, `Microphone blocked by host`, `Voice sending to host` and `Xbox mic uplink active` are different statuses.
- `Xbox voice forwarding` is not equivalent to `Heard by Xbox party`; actual listener acceptance is a separate manual gate.

## 7. Implementation slices and acceptance gates

### UX1 — Shared Session screen and navigation (first PR)

- Add dedicated `Play on my Xbox` / `Join a friend` entry states.
- Give Stream an unobtrusive header, video-first layout, invite/participants entry points and dock.
- Move legacy complex controls into an explicitly labeled Advanced section, **not deleted**.
- Reuse existing controller, video and voice implementations; no signaling changes.
- Implement semantic keyboard focus, Escape handling, accessible labels and small-window layout.
- Source tests: required controls and route selection, no regressions in previous V1.5 actions.

### UX2 — Session state + permissions

- Introduce typed session/participant state separate from DOM.
- Aggregate controller, video and voice status; display observed vs inferred state accurately.
- Assert no controller/mic enablement without host authorization; guest mute survives reconnect.
- Transitions/reconnection/permission revocation and Xbox disconnect unit tests.

### UX3 — Invitation experience atop known transports

- Single host/guest wizard organizing **existing** controller and microphone exchanges with explicit progress.
- Do not silently auto-enable mic/camera/controller; meaningful cancellation and failure messages.
- Preserve compatibility or show an actionable version mismatch.

### UX4 — Real invite-code service (separate architecture/PR)

- Authenticated short-lived invitation identifiers, host-controlled permissions and one-time/single-session semantics.
- Design/sign off signaling server, TTLs, NAT traversal / TURN, abuse limits, transport encryption, identity checks, consent, versioning and revocation.
- Test network loss, replay, old-client compatibility, and multi-guest rejection (until supported).
- Only this phase may claim true one-code join.

### UX5 — Polish and recovery

- Controller-first navigation, comprehensive status recovery, multi-resolution/focus/resizing QA, guided diagnostics.
- Verify layout with real Xbox streams and both PCs; ensure no recurring black bars or crop.

## 8. Non-goals for UX1

- Replacing WebRTC media transport or Xbox stream initiation backend.
- Enabling additional guests.
- Public release packaging, signing, redistribution clearance or marketing launch.
- Rewriting recording, audio routing, authentication, or controller implementation just to support a new layout.

## 9. Release / merge policy

V1.5 merges only after a new local preflight confirms typecheck, build, voice/controller tests, recording tests, staged file review and secrets scanning. User has confirmed current live functionality, but do not invent missing automated verification results. V1.6 work begins in a separate new worktree from verified `origin/main`. Each UX slice must maintain an acceptance checklist and be separately reviewable.

## 10. Proposed first PR checklist

- [ ] New clean `feature/unified-session-ux1` branch based on accepted V1.5 main.
- [ ] An explicit interface map for host, guest and session states is approved.
- [ ] Stream-first host layout, join entry and session drawer implemented without deleting old controls.
- [ ] Keyboard/controller focus and screen-reader labels verified.
- [ ] Invite/revoke/mute semantics unchanged.
- [ ] Stream layout tested at normal, maximized and fullscreen widths, plus 16:9/4:3 samples.
- [ ] V1.5 regression tests and recording tests all pass.
- [ ] Live JPCMAIN + XLAPTOPX + Xbox session accepted.
- [ ] PR independently reviewed; no release signing/licensing claims.
