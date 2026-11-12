# UX3b1.1 — Discoverable hosted-session exit

Baseline: `a1816b4575374b695c8dc59b01626d08182acfb1` on `feature/ux3b1-electron-integration`, with UX3b1 and the accepted UX1b/UX2 smoke reconciliation applied (uncommitted).

## User contract

- Creating a hosted invitation or submitting a hosted join request immediately shows **End friend session** in the Stream header. It remains reachable when the Friend drawer closes.
- While any hosted invitation or guest request is active, the Friend drawer has a **pinned bottom bar** with **End session**, independent of scroll position or current page.
- Both buttons and the Session page's existing exit route open a focused confirmation dialog. **Keep session** does not revoke or reset anything. **End session** revokes/ends the broker session (best effort), resets the UX2 renderer transport coordinator, clears invitation text, then hides the active controls.
- The console's independent Xbox Remote Play connection is not ended by this action. The existing UX2 manual fallback remains mounted and usable.
- The setup description now describes host approval instead of the old copy-and-paste response workflow.
- If the broker is unreachable during exit, local sharing is stopped but remote revocation cannot be confirmed. Server-side status and remote guest teardown require further verification.

## Acceptance

1. Start UX3a broker on loopback, launch Electron, connect Xbox.
2. Invite with some capabilities. After **Create local invitation**, observe the prominent header exit and pinned Friend footer.
3. Click **End session** and **Keep session**: invite remains active. Then close the drawer and confirm the Stream header still exposes **End friend session**.
4. End from the Stream header, confirm in dialog. Broker session should be revoked, local controller/voice transport reset, and the old invitation field cleared; Xbox Remote Play remains connected.
5. Create another invitation. Verify a new code and the same exit controls.
6. Repeat with a guest join request, both reject and approve flows, and while connected; check controller/media/voice behaviors individually.
7. Verify manual UX2 fallback is still present and performs a separate manual session.

## Evidence limits

Automated source and Chromium DOM tests exercise the visibility, confirmation and cleanup wiring. Node's 37 existing UX3a/UX3b tests verify broker/client/IPC protocol behaviors. This does **not** yet prove a two-Electron, real Xbox host/guest session or public network safety. Do not merge/deploy without Windows typecheck/build, full regressions, Electron acceptance, and relevant security review.
