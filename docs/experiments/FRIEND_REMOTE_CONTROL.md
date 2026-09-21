# CaptureLink Friend Remote Control Experiment

## Status

Research experiment.

This feature is not part of the CaptureLink v0.2 release and must not
destabilize the known-good Xbox Remote Play path.

## Goal

Allow one CaptureLink user to temporarily share an active Xbox Remote
Play session with another CaptureLink user.

The guest should be able to:

- receive the host's Xbox video
- receive the host's Xbox audio
- optionally control the Xbox using a controller connected to the guest PC

The Xbox owner remains authenticated locally on the host machine.

Microsoft/Xbox credentials, authentication tokens, and Xbox service
tokens must never be transmitted to the guest.

## Proposed topology

Xbox Console
     |
     | Xbox Remote Play
     |
     v
CaptureLink HOST
     |
     | CaptureLink-to-CaptureLink WebRTC
     |
     +-----------------------------+
     |                             |
     | video/audio ->              |
     | <- controller input         |
     |                             |
     v                             |
CaptureLink GUEST                  |
     |                             |
     v                             |
Guest controller -----------------+

## Trust model

The CaptureLink host owns the Xbox session.

The guest receives only capabilities explicitly granted by the host.

Initial permissions:

- View
- Control

A guest must never automatically receive controller permission simply
because they possess an invitation code.

The host must explicitly approve the connection.

The host must be able to revoke controller access immediately.

Disconnecting the sharing session must not disconnect Xbox Remote Play.

## Invitation model

Future user experience:

1. Host connects to Xbox normally.
2. Host selects Share Session.
3. CaptureLink creates a short-lived invitation.
4. Guest enters the invitation code.
5. Host receives an approval request.
6. Host chooses View Only or Allow Controller.
7. CaptureLink establishes an encrypted peer session.

Invitation requirements:

- random
- one-use
- short-lived
- revocable
- no Xbox credentials
- no Microsoft credentials
- no persistent access

## Architecture principle

The Xbox-facing Remote Play implementation remains unchanged.

Friend sharing is a second transport layer.

Xbox WebRTC != CaptureLink friend WebRTC.

This boundary is intentional.

## Experimental milestones

### F0 - Identify integration hooks

Locate:

- live Xbox MediaStream
- live video/audio tracks
- existing CaptureLink controller attachment path
- exact gamepad-to-Xbox input path

No behavioral changes.

### F1 - Remote-input adapter

Represent a controller as a serializable CaptureLink message.

Inject a synthetic remote controller state into the same input path
currently used by a controller connected to the host PC.

This test does not require networking.

Exit criterion:

A synthetic CaptureLink controller payload can operate the Xbox through
the existing Remote Play session.

### F1 Result - PASS

Validated September 21, 2026 against a live Xbox Remote Play session.

CaptureLink successfully:

- created a synthetic `FriendGamepadState`
- translated it into the Xbox gamepad frame used by `xbox-xcloud-player`
- announced synthetic gamepad index 0 through the existing control channel
- injected frames through the existing Xbox input channel
- controlled the physical Xbox without a locally attached PC controller

Observed runtime proof:

- `Ctrl+Alt+6` produced D-pad Right and moved the Xbox UI selection right
- `Ctrl+Alt+1` produced the Xbox A button and activated the selected item

The synthetic path uses the existing `xbox-xcloud-player` input serializer.
The vendored player bundle was not modified.

This validates the Xbox-facing half of friend remote control.

F2 can now transport `FriendGamepadState` messages from another
CaptureLink installation and feed them into the same adapter.

### F2 Result - PASS

Validated September 21, 2026 using two physical Windows PCs:

- Host: JPCMAIN
- Guest: XLAPTOPX
- Host maintained the Xbox xHome Remote Play session
- Guest had a physical controller connected locally
- CaptureLink established a WebRTC DataChannel between the two PCs
- Guest controller state was transmitted to the host
- Host fed the received state into the F1 `RemoteGamepadAdapter`
- The guest controller successfully controlled the physical Xbox

The test used manual SDP offer/answer exchange and no TURN relay.

This proves the complete CaptureLink-to-CaptureLink remote-controller path.

Current validated architecture:

    Guest Controller
          |
    Guest CaptureLink
          |
    WebRTC DataChannel
          |
    Host CaptureLink
          |
    RemoteGamepadAdapter
          |
    Xbox Remote Play
          |
         Xbox

The next networking milestone is direct internet traversal using STUN while
preserving peer-to-peer controller transport. TURN remains outside the primary
path and is not required for the next experiment.

### F2 - Peer controller transport

Create a CaptureLink-to-CaptureLink WebRTC DataChannel.

Guest:

physical controller
    -> browser Gamepad API
    -> CaptureLink controller state
    -> WebRTC DataChannel

Host:

WebRTC DataChannel
    -> remote controller adapter
    -> existing Xbox input path

Exit criterion:

A controller connected to a second PC controls the host's Xbox.

### F3 - Media relay

Relay the already-received Xbox MediaStream from host CaptureLink to the
guest peer connection.

Initial implementation may decode/re-encode media.

Optimization can happen later.

Exit criterion:

Guest receives playable Xbox video and audio with acceptable latency.

### F4 - Signaling and invitation codes

Introduce ephemeral signaling.

The signaling service may exchange:

- session identifiers
- SDP offers/answers
- ICE candidates
- ephemeral public information
- authorization state

It must not receive Xbox authentication tokens.

Exit criterion:

Two CaptureLink installations can connect using a short invitation code.

### F5 - Internet/NAT reliability

Add:

- STUN
- TURN fallback
- disconnect handling
- reconnection
- session expiration
- permission revocation

### F6 - Security hardening

Before any public release:

- cryptographically strong invitations
- strict expiration
- explicit host approval
- replay protection
- rate limiting
- guest identity/session fingerprinting
- permission audit
- TURN credential strategy
- threat-model review

## Non-goals for the first prototype

Do not add:

- CaptureLink user accounts
- permanent friend lists
- cloud recording
- persistent remote access
- unattended Xbox access
- Microsoft credential sharing
- Xbox token forwarding
- multiple simultaneous guests
- public matchmaking

The first prototype exists only to determine whether the technical path
is viable and sufficiently low latency.
