# Filey

Filey is a one-stop local file compression, conversion, and manipulation tool. The product goal is to replace a bunch of paid Mac utilities with one free local app.

This `AGENTS.md` is the Codex-native project instruction file migrated from the old `CLAUDE.md`. Treat `CLAUDE.md` and `.claude/` as legacy compatibility artifacts until Adam approves cleanup.

## Stack

- Node.js and Express backend.
- Vanilla HTML/CSS/JS frontend.
- `sharp` for image processing.
- `exiftool-vendored` for lossless metadata stripping.
- FFmpeg for video, GIF, and audio processing.

## Running

```bash
npm start
```

The app opens at `http://localhost:3456`.

The old Claude launch config also used:

```bash
node server.js
```

## Current Tools

1. Image Compressor and Converter: format conversion across PNG, JPG, HEIC, and WebP; ImageOptim-style optimization; metadata stripping; quality control; resize by scale; target file size; HEIC support through macOS `sips` fallback.
2. Video Compressor and Converter: compression with codec selection, MP4/MOV output, resolution presets, trim controls, audio options, denoise filter, target file size, and source resolution detection.
3. GIF Maker: video to GIF using `gifski` with FFmpeg fallback, FPS control, width presets, trim, target file size, and `gifsicle` post-optimization.
4. PDF Compressor: Ghostscript-based compression with low, medium, high, and lossless presets plus a never-bigger guarantee.
5. Audio and Video Transcriber: local OpenAI Whisper transcription with TXT/SRT/VTT outputs.
6. SVG Optimizer: lossless SVG optimization via `svgo`.

## UX Rules

- All tools have an editable suffix input, defaulting to `-filey`.
- Smart suffix suggestions should update from settings, for example `-1080p` for video downscaling and `-720px` for GIF width.
- Video converter should detect and display source resolution on file drop.
- GIF maker should offer preset widths plus a custom width input.
- All target size inputs should support a KB/MB toggle.
- Each file should have an X button to remove it.
- Removing all files should hide controls.
- Results should show a prominent savings percentage with before/after sizes and a reveal-in-Finder button.

## Structure

- `server.js`: Express server and processing APIs.
- `public/`: frontend assets, including `index.html`, `style.css`, and `app.js`.

## Dependencies

Core:

```bash
npm install
brew install ffmpeg
```

Optional image optimization tools:

```bash
brew install mozjpeg oxipng pngquant jpegoptim advancecomp zopfli gifsicle gifski
```

Optional PDF compression:

```bash
brew install ghostscript
```

Optional transcription:

```bash
pip3 install openai-whisper
```

Optional SVG optimization:

```bash
npm install -g svgo
```

All optional tools should gracefully degrade. If a tool is missing, Filey should fall back to `sharp`, FFmpeg, or the available lower-level path.

## Roadmap Bias

The long-term direction is to cover the useful local workflows from ImageOptim, Compress, Resize Master, PhotoBulk, HandBrake, Permute, Video Compressor, Gifski, and PDF Squeezer without adding cloud dependence.

Prefer practical batch processing, transparent file-size savings, Finder-friendly output, and predictable local behavior over SaaS-style account flows.

Important future areas:

- Exact-dimension and max-dimension image resize.
- Watermarking, batch renaming, DPI control, presets, and previews.
- More video input/output formats and device presets.
- Hardware-accelerated encoding where available on Mac.
- Better GIF preview and loop controls.
- PDF merge/split and metadata stripping.
- Audio conversion and extraction.
- Finder Quick Actions, keyboard shortcuts, drag-out outputs, theme support, and remembered settings.

## Safety

- Do not install optional tools globally without Adam explicitly approving that install.
- Do not overwrite source files. Output transformed files separately using the configured suffix.
- Treat user-selected local files as private. Do not upload them to external services unless Adam explicitly asks for a cloud/API path.
