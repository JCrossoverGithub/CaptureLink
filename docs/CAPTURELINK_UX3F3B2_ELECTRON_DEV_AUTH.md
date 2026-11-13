# CaptureLink UX3F-3B2 — Windows Electron Auth0 development sign-in

**Status:** local Windows, Linux and Auth0 development acceptance completed; **NOT a production release or public v2 deployment**.
**Git baseline:** `dc7d1da61acfece1bd2d908222fecdbdf0722618` (PR #21 merged).
**Scope:** Auth0 Native App login, app-side browser callback lifecycle, encrypted-refresh-token initialization, top-level trusted IPC with safe status, independent dev-only Settings controls.
**Production deployment:** NONE. Production v1, private pilot and remote controller behavior are unchanged. **No public v2 client is wired into Electron**.

## Activation must be explicit and source-controlled

The trusted `src/main/capturelink-online-dev-config.mjs` contains the publicly shareable Native App Client ID, API audience and fixed redirect port 49152. **No Auth0 Domain was independently verified from the source archive, so the feature is off by default.** An operator must create a **non-repository, non-secret** JSON file in their Windows user home directory: `C:\Users\thede\CaptureLink-Online-Dev.v1.json` with exactly `{"domain":"YOUR_VERIFIED_AUTH0_DOMAIN"}`. Copy Domain from **Applications → CaptureLink Desktop Dev → Settings → Basic Information**, without scheme/path/secrets/tokens. The loader accepts only the selected US development tenant's expected Auth0 domain pattern; mismatch fails closed and must be investigated rather than guessed. Do not commit this configuration file into Git.

Expected Allowed Callback URL in Auth0 Native App **URLs**: `http://127.0.0.1:49152/capturelink-online/callback`. The listener refuses a busy port rather than changing the URL. OAuth authorization code with PKCE S256, state, nonce and exact issuer/audience checks are implemented by accepted UX3F-3A/B1 modules. Token response/JWKS access happens in Electron main. Browser receives only generic callback success/failure text. Browser session may remain active after local sign-out.

**Activation gates:** actual platform must be Windows; `app.isPackaged` false; not the disposable local guest test profile; Windows `safeStorage.isEncryptionAvailable()` true; operator home-directory config file present and verified. No environment-variable or renderer-provided identity configuration is accepted. If any gate fails, the API returns `{enabled:false,authenticated:false,pending:false}` and the Settings card is hidden. Build packages remain disabled.

## Main/renderer boundaries

- Electron main owns the Auth0 client, PKCE state and encrypted refresh-token vault in `app.getPath('userData')` (separate from Xbox and pilot). On startup it attempts refresh-token rotation when possible; failures leave sign-in unavailable rather than falling back to plaintext.
- The installed top-level-frame IPC authorization function is reused for `capturelink:online-auth-status`, `capturelink:online-auth-begin`, `capturelink:online-auth-sign-out`. The renderer has **no config, JWT, refresh token, access token, client secret, PKCE state, redirect URI or account subject**.
- The Settings screen injects a small CaptureLink Online development card consistent with the existing design. The UI only sees enabled/authenticated/pending booleans and generic results. Xbox sign-out, account discovery, manual P2P, hosted pilot and media paths are not altered.
- The callback listener binds before shell opening and is closed after completion, timeout or sign-out. Failed login can be retried. Sign-out invalidates any pending code and clears only the CaptureLink Online vault. App shutdown closes the listener but does **not** delete a valid refresh token.

## Deliberate exclusions / required follow-up

1. This stage **does not** implement real public `/v2` host or account-free guest connectivity. The accepted UX3F-3B1 client is still intentionally `127.0.0.1`-only and is **not** in the active `HostedSignalingBridge` path. It would be misleading to call an authenticated status a successful live online session.
2. No provider-side Auth0 `/oauth/revoke`, tenant account revocation lookup, backend token verifier deployment or server-side active-account signal is integrated. Sign-out revokes local authority only. A JWT already issued to an external server remains valid until expiration unless the server performs account/revocation checks.
3. Windows-specific DPAPI/Electron `safeStorage` operation, built app login redirect, actual Auth0 development account and wrong-password/error flows require **JPCMAIN interactive acceptance**. Unix Node unit tests cannot prove them.
4. Existing dependency advisories remain subject to separate release-security review. Never run `npm audit fix --force` as part of this patch.
5. Fixed-port native-app callback hijacking by another local process is a residual risk. OAuth PKCE/state validation limits impact; final production callback strategy and Microsoft Store/code-signing distribution require separate review.

## Historical source guard reconciliation

UX3F-2/3A/3B1 and the historical UX3F-1 smoke scripts hash-pin `src/main/index.ts`, preload, renderer main and (for 3A) renderer global typing. UX3F-3B2 necessarily changes those exact surfaces in an **explicit, reviewed authorization expansion**. The new hashes in those guard scripts must not be mistaken for evidence that the old source is byte-for-byte unchanged: the revised checks preserve unchanged source content of Xbox, v1/v2 broker, pilot enrollment, vault, controller and manual P2P, and the new UX3F-3B2 guard pins the full intended new source content. Verify the diff and run the legacy smoke checks before acceptance.

## Required acceptance before PR

On JPCMAIN WSL Node 24.x, run all `services/signaling/test/*.test.mjs`, all UX3F guards and `git diff --check`; new total should be 164 tests with no skips on Linux. On Windows PowerShell, `npm ci`, `npm run typecheck`, `npm run build`, all new and existing tests, source smokes and guard checks. Expect 158 passed and 6 skips from the 164-case suite (Windows symlink privilege unavailable). Existing project PowerShell-to-WSL Git worktree metadata issue means perform Git queries in WSL, not Windows. Run a staged Gitleaks scan using the correct CLI syntax. Stop if old source guards or Windows compile fail.

**Only after Windows offline acceptance**, create the operator home-directory JSON file with the verified Auth0 domain, launch an unpackaged Windows dev build and test real browser sign-in and sign-out; do not send screenshots of access tokens or callback codes. Do not deploy or merge on offline source tests alone.

## UX3F-3B2 local operator acceptance (November 13, 2026)

- Linux full signaling suite: 164 passing, zero failures; real symlink-rejection test exercised.
- Windows Node signaling suite after permission-limited symlink test repair: 158 passing,
  six expected skips, zero failures; TypeScript and Electron production build passed.
- Source-boundary checks and relevant legacy smoke tests passed.
- Auth0 Google login and local OAuth callback completed successfully after
  `CaptureLink Desktop Dev` received the API's user-delegated `sessions:create` grant.
- Auth0 offline access and native refresh-token rotation were enabled in the
  development tenant; the operator reports that Online sign-in survives an app restart.
- Online sign-out worked and Xbox remained signed in independently.
- No public v2 broker integration, production Auth0 deployment, installer enablement,
  release signing, public guest invitation acceptance, or server-side revocation tests.
- Do not collect or paste callback URLs with authorization codes, bearer credentials,
  or encrypted-refresh-vault bytes in acceptance evidence.
