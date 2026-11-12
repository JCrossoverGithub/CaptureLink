# CaptureLink UX3b1.3 — Invite interaction recovery

## Scope

This patch fixes three issues observed in live Windows acceptance:

1. **Type mismatch:** the guest-name IPC was updated to `join(code, displayName)` but `src/main/hosted-signaling-bridge.d.mts` still declared one parameter. This caused `TS2554` even though Vite emitted a JS bundle.
2. **Silent modal close:** the guest-name dialog closed before the server acknowledged the join. Now it remains open while submitting, shows broker errors inline, preserves the entered name and invitation code, and allows a retry. Only a successful broker join closes it.
3. **Accidental drawer dismissal:** clicking a live invitation could dismiss the Friend drawer. The invitation field now selects its text; clicking the backdrop no longer dismisses Friends while the explicit **Close** button and Escape retain normal behavior.

The broker's existing `invalid_invitation` response generally means the provided code is not known to the **current running broker**, not that it has invalid characters. The client now reports this more clearly.

This patch does not change Xbox controller/video/microphone transports, the broker's security model, or the existing permissions. It has no commits or deployment actions.

## Apply (JPCMAIN WSL Bash)

```bash
cd /mnt/c/Users/thede/projects/CaptureLink-ux3b1-electron
PATCH=/mnt/c/Users/thede/Downloads/CaptureLink_UX3B1_Join_And_Code_Recovery
unzip -q "$PATCH.zip" -d "$PATCH"
python3 "$PATCH/apply_ux3b1_recovery.py" --check && python3 "$PATCH/apply_ux3b1_recovery.py" --apply
```

Type `exit` to return to **Windows PowerShell**. Never paste PowerShell scripts in WSL.

## Verify (Windows PowerShell)

```powershell
cd C:\Users\thede\projects\CaptureLink-ux3b1-electron
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw "Typecheck failed" }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
node scripts/ux3b1-recovery-smoke.mjs
if ($LASTEXITCODE -ne 0) { throw "Recovery smoke failed" }
node --test services/signaling/test/signaling.test.mjs services/signaling/test/client.test.mjs services/signaling/test/desktop-bridge.test.mjs services/signaling/test/guest-name.test.mjs
if ($LASTEXITCODE -ne 0) { throw "Signaling regression failed" }
Write-Host "UX3B1.3 AUTOMATED CHECKS PASSED"
```

The source-only browser fixtures passed in Chromium at 1280px and 470px for code selection, backdrop behavior, failed join retry, preserved name/code, and successful subsequent join. The complete Windows Electron build and real host/guest acceptance must still be run on JPCMAIN.

## Live test and broker version

1. Close host and isolated guest apps (end active test sessions), and stop the **old** signaling server using Ctrl+C in its own PowerShell window. The previous log showed `EADDRINUSE` on 127.0.0.1:8787, meaning an earlier process was already listening. **Only one broker may run.**
2. From a new Windows PowerShell window in the UX3b1 worktree run `node services/signaling/src/server.mjs`. From another run `curl.exe --noproxy "*" http://127.0.0.1:8787/healthz`.
3. Run the host with `npm.cmd run dev`; run the isolated guest with `& .\scripts\launch-ux3b1-local-guest.ps1`.
4. Host makes a **fresh** invitation in the currently running broker. Click the invite code: it should select without closing Friends. Copy privately; do not include it in screenshots or logs.
5. Guest enters it, enters their display name, and submits. If rejected, the dialog stays open with an error instead of disappearing. The host should see the name (unverified) for explicit approval when accepted.
6. Verify the host can still use the persistent End session controls, that revoked codes no longer work, and that Xbox Remote Play stays connected when friend sharing ends.

**Security:** invitation codes are bearer credentials. Don't print or screenshot live codes. A `curl` health check alone doesn't guarantee you're talking to the new broker version: the old Node listener must actually be stopped and restarted. No public port exposure.

The overall UX3b1 implementation remains experimental and unmerged until live acceptance succeeds.
