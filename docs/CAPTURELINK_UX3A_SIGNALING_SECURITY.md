# CaptureLink UX3a — Security and Engineering Acceptance

**Baseline:** merged PR #8, `30097ab52571421bcaa2fcb6cf0f33f3b2218ad1`, branch `feature/ux3-hosted-signaling`.

**Scope in this patch:** independent Node.js localhost signaling broker and deterministic integration tests. No Electron UI changes, Xbox access, cloud deployment, DNS, firewall changes, persistent data, or production rollout.

**UX2 compatibility:** permissions `{watch,voice,controller,controllerMode}`, `CAPTURELINK-SESSION-V1` invite/response envelopes, one guest, and one SDP-complete offer and answer per channel. Hosted session ID and UX2 SDP session ID are distinct: the broker verifies the UX2 reply against the actual UX2 offer, not the hosted session identifier.

## Security invariants

1. Creation generates independent 256-bit invitation, host, and guest bearer secrets. Invite code is single-use and **not** an authenticated identity.
2. Only an authorized host can approve/reject; only approved guests receive signaling. No guest can upgrade permissions, issue a host offer, or revoke the host's session.
3. Backend validates the existing UX2 envelope version/schema, permission set and roles; reply session ID must equal the accepted offer's UX2 session ID.
4. Enforce body/signal size limits, expiry at guest join, host approval and host offer; limit request rates and simultaneous sessions.
5. No SDP/ICE, secrets, IP addresses, audio samples or Xbox credentials in application logs. Responses use `Cache-Control: no-store`.
6. Host revocation removes the broker session immediately, but **does not terminate an already running P2P connection** without coordinated desktop teardown. The client integration MUST implement teardown and track media/controller status separately from signaling status.
7. Backend state exists only in RAM. Do not treat a green test or successful `/healthz` as production approval.

## Acceptance checklist

- [x] Contract tests: controller-only, voice-only, watch-only, controller + voice.
- [x] Host approval, wrong role, missing bearer, replay, session mismatch.
- [x] Invitation/offer expiry, rejection, leave, revocation, throttling, origin controls.
- [ ] Desktop transport adapter with explicit guest microphone consent and host-provisioned permissions.
- [ ] Live two-PC controller/voice/watch acceptance and disconnect teardown.
- [ ] TURN and secure networking: relay fallbacks, TLS reverse proxy, robust ICE handling.
- [ ] External host/guest identity and abuse strategy, protection from invite theft/phishing, and secure production secrets.
- [ ] Storage/scale strategy (in-memory broker is single-process, non-durable), readiness, backups/operations if needed.
- [ ] Remote deployment penetration tests, SAST/dependency audit and operator review.

## Phase cut

UX3a = isolated signaling broker tested locally. UX3b = desktop host/guest adapter and invite UI. UX3c = hardened hosted deployment and network relay, with explicit go/no-go review. **Do not merge UX3a as an Internet-ready service.**
