# CaptureLink V1.6 UX2 — Unified Session Foundation (experimental)

**Branch target:** `feature/unified-session-ux1` at `0ce9166`, based on merged V1.5 `a11c4f1` with UX1a and UX1b applied but uncommitted.

## What this iteration changes

The host selects controller, optional Xbox voice, and gameplay viewing once. One private `CAPTURELINK-SESSION-V1` invitation contains the authorized legacy transport offers. The guest pastes that invitation, explicitly consents before opening a real microphone, and returns one unified response. The host pastes the response once. An internal coordinator calls the existing independently permissioned controller and voice transports. The old legacy controls remain accessible under **Troubleshoot separate connections**.

This is **one manual invite and one manual response**, not an internet-hosted join code, authentication server, or automatic discovery system. One unified invite does not imply that Xbox game chat audibility, controller delivery, or game media are working. Voice diagnostics still need live validation. Existing one-guest/STUN limitations remain.

## Permission and routing rules

| Selection | Controller transport | Voice/media transport | Guest microphone |
|---|---|---|---|
| Watch/listen only | No | Yes | Silent audio track, no getUserMedia |
| Controller (shared or Player 2) | Yes, carries gameplay video/audio | No unless voice also selected | No |
| Xbox voice only | No | Yes | Explicit guest checkbox, then getUserMedia |
| Controller + Xbox voice | Yes | Yes, without duplicating game media | Explicit guest checkbox |

Controller access implies gameplay visibility because the existing controller peer carries the game stream. The host checkbox for voice forwarding authorizes Xbox microphone routing but does not enable the host physical microphone. The guest controls local microphone activation and mute. The guest should never be asked for Xbox credentials.

## Protocol and state safety

The versioned envelope has a short-lived random session ID, creation timestamp, explicit capabilities, and opaque controller/voice signal payloads. Parsing checks supported version, allowed fields, size bounds, selected transport consistency, and invite expiry (15 minutes). A reply must match the pending host session ID and capabilities. The protocol does **not** cryptographically authenticate the sender; share codes only with the intended friend and do not post them publicly. No code logs raw SDP, ICE, audio or authentication material.

Coordinator phases: idle → creating → invite-ready → accepting → negotiated for the host; idle → joining → response-ready for the guest. “Negotiated” only means signaling responses were accepted; actual peer/network/media status remains separate. Partial transport failures roll back only transports owned by this unified setup, preserving unrelated legacy sessions.

## Acceptance gates

1. Windows TypeScript typecheck and Electron production build.
2. UX1a/UX1b, UX2, controller hub, signaling, ICE, host-flow, guest-uplink and audio-path tests.
3. Recording MP4 and finalization regression tests.
4. Desktop inspection: host invite with all capabilities; guest join with microphone consent; watch-only without device permission; error and cancel/retry; legacy recovery reachable but collapsed.
5. Live JPCMAIN ↔ XLAPTOPX Xbox test: both controller modes as applicable, voice with host microphone off, watch and listen, revoke permissions, disconnect/reconnect, video aspect ratio, no fixed diagnostics overlay.
6. Do not merge before live acceptance. Release signing, third-party licenses, npm vulnerability remediation, TURN/signaling security are separate gates.

## Known remaining work

- Unified session currently wraps two independently negotiated RTCPeerConnections. Permission enforcement also lives in those existing transport implementations; a future review should bind each peer cryptographically to the session identity.
- Hosted signaling, short-lived links/codes, host approval, TURN support, and automatic message exchange are the next backend milestone, not included here.
- Automatic recovery, transport-connected event aggregation, session timeout/expiry enforcement after negotiation, and controller-driven UX remain future work.
- The Electron-side deployment must be retested on Windows. Local source-level and synthetic browser tests do not prove Xbox P2P success.
