# CaptureLink V1.6 UX1a — Stream entry and Shared Session drawer

**Base:** PR #7 (`a11c4f1`), V1.6 design-only commit `0ce9166`.
**Status:** Experimental source patch. No production acceptance or Xbox live test.

## Included

- Stream header with **Play on my Xbox**, **Join a friend**, **Invite friend**, **Session**, and collapsible **Details**.
- Video-first Stream layout; existing console/context rail collapses without losing event handlers.
- Accessible keyboard-dismissable Shared Session drawer with the current V1.5 controller and voice panels. Their DOM nodes are *moved*, not reconstructed, preserving listeners, device controls and authorization gates.
- Host/guest/idle presentation derived from the current V1.5 session source. Status differentiates started controller workflow from verified transport and guest mixer attachment from party chat audibility.
- Reduced Stream clutter without changing media negotiation, recording, controller authority, microphone access, or session authentication.

## Intentionally deferred

- Real single-code invitations, authenticated participant identity, comprehensive state coordinator and automatic permission transitions (UX2–UX4).
- Consolidated mic/controller invite exchange; existing two-code steps remain explicitly displayed.
- Testing of microphone and controller on a real Xbox after the new layout change.

## Acceptance gates on JPCMAIN

1. `npm.cmd run typecheck` and `npm.cmd run build` in **Windows PowerShell**.
2. `node scripts/unified-session-ux1-smoke.mjs` and the six V1.5 voice/controller smoke tests.
3. `npm.cmd run test:recording-mp4` and `npm.cmd run test:recording-finalization`.
4. Launch dev app: idle Xbox connect, guest join without sign-in, host invite, actual controller/voice exchange, stage ratio at 16:9 and 4:3, fullscreen, keyboard Escape, focus return, Diagnostics accessible under Details/Settings, and no Xbox mic activation without host consent.
5. Do not merge or package for release until Windows and live acceptance. The app version stays 0.2.1.

## Important UX limitation

The controller P2P and voice P2P connections are not yet cryptographically bound to one remote identity. The drawer describes transport activity but deliberately does not assert a single verified participant or Xbox chat audibility. UX2 needs explicit identity binding and accurate connection-state evidence.
