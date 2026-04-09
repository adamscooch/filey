# Filey

One free app to replace ImageOptim, HandBrake, Gifski, PDF Squeezer, and more. Local processing, no uploads, no subscriptions.

[![Download Filey](https://img.shields.io/badge/Download-Filey%20for%20Mac-E8923A?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/adamscooch/filey/releases/latest/download/Filey-26.409.2-arm64.dmg) ![Version](https://img.shields.io/github/v/release/adamscooch/filey) ![macOS](https://img.shields.io/badge/macOS-arm64-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## What It Does

Filey is a file compression and conversion toolkit for macOS. Drop files in, get smaller files out. Everything runs locally on your machine.

### Tools

| Tool | What it does | Powered by |
|------|-------------|------------|
| **Image Compressor** | PNG, JPG, HEIC, WebP compression and conversion. Quality slider, target file size, resize, metadata stripping. | sharp, MozJPEG, OxiPNG, pngquant |
| **Video Compressor** | H.264, H.265, AV1 encoding. Resolution presets, trim, denoise, audio control, hardware acceleration. | FFmpeg, VideoToolbox |
| **GIF Maker** | Video to GIF with cross-frame palette optimization. FPS, width, colors, bounce mode. | gifski, gifsicle, FFmpeg |
| **PDF Compressor** | 4 quality presets (low to lossless). Never outputs a larger file. | Ghostscript |
| **Transcriber** | Local speech-to-text from video or audio. Multiple models, SRT/VTT/TXT output. | OpenAI Whisper |
| **SVG Optimizer** | Lossless SVG optimization with multipass. | svgo |

### Features

- Drag and drop everything
- Batch processing with total estimates
- Before/after comparison slider with fullscreen modal
- Custom output suffix (default `-filey`)
- Never-bigger guarantee on images and PDFs
- ImageOptim-style optimization pipeline (MozJPEG + OxiPNG + pngquant)
- Auto-updates from GitHub Releases
- Content Security Policy headers
- All processing is local, nothing leaves your machine

## Install

### Download

Grab the latest DMG from [Releases](https://github.com/adamscooch/filey/releases). Open the DMG, drag Filey to Applications.

On first launch, macOS may warn about unverified software. Right-click the app and choose "Open" to bypass Gatekeeper.

### Build from Source

Requires Node.js 18+ and Homebrew.

```bash
# Clone
git clone https://github.com/adamscooch/filey.git
cd filey

# Install Node dependencies
npm install

# Install CLI tools (optional, for full optimization)
brew install mozjpeg oxipng pngquant jpegoptim advancecomp zopfli gifsicle gifski ghostscript ffmpeg
npm install -g svgo
pip3 install openai-whisper  # for transcription

# Run in browser (development)
npm start
# Opens at http://localhost:3456

# Run as Electron app
npm run electron

# Build distributable
npm run release
```

All CLI tools are optional. Filey gracefully falls back to sharp/FFmpeg if optimization tools aren't installed. The Electron build bundles all detected tools automatically.

## Architecture

- **Backend:** Node.js + Express (`server.js`)
- **Frontend:** Vanilla HTML/CSS/JS (`public/`)
- **Desktop:** Electron with frameless window (`electron-main.js`)
- **Bundling:** `bundle-tools.sh` copies Homebrew binaries + dylibs, rewrites paths for portability
- **Releases:** `release.sh` handles bundle, build (in /tmp to avoid iCloud xattr issues), git tag, and GitHub Release upload

## Apps It Replaces

| App | What Filey covers |
|-----|------------------|
| ImageOptim | Lossless JPEG/PNG optimization with MozJPEG + OxiPNG |
| Compress / PhotoBulk | Batch image resize and format conversion |
| HandBrake / Permute 3 | Video compression with codec selection |
| Video Compressor | Target file size with 2-pass encoding |
| Gifski | High-quality video-to-GIF with cross-frame palettes |
| PDF Squeezer | PDF compression with quality presets |

## License

MIT
