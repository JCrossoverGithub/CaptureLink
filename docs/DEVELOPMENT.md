# CaptureLink Development Guide

## Primary environment

CaptureLink is currently developed and validated primarily on Windows.

Current baseline:

```text
Windows 11
Node.js >= 24.19.0
npm
Electron 44.2.0
TypeScript
electron-vite
electron-builder
```

The application uses Electron's Chromium runtime for the Remote Play media path.

## Repository setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/JCrossoverGithub/CaptureLink.git
cd CaptureLink
npm install
```

## Development mode

Start CaptureLink with:

```bash
npm run dev
```

The `predev` hook runs the Xbox player vendoring/verification step first.

## Type checking

Run:

```bash
npm run typecheck
```

This executes TypeScript validation without emitting build artifacts.

## Production application build

Run:

```bash
npm run build
```

The build uses electron-vite to generate:

```text
out/main/
out/preload/
out/renderer/
```

The `prebuild` hook verifies and copies the pinned Xbox player bundle before compilation.

## Xbox player vendoring

The canonical checked-in player artifact is:

```text
third_party/xbox-xcloud-player/xCloudPlayer.min.js
```

Metadata is stored in:

```text
third_party/xbox-xcloud-player/SOURCE.json
```

Prepare the renderer copy with:

```bash
npm run vendor:xbox-player
```

The script:

1. reads the checked-in third-party bundle
2. calculates SHA-256
3. compares it with `SOURCE.json`
4. fails if the digest does not match
5. copies the verified bundle to:

```text
src/renderer/public/vendor/xCloudPlayer.min.js
```

Do not silently replace the vendored bundle.

Any update should include updated provenance, version information, license review, and a new recorded SHA-256.

## Authentication data

Xbox authentication material is runtime/user data and must never be committed.

CaptureLink stores authentication material beneath Electron's application-data directory in:

```text
xbox-auth/.xbox.tokens.json
```

The exact parent directory is resolved through Electron's `app.getPath('userData')`.

Never add personal token files to test fixtures, documentation, or commits.

## FFmpeg during development

CaptureLink can resolve FFmpeg from multiple locations.

Resolution order is documented in `docs/EXPORTS.md`.

Developers can explicitly provide an executable with:

```powershell
$env:CAPTURELINK_FFMPEG = "C:\path\to\ffmpeg.exe"
```

The development dependency `ffmpeg-static` can also provide the runtime used by the export implementation.

## Windows installer

Build the Windows NSIS installer with:

```bash
npm run dist:win
```

The command performs the application build and then invokes electron-builder.

Expected release artifacts are written beneath:

```text
release/
```

The primary installer is:

```text
CaptureLink-Setup-0.1.0.exe
```

A corresponding unpacked application is produced beneath:

```text
release/win-unpacked/
```

## Packaged resources

The current Windows package includes:

```text
resources/ffmpeg/ffmpeg.exe
resources/CaptureLink.ico
resources/licenses/THIRD_PARTY_NOTICES.md
resources/licenses/xal-node-LICENSE.txt
resources/licenses/ffmpeg-static-LICENSE.txt
resources/licenses/electron-LICENSE.txt
resources/licenses/xbox-xcloud-player/SOURCE.json
resources/licenses/xbox-xcloud-player/UPSTREAM_PACKAGE.json
resources/licenses/xbox-xcloud-player/README.md
```

The packaged renderer also contains the verified Xbox player bundle generated during the build.

## Packaging verification

After changing package/runtime configuration:

```powershell
npm run typecheck
git diff --check

if (Test-Path .\release) {
    Remove-Item .\release -Recurse -Force
}

npm run dist:win
```

Then inspect:

```powershell
Get-ChildItem .\release -File |
    Select-Object Name, Length

Get-Item .\release\win-unpacked\CaptureLink.exe |
    Select-Object Name, Length, VersionInfo |
    Format-List
```

Confirm bundled resources:

```powershell
Get-Item .\release\win-unpacked\resources\CaptureLink.ico
Get-Item .\release\win-unpacked\resources\ffmpeg\ffmpeg.exe
```

## Installed-build smoke test

A release candidate should be tested from the installed application, not only `npm run dev`.

At minimum verify:

1. installer launches
2. application installs
3. application/shortcut icons appear correctly
4. CaptureLink launches
5. Xbox authentication works
6. console discovery works
7. Remote Play connects
8. video is visible
9. Xbox audio is audible
10. gameplay input works in the intended configuration
11. microphone controls behave correctly
12. a short recording succeeds
13. the recording appears in the library
14. the recording plays
15. at least one converted export succeeds
16. disconnect and application shutdown behave normally

Long-session testing should also be performed before a broader release.

## Git workflow

Feature work should normally happen on a focused branch.

Completed branches should be merged into `main` and removed after Git confirms their commits are reachable from `main`.

Before committing:

```powershell
git diff --check
npm run typecheck
git status
```

Before deleting a branch:

```powershell
git branch --merged main
git branch -r --merged main
```

Do not delete work that has not been verified as merged.

## Generated/build directories

Build output and runtime-generated files should not become accidental source-of-truth artifacts.

The repository should treat checked-in source, configuration, documented third-party artifacts, and lockfiles as authoritative.

`out/`, `release/`, runtime authentication data, and other generated state should remain ignored unless there is a deliberate reason to version a specific artifact.

## Documentation

When behavior changes, update the relevant document rather than leaving milestone-era assumptions behind.

Primary documents:

```text
README.md
docs/ARCHITECTURE.md
docs/DEVELOPMENT.md
docs/PROJECT_HISTORY.md
docs/RECORDING.md
docs/EXPORTS.md
docs/ROADMAP.md
docs/RELEASE_SCOPE.md
docs/LEGAL_REVIEW.md
THIRD_PARTY_NOTICES.md
```

Known issue investigations belong under:

```text
docs/known-issues/
```
