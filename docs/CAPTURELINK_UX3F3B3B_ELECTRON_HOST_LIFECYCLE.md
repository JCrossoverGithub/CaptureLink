# UX3F-3B3B — Auth0 → offline HTTPS-host lifecycle in Electron main

**Status:** offline integration candidate; **not** production, not public, not yet merged.

**Parent baseline:** `c8ac3566d746813a3ce8f3817734e33db1c6f1ea` (PR #23 squash merge).

## Intended, narrow change

The accepted `createCaptureLinkOnlineElectron` controller optionally receives `hostFactory` from trusted Electron main. Only that factory receives a main-process callback to the already-verified Auth0 access token; the callback returns `null` on sign-out, shutdown, expiry, or before initialization. The factory is wired **only** within the pre-existing unpackaged, non-guest Windows Auth0 activation gate in `src/main/index.ts`. It constructs the *accepted* HTTPS-host candidate, pinned exactly to `https://signal.capturelink.test`.

Controller operations (`createHostSession`, `endHostSession`, `hostingStatus`) are **main-process-only**. There is no new preload or IPC method, no renderer UI, no live create invocation, and no connection from the existing `HostedSignalingBridge` to this path. The offline tests invoke them through an injected main-only factory to verify composition against a real loopback v2 broker and signed synthetic JWTs. The production signaling domain is *never* selected by this stage.

## Security and race semantics

- Browser PKCE, nonce, rotated refresh-token vault, signing keys and bearer tokens remain owned by the accepted Auth0 implementation; none are added to return payloads or IPC.
- `createHostSession` demands initialized, authenticated, non-pending state. It returns only the public invitation code and invitation expiry. The host-session capability remains private inside the HTTPS host candidate.
- `signOut` invalidates the host token accessor and aborts in-flight creation immediately before queuing Auth0 sign-out; it ends any known host session, attempts broker revocation, clears local Auth0 credentials, and preserves Xbox and manual P2P state.
- `shutdown` similarly invalidates and ends hosted authority, but preserves the encrypted refresh-token vault for the next ordinary launch. It does not await the Electron process exit: Electron `before-quit` still initiates cleanup on a best-effort basis.
- If the broker created a session but the response never reached the client, there is no host capability with which to revoke it. Server-side TTL and a separately designed account-revocation enforcement remain required. Never claim that every network failure guarantees remote revocation.
- The runtime candidate's 10-second request bound and server's expiry are **not** replacements for operator deactivation or production session teardown verification.

## Deliberate exclusions

1. No public/staging hostname configuration, TLS override, private pilot change, native packaging activation or operator enrollment change.
2. No new IPC. Invitations cannot yet be created from the UI. No guest polling/approval, SDP offer/answer, media, friend-controller connection, or persistent remote broker is connected.
3. No backend account status/host disable subscriber or public endpoint. `isHostActive` in offline tests is an injectable fake.
4. No assumption that local `npm audit` advisories are resolved; the separate dependency-security review remains outstanding.

## Local acceptance evidence (2026-11-13)

- [x] Source archive SHA-256 verified; guarded patch applied on clean `feature/ux3f3b3b-electron-host` at accepted parent SHA.
- [x] Linux Node 24 complete signaling suite: **176 passed, 0 failed/skipped** after test-race repair.
- [x] All five historical UX3F source-boundary guards passed after explicit pin reconciliation.
- [x] Windows Node 24 complete suite: **170 passed, 6 expected platform skips, 0 failed**; TypeScript check and Electron build passed.
- [x] Exact **14-file** staged inventory, whitespace check, staged Gitleaks 8.30.1 (no leaks), and independent diff review passed.
- [ ] GitHub CI passes on the **exact PR head**, and operator confirms no new renderer/preload/production routes before merge.

The additional 14th file, `services/signaling/test/client.test.mjs`, fixes a pre-existing test synchronization race: both expected rejected promises are observed before either assertion is awaited. The first Linux rerun exposed the race; the corrected suite passed on Linux and Windows. The four Windows TLS failures in a separate rerun were caused by `openssl` missing from that PowerShell session's PATH; a temporary Git for Windows OpenSSL PATH addition restored the expected results without source changes. The npm dependency audit still reports 45 advisories (41 moderate, 4 high); remediation is a separate, unresolved release gate.

**Merge is not deployment approval.** Retain this as a narrowly scoped internal integration until future stages explicitly authorize UI and server wiring.
