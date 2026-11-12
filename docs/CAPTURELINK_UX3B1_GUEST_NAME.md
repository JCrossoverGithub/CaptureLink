# UX3b1.2 — Guest display name on join requests

**Status:** unmerged UX3b1 localhost-only integration addendum. Targets base `a1816b4575374b695c8dc59b01626d08182acfb1` with UX3b1 Electron patch, Smoke Contract Fix, Visible End Session patch and Isolated Local Guest patch applied. No remote deployment.

## Contract

- Guest: after entering a valid one-use invite and clicking **Request to join**, a modal asks **What should your friend call you?** Name is required before the UX3b1 desktop IPC request. Canceling the modal sends nothing. The guest can continue without enabling a microphone.
- Broker: the `/v1/join` request accepts an optional `displayName` for backward compatibility with earlier headless test clients. New desktop bridge requires a name. Names are Unicode NFKC-normalized, trimmed and space-collapsed; accepted display length 1–32 characters with Unicode letters/marks/numbers and conservative separators (`space . _ ' -`). HTML and bidi control characters are rejected. Invalid input does not consume an invitation.
- Host: the authenticated host snapshot includes `guestDisplayName`, which is shown **as text** in the existing approval UI; the name is explicitly labeled **not verified**. A guest's own snapshot contains null. The host must still explicitly approve before SDP messages are shared.
- Privacy: name is in-memory only in the localhost broker; no new logging, file storage, user identity lookup or app analytics. The name is a user-supplied display label, never an account identity or authorization factor.
- End session: existing prominent Stream-header and persistent drawer actions still revoke broker state and locally tear down controller/voice sharing. Guest name is cleared from the UI on local end.

## Acceptance

1. Both guest and host applications must use this version; restart the localhost broker to use the updated join format.
2. On an isolated guest, choose Join Friend; paste a fresh invite; click Request to join; verify the name dialog appears. Cancel: no pending request on host.
3. Try an empty/HTML-like name: no join. Enter `Alex Rivera`; submit: host must see `Alex Rivera wants to join` and warning that identity is not verified.
4. Host rejects, then recreates a new invite and approves. Verify actual video/voice/controller separately; guest name must not bypass permissions.
5. End from the host's prominent End session control; Xbox Remote Play stays connected and no guest transport remains.
6. Confirm the old manual invite path still works.

## Verification scope

Node broker/client/bridge tests and source contracts are testable on Node Linux/Windows. Windows Electron typecheck, production build and two-client runtime tests must be run on JPCMAIN. Do not merge until those pass.
