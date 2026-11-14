# RemoteGlass covered open-source components

This repository contains the noVNC and noVNC-ARD components used by RemoteGlass,
including local modifications. Covered source and modifications are available
under the Mozilla Public License 2.0 (see LICENSE). Incorporated components keep
their original notices and licenses, including Pako (MIT) and the IJG IDCT terms.
This software is based in part on the work of the Independent JPEG Group.

RemoteGlass's proprietary Swift app, interface, services, signing material,
private repository history and standalone app JavaScript are not included.
This is a component source release, not a release of the RemoteGlass app.

## Contents and provenance

- Vendor/noVNC/core: noVNC 1.7.0 with RemoteGlass modifications to frame updates,
  remote cursor handling, keyboard/input, clipboard and transport integration.
- Vendor/noVNC/vendor: incorporated upstream Pako source and MIT license.
- Vendor/noVNC/docs: upstream documentation and complete license texts.
- Vendor/noVNC-ARD/ard: ARD extensions, protocol code, tests, and local native
  media adapters, file transfer, display/session handling and MVS acceleration.
  The upstream revision is in Vendor/noVNC-ARD/REVISION.
- Tools/build-mvs-wasm.py: generator for the bundled MVS WebAssembly data module;
  generated from the accompanying IDCT, tables, renderer and entropy C source.
- IJG-README.txt: original IJG license/documentation for the IDCT adaptation.
- SOURCE-MANIFEST.json: exact file hashes for this snapshot.

Upstream projects: https://github.com/novnc/noVNC and
https://github.com/peetinc/noVNC-ARD . Existing notices are retained in the files.
Local additions in the covered component directories and the included MVS build
script are distributed under MPL-2.0, subject to incorporated upstream terms.
The upstream IDCT was adapted to JavaScript, separate dequantization and Apple's
range limiting, then compiled to WebAssembly with batched tile/entropy helpers.

Unshipped browser UI/artwork and optional FFmpeg/libav browser audio assets are
omitted. RemoteGlass uses native Apple audio decoding and does not ship those
FFmpeg/libav assets. The optional audio-decoder.js browser fallback references
that omitted library; it is not used by the native integration.

## Build and checks

Node.js is needed for JavaScript checks. To run the decoder tests:

    node --test Vendor/noVNC-ARD/ard/tests/test.mvs*.js

To rebuild the generated MVS module, install clang with wasm32 support and
wasm-ld (for example Homebrew lld), then:

    python3 Tools/build-mvs-wasm.py

The output is Vendor/noVNC-ARD/ard/decoders/mvs-wasm-data.js. No private app
source is required to rebuild that module. JavaScript files are source modules;
RemoteGlass bundles its private entry point with esbuild targeting Safari 17.
The included component entry point can be bundled independently:

    npx --yes esbuild@0.25.12 covered-entry.js --bundle --format=iife --target=safari17 --outfile=covered.js

This verifies component bundling; it does not reproduce the proprietary app.
