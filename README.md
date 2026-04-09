# Filey

[![Download Filey for Mac](https://img.shields.io/badge/Download_for_Mac-Latest_Version-2ea44f?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/adamscooch/filey/releases/latest)

![Version](https://img.shields.io/github/v/release/adamscooch/filey) ![macOS](https://img.shields.io/badge/macOS-arm64-blue) ![License](https://img.shields.io/badge/license-MIT-green)

*macOS only for now. Windows support is on the roadmap.*

> **Note:** Filey is in beta. If you find bugs or have feature ideas, [open an issue](https://github.com/adamscooch/filey/issues).

## Why I Built This

I manage ecommerce websites and email marketing for multiple brands. Every day I'm uploading product photos to Shopify, rebuilding landing pages, compressing videos for PDPs, converting screenshots for email campaigns. The file prep alone was eating a lot of time.

I had ImageOptim for lossless JPEG compression. Permute for video conversion. HandBrake when I needed more codec control. Gifski for making GIFs from video clips. PDF Squeezer for compressing sell sheets. A separate app for resizing. Another for format conversion. Another for metadata stripping.

That's six or seven apps just to get files ready to upload. I'd drag a PNG into one app to resize it, then drag the output into another app to convert it to JPEG, then drag that into a third app to compress it. Three apps, three windows, three sets of settings for what should be one operation.

Filey does all of it. Drop your files in, pick your settings, get compressed output. One app, one window. Everything runs locally on your machine, nothing gets uploaded anywhere.

It's still a beta. And I don't claim to be an app developer. I'm a rookie vibecoder that usually works on ecom stuff. This app has rough edges and missing features. But it already handles the daily workflow that used to require half a dozen paid apps. PLEASE give your feedback by opening issues. I'd love to make this thing bug-free and feature-rich, but also still be simple to use. Handbrake was a visual nightmare for me lol.

## What It Does

Drop files in, get smaller files out. Six tools in one window.

| Tool | What it does | Powered by |
|------|-------------|------------|
| **Image Compressor** | PNG, JPG, HEIC, WebP compression and conversion. Quality slider, target file size, resize, metadata stripping. | sharp, MozJPEG, OxiPNG, pngquant |
| **Video Compressor** | H.264, H.265, AV1 encoding. Resolution presets, trim, denoise, audio control, hardware acceleration. | FFmpeg, VideoToolbox |
| **GIF Maker** | Video to GIF with cross-frame palette optimization. FPS, width, colors, bounce mode. | gifski, gifsicle, FFmpeg |
| **PDF Compressor** | 4 quality presets (low to lossless). Never outputs a larger file. | Ghostscript |
| **Transcriber** | Local speech-to-text from video or audio. Multiple models, SRT/VTT/TXT output. | OpenAI Whisper |
| **SVG Optimizer** | Lossless SVG optimization with multipass. | svgo |

### Other stuff

- Drag and drop everything
- Batch processing with size estimates
- Before/after comparison slider with fullscreen view
- Custom output suffix (default `-filey`)
- Never-bigger guarantee on images and PDFs
- ImageOptim-style optimization pipeline (MozJPEG + OxiPNG + pngquant)
- Auto-updates from GitHub Releases
- All processing is local, nothing leaves your machine
- All CLI tools are bundled in the app, no Homebrew or terminal needed

## Install

Download the DMG from the [latest release](https://github.com/adamscooch/filey/releases/latest). Open it, drag Filey to Applications.

On first launch, macOS may say it can't verify the app. Right-click the app icon and choose "Open" to get past this. You only have to do it once.

Filey auto-updates. When a new version is available, the app will ask if you want to download and install it.

## Feedback

This is a beta. Things will break. If something doesn't work right, or if you have an idea for a feature:

[Open an issue on GitHub](https://github.com/adamscooch/filey/issues)

## Apps It Replaces

| App | What Filey covers |
|-----|------------------|
| ImageOptim | Lossless JPEG/PNG optimization with MozJPEG + OxiPNG |
| Compress / PhotoBulk | Batch image resize and format conversion |
| HandBrake / Permute 3 | Video compression with codec selection |
| Video Compressor | Target file size with 2-pass encoding |
| Gifski | High-quality video-to-GIF with cross-frame palettes |
| PDF Squeezer | PDF compression with quality presets |

## Build from Source

Requires Node.js 18+ and Homebrew. Most people should just download the app above.

```bash
git clone https://github.com/adamscooch/filey.git
cd filey
npm install
npm start          # Run in browser at localhost:3456
npm run electron   # Run as desktop app
npm run release    # Build and publish a release
```

## Like it?

If Filey saves you time, [give it a star on GitHub](https://github.com/adamscooch/filey). It helps other people find it.

## License

MIT

## Author

Built by [Adam Anderson](https://github.com/adamscooch) at [Scooch](https://scooch.com).
