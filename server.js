const express = require("express");
const { execFile, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const sharp = require("sharp");
const { exiftool } = require("exiftool-vendored");

const app = express();
const PORT = 3456;
// Version: package.json uses semver YY.MDD.N (e.g. 26.402.1)
// Display format: YYMMDD.N (e.g. 260402.1)
const PKG_VERSION = require("./package.json").version;
const APP_VERSION = PKG_VERSION.replace(/^(\d+)\.(\d+)\.(\d+)$/, (_, yy, mdd, n) =>
  `${yy}${mdd.padStart(4, "0")}.${n}`
);

// Bundled binary directory (set by Electron or bundle-tools.sh)
const FILEY_BIN = process.env.FILEY_BIN_DIR || path.join(__dirname, "bin");
const FILEY_LIB = path.join(FILEY_BIN, "lib");

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "1mb" }));

// Graceful shutdown — exiftool spawns a persistent process
process.on("SIGINT", async () => {
  await exiftool.end();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await exiftool.end();
  process.exit(0);
});

// --- File finding ---

function searchCommonDirs(fileName, fileSize) {
  const homedir = os.homedir();
  const searchDirs = [
    path.join(homedir, "Desktop"),
    path.join(homedir, "Downloads"),
    path.join(homedir, "Documents"),
    path.join(homedir, "Movies"),
    path.join(homedir, "Pictures"),
    homedir,
  ];

  for (const dir of searchDirs) {
    try {
      const candidate = path.join(dir, fileName);
      const stat = fs.statSync(candidate);
      if (!fileSize || stat.size === fileSize) return candidate;
    } catch (_) {}
  }
  return null;
}

// Deep search using `find` — covers cloud storage, nested folders
function deepFindFile(fileName, fileSize) {
  return new Promise((resolve) => {
    const homedir = os.homedir();
    const searchRoots = [
      path.join(homedir, "Library", "CloudStorage"),
      path.join(homedir, "Desktop"),
      path.join(homedir, "Downloads"),
      path.join(homedir, "Documents"),
      path.join(homedir, "Movies"),
      path.join(homedir, "Pictures"),
    ];

    // Only search roots that exist
    const existingRoots = searchRoots.filter((d) => {
      try { return fs.statSync(d).isDirectory(); } catch (_) { return false; }
    });

    if (existingRoots.length === 0) return resolve(null);

    const args = existingRoots.concat(["-name", fileName, "-type", "f", "-maxdepth", "10"]);
    execFile("find", args, { timeout: 15000 }, (err, stdout) => {
      const candidates = (!err && stdout) ? stdout.trim().split("\n").filter(Boolean) : [];

      if (fileSize) {
        for (const candidate of candidates) {
          try {
            const stat = fs.statSync(candidate);
            if (stat.size === fileSize) return resolve(candidate);
          } catch (_) {}
        }
      }

      resolve(candidates.length > 0 ? candidates[0] : null);
    });
  });
}

function mdfindByExactName(fileName) {
  return new Promise((resolve) => {
    execFile("mdfind", [`kMDItemFSName == '${fileName}'`], (err, stdout) => {
      resolve((!err && stdout) ? stdout.trim().split("\n").filter(Boolean) : []);
    });
  });
}

function mdfindByName(fileName) {
  return new Promise((resolve) => {
    execFile("mdfind", ["-name", fileName], (err, stdout) => {
      resolve((!err && stdout) ? stdout.trim().split("\n").filter(Boolean) : []);
    });
  });
}

function matchBySize(candidates, fileSize) {
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.size === fileSize) return candidate;
    } catch (_) {}
  }
  return null;
}

async function findFileOnDisk(fileName, fileSize) {
  // 1. FAST: check common directories first (instant, direct path check)
  const found = searchCommonDirs(fileName, fileSize);
  if (found) return found;

  const foundAny = searchCommonDirs(fileName, null);
  if (foundAny) return foundAny;

  // 2. MEDIUM: Spotlight search (fast index-based)
  let candidates = await mdfindByExactName(fileName);
  let sizeMatch = matchBySize(candidates, fileSize);
  if (sizeMatch) return sizeMatch;
  if (candidates.length > 0) return candidates[0];

  candidates = await mdfindByName(fileName);
  sizeMatch = matchBySize(candidates, fileSize);
  if (sizeMatch) return sizeMatch;
  if (candidates.length > 0) return candidates[0];

  // 3. SLOW: deep filesystem search (last resort)
  const deepFound = await deepFindFile(fileName, fileSize);
  if (deepFound) return deepFound;

  throw new Error(`Could not find "${fileName}" on disk.`);
}

// --- FFmpeg helpers ---

function getVideoInfo(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
      (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, { timeout: 600000 }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// --- ImageOptim-Style Optimization Pipeline ---

// Check which optimization tools are available (cached at startup)
const OPTIM_TOOLS = {};
function detectTool(name, paths) {
  for (const p of paths) {
    try { if (fs.statSync(p)) { OPTIM_TOOLS[name] = p; return; } } catch (_) {}
  }
}

detectTool("mozjpeg-jpegtran", [path.join(FILEY_BIN, "mozjpeg", "jpegtran"), "/opt/homebrew/opt/mozjpeg/bin/jpegtran", "/usr/local/opt/mozjpeg/bin/jpegtran"]);
detectTool("jpegoptim", [path.join(FILEY_BIN, "jpegoptim"), "/opt/homebrew/bin/jpegoptim", "/usr/local/bin/jpegoptim"]);
detectTool("oxipng", [path.join(FILEY_BIN, "oxipng"), "/opt/homebrew/bin/oxipng", "/usr/local/bin/oxipng"]);
detectTool("pngquant", [path.join(FILEY_BIN, "pngquant"), "/opt/homebrew/bin/pngquant", "/usr/local/bin/pngquant"]);
detectTool("advpng", [path.join(FILEY_BIN, "advpng"), "/opt/homebrew/bin/advpng", "/usr/local/bin/advpng"]);
detectTool("zopflipng", [path.join(FILEY_BIN, "zopflipng"), "/opt/homebrew/bin/zopflipng", "/usr/local/bin/zopflipng"]);
detectTool("gifsicle", [path.join(FILEY_BIN, "gifsicle"), "/opt/homebrew/bin/gifsicle", "/usr/local/bin/gifsicle"]);
detectTool("gifski", [path.join(FILEY_BIN, "gifski"), "/opt/homebrew/bin/gifski", "/usr/local/bin/gifski"]);

console.log("Optimization tools found:", Object.keys(OPTIM_TOOLS).join(", ") || "none (using sharp only)");

// Run external tool safely via execFile (no shell injection)
function runOptimTool(bin, args, timeout = 60000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout }, (err) => {
      if (err) return resolve({ success: false });
      resolve({ success: true });
    });
  });
}

// Post-process JPEG: MozJPEG lossless recompression
async function optimizeJpeg(filePath, quality, isLossy) {
  const results = [];
  const origSize = fs.statSync(filePath).size;
  const ts = Date.now();
  const tmpBase = path.join(os.tmpdir(), `filey_jpg_${ts}`);

  // Lossy pass: jpegoptim with quality cap (only if quality < 100)
  if (isLossy && OPTIM_TOOLS["jpegoptim"]) {
    const tmpLossy = `${tmpBase}_jpegoptim.jpg`;
    fs.copyFileSync(filePath, tmpLossy);
    await runOptimTool(OPTIM_TOOLS["jpegoptim"], [
      "--strip-all", "--all-progressive", `-m${quality}`, "--quiet", "--", tmpLossy
    ]);
    try {
      results.push({ path: tmpLossy, size: fs.statSync(tmpLossy).size, tool: "jpegoptim" });
    } catch (_) {}
  }

  // Lossless pass: MozJPEG jpegtran (better Huffman tables)
  if (OPTIM_TOOLS["mozjpeg-jpegtran"]) {
    const tmpMoz = `${tmpBase}_mozjpeg.jpg`;
    await runOptimTool(OPTIM_TOOLS["mozjpeg-jpegtran"], [
      "-optimize", "-copy", "none", "-progressive", "-outfile", tmpMoz, filePath
    ]);
    try {
      results.push({ path: tmpMoz, size: fs.statSync(tmpMoz).size, tool: "mozjpeg" });
    } catch (_) {}
  }

  // Pick the smallest result
  let best = { path: filePath, size: origSize, tool: "sharp" };
  for (const r of results) {
    if (r.size < best.size) {
      if (best.path !== filePath) try { fs.unlinkSync(best.path); } catch (_) {}
      best = r;
    } else {
      try { fs.unlinkSync(r.path); } catch (_) {}
    }
  }

  if (best.path !== filePath) {
    fs.copyFileSync(best.path, filePath);
    try { fs.unlinkSync(best.path); } catch (_) {}
  }

  return { tool: best.tool, saved: origSize - best.size };
}

// Post-process PNG: run multiple lossless optimizers in parallel, keep smallest
// Temp files go in os.tmpdir() to avoid polluting the user's folder
async function optimizePng(filePath, quality, isLossy) {
  const origSize = fs.statSync(filePath).size;
  const results = [];
  const ts = Date.now();
  const tmpBase = path.join(os.tmpdir(), `filey_png_${ts}`);

  // Lossy pass first: pngquant (like ImageOptim Phase 1)
  let pngquantOutput = filePath;
  if (isLossy && OPTIM_TOOLS["pngquant"]) {
    const tmpPq = `${tmpBase}_pq.png`;
    const minQ = Math.max(0, quality - 15);
    await runOptimTool(OPTIM_TOOLS["pngquant"], [
      "256", "--skip-if-larger", `--quality=${minQ}-${quality}`, "--force",
      "--output", tmpPq, "--", filePath
    ]);
    try {
      const pqSize = fs.statSync(tmpPq).size;
      if (pqSize < origSize) {
        pngquantOutput = tmpPq;
      } else {
        try { fs.unlinkSync(tmpPq); } catch (_) {}
      }
    } catch (_) {}
  }

  // Lossless passes — oxipng + advpng only (fast)
  // Zopflipng is skipped by default: it's 10-50x slower for only ~2-5% more savings
  const losslessInput = pngquantOutput;
  const losslessPromises = [];

  if (OPTIM_TOOLS["oxipng"]) {
    const tmpOxi = `${tmpBase}_oxi.png`;
    fs.copyFileSync(losslessInput, tmpOxi);
    losslessPromises.push(
      runOptimTool(OPTIM_TOOLS["oxipng"], ["-o2", "--strip", "safe", "--quiet", tmpOxi])
        .then(() => {
          try { results.push({ path: tmpOxi, size: fs.statSync(tmpOxi).size, tool: "oxipng" }); } catch (_) {}
        })
    );
  }

  // advpng skipped: too slow for default use (72s on 1.4MB file at -4)
  // oxipng alone provides 95%+ of the savings in ~2 seconds

  // Also include pngquant-only result if it was better
  if (pngquantOutput !== filePath) {
    results.push({ path: pngquantOutput, size: fs.statSync(pngquantOutput).size, tool: "pngquant" });
  }

  await Promise.all(losslessPromises);

  // Pick smallest
  let best = { path: filePath, size: origSize, tool: "sharp" };
  for (const r of results) {
    if (r.size < best.size) {
      if (best.path !== filePath) try { fs.unlinkSync(best.path); } catch (_) {}
      best = r;
    } else {
      if (r.path !== filePath) try { fs.unlinkSync(r.path); } catch (_) {}
    }
  }

  if (best.path !== filePath) {
    fs.copyFileSync(best.path, filePath);
    try { fs.unlinkSync(best.path); } catch (_) {}
  }

  return { tool: best.tool, saved: origSize - best.size };
}

// Main optimizer dispatcher
async function optimizeOutput(filePath, format, quality, isLossy) {
  if (format === "jpg" || format === "jpeg") {
    return optimizeJpeg(filePath, quality, isLossy);
  } else if (format === "png") {
    return optimizePng(filePath, quality, isLossy);
  }
  return { tool: "sharp", saved: 0 };
}

// --- Unified Image Processor ---

async function processImage(inputPath, options = {}) {
  const {
    outputFormat = "auto",
    quality = 85,
    stripMeta = true,
    resize = {},
    targetBytes = 0,
    optimize = true,
  } = options;

  const ext = path.extname(inputPath).toLowerCase();
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const dir = path.dirname(inputPath);
  const originalSize = fs.statSync(inputPath).size;

  // HEIC/HEIF pre-conversion: sharp may lack libheif, so use macOS sips as fallback
  let effectiveInput = inputPath;
  if ([".heic", ".heif"].includes(ext)) {
    const tmpJpg = path.join(os.tmpdir(), `filey_heic_${Date.now()}.jpg`);
    try {
      await new Promise((resolve, reject) => {
        execFile("sips", ["-s", "format", "jpeg", inputPath, "--out", tmpJpg], (err) => {
          if (err) reject(err); else resolve();
        });
      });
      effectiveInput = tmpJpg;
    } catch (e) {
      throw new Error(`HEIC conversion failed: ${e.message}. Install libheif or use macOS for HEIC support.`);
    }
  }

  // Probe input
  const metadata = await sharp(effectiveInput).metadata();
  const inputFormat = metadata.format; // jpeg, png, webp, heif, tiff, gif, etc.

  // Determine output format
  let outFmt = outputFormat;
  if (outFmt === "auto") {
    // Auto: HEIC/HEIF → JPG, everything else stays the same
    if (inputFormat === "heif" || inputFormat === "heic") {
      outFmt = "jpg";
    } else {
      outFmt = inputFormat === "jpeg" ? "jpg" : inputFormat;
    }
  }

  const outExt = outFmt === "jpg" || outFmt === "jpeg" ? ".jpg"
    : outFmt === "png" ? ".png"
    : outFmt === "webp" ? ".webp"
    : `.${outFmt}`;

  const suffix = options.suffix || "-filey";
  const outputPath = path.join(dir, `${baseName}${suffix}${outExt}`);

  // Determine if we need sharp (re-encoding) or can use exiftool (lossless metadata-only)
  const needsFormatChange = outFmt !== inputFormat && !(outFmt === "jpg" && inputFormat === "jpeg");
  const needsResize = resize.scale && resize.scale !== 100 || resize.width || resize.height;
  const needsTargetSize = targetBytes > 0;
  // For lossy formats (jpg, webp), quality < 100 means we need sharp to actually compress
  // For PNG, quality slider doesn't apply — PNG is always lossless, so only use sharp if format/resize/target changes
  // Any format at quality < 100 needs sharp — PNG uses palette quantization, JPG/WebP use lossy encoding
  const needsQualityCompress = quality < 100;
  const needsSharp = needsFormatChange || needsResize || needsTargetSize || !stripMeta || needsQualityCompress;

  // LOSSLESS PATH: metadata-only stripping with exiftool (no pixel re-encoding)
  if (stripMeta && !needsFormatChange && !needsResize && !needsTargetSize && !needsQualityCompress) {
    // Copy file first, then strip in-place
    fs.copyFileSync(inputPath, outputPath);
    try {
      await exiftool.write(outputPath, {}, ["-all=", "-overwrite_original"]);
    } catch (e) {
      // If exiftool fails (unsupported format), fall through to sharp
      fs.unlinkSync(outputPath);
      return processImageWithSharp(effectiveInput, outputPath, metadata, outFmt, quality, stripMeta, resize, targetBytes, originalSize, inputPath, optimize);
    }

    // Run ImageOptim-style lossless optimization even on metadata-stripped files
    let optimTool = "exiftool";
    if (optimize) {
      const optimResult = await optimizeOutput(outputPath, outFmt, 100, false);
      if (optimResult.saved > 0) optimTool = `exiftool + ${optimResult.tool}`;
    }

    let outputSize = fs.statSync(outputPath).size;
    // Never bigger guarantee for lossless path too
    if (outputSize >= originalSize) {
      fs.copyFileSync(inputPath, outputPath);
      outputSize = fs.statSync(outputPath).size;
      if (outputSize > originalSize) outputSize = originalSize;
      optimTool = "exiftool (lossless)";
    }
    const savedPercent = Math.round((1 - outputSize / originalSize) * 100);

    // Clean up HEIC temp file if used
    if (effectiveInput !== inputPath) try { fs.unlinkSync(effectiveInput); } catch (_) {}

    return {
      originalName: path.basename(inputPath),
      originalSize,
      outputSize,
      savedPercent,
      outputName: path.basename(outputPath),
      savedTo: outputPath,
      originalPath: inputPath,
      method: optimTool,
      warning: null,
    };
  }

  // SHARP PATH: format conversion, resize, target size, or quality adjustment
  const result = await processImageWithSharp(effectiveInput, outputPath, metadata, outFmt, quality, stripMeta, resize, targetBytes, originalSize, inputPath, optimize);

  // Clean up HEIC temp file if used
  if (effectiveInput !== inputPath) try { fs.unlinkSync(effectiveInput); } catch (_) {}

  return result;
}

async function processImageWithSharp(inputPath, outputPath, metadata, outFmt, quality, stripMeta, resize, targetBytes, originalSize, originalInputPath, optimize) {
  // originalInputPath is the user's actual file (for naming/never-bigger); inputPath may be a temp conversion
  if (!originalInputPath) originalInputPath = inputPath;
  if (optimize === undefined) optimize = true;
  const hasAlpha = metadata.hasAlpha;
  const needsFlatten = hasAlpha && (outFmt === "jpg" || outFmt === "jpeg");

  async function encode(q) {
    let pipeline = sharp(inputPath).rotate(); // auto-orient from EXIF

    // Resize
    if (resize.scale && resize.scale !== 100) {
      const newW = Math.round(metadata.width * resize.scale / 100);
      const newH = Math.round(metadata.height * resize.scale / 100);
      pipeline = pipeline.resize(newW, newH, { fit: "fill" });
    } else if (resize.width || resize.height) {
      pipeline = pipeline.resize(
        resize.width || null,
        resize.height || null,
        { fit: resize.maintainAspect !== false ? "inside" : "fill", withoutEnlargement: false }
      );
    }

    // Flatten alpha for JPEG output
    if (needsFlatten) {
      pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
    }

    // Output format
    if (outFmt === "jpg" || outFmt === "jpeg") {
      pipeline = pipeline.jpeg({ quality: q, mozjpeg: true });
    } else if (outFmt === "png") {
      // PNG: quality < 100 enables lossy palette quantization (like pngquant)
      // Maps quality 1-99 to colors 16-256 for lossy compression
      if (q < 100) {
        const colors = Math.max(16, Math.round((q / 100) * 256));
        pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, colours: colors, quality: q, dither: 1.0 });
      } else {
        pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
      }
    } else if (outFmt === "webp") {
      pipeline = pipeline.webp({ quality: q });
    } else {
      // Fallback: let sharp decide
      pipeline = pipeline.toFormat(outFmt, { quality: q });
    }

    await pipeline.toFile(outputPath);
  }

  // Binary search for target size
  let qualityUsed = quality;
  if (targetBytes > 0) {
    let lo = 1, hi = 100, bestQ = quality;
    for (let i = 0; i < 8; i++) {
      const mid = Math.max(1, Math.floor((lo + hi) / 2));
      await encode(mid);
      const size = fs.statSync(outputPath).size;
      if (size <= targetBytes) { bestQ = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    await encode(bestQ);
    qualityUsed = bestQ;
  } else {
    await encode(quality);
  }

  // Strip metadata from output if requested (after encoding)
  if (stripMeta) {
    try {
      await exiftool.write(outputPath, {}, ["-all=", "-overwrite_original"]);
    } catch (_) {
      // Non-critical — metadata stripping is best-effort after conversion
    }
  }

  // ImageOptim-style optimization pass (runs external tools for additional compression)
  let optimResult = { tool: "sharp", saved: 0 };
  if (optimize && targetBytes === 0) {
    // Skip optimization when targeting a specific file size (binary search already found optimal quality)
    const isLossy = quality < 100;
    optimResult = await optimizeOutput(outputPath, outFmt, quality, isLossy);
  }

  let outputSize = fs.statSync(outputPath).size;

  // NEVER BIGGER guarantee: if output is larger than original and we're not changing format/dimensions,
  // fall back to just stripping metadata from a copy of the original
  const needsFormatChange = outFmt !== metadata.format && !(outFmt === "jpg" && metadata.format === "jpeg");
  // Check if resize actually changes dimensions (not just whether resize params are set)
  let actuallyResized = false;
  if (resize.scale && resize.scale !== 100) {
    actuallyResized = true;
  } else if (resize.width || resize.height) {
    try {
      const outMeta2 = await sharp(outputPath).metadata();
      actuallyResized = outMeta2.width !== metadata.width || outMeta2.height !== metadata.height;
    } catch (_) {
      actuallyResized = true; // assume resized if we can't check
    }
  }
  if (outputSize >= originalSize && !needsFormatChange && !actuallyResized) {
    // Re-copy original and just strip metadata
    fs.copyFileSync(originalInputPath, outputPath);
    if (stripMeta) {
      try {
        await exiftool.write(outputPath, {}, ["-all=", "-overwrite_original"]);
      } catch (_) {}
    }
    outputSize = fs.statSync(outputPath).size;
    // If STILL bigger (rare edge case), just use original as-is
    if (outputSize > originalSize) {
      fs.copyFileSync(originalInputPath, outputPath);
      outputSize = originalSize;
    }
  }

  const savedPercent = Math.round((1 - outputSize / originalSize) * 100);

  let warning = null;
  if (targetBytes > 0 && outputSize > targetBytes * 1.1) {
    warning = `Could only reach ${(outputSize / 1024).toFixed(1)} KB at minimum quality. Target was ${(targetBytes / 1024).toFixed(1)} KB.`;
  }

  // Get output dimensions
  let dimensions = null;
  try {
    const outMeta = await sharp(outputPath).metadata();
    dimensions = `${outMeta.width}x${outMeta.height}`;
  } catch (_) {}

  return {
    originalName: path.basename(originalInputPath),
    originalSize,
    outputSize,
    savedPercent,
    outputName: path.basename(outputPath),
    savedTo: outputPath,
    originalPath: originalInputPath,
    dimensions,
    method: optimResult.tool !== "sharp" ? `sharp + ${optimResult.tool}` : "sharp",
    warning,
    qualityUsed,
  };
}

// --- Video Compress ---

async function compressVideo(inputPath, format, scalePercent, targetBytes, resWidth = 0, resHeight = 0, suffix = "-filey", quality = 0, trimStart = 0, trimEnd = 0, codec = "auto", audio = "auto", denoise = false) {
  const ext = path.extname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const dir = path.dirname(inputPath);

  const info = await getVideoInfo(inputPath);
  const videoStream = info.streams.find((s) => s.codec_type === "video");

  if (!videoStream) throw new Error("No video stream found (audio-only file?)");

  const duration = parseFloat(info.format.duration) || 1;
  const originalSize = parseInt(info.format.size);

  if (duration < 0.5) throw new Error("Video too short (< 0.5 seconds)");

  // Trim: validate and compute effective duration
  const effectiveStart = Math.max(0, Math.min(trimStart || 0, duration));
  const effectiveEnd = trimEnd > 0 ? Math.min(trimEnd, duration) : duration;
  if (effectiveEnd <= effectiveStart) throw new Error("Trim end must be after trim start");
  const trimmedDuration = effectiveEnd - effectiveStart;
  const isTrimming = effectiveStart > 0 || effectiveEnd < duration;

  // Use trimmed duration for bitrate calculations
  const effectiveDuration = isTrimming ? trimmedDuration : duration;

  const targetSizeKB = targetBytes > 0 ? targetBytes / 1024 : 0;
  if (targetSizeKB > 0 && targetSizeKB < 10) throw new Error("Target size too small (min 10 KB)");

  const origWidth = parseInt(videoStream.width);
  const origHeight = parseInt(videoStream.height);

  let finalWidth, finalHeight;
  const isPortrait = origHeight > origWidth;

  if (resWidth > 0 && resHeight > 0) {
    // Exact resolution specified
    finalWidth = resWidth % 2 === 0 ? resWidth : resWidth + 1;
    finalHeight = resHeight % 2 === 0 ? resHeight : resHeight + 1;
  } else if (resWidth > 0) {
    // Resolution preset: apply to the long edge, not always width
    // For portrait video, the preset targets height (long edge) instead
    if (isPortrait) {
      const targetLong = resWidth; // "1280" means 1280 on the long edge
      // Don't upscale — if source long edge is smaller, use original
      const effectiveLong = Math.min(targetLong, origHeight);
      const aspect = origWidth / origHeight;
      finalHeight = effectiveLong % 2 === 0 ? effectiveLong : effectiveLong + 1;
      finalWidth = Math.round(finalHeight * aspect);
      finalWidth = finalWidth % 2 === 0 ? finalWidth : finalWidth + 1;
    } else {
      // Don't upscale — if source width is smaller, use original
      const effectiveW = Math.min(resWidth, origWidth);
      const aspect = origHeight / origWidth;
      finalWidth = effectiveW % 2 === 0 ? effectiveW : effectiveW + 1;
      finalHeight = Math.round(finalWidth * aspect);
      finalHeight = finalHeight % 2 === 0 ? finalHeight : finalHeight + 1;
    }
  } else if (resHeight > 0) {
    // Height specified, calculate width preserving aspect ratio
    const aspect = origWidth / origHeight;
    finalHeight = resHeight % 2 === 0 ? resHeight : resHeight + 1;
    finalWidth = Math.round(finalHeight * aspect);
    finalWidth = finalWidth % 2 === 0 ? finalWidth : finalWidth + 1;
  } else {
    // Scale percentage
    const newWidth = Math.round((origWidth * scalePercent) / 100);
    const newHeight = Math.round((origHeight * scalePercent) / 100);
    finalWidth = newWidth % 2 === 0 ? newWidth : newWidth + 1;
    finalHeight = newHeight % 2 === 0 ? newHeight : newHeight + 1;
  }

  const outputName = `${baseName}${suffix}.${format}`;
  const outputPath = path.join(dir, outputName);

  // Codec selection
  // "auto" = H.265 for small targets, H.264 otherwise (original behavior)
  // Explicit options: h264, h265, h264_hw, h265_hw, av1
  let videoCodec, isHW = false, isH265 = false, isAV1 = false;
  switch (codec) {
    case "h264":
      videoCodec = "libx264";
      break;
    case "h265":
      videoCodec = "libx265";
      isH265 = true;
      break;
    case "h264_hw":
      videoCodec = "h264_videotoolbox";
      isHW = true;
      break;
    case "h265_hw":
      videoCodec = "hevc_videotoolbox";
      isHW = true;
      isH265 = true;
      break;
    case "av1":
      videoCodec = "libsvtav1";
      isAV1 = true;
      break;
    default: // "auto"
      isH265 = targetSizeKB > 0 && targetSizeKB < 1024;
      videoCodec = isH265 ? "libx265" : "libx264";
      break;
  }

  // Audio mode: "auto" (AAC 128k), "passthrough" (-c:a copy), "aac_64k"..."aac_320k", "none" (-an)
  let audioArgs = [];
  let audioBitrateForCalc = 128000; // bits/sec, used for target size bitrate calculation
  switch (audio) {
    case "passthrough":
      audioArgs = ["-c:a", "copy"];
      audioBitrateForCalc = 128000; // estimate for calc purposes
      break;
    case "none":
      audioArgs = ["-an"];
      audioBitrateForCalc = 0;
      break;
    case "aac_64k":
      audioArgs = ["-c:a", "aac", "-b:a", "64k"];
      audioBitrateForCalc = 64000;
      break;
    case "aac_96k":
      audioArgs = ["-c:a", "aac", "-b:a", "96k"];
      audioBitrateForCalc = 96000;
      break;
    case "aac_192k":
      audioArgs = ["-c:a", "aac", "-b:a", "192k"];
      audioBitrateForCalc = 192000;
      break;
    case "aac_256k":
      audioArgs = ["-c:a", "aac", "-b:a", "256k"];
      audioBitrateForCalc = 256000;
      break;
    case "aac_320k":
      audioArgs = ["-c:a", "aac", "-b:a", "320k"];
      audioBitrateForCalc = 320000;
      break;
    default: // "auto" or "aac_128k"
      audioArgs = ["-c:a", "aac", "-b:a", "128k"];
      audioBitrateForCalc = 128000;
      break;
  }

  // Build input args with optional trim (fast seek: -ss before -i)
  let inputArgs = ["-y"];
  if (isTrimming && effectiveStart > 0) inputArgs.push("-ss", String(effectiveStart));
  inputArgs.push("-i", inputPath);
  if (isTrimming) inputArgs.push("-t", String(trimmedDuration));

  let args = [...inputArgs];

  if (targetSizeKB > 0) {
    const targetBits = targetSizeKB * 1024 * 8;
    // For target size, use low audio bitrate (32k) unless passthrough/none
    const targetAudioBitrate = audio === "none" ? 0 : (audio === "passthrough" ? audioBitrateForCalc : 32000);
    const targetAudioArgs = audio === "none" ? ["-an"] : (audio === "passthrough" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "32k"]);
    // Use 90% of target to account for container overhead, muxing, and headers
    const videoBitrate = Math.max(
      Math.floor(targetBits * 0.9 / effectiveDuration - targetAudioBitrate),
      10000
    );

    args.push(
      "-c:v", videoCodec,
      "-b:v", `${videoBitrate}`,
      "-maxrate", `${Math.floor(videoBitrate * 1.5)}`,
      "-bufsize", `${Math.floor(videoBitrate * 2)}`,
      ...targetAudioArgs
    );

    if (isH265) {
      args.push("-tag:v", "hvc1");
    }
  } else {
    if (isHW) {
      // VideoToolbox: uses -q:v (1-100, higher = better) instead of CRF
      let vtQ;
      if (quality > 0) {
        vtQ = quality; // direct 1-100 mapping
      } else {
        vtQ = 65; // good default for VideoToolbox
      }
      args.push("-c:v", videoCodec, "-q:v", String(vtQ), ...audioArgs);
      if (isH265) args.push("-tag:v", "hvc1");
    } else if (isAV1) {
      // SVT-AV1: CRF range 0-63, good defaults 25-35
      let crf;
      if (quality > 0) {
        // Map quality 1-100 to CRF 55-20 (lower CRF = higher quality)
        crf = Math.round(55 - (quality * 35 / 100));
        crf = Math.max(20, Math.min(55, crf));
      } else {
        crf = 32;
      }
      args.push("-c:v", videoCodec, "-crf", String(crf), "-preset", "6", ...audioArgs);
    } else {
      // Software H.264/H.265: CRF mode
      let crf;
      if (quality > 0) {
        // Map quality 1-100 to CRF 51-18 (lower CRF = higher quality)
        crf = Math.round(51 - (quality * 33 / 100));
        crf = Math.max(18, Math.min(51, crf));
      } else {
        crf = isH265 ? 28 : 23;
      }
      args.push("-c:v", videoCodec, "-crf", String(crf), ...audioArgs);
      if (isH265) args.push("-tag:v", "hvc1");
    }
  }

  // Build video filter chain (denoise + scale)
  const vfParts = [];
  if (denoise) vfParts.push("hqdn3d=4:3:6:4.5");
  if (finalWidth !== origWidth || finalHeight !== origHeight) vfParts.push(`scale=${finalWidth}:${finalHeight}`);
  if (vfParts.length > 0) args.push("-vf", vfParts.join(","));

  if (format === "mov") {
    args.push("-f", "mov");
  } else {
    args.push("-f", "mp4", "-movflags", "+faststart");
  }

  args.push(outputPath);

  if (targetSizeKB > 0 && !isHW && !isAV1) {
    // 2-pass encoding for software H.264/H.265 with target size
    const passLogFile = path.join(os.tmpdir(), `filey_pass_${Date.now()}`);
    const bitrateIdx = args.indexOf("-b:v");
    const videoBitrateVal = args[bitrateIdx + 1];

    const pass1Args = [...inputArgs, "-c:v", videoCodec, "-b:v", videoBitrateVal, "-pass", "1", "-passlogfile", passLogFile, "-an"];
    if (isH265 && !isHW) pass1Args.push("-x265-params", `pass=1:stats=${passLogFile}.x265`);
    if (vfParts.length > 0) pass1Args.push("-vf", vfParts.join(","));
    pass1Args.push("-f", "null", "/dev/null");

    const pass2Args = [...inputArgs];
    // Copy encoding args (everything after inputArgs, before outputPath)
    for (let i = inputArgs.length; i < args.length - 1; i++) pass2Args.push(args[i]);
    const codecIdx = pass2Args.indexOf(videoCodec);
    pass2Args.splice(codecIdx + 1, 0, "-pass", "2", "-passlogfile", passLogFile);
    if (isH265 && !isHW) {
      const x265Idx = pass2Args.indexOf("-x265-params");
      if (x265Idx >= 0) {
        pass2Args[x265Idx + 1] = `pass=2:stats=${passLogFile}.x265`;
      } else {
        pass2Args.splice(codecIdx + 1, 0, "-x265-params", `pass=2:stats=${passLogFile}.x265`);
      }
    }
    pass2Args.push(outputPath);

    await runFFmpeg(pass1Args);
    await runFFmpeg(pass2Args);

    try {
      for (const f of fs.readdirSync(os.tmpdir())) {
        if (f.startsWith(path.basename(passLogFile))) {
          fs.unlinkSync(path.join(os.tmpdir(), f));
        }
      }
    } catch (_) {}
  } else {
    // Single-pass: HW encoders, AV1, or quality-based (no target size)
    await runFFmpeg(args);
  }

  const outputSize = fs.statSync(outputPath).size;
  const savedPercent = Math.round((1 - outputSize / originalSize) * 100);

  let warning = null;
  if (targetSizeKB > 0 && outputSize > targetBytes * 1.5) {
    warning = `Could only compress to ${(outputSize / 1024).toFixed(1)} KB (target was ${targetSizeKB.toFixed(0)} KB). Try a lower resolution or shorter duration.`;
  }

  return {
    originalName: path.basename(inputPath),
    originalSize,
    outputSize,
    savedPercent,
    outputName,
    dimensions: `${finalWidth}x${finalHeight}`,
    codec: videoCodec,
    savedTo: outputPath,
    warning,
    qualityUsed: quality || null,
    audio: audio === "none" ? "removed" : (audio === "passthrough" ? "passthrough" : `aac`),
    trimmed: isTrimming ? { start: effectiveStart, end: effectiveEnd, duration: trimmedDuration } : null,
  };
}

// --- Video to GIF ---

async function videoToGif(inputPath, fps = 10, width = 480, targetBytes = 0, suffix = "-filey", maxColors = 256, trimStart = 0, trimEnd = 0, bounce = false) {
  const ext = path.extname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const dir = path.dirname(inputPath);
  const outputPath = path.join(dir, `${baseName}${suffix}.gif`);
  const palettePath = path.join(os.tmpdir(), `filey_palette_${Date.now()}.png`);
  const originalSize = fs.statSync(inputPath).size;

  const info = await getVideoInfo(inputPath);
  const vs = info.streams.find((s) => s.codec_type === "video");
  if (!vs) throw new Error("No video stream found");
  const duration = parseFloat(info.format.duration) || 0;
  if (duration < 0.1) throw new Error("Video too short");

  // Trim
  const effectiveStart = Math.max(0, Math.min(trimStart || 0, duration));
  const effectiveEnd = trimEnd > 0 ? Math.min(trimEnd, duration) : duration;
  if (effectiveEnd <= effectiveStart) throw new Error("Trim end must be after trim start");
  const trimmedDuration = effectiveEnd - effectiveStart;
  const isTrimming = effectiveStart > 0 || effectiveEnd < duration;

  // Check duration limit on the trimmed portion
  const gifDuration = isTrimming ? trimmedDuration : duration;
  if (gifDuration > 120) throw new Error("GIF duration too long (max 2 minutes). Use trim to shorten it.");

  // Build input args with optional trim
  const preInputArgs = [];
  if (isTrimming && effectiveStart > 0) preInputArgs.push("-ss", String(effectiveStart));
  const postInputArgs = [];
  if (isTrimming) postInputArgs.push("-t", String(trimmedDuration));

  const useGifski = !!OPTIM_TOOLS["gifski"];
  let method = "ffmpeg";

  if (useGifski) {
    // GIFSKI PATH: higher quality cross-frame palette optimization
    method = "gifski";

    // If trimming, extract trimmed clip to temp file first (gifski has no trim support)
    let gifskiInput = inputPath;
    let tempTrimmed = null;
    if (isTrimming) {
      tempTrimmed = path.join(os.tmpdir(), `filey_trim_${Date.now()}.mp4`);
      await runFFmpeg([
        "-y", ...preInputArgs, "-i", inputPath, ...postInputArgs,
        "-c:v", "copy", "-an", tempTrimmed,
      ]);
      gifskiInput = tempTrimmed;
    }

    // Map quality slider: maxColors 8-256 → gifski quality 30-100
    const gifskiQuality = Math.max(30, Math.min(100, Math.round((maxColors / 256) * 70 + 30)));

    const gifskiArgs = [
      "--fps", String(fps),
      "--quality", String(gifskiQuality),
      "--output", outputPath,
      "--quiet",
    ];
    if (width > 0) gifskiArgs.push("--width", String(width));
    if (bounce) gifskiArgs.push("--bounce");
    gifskiArgs.push(gifskiInput);

    await new Promise((resolve, reject) => {
      execFile(OPTIM_TOOLS["gifski"], gifskiArgs, { timeout: 300000 }, (err) => {
        if (err) reject(new Error(`gifski failed: ${err.message}`));
        else resolve();
      });
    });

    // Clean up temp trimmed file
    if (tempTrimmed) try { fs.unlinkSync(tempTrimmed); } catch (_) {}

    // If target size set and gifski output is too large, retry with lower quality
    if (targetBytes > 0 && fs.statSync(outputPath).size > targetBytes) {
      const qualitySteps = [60, 40, 30].filter(q => q < gifskiQuality);
      for (const q of qualitySteps) {
        if (fs.statSync(outputPath).size <= targetBytes) break;
        const retryArgs = [
          "--fps", String(fps),
          "--quality", String(q),
          "--output", outputPath,
          "--quiet",
        ];
        if (width > 0) retryArgs.push("--width", String(width));
        if (bounce) retryArgs.push("--bounce");
        retryArgs.push(gifskiInput === inputPath ? inputPath : gifskiInput);

        // For retries with trim, we need to re-extract since temp was deleted
        let retryInput = inputPath;
        let retryTemp = null;
        if (isTrimming) {
          retryTemp = path.join(os.tmpdir(), `filey_trim_${Date.now()}.mp4`);
          await runFFmpeg(["-y", ...preInputArgs, "-i", inputPath, ...postInputArgs, "-c:v", "copy", "-an", retryTemp]);
          retryInput = retryTemp;
          retryArgs[retryArgs.length - 1] = retryInput;
        }

        await new Promise((resolve) => {
          execFile(OPTIM_TOOLS["gifski"], retryArgs, { timeout: 300000 }, () => resolve());
        });
        if (retryTemp) try { fs.unlinkSync(retryTemp); } catch (_) {}
      }
    }
  } else {
    // FFMPEG FALLBACK: standard palettegen/paletteuse pipeline
    const scaleFilter = width > 0
      ? `fps=${fps},scale=${width}:-1:flags=lanczos`
      : `fps=${fps}`;

    async function generateGif(colors = 256) {
      const paletteFilter = colors < 256
        ? `palettegen=max_colors=${colors}:stats_mode=diff`
        : `palettegen=stats_mode=diff`;

      await runFFmpeg([
        "-y", ...preInputArgs, "-i", inputPath, ...postInputArgs,
        "-vf", `${scaleFilter},${paletteFilter}`,
        palettePath,
      ]);

      await runFFmpeg([
        "-y", ...preInputArgs, "-i", inputPath, "-i", palettePath, ...postInputArgs,
        "-lavfi", `${scaleFilter}[x];[x][1:v]paletteuse=dither=floyd_steinberg`,
        outputPath,
      ]);
    }

    const startColors = Math.max(8, Math.min(256, maxColors));
    await generateGif(startColors);

    if (targetBytes > 0) {
      const colorSteps = [128, 64, 32].filter(c => c < startColors);
      for (const colors of colorSteps) {
        if (fs.statSync(outputPath).size <= targetBytes) break;
        await generateGif(colors);
      }
    }
  }

  try { fs.unlinkSync(palettePath); } catch (_) {}

  // Post-process with gifsicle for additional optimization
  if (OPTIM_TOOLS["gifsicle"]) {
    const tmpGifsicle = outputPath + ".gifsicle.tmp";
    const gifsicleResult = await runOptimTool(OPTIM_TOOLS["gifsicle"], [
      "-O3", "--no-comments", "--no-names", "--careful",
      "-o", tmpGifsicle, "--", outputPath,
    ]);
    if (gifsicleResult.success) {
      try {
        const origGifSize = fs.statSync(outputPath).size;
        const optimGifSize = fs.statSync(tmpGifsicle).size;
        if (optimGifSize < origGifSize) {
          fs.copyFileSync(tmpGifsicle, outputPath);
        }
      } catch (_) {}
    }
    try { fs.unlinkSync(tmpGifsicle); } catch (_) {}
  }

  const outputSize = fs.statSync(outputPath).size;
  const savedPercent = Math.round((1 - outputSize / originalSize) * 100);

  let warning = null;
  const targetSizeKB = targetBytes > 0 ? targetBytes / 1024 : 0;
  if (targetBytes > 0 && outputSize > targetBytes * 1.1) {
    warning = `Could only reach ${(outputSize / 1024).toFixed(1)} KB (target was ${targetSizeKB.toFixed(0)} KB). Try a lower FPS or smaller width.`;
  }

  // Get output dimensions
  let dimensions = null;
  try {
    const probe = await getVideoInfo(outputPath);
    const vs = probe.streams.find((s) => s.codec_type === "video");
    if (vs) dimensions = `${vs.width}x${vs.height}`;
  } catch (_) {}

  return {
    originalName: path.basename(inputPath),
    originalSize,
    outputSize,
    savedPercent,
    outputName: path.basename(outputPath),
    dimensions,
    fps,
    method,
    bounce: bounce || false,
    savedTo: outputPath,
    warning,
  };
}

// --- PDF Compressor ---

// Auto-detect Ghostscript
let GS_BIN = null;
const gsCandidates = [path.join(FILEY_BIN, "gs"), "/opt/homebrew/bin/gs", "/usr/local/bin/gs", "/usr/bin/gs"];
for (const c of gsCandidates) {
  try { if (fs.statSync(c)) { GS_BIN = c; break; } } catch (_) {}
}
if (!GS_BIN) {
  try {
    const gsPath = require("child_process").execFileSync("which", ["gs"]).toString().trim();
    if (gsPath) GS_BIN = gsPath;
  } catch (_) {}
}

// Ghostscript PDF quality presets (maps to -dPDFSETTINGS)
// screen = 72dpi, ebook = 150dpi, printer = 300dpi, prepress = 300dpi+preserve
const PDF_PRESETS = {
  low: "/screen",       // smallest, 72dpi images
  medium: "/ebook",     // good balance, 150dpi
  high: "/printer",     // high quality, 300dpi
  lossless: "/prepress" // maximum quality, preserve everything
};

async function compressPdf(inputPath, quality = "medium", suffix = "-filey") {
  if (!GS_BIN) throw new Error("Ghostscript not installed. Run: brew install ghostscript");

  const ext = path.extname(inputPath);
  if (ext.toLowerCase() !== ".pdf") throw new Error("Not a PDF file");

  const baseName = path.basename(inputPath, ext);
  const dir = path.dirname(inputPath);
  const outputPath = path.join(dir, `${baseName}${suffix}.pdf`);
  const originalSize = fs.statSync(inputPath).size;

  const preset = PDF_PRESETS[quality] || PDF_PRESETS.medium;

  await new Promise((resolve, reject) => {
    execFile(GS_BIN, [
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      `-dPDFSETTINGS=${preset}`,
      "-dNOPAUSE",
      "-dBATCH",
      "-dQUIET",
      `-sOutputFile=${outputPath}`,
      inputPath,
    ], { timeout: 120000 }, (err) => {
      if (err) reject(new Error(`Ghostscript failed: ${err.message}`));
      else resolve();
    });
  });

  const outputSize = fs.statSync(outputPath).size;
  const savedPercent = Math.round((1 - outputSize / originalSize) * 100);

  // Never bigger: if output is larger, copy original
  if (outputSize >= originalSize) {
    fs.copyFileSync(inputPath, outputPath);
    return {
      originalName: path.basename(inputPath),
      originalSize,
      outputSize: originalSize,
      savedPercent: 0,
      outputName: path.basename(outputPath),
      savedTo: outputPath,
      method: "ghostscript",
      quality: quality,
      warning: "File is already well-optimized — no further compression possible at this quality level.",
    };
  }

  return {
    originalName: path.basename(inputPath),
    originalSize,
    outputSize,
    savedPercent,
    outputName: path.basename(outputPath),
    savedTo: outputPath,
    method: "ghostscript",
    quality: quality,
    warning: null,
  };
}

// --- SVG Optimizer ---

const { optimize: svgoOptimize } = require("svgo");
const SVGO_AVAILABLE = true;

async function optimizeSvg(inputPath, suffix = "-filey") {
  const ext = path.extname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const dir = path.dirname(inputPath);
  const outputPath = path.join(dir, `${baseName}${suffix}.svg`);
  const originalSize = fs.statSync(inputPath).size;

  const input = fs.readFileSync(inputPath, "utf-8");
  const result = svgoOptimize(input, { multipass: true });
  fs.writeFileSync(outputPath, result.data);

  const outputSize = fs.statSync(outputPath).size;
  const savedPercent = Math.round((1 - outputSize / originalSize) * 100);

  return {
    originalName: path.basename(inputPath),
    originalSize,
    outputSize,
    savedPercent,
    outputName: path.basename(outputPath),
    savedTo: outputPath,
    method: "svgo",
    warning: null,
  };
}

// --- Video Transcriber ---

// Auto-detect whisper binary: check common locations
const WHISPER_BIN = (() => {
  const candidates = [
    path.join(os.homedir(), "Library/Python/3.9/bin/whisper"),
    path.join(os.homedir(), "Library/Python/3.11/bin/whisper"),
    path.join(os.homedir(), "Library/Python/3.12/bin/whisper"),
    path.join(os.homedir(), "Library/Python/3.13/bin/whisper"),
    "/usr/local/bin/whisper",
    "/opt/homebrew/bin/whisper",
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c)) return c; } catch (_) {}
  }
  return "whisper"; // fall back to PATH lookup
})();

async function transcribeVideo(inputPath, model = "base", language = "auto", outputFormat = "txt", suffix = "-transcript") {
  const ext = path.extname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const dir = path.dirname(inputPath);
  const originalSize = fs.statSync(inputPath).size;

  // Whisper outputs to a directory with the base name of the input file
  // We'll use a temp dir for output, then rename
  const tmpDir = path.join(os.tmpdir(), `filey_whisper_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const args = [inputPath, "--model", model, "--output_format", outputFormat, "--output_dir", tmpDir];

  if (language !== "auto") {
    args.push("--language", language);
  }

  await new Promise((resolve, reject) => {
    execFile(WHISPER_BIN, args, { timeout: 600000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });

  // Find the output file whisper created
  const whisperOutputName = `${baseName}.${outputFormat}`;
  const whisperOutputPath = path.join(tmpDir, whisperOutputName);

  if (!fs.existsSync(whisperOutputPath)) {
    // Try to find any output file in the temp dir
    const files = fs.readdirSync(tmpDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`Transcription failed. No output file found. Files in tmp: ${files.join(", ")}`);
  }

  const transcript = fs.readFileSync(whisperOutputPath, "utf-8");

  // Copy to final destination
  const finalName = `${baseName}${suffix}.${outputFormat}`;
  const finalPath = path.join(dir, finalName);
  fs.copyFileSync(whisperOutputPath, finalPath);

  // Clean up temp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const outputSize = fs.statSync(finalPath).size;

  return {
    originalName: path.basename(inputPath),
    originalSize,
    outputName: finalName,
    outputSize,
    savedTo: finalPath,
    transcript: transcript.trim(),
    model,
    language: language === "auto" ? "auto-detected" : language,
    outputFormat,
  };
}

// --- API Endpoints ---

// Verify a file path exists
app.post("/api/verify-path", (req, res) => {
  const filePath = req.body.path;
  if (!filePath) return res.json({ valid: false });
  try {
    fs.statSync(filePath);
    res.json({ valid: true });
  } catch (_) {
    res.json({ valid: false });
  }
});

// Locate file on disk
app.post("/api/locate", async (req, res) => {
  const { fileName, fileSize } = req.body;
  if (!fileName) return res.status(400).json({ error: "No file name" });
  try {
    const filePath = await findFileOnDisk(fileName, fileSize);
    res.json({ path: filePath });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Get file info
app.post("/api/file-info", async (req, res) => {
  const { path: filePath, type } = req.body;
  if (!filePath) return res.status(400).json({ error: "No path" });

  try {
    const stat = fs.statSync(filePath);
    const info = { sizeBytes: stat.size, sizeKB: (stat.size / 1024).toFixed(1) };

    if (type === "video") {
      const vinfo = await getVideoInfo(filePath);
      const vs = vinfo.streams.find((s) => s.codec_type === "video");
      info.duration = parseFloat(vinfo.format.duration) || 0;
      info.width = parseInt(vs?.width) || 0;
      info.height = parseInt(vs?.height) || 0;
      info.codec = vs?.codec_name;
      info.hasVideo = !!vs;
    } else if (type === "image") {
      const metadata = await sharp(filePath).metadata();
      info.width = metadata.width;
      info.height = metadata.height;
      info.format = metadata.format;
      info.hasAlpha = metadata.hasAlpha;
      info.hasExif = !!metadata.exif;
      info.hasIcc = !!metadata.icc;
      info.hasXmp = !!metadata.xmp;
    }

    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Process image (unified: convert, strip metadata, resize, target size)
app.post("/api/process-image", async (req, res) => {
  const { filePath, outputFormat, quality, stripMeta, resize, targetBytes, suffix, optimize } = req.body;
  if (!filePath) return res.status(400).json({ error: "No file" });

  try {
    const clampedQuality = Math.max(1, Math.min(100, parseInt(quality) || 85));
    const clampedTarget = Math.min(parseInt(targetBytes) || 0, 500 * 1024 * 1024);
    const safeSuffix = (suffix || "-filey").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 50) || "-filey";

    const result = await processImage(filePath, {
      outputFormat: outputFormat || "auto",
      quality: clampedQuality,
      stripMeta: stripMeta !== false,
      resize: resize || {},
      targetBytes: Math.max(0, clampedTarget),
      suffix: safeSuffix,
      optimize: optimize !== false,
    });
    res.json({ results: [result], errors: [] });
  } catch (err) {
    res.json({ results: [], errors: [{ file: path.basename(filePath), error: err.message }] });
  }
});

// Process video (compress)
app.post("/api/process-video", async (req, res) => {
  const { filePath, format, scale, targetBytes, resWidth, resHeight, suffix, quality, trimStart, trimEnd, codec, audio, denoise } = req.body;
  if (!filePath) return res.status(400).json({ error: "No file" });

  try {
    const clampedTarget = Math.max(0, Math.min(parseInt(targetBytes) || 0, 500 * 1024 * 1024));
    const clampedWidth = parseInt(resWidth) || 0;
    const safeWidth = clampedWidth > 0 ? Math.max(100, Math.min(7680, clampedWidth)) : 0;
    const clampedHeight = parseInt(resHeight) || 0;
    const safeHeight = clampedHeight > 0 ? Math.max(100, Math.min(7680, clampedHeight)) : 0;
    const safeSuffix = (suffix || "-filey").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 50) || "-filey";
    const clampedQuality = Math.max(0, Math.min(100, parseInt(quality) || 0));

    const safeTrimStart = Math.max(0, parseFloat(trimStart) || 0);
    const safeTrimEnd = Math.max(0, parseFloat(trimEnd) || 0);

    const safeCodec = ["h264", "h265", "h264_hw", "h265_hw", "av1"].includes(codec) ? codec : "auto";
    const safeAudio = ["passthrough", "none", "aac_64k", "aac_96k", "aac_128k", "aac_192k", "aac_256k", "aac_320k"].includes(audio) ? audio : "auto";

    const result = await compressVideo(
      filePath,
      format || "mp4",
      parseInt(scale) || 100,
      clampedTarget,
      safeWidth,
      safeHeight,
      safeSuffix,
      clampedQuality,
      safeTrimStart,
      safeTrimEnd,
      safeCodec,
      safeAudio,
      denoise === true
    );
    res.json({ results: [result], errors: [] });
  } catch (err) {
    res.json({ results: [], errors: [{ file: path.basename(filePath), error: err.message }] });
  }
});

// Process GIF (video to gif)
app.post("/api/process-gif", async (req, res) => {
  const { filePath, fps, width, targetBytes, suffix, quality, trimStart, trimEnd, bounce } = req.body;
  if (!filePath) return res.status(400).json({ error: "No file" });

  try {
    const clampedTarget = Math.max(0, Math.min(parseInt(targetBytes) || 0, 100 * 1024 * 1024));
    const clampedFps = Math.max(1, Math.min(30, parseInt(fps) || 10));
    const clampedWidth = parseInt(width) || 480;
    const safeWidth = Math.max(100, Math.min(2048, clampedWidth));
    const safeSuffix = (suffix || "-filey").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 50) || "-filey";
    const maxColors = Math.max(8, Math.min(256, parseInt(quality) || 256));

    const safeTrimStart = Math.max(0, parseFloat(trimStart) || 0);
    const safeTrimEnd = Math.max(0, parseFloat(trimEnd) || 0);

    const result = await videoToGif(
      filePath,
      clampedFps,
      safeWidth,
      clampedTarget,
      safeSuffix,
      maxColors,
      safeTrimStart,
      safeTrimEnd,
      bounce === true
    );
    res.json({ results: [result], errors: [] });
  } catch (err) {
    res.json({ results: [], errors: [{ file: path.basename(filePath), error: err.message }] });
  }
});

// Process SVG (optimize)
app.post("/api/process-svg", async (req, res) => {
  const { filePath, suffix } = req.body;
  if (!filePath) return res.status(400).json({ error: "No file" });

  try {
    const safeSuffix = (suffix || "-filey").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 50) || "-filey";
    const result = await optimizeSvg(filePath, safeSuffix);
    res.json({ results: [result], errors: [] });
  } catch (err) {
    res.json({ results: [], errors: [{ file: path.basename(filePath), error: err.message }] });
  }
});

// Process PDF (compress)
app.post("/api/process-pdf", async (req, res) => {
  const { filePath, quality, suffix } = req.body;
  if (!filePath) return res.status(400).json({ error: "No file" });

  try {
    const safeSuffix = (suffix || "-filey").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 50) || "-filey";
    const safeQuality = ["low", "medium", "high", "lossless"].includes(quality) ? quality : "medium";
    const result = await compressPdf(filePath, safeQuality, safeSuffix);
    res.json({ results: [result], errors: [] });
  } catch (err) {
    res.json({ results: [], errors: [{ file: path.basename(filePath), error: err.message }] });
  }
});

// Reveal file in Finder
app.post("/api/reveal", (req, res) => {
  const filePath = req.body.path;
  if (!filePath) return res.status(400).json({ error: "No path" });
  execFile("open", ["-R", filePath], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Estimate image output size (fast proxy-based estimation)
app.post("/api/estimate-image", async (req, res) => {
  const { filePath, outputFormat, quality, resize } = req.body;
  if (!filePath) return res.status(400).json({ error: "No file" });

  try {
    const metadata = await sharp(filePath).metadata();
    const inputFormat = metadata.format;

    let outFmt = outputFormat || "auto";
    if (outFmt === "auto") {
      outFmt = (inputFormat === "heif" || inputFormat === "heic") ? "jpg" : (inputFormat === "jpeg" ? "jpg" : inputFormat);
    }

    // Determine target dimensions
    let targetW = metadata.width;
    let targetH = metadata.height;
    if (resize) {
      if (resize.scale && resize.scale !== 100) {
        targetW = Math.round(metadata.width * resize.scale / 100);
        targetH = Math.round(metadata.height * resize.scale / 100);
      } else if (resize.width || resize.height) {
        if (resize.width && resize.height) {
          targetW = resize.width;
          targetH = resize.height;
        } else if (resize.width) {
          targetW = resize.width;
          targetH = Math.round(metadata.height * (resize.width / metadata.width));
        } else {
          targetH = resize.height;
          targetW = Math.round(metadata.width * (resize.height / metadata.height));
        }
      }
    }

    const fullPixels = targetW * targetH;
    // Use a larger proxy for better accuracy — 1024px wide instead of 512
    const useProxy = fullPixels > 1500000; // > 1.5MP
    const proxyW = useProxy ? 1024 : targetW;
    const proxyH = useProxy ? Math.round(1024 * (targetH / targetW)) : targetH;
    const proxyPixels = proxyW * proxyH;

    const q = Math.max(1, Math.min(100, parseInt(quality) || 85));
    const hasAlpha = metadata.hasAlpha;
    const needsFlatten = hasAlpha && (outFmt === "jpg" || outFmt === "jpeg");

    let pipeline = sharp(filePath).rotate().resize(proxyW, proxyH, { fit: "fill" });
    if (needsFlatten) pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });

    if (outFmt === "jpg" || outFmt === "jpeg") {
      pipeline = pipeline.jpeg({ quality: q, mozjpeg: true });
    } else if (outFmt === "png") {
      // PNG: quality < 100 enables lossy palette quantization (like pngquant)
      // Maps quality 1-99 to colors 16-256 for lossy compression
      if (q < 100) {
        const colors = Math.max(16, Math.round((q / 100) * 256));
        pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, colours: colors, quality: q, dither: 1.0 });
      } else {
        pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
      }
    } else if (outFmt === "webp") {
      pipeline = pipeline.webp({ quality: q });
    } else {
      pipeline = pipeline.toFormat(outFmt, { quality: q });
    }

    const buffer = await pipeline.toBuffer();
    let estimatedBytes = buffer.length;

    if (useProxy) {
      // Extrapolate from proxy using sublinear scaling
      // Compressed image size doesn't scale linearly with pixels — use sqrt ratio
      const pixelRatio = fullPixels / proxyPixels;
      const scaleFactor = Math.pow(pixelRatio, 0.65); // sublinear: between sqrt and linear
      estimatedBytes = Math.round(buffer.length * scaleFactor);
    }

    // Never estimate larger than original (unless format conversion changes dimensions)
    const originalSize = fs.statSync(filePath).size;
    const isResizing = resize && (resize.scale && resize.scale !== 100 || resize.width || resize.height);
    const isConvertingFormat = outFmt !== (metadata.format === "jpeg" ? "jpg" : metadata.format);
    if (!isResizing && !isConvertingFormat && estimatedBytes > originalSize) {
      estimatedBytes = originalSize;
    }

    // Apply optimization discount if tools are available
    // Calibrated from real test results (2026-03-15)
    let optimizedEstimate = estimatedBytes;
    if (outFmt === "jpg" || outFmt === "jpeg") {
      if (q >= 100 && OPTIM_TOOLS["mozjpeg-jpegtran"]) {
        // MozJPEG lossless recompression ~18% savings at Q100
        optimizedEstimate = Math.round(estimatedBytes * 0.82);
      }
      // At lower qualities, the proxy estimate is already close enough — don't adjust
    } else if (outFmt === "png") {
      // PNG proxy estimates are unreliable — estimate relative to original size instead
      if (q >= 100) {
        optimizedEstimate = Math.round(originalSize * 0.55); // OxiPNG typically saves ~45%
      } else if (q >= 80) {
        optimizedEstimate = Math.round(originalSize * 0.35); // Light quantization + OxiPNG
      } else {
        optimizedEstimate = Math.round(originalSize * 0.20); // Heavy quantization + OxiPNG
      }
    }

    // Clamp: never estimate larger than original
    if (optimizedEstimate > originalSize) optimizedEstimate = originalSize;

    res.json({ estimatedBytes, optimizedEstimate, isEstimate: useProxy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Estimate video output size (bitrate-based calculation)
app.post("/api/estimate-video", async (req, res) => {
  const { filePath, quality, resWidth, codec } = req.body;
  if (!filePath) return res.status(400).json({ error: "No file" });

  try {
    const info = await getVideoInfo(filePath);
    const videoStream = info.streams.find((s) => s.codec_type === "video");
    if (!videoStream) return res.status(400).json({ error: "No video stream" });

    const duration = parseFloat(info.format.duration) || 1;
    const origWidth = parseInt(videoStream.width);
    const origHeight = parseInt(videoStream.height);
    const origBitrate = parseInt(info.format.bit_rate) || 0;

    // Determine CRF and estimate bitrate
    const q = parseInt(quality) || 70;
    let crf;
    const isHW = codec === "h264_hw" || codec === "h265_hw";
    const isAV1 = codec === "av1";
    const isH265 = codec === "h265" || codec === "h265_hw";

    if (isHW) {
      // HW encoders produce larger files — estimate ~60% of original at Q70
      const hwRatio = q / 100;
      const estimatedBytes = Math.round(origBitrate * duration / 8 * hwRatio);
      return res.json({ estimatedBytes });
    } else if (isAV1) {
      crf = Math.round(55 - (q * 35 / 100));
    } else {
      crf = Math.round(51 - (q * 33 / 100));
    }

    // Simple quality-to-ratio model (calibrated from real tests)
    // Q100 ≈ 20% of original, Q70 ≈ 12%, Q50 ≈ 10%, Q30 ≈ 8%
    // Using a simple mapping: ratio = 0.05 + (q/100) * 0.20
    let ratio = 0.05 + (q / 100) * 0.20;

    // Account for resolution change
    if (resWidth > 0 && resWidth < origWidth) {
      const pixelRatio = (resWidth * resWidth) / (origWidth * origWidth);
      ratio *= Math.max(0.1, pixelRatio);
    }

    // H.265 is ~35% more efficient, AV1 ~45% more efficient
    if (isH265) ratio *= 0.65;
    if (isAV1) ratio *= 0.55;

    const originalBytes = parseInt(info.format.size) || (origBitrate * duration / 8);
    let estimatedBitrate = (originalBytes * ratio * 8) / duration;

    const estimatedBytes = Math.round(estimatedBitrate * duration / 8);
    res.json({ estimatedBytes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Estimate PDF output size (heuristic based on preset)
app.post("/api/estimate-pdf", async (req, res) => {
  const { filePath, quality } = req.body;
  if (!filePath) return res.status(400).json({ error: "No file" });

  try {
    const originalSize = fs.statSync(filePath).size;
    // Rough estimates based on typical PDF compression ratios
    const ratios = { low: 0.25, medium: 0.45, high: 0.70, lossless: 0.90 };
    const ratio = ratios[quality] || ratios.medium;
    const estimatedBytes = Math.round(originalSize * ratio);
    res.json({ estimatedBytes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve a local file (for before/after comparison)
app.get("/api/serve-file", (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: "No path" });

  // Security: only allow files within common user directories
  const homedir = os.homedir();
  const allowedPrefixes = [
    path.join(homedir, "Desktop"),
    path.join(homedir, "Downloads"),
    path.join(homedir, "Documents"),
    path.join(homedir, "Pictures"),
    path.join(homedir, "Movies"),
    os.tmpdir(),
  ];

  const resolvedPath = path.resolve(filePath);
  const isAllowed = allowedPrefixes.some((prefix) => resolvedPath.startsWith(prefix));
  if (!isAllowed) return res.status(403).json({ error: "Access denied" });

  if (!fs.existsSync(resolvedPath)) return res.status(404).json({ error: "File not found" });

  const ext = path.extname(resolvedPath).toLowerCase();
  const mimeMap = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp",
    ".gif": "image/gif", ".heic": "image/heic",
    ".heif": "image/heif", ".tiff": "image/tiff",
  };

  res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");
  fs.createReadStream(resolvedPath).pipe(res);
});

// Transcribe video/audio
app.post("/api/transcribe", async (req, res) => {
  const { filePath, model, language, outputFormat, suffix } = req.body;
  if (!filePath) return res.status(400).json({ error: "No file" });

  try {
    const safeModel = ["tiny", "base", "small", "medium"].includes(model) ? model : "base";
    const safeFormat = ["txt", "srt", "vtt"].includes(outputFormat) ? outputFormat : "txt";
    const safeSuffix = (suffix || "-transcript").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 50) || "-transcript";

    const result = await transcribeVideo(
      filePath,
      safeModel,
      language || "auto",
      safeFormat,
      safeSuffix
    );
    res.json({ results: [result], errors: [] });
  } catch (err) {
    res.json({ results: [], errors: [{ file: path.basename(filePath), error: err.message }] });
  }
});

// --- Status / dependency check ---

// Check for FFmpeg
let HAS_FFMPEG = false;
try {
  require("child_process").execFileSync("which", ["ffmpeg"]);
  HAS_FFMPEG = true;
} catch (_) {}

app.get("/api/version", (req, res) => {
  res.json({ version: APP_VERSION });
});

app.get("/api/status", (req, res) => {
  const tools = {
    // Core
    ffmpeg: HAS_FFMPEG,
    // Optimization (image)
    mozjpeg: !!OPTIM_TOOLS["mozjpeg-jpegtran"],
    oxipng: !!OPTIM_TOOLS["oxipng"],
    pngquant: !!OPTIM_TOOLS["pngquant"],
    jpegoptim: !!OPTIM_TOOLS["jpegoptim"],
    advpng: !!OPTIM_TOOLS["advpng"],
    zopflipng: !!OPTIM_TOOLS["zopflipng"],
    // GIF
    gifsicle: !!OPTIM_TOOLS["gifsicle"],
    gifski: !!OPTIM_TOOLS["gifski"],
    // SVG
    svgo: SVGO_AVAILABLE,
    // PDF
    ghostscript: !!GS_BIN,
    // Transcription
    whisper: (() => { try { fs.statSync(WHISPER_BIN); return true; } catch (_) { return false; } })(),
  };

  const coreOk = HAS_FFMPEG;
  const optimCount = [tools.mozjpeg, tools.oxipng, tools.pngquant, tools.jpegoptim, tools.advpng, tools.zopflipng].filter(Boolean).length;
  const allOptional = optimCount + (tools.gifsicle ? 1 : 0) + (tools.gifski ? 1 : 0) + (tools.svgo ? 1 : 0) + (tools.whisper ? 1 : 0);

  res.json({
    version: `v${APP_VERSION}`,
    tools,
    summary: {
      coreOk,
      optimizationTools: `${optimCount}/6`,
      gifTools: `${(tools.gifsicle ? 1 : 0) + (tools.gifski ? 1 : 0)}/2`,
      svgo: tools.svgo,
      whisper: tools.whisper,
      allOptionalInstalled: allOptional === 10,
    },
    install: {
      core: "npm install && brew install ffmpeg",
      optimization: "brew install mozjpeg oxipng pngquant jpegoptim advancecomp zopfli gifsicle gifski",
      svg: "npm install -g svgo",
      transcription: "pip3 install openai-whisper",
    },
  });
});

app.listen(PORT, () => {
  console.log(`Filey is running at http://localhost:${PORT}`);
  if (!HAS_FFMPEG) console.warn("⚠ FFmpeg not found — video/GIF tools will not work. Install with: brew install ffmpeg");
});
