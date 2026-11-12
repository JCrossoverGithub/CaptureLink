# CaptureLink UX3c-3d — Windows protected pilot admission and gated desktop selection

**Status:** implementation candidate; NOT live deployment approval, not public release.
**Exact accepted baseline:** `967dda377d9608e97e259e9c95e616c8348fce8c` (PR #16).
**Branch:** `feature/ux3c3d-hosted-pilot-activation`.

## Behavior

- Default without enrollment: original `LocalSignalingClient` to `127.0.0.1`. No automatic public traffic. Manual UX2 invitation stays available.
- Main-process-only, Windows-only operator enrollment: start CaptureLink using **one** of `--capturelink-ux3d-enroll`, `--capturelink-ux3d-rotate` or `--capturelink-ux3d-disable`. The native OS file picker selects a *single installation's* 43-character `host.admission` or `guest.admission` token file; **no token in command-line arguments, environment, renderer, preload or logs**. The app quits after the operator action, and must be restarted normally.
- Enrollment stores the credential in the Electron user-data profile encrypted using Electron `safeStorage` on Windows (OS DPAPI). No plaintext admission token is persisted by CaptureLink. The *original plaintext import file remains* wherever the operator placed it; protect it separately, securely transfer it to the intended device and remove it when appropriate. Deletion on SSD is not necessarily secure erasure.
- An enrolled installation selects the trusted main-process `RemoteSignalingClient` with a **source-pinned candidate** `https://signal.capturelink.io`; no user-supplied hostname, env or renderer origin selection. This hostname has **not** been verified, deployed or independently approved for DNS/TLS. Do not create or use live credentials until the domain and service are reviewed and approved. A future reviewed commit can change the pinned origin before pilot enablement.
- Corrupt, unreadable or non-Windows enrolled credentials fail closed: hosted invitations are unavailable; there is **no silent localhost downgrade**. A read-only mode status (`local` / `remote` / `unavailable`) is returned to the renderer and displayed in the invitation panel; no secret crosses IPC.
- `--capturelink-ux3d-disable` removes the *local encrypted enrollment only*. It does NOT revoke the server-side installation token. Separate server operator revocation/rotation is required. `--capturelink-ux3d-rotate` atomically replaces an existing valid local enrollment; coordinate broker token rotation before use.
- The UX3b1 `--capturelink-ux3-local-guest` process intentionally creates a disposable random profile. Enrollment flags cannot be combined with that disposable mode. Use two normal Windows installations for remote acceptance.
- The credential is bound to the current Windows user's OS encryption context; copying the encrypted file to another user/device is not a supported enrollment mechanism. A local compromise under the same user or malware with process access is out of scope of safeStorage protection.

## Acceptance gates

1. Windows PowerShell: `npm.cmd ci`, `npm.cmd run typecheck`, `npm.cmd run build`, `node --test services/signaling/test/ux3c3d-enrollment.test.mjs`, and `node scripts/ux3c3d-enrollment-source-smoke.mjs`.
2. Existing signaling, HTTPS edge, pilot runtime, UX/voice and recording regressions; Linux tests remain offline-only.
3. Manual Windows pilot enrollment/disable/rotation using **test-only** admission files, after confirming user-data isolation on JPCMAIN and XLAPTOPX. Do not upload, paste or screenshot real tokens.
4. Review the real DNS hostname, TLS, proxy and edge limits and Windows-to-Linux credential delivery separately. **No VPS deployment, public listener, DNS change, remote-media validation or release is made here.**

## Open risks and follow-up

- The operator must keep plaintext source token files private. Current flow is not ordinary consumer onboarding.
- `safeStorage` protects secrets at rest, not the application process when running, or a compromised user session.
- Broker `end()` currently reports a local clean outcome even when the remote server's revocation confirmation cannot be proven; UX3c-3b deliberately displays cautious status and live remote acceptance is still required.
- Broker state is in-memory; process restart invalidates sessions. Its server-side configuration is separate and stays on the private Linux filesystem.
- Long-lived admission credentials and operational rotation need an incident/recovery process; no general consumer account authentication exists.
- The 45 existing npm audit advisories (41 moderate, 4 high in local logs) need an independent review before public distribution. Do not run unreviewed `npm audit fix --force`.
