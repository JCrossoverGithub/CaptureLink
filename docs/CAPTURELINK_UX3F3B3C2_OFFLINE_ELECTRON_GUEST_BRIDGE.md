# CaptureLink UX3F-3B3C2 — Offline Electron Online Session Boundary

**Status:** local Linux/Windows acceptance complete (2026-11-13); GitHub PR CI and release gates pending. **Not a production or live-guest release.**

**Accepted parent:** `0d49b1a2f8235484d36c78afbc1cc97043da0c5a` (PR #25 squash merge, 2026-11-13).
**Expected branch:** `feature/ux3f3b3c2-electron-guest`.
**Source intake:** `CaptureLink_UX3F3B3C2_Source_Intake.zip`, SHA-256 `77e598a57311531643522bfe64d07937ca8db2ad1045b388e24b1a92c3c77467`.

## 1. Design decision from accepted source

Do **not** inject the 3B3C1 HTTPS client directly into the accepted `HostedSignalingBridge`: its API is deliberately incompatible. The old bridge uses the local/pilot client's `role`, `approve(guestId)`/`reject(guestId)`, `clearLocal()` and `pendingGuestId` contracts; the new HTTPS client has `status()`, `approve(boolean)`, `end()` and internal pending-guest state. Blind substitution breaks approval and cleanup.

3B3C2 introduces a distinct `CaptureLinkOnlineSessionBridge` in the trusted main process. It composes the accepted 3B3C1 HTTPS candidate, keeps host authentication behind `createCaptureLinkOnlineElectron.hostFactory`, and permits account-free guest join. The authenticated host adapter is now **the same authority** as the online bridge: the old 3B3B host-only candidate is not also constructed, so a second online invitation cannot be created. Auth0 sign-out and shutdown call that same adapter's `end()`.

The existing `HostedSignalingBridge`, its default private-pilot selection and all manual/UX2 renderer coordinators are unchanged. A new main-only exclusive-mode arbiter reserves either `legacy` or `online` before starting a client, rejects overlapping attempts (including pending creates/joins), and cannot have a late failure unlock a newer session. End, window close, sign-out and app shutdown immediately clear local ownership before best-effort broker cleanup.

## 2. Runtime scope and explicit boundaries

- `src/main/index.ts` initializes the online bridge **only** in an **unpackaged Windows** Electron process. A disposable isolated local-guest test profile may join without a CaptureLink Online account. Existing Auth0 login still requires the prior exact development-domain file, safeStorage, a normal (non-guest) profile and unpackaged Windows.
- The HTTPS client remains permanently pinned to `https://signal.capturelink.test`, which is reserved for tests. No production or staging host, public listener, Auth0 dashboard, edge service, or `signal.capturelink.io` network activation is added. Requests outside an injected offline test fixture cannot complete the planned public flow.
- New IPC names are distinct: `capturelink:online-session-{status,create,join,snapshot,approve,send,messages,end}`. Every handler calls the accepted `authorizedHostedFrame` exact sender, main frame and origin/page checker. The existing `capturelink:hosted-*` methods retain their local/private-pilot behavior. No arbitrary endpoint or trusted client factory can be selected by IPC.
- Preload publishes method names, **not access tokens, refresh tokens, session bearer tokens, JWKS, signer keys, enrollment credentials or trusted origins**. IPC outputs contain only invitation codes, anonymous unverified display names, permission snapshots, status, and the intended UX2 envelope. SDP/ICE must not be logged or rendered; the renderer does not yet call these methods.
- The v2 policy and public broker are unchanged, so account disable/revocation tests still rely on a **synthetic** verifier/account map. Remote close remains best effort. Established WebRTC media/controller teardown is **not** proved, and the renderer is intentionally unchanged.
- Unpackaged Windows online session status is `enabled` for the offline-only candidate; **this is a code-path capability flag, not a claim that an online public signaling service is available**. A future UI must distinguish configured, authenticated, reachable, pending and approved states.

## 3. Acceptance and stop conditions

**Operator local acceptance (2026-11-13):** The pinned archive and 19 installed paths were verified against the accepted baseline. WSL Linux Node 24 completed **191/191 tests** with no failures or skips; all six historical source guards and the new 3B3C2 guard passed. Windows Node 24 completed **185 passes, 6 expected platform skips, 0 failures**; `npm ci`, TypeScript typecheck, and Electron build passed. The final 19-file staged diff, independent source review, whitespace and pinned Gitleaks scans passed locally. The install still reports **45 existing dependency advisories (41 moderate, 4 high)**, none remediated here.

- [x] Exact parent, branch, source-intake SHA and individual-file SHA manifest verified before installer runs.
- [x] Exact reviewed modified/new file inventory; no files outside it changed; six historical source guards reconciled **only** for the deliberately changed Electron main/preload/type surfaces.
- [x] New `ux3f3b3c2-source-boundary.mjs` passes; all six historical UX3F source guards pass; accepted v1/pilot, Xbox, v2 broker and renderer hashes stay pinned.
- [x] Full Linux Node 24 signaling suite, 3B3C2 offline tests and mode-arbiter tests pass with zero unexpected skips.
- [x] Windows Node 24 signaling suite, TypeScript typecheck and Electron build pass. Account for the accepted six Windows-specific platform skips.
- [x] Staged patch exact inventory, diff whitespace, pinned Gitleaks and independent diff review pass.
- [ ] GitHub PR CI passes against the exact latest candidate head before any merge; no production deploy, new live origin, or renderer activation.
- [ ] A later UX3F-3B3C3 review proves safe renderer teardown, media/control cancellation, explicit UI mode selection and two-machine offline/staging acceptance **before activation**.

## 4. Not accepted and future engineering work

The new bridge proves offline role/approval/protocol composition and guarded IPC boundaries, **not** a usable internet guest invitation. No production identity/Google consent branding, staging deployment, remote account deactivation persistence, rate-limiting edge, TURN path, code signing, installer acceptance, dependency advisories remediation, or two-device Xbox/voice/controller tests have been completed by this patch. The previously reported npm audit count was **45 advisories (41 moderate, 4 high)**; this patch does not change dependencies or claim remediation.

Known residual distributed-system limits: if the network accepts a create/join but loses the response, the client cannot necessarily revoke an unknown server-side authority; if broker revocation succeeds, an already established peer may still possess media until **both** sides close transports. UX3F-3B3C3 must handle those explicitly rather than interpreting an `ended` result as complete remote media shutdown.

**Do not merge or deploy merely because offline tests pass.** Operator review and exact-head CI acceptance are separate gates.
