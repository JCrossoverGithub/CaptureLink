# CaptureLink Pre-Release Legal and Distribution Review

This document is an engineering/release checklist, not legal advice.

Its purpose is to prevent CaptureLink from treating legal, licensing, privacy, trademark, and redistribution questions as implicit assumptions.

## Current project status

CaptureLink is an independent project.

It is not affiliated with, endorsed by, sponsored by, or supported by Microsoft Corporation or Xbox.

The repository is public, but CaptureLink's own final application-license and binary-distribution posture has not yet been selected.

The Windows installer currently builds successfully but is not Authenticode-signed.

## Microsoft and Xbox

Before broad public distribution:

- [ ] Review the current Microsoft Services Agreement relevant to the intended use.
- [ ] Review Xbox-specific terms relevant to Remote Play and application behavior.
- [ ] Confirm that the planned public distribution model is consistent with applicable service terms.
- [ ] Review use of Microsoft/Xbox names in documentation.
- [ ] Review application artwork for trademark concerns.
- [ ] Avoid language implying Microsoft endorsement, partnership, certification, or official status.

CaptureLink should describe itself as an independent application that interacts with Xbox Remote Play services used by the user's account and console.

## Recording and privacy

CaptureLink can record gameplay audio, video, voice communications received through Remote Play, and optionally a local microphone.

Before a public technical preview:

- [ ] Add clear user-facing recording disclosure.
- [ ] Explain that voice communications may be included in recordings.
- [ ] Explain that the user's local microphone may be included when enabled.
- [ ] Avoid implying that CaptureLink determines whether another participant has consented to recording.
- [ ] Remind users that recording/privacy/consent requirements vary by jurisdiction and context.
- [ ] Document where CaptureLink stores recordings and authentication material.

## xbox-xcloud-player

CaptureLink includes a pinned browser bundle identified as:

```text
xbox-xcloud-player 1.0.0-beta7
Jim Kroon / UnknownSKL
https://github.com/unknownskl/xbox-xcloud-player
MIT
```

Release-readiness tasks:

- [ ] Resolve the upstream license-notice requirement: the published beta7 package declares MIT but the inspected npm tarball contains no standalone license text.
- [x] Record project/version/repository metadata.
- [x] Record the vendored bundle SHA-256.
- [x] Credit the upstream project in CaptureLink documentation.
- [x] Avoid claiming the upstream player implementation as original CaptureLink work.

The checked-in artifact is tracked under:

```text
third_party/xbox-xcloud-player/
```

## xal-node

CaptureLink depends on `xal-node` for Xbox Authentication Library functionality.

The upstream project identifies itself as MIT licensed.

Release-readiness tasks:

- [x] Confirm the exact version resolved in the release lockfile (1.1.5).
- [x] Preserve the installed upstream MIT license text in the repository and packaged notice bundle.
- [x] Credit the project in third-party documentation.

## FFmpeg and ffmpeg-static

CaptureLink uses FFmpeg for optional post-recording conversion.

The FFmpeg binary previously bundled through `ffmpeg-static@5.3.0` was audited during v0.1 release preparation.

The exact binary was identified as:

- FFmpeg 6.1.1
- Gyan.dev essentials build
- static Windows x64 executable
- GPL version 3
- `--enable-gpl`
- `--enable-version3`
- `--enable-static`
- `--enable-libx264`
- `--enable-libx265`
- no `--enable-nonfree`
- SHA-256 `04E1307997530F9CF2FE35CBA2CA7E8875CA91DA02F89D6C7243DF819C94AD00`

The original Gyan.dev archive was independently downloaded and its `ffmpeg.exe` matched the executable previously packaged by CaptureLink exactly by SHA-256.

The archive records FFmpeg source commit `e38092ef93`, its build configuration, and versions of its external libraries.

Because this is a statically linked GPLv3 build incorporating numerous external libraries, CaptureLink would need a complete corresponding-source distribution strategy before redistributing that executable confidently.

### v0.1 decision

- [x] Identify the exact previously redistributed binary.
- [x] Identify its effective license as GPLv3.
- [x] Confirm that `--enable-nonfree` is not enabled.
- [x] Confirm original Gyan.dev binary provenance by SHA-256.
- [x] Record its FFmpeg source revision and external-library versions.
- [x] Stop redistributing the FFmpeg executable in the v0.1 Windows installer.
- [x] Preserve FFmpeg and `ffmpeg-static` provenance documentation.
- [x] Keep converted exports available through externally supplied FFmpeg.

CaptureLink invokes FFmpeg as a separate external process.

See `docs/FFMPEG.md`.


## Other npm dependencies

Before public release:

- [ ] Generate an inventory of production and distributed dependencies.
- [ ] Review licenses in the final dependency tree.
- [ ] Preserve notices required by those licenses.
- [ ] Confirm that build-only dependencies do not create unexpected redistribution obligations.

The lockfile, not memory or a development machine's global packages, should be the source of truth for exact dependency versions.

## CaptureLink application license

Do not select CaptureLink's own license merely because individual dependencies use MIT or another permissive license.

Before adding a root `LICENSE`:

- [ ] Complete the upstream-code provenance review.
- [ ] Complete the FFmpeg distribution review.
- [ ] Confirm whether any copied/adapted implementation requires additional terms.
- [ ] Decide the desired permissions for CaptureLink's own source code.
- [ ] Add the chosen root license intentionally.

Third-party components retain their own licenses regardless of CaptureLink's eventual application license.

## Code signing

The current Windows executable and installer are not Authenticode-signed.

Before a wider Windows release:

- [ ] Decide whether v0.1 requires code signing.
- [ ] If signing, select certificate/signing infrastructure.
- [ ] Verify the installed executable and installer signatures.
- [ ] Document signing/release verification steps.

## Release checklist

A public technical preview should not be declared ready until the unresolved items above have either:

1. been completed, or
2. been explicitly accepted as a documented release decision.

The release should include accurate third-party attribution and should not rely on stale assumptions from earlier development milestones.
