# Third-Party Notices

CaptureLink uses third-party software. Each component remains subject to its own license and terms.

This file is an attribution and provenance summary. It is not a substitute for preserving license texts or notices required by the applicable licenses.

Packaged CaptureLink builds include a copy of this notice and the preserved third-party license/provenance files under the application's `resources/licenses` directory.

## xbox-xcloud-player

**Project:** xbox-xcloud-player
**Version:** 1.0.0-beta7
**Author:** Jim Kroon / UnknownSKL
**Repository:** https://github.com/unknownskl/xbox-xcloud-player
**License:** MIT

CaptureLink includes a pinned browser bundle from this project for the Xbox xCloud/xHome WebRTC player and control layer.

The canonical vendored artifact is stored at:

- third_party/xbox-xcloud-player/xCloudPlayer.min.js

Its provenance and integrity metadata is stored at:

- third_party/xbox-xcloud-player/SOURCE.json

CaptureLink verifies the artifact SHA-256 before copying it into the renderer build.

The exact published npm package metadata is preserved at:

- third_party/xbox-xcloud-player/UPSTREAM_PACKAGE.json

The `1.0.0-beta7` package metadata declares the project license as MIT. However, the inspected npm package did not contain a standalone LICENSE, LICENCE, COPYING, or NOTICE file.

CaptureLink does not reconstruct an upstream license text that was not distributed with the inspected package. Resolving the appropriate license-notice treatment remains part of the release review.

CaptureLink does not claim authorship of xbox-xcloud-player.

## xal-node

**Project:** xal-node
**Resolved CaptureLink version:** 1.1.5
**Repository:** https://github.com/unknownskl/xal-node
**License:** MIT

CaptureLink uses xal-node for Xbox Authentication Library functionality.

The installed upstream license text is preserved at:

- third_party/licenses/xal-node-LICENSE.txt

CaptureLink does not claim authorship of xal-node.

## FFmpeg / ffmpeg-static

**npm package:** ffmpeg-static
**Resolved CaptureLink version:** 5.3.0
**Repository:** https://github.com/eugeneware/ffmpeg-static
**Package license metadata:** GPL-3.0-or-later

CaptureLink uses FFmpeg as an optional external process for post-recording conversion.

The `ffmpeg-static` package remains a development dependency, but CaptureLink v0.1 does not redistribute its `ffmpeg.exe` in the Windows installer.

The previously bundled executable was audited as Gyan.dev FFmpeg 6.1.1 essentials, GPLv3, with SHA-256:

`04E1307997530F9CF2FE35CBA2CA7E8875CA91DA02F89D6C7243DF819C94AD00`

The `ffmpeg-static` package license text is preserved at:

- `third_party/licenses/ffmpeg-static-LICENSE.txt`

See `docs/FFMPEG.md` for the audit and v0.1 distribution decision.


## Electron

**Project:** Electron
**Resolved CaptureLink version:** 44.2.0
**Website:** https://www.electronjs.org/

CaptureLink uses Electron as its desktop runtime, combining Chromium with desktop application APIs.

Electron's primary upstream license text is preserved at:

- third_party/licenses/electron-LICENSE.txt

Electron's packaged runtime also carries Chromium and other third-party notices. CaptureLink does not duplicate Electron's approximately 20 MB `LICENSES.chromium.html` in this source repository.

Electron itself includes additional third-party software and notices governed by the Electron distribution.

## Microsoft / Xbox services

CaptureLink interoperates with Microsoft/Xbox services used for authentication, console discovery, and Xbox Remote Play.

Microsoft and Xbox software, services, protocols, names, and trademarks are not CaptureLink source code and are not licensed by this repository.

CaptureLink is an independent project and is not affiliated with, endorsed by, sponsored by, or supported by Microsoft Corporation or Xbox.

## Additional npm dependencies

The exact npm dependency graph for a CaptureLink revision is recorded by:

- package.json
- package-lock.json

Before public binary distribution, the complete distributed dependency set should be reviewed and any required third-party license texts or notices preserved.

## CaptureLink's own license

No third-party license listed above automatically determines the license of CaptureLink's original application code.

CaptureLink's root application license remains a separate release decision pending completion of the project's provenance and distribution review.
