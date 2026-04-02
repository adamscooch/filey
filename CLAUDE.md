# Filey

One-stop file compression, conversion, and manipulation tool. Simple web UI with drag-and-drop. The goal is to replace a bunch of paid Mac utilities with one free local app.

## Stack
- Node.js + Express backend
- Vanilla HTML/CSS/JS frontend
- sharp for image processing
- exiftool-vendored for lossless metadata stripping
- FFmpeg for video/GIF processing

## Running
```
cd Filey
npm start
```
Opens at http://localhost:3456

## Current Tools (v3)
1. **Image Compressor & Converter** — format conversion (PNG/JPG/HEIC/WebP), ImageOptim-style multi-tool optimization (MozJPEG, OxiPNG, ZopfliPNG, AdvPNG, pngquant), lossless metadata stripping (exiftool), quality control, resize by scale, target file size. HEIC support via macOS sips fallback.
2. **Video Compressor & Converter** — compression with codec selection (H.264, H.265, H.264/H.265 VideoToolbox HW, AV1), format (MP4/MOV), resolution presets, trim (start/end time), audio options (passthrough/AAC bitrates/none), denoise filter, target file size, source resolution detection
3. **GIF Maker** — video to GIF via gifski (cross-frame palette optimization, bounce mode) with FFmpeg fallback, FPS control, width presets, trim, target file size, gifsicle post-optimization
4. **PDF Compressor** — PDF compression via Ghostscript with quality presets (low/medium/high/lossless), never-bigger guarantee
5. **Audio & Video Transcriber** — drag video/audio, transcribe with OpenAI Whisper (local), model selection (tiny/base/small/medium), language detection, output as TXT/SRT/VTT, copy-to-clipboard
6. **SVG Optimizer** — lossless SVG optimization via svgo (multipass)

## UX Details
- **Custom suffix**: All tools have an editable suffix input (default `-filey`). Smart suggestions update based on settings (e.g., `-1080p` when downscaling video, `-720px` for GIF width).
- **Resolution presets**: Video converter detects source resolution on file drop and displays it. Dropdown offers standard presets plus custom width input. Aspect ratio is preserved automatically.
- **Width presets**: GIF maker offers preset widths plus custom input.
- **KB/MB toggle**: All target size inputs have a clickable unit toggle.
- **File management**: X button on each file to remove it. Removing all files hides controls.
- **Results**: Prominent savings % (green for smaller, red for larger) with before/after sizes and reveal-in-Finder button.

## Structure
- `server.js` — Express server with processing APIs
- `public/` — Frontend (index.html, style.css, app.js)

## Dependencies

### Core (required)
```
npm install          # sharp, exiftool-vendored, express
brew install ffmpeg  # video/GIF/audio processing
```

### Image Optimization Tools (optional, for ImageOptim-style pipeline)
```
brew install mozjpeg      # Lossless JPEG recompression (better Huffman tables, 5-15% savings)
brew install oxipng       # Fast lossless PNG optimizer (Rust rewrite of OptiPNG)
brew install pngquant     # Lossy PNG quantization (256-color palette, huge savings)
brew install jpegoptim    # JPEG quality optimization
brew install advancecomp  # Re-deflates PNG IDAT with 7-Zip's deflate (advpng)
brew install zopfli       # Google's Zopfli compression for PNG (zopflipng)
brew install gifsicle     # GIF optimization
brew install gifski       # High-quality video-to-GIF (cross-frame palette optimization)
```

### PDF Compression (optional)
```
brew install ghostscript  # PDF compression via Ghostscript
```

### Transcription (optional)
```
pip3 install openai-whisper  # Local speech-to-text
```

### SVG Optimization (optional)
```
npm install -g svgo    # SVG optimizer
```

All optional tools gracefully degrade — if not installed, Filey falls back to sharp/FFmpeg.
To install everything at once:
```
brew install mozjpeg oxipng pngquant jpegoptim advancecomp zopfli gifsicle gifski ghostscript
npm install -g svgo
```

## Vision / Feature Roadmap

The long-term goal is to match the combined functionality of these Mac apps in a single free local tool:

### Apps We're Replacing
| App | Developer | Bundle ID | Open Source? | Repo |
|-----|-----------|-----------|-------------|------|
| ImageOptim | Kornel Lesiński (pornel) | net.pornel.ImageOptim | Yes (GPL v2+) | github.com/ImageOptim/ImageOptim |
| Compress | Seraphin Huguenot (devserahug) | com.devserahug.compress | No | — |
| Resize Master | Boltnev (boltnev) | com.boltnev.Resize-Master | No | — |
| PhotoBulk | Electronic Team (Eltima) | — | No | — |
| HandBrake | HandBrake Team | fr.handbrake.HandBrake | Yes (GPL v2) | github.com/HandBrake/HandBrake |
| Permute 3 | Charlie Monroe Software | com.charliemonroe.Permute-3 | No | — |
| Video Compressor | Lanars (lanars) | com.lanars.videocompressor | No | — |
| Gifski | Sindre Sorhus (GUI) / Kornel Lesiński (encoder) | com.sindresorhus.Gifski | Yes (MIT) | github.com/sindresorhus/Gifski + github.com/ImageOptim/gifski |
| PDF Squeezer | Witt Software | com.witt-software.PDF-Squeezer | No | — |

### Image Processing (inspired by ImageOptim, Compress, PhotoBulk, Resize Master)
- [x] Format conversion (PNG, JPG, HEIC, WebP)
- [x] Lossless metadata stripping (exiftool, not re-encoding)
- [x] Quality slider with target file size
- [x] Resize by scale percentage
- [x] Custom suffix input with smart suggestions
- [ ] Resize by exact dimensions (width/height with aspect ratio lock)
- [ ] Resize by max dimension (fit within rectangle)
- [ ] Batch watermarking (text and image watermarks)
- [ ] Batch renaming
- [ ] DPI control
- [ ] SVG optimization
- [ ] Side-by-side preview (original vs compressed)
- [ ] Saveable presets for repeated workflows
- [ ] Color space conversion (sRGB, AdobeRGB)

### Video Processing (inspired by HandBrake, Permute, Video Compressor)
- [x] Video compression with target file size (2-pass encoding)
- [x] Format conversion (MP4, MOV)
- [x] Scale/resize by percentage
- [x] Resolution presets (4K, 1440p, 1080p, 720p, 480p, custom)
- [x] Source resolution detection and display
- [x] Custom suffix with smart suggestions (e.g., `-1080p`)
- [ ] More input formats (MKV, AVI, WebM, M4V, 3GP)
- [ ] More output formats (MKV, WebM)
- [ ] Codec selection (H.264, H.265/HEVC, VP9, AV1)
- [ ] Audio codec options (AAC, MP3, passthrough)
- [ ] Trim/clip (start time, end time)
- [ ] Batch queue with progress
- [ ] Device presets (iPhone, Android, Twitter, Instagram, etc.)
- [ ] Hardware-accelerated encoding (VideoToolbox on Mac)
- [ ] Video filters (denoise, deinterlace)
- [ ] Subtitle support
- [ ] Audio volume adjustment

### GIF Creation (inspired by Gifski)
- [x] Video to GIF conversion
- [x] FPS and width control
- [x] Width presets (320, 480, 640, 720, 1080, custom)
- [x] Custom suffix with smart suggestions (e.g., `-480px`)
- [x] Target file size
- [ ] Quality slider (pngquant-style cross-frame palettes)
- [ ] Bounce/reverse loop mode
- [ ] Speed adjustment
- [ ] Trim (start/end time before converting)
- [ ] Frame-by-frame preview

### PDF Processing (inspired by PDF Squeezer)
- [ ] PDF compression (reduce embedded image quality)
- [ ] Remove duplicate resources and unnecessary fonts
- [ ] Strip PDF metadata
- [ ] Batch compress folders
- [ ] Side-by-side size comparison
- [ ] PDF merge (combine multiple PDFs)
- [ ] PDF split (extract pages)

### Audio Processing (inspired by Permute)
- [ ] Audio format conversion (MP3, AAC, WAV, FLAC, OGG)
- [ ] Audio compression/bitrate control
- [ ] Extract audio from video
- [ ] Batch processing

### General UX Goals
- [x] Drag-and-drop everything
- [x] Prominent savings % display (like ImageOptim)
- [x] Custom editable suffix on output files (default `-filey`)
- [x] Smart suffix suggestions based on tool settings
- [x] KB/MB toggle on file size inputs
- [x] X button to clear files
- [ ] Finder Quick Action / Services integration
- [ ] Dark/light theme
- [ ] Keyboard shortcuts
- [ ] Drag output files out of the app
- [ ] Remember last-used settings per tool
