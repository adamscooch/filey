// --- Drop path extraction (macOS Finder provides file:// URLs) ---

function extractDropPaths(dataTransfer) {
  const paths = {};
  try {
    // Safari and some browsers put file:// URIs in text/uri-list
    const uriList = dataTransfer.getData("text/uri-list") || dataTransfer.getData("URL") || "";
    for (const line of uriList.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("file://")) {
        const decoded = decodeURIComponent(trimmed.replace("file://", ""));
        const name = decoded.split("/").pop();
        if (name) paths[name] = decoded;
      }
    }
  } catch (_) {}
  return paths;
}

// --- Shared utilities ---

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeAttr(str) {
  if (typeof str !== "string") return "";
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatSize(bytes) {
  if (bytes < 1000) return bytes + " B";
  if (bytes < 1000 * 1000) return (bytes / 1000).toFixed(1) + " KB";
  return (bytes / (1000 * 1000)).toFixed(1) + " MB";
}

function shortenPath(p) {
  if (p.startsWith("/Users/")) {
    const parts = p.split("/");
    return "~/" + parts.slice(3).join("/");
  }
  return p;
}

// Verify a known path exists on disk, fall back to search if not
async function verifyPath(knownPath, name, size) {
  const res = await fetch("/api/verify-path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: knownPath }),
  });
  const data = await res.json();
  if (data.valid) return knownPath;
  // Path didn't verify — fall back to search
  return locateFile(name, size);
}

async function locateFile(name, size) {
  const res = await fetch("/api/locate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: name, fileSize: size }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.path;
}

function getTargetBytes(inputEl, toggleEl) {
  const val = parseInt(inputEl?.value);
  if (!val || val <= 0) return 0;
  const unit = toggleEl?.value || toggleEl?.dataset?.unit || "KB";
  return unit === "MB" ? val * 1024 * 1024 : val * 1024;
}

function getSuffix(card) {
  const input = card.el.querySelector(".suffix-input");
  const val = input?.value?.trim();
  // Use placeholder as fallback if field is empty
  return val || input?.placeholder || "-filey";
}

function parseTimeInput(val) {
  if (!val || val === "" || val === "end") return 0;
  // Support formats: "30" (seconds), "1:30" (min:sec), "1:30.5" (min:sec.ms)
  const parts = val.split(":");
  if (parts.length === 1) return parseFloat(parts[0]) || 0;
  if (parts.length === 2) return (parseInt(parts[0]) || 0) * 60 + (parseFloat(parts[1]) || 0);
  if (parts.length === 3) return (parseInt(parts[0]) || 0) * 3600 + (parseInt(parts[1]) || 0) * 60 + (parseFloat(parts[2]) || 0);
  return 0;
}

// --- ToolCard class ---

class ToolCard {
  constructor(config) {
    this.config = config;
    this.el = document.getElementById(config.id);
    this.dropzone = this.el.querySelector(".tool-dropzone");
    this.fileInput = this.el.querySelector('input[type="file"]');
    this.fileList = this.el.querySelector(".tool-file-list");
    this.controls = this.el.querySelector(".tool-controls");
    this.progress = this.el.querySelector(".tool-progress");
    this.progressText = this.el.querySelector(".progress-text");
    this.batchCounter = this.el.querySelector(".batch-counter");
    this.results = this.el.querySelector(".tool-results");
    this.goBtn = this.el.querySelector(".tool-go-btn");
    this.warningEl = this.el.querySelector(".tool-warning");
    this.pendingFiles = [];
    this.bindEvents();
  }

  bindEvents() {
    // Drag and drop
    this.dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.dropzone.classList.add("drag-over");
    });

    this.dropzone.addEventListener("dragleave", () => {
      this.dropzone.classList.remove("drag-over");
    });

    this.dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      this.dropzone.classList.remove("drag-over");
      if (e.dataTransfer.files.length > 0) {
        // Try to extract file:// paths from drag data (macOS Finder provides these)
        const dragPaths = extractDropPaths(e.dataTransfer);
        this.handleFiles(e.dataTransfer.files, dragPaths);
      }
    });

    // Click dropzone to trigger file dialog
    this.dropzone.addEventListener("click", (e) => {
      this.fileInput.click();
    });

    this.fileInput.addEventListener("change", () => {
      if (this.fileInput.files.length > 0) this.handleFiles(this.fileInput.files);
    });

    // Go button
    this.goBtn.addEventListener("click", () => this.process());

    // Compression mode toggle
    this.el.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.el.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const mode = btn.dataset.mode;
        this.el.querySelectorAll(".mode-panel").forEach((panel) => {
          panel.classList.toggle("hidden", panel.dataset.panel !== mode);
        });
      });
    });

    // Quality slider(s) — display value
    this.el.querySelectorAll(".quality-slider").forEach((slider) => {
      const valSpan = slider.closest(".slider-label").querySelector(".slider-val");
      slider.addEventListener("input", () => {
        valSpan.textContent = slider.value;
      });
    });

    // Size unit toggles (now <select> dropdowns — no handler needed)

    // Close/reset results
    this.results.addEventListener("click", (e) => {
      if (e.target.closest(".results-close-btn")) {
        this.reset();
      }
    });
  }

  async handleFiles(browserFiles, dragPaths = {}) {
    // Append mode: keep existing files, add new ones
    const isFirstDrop = this.pendingFiles.length === 0;
    if (isFirstDrop) {
      this.fileList.textContent = "";
      this.results.classList.add("hidden");
      this.results.textContent = "";
      this.hideWarning();
    }

    const validFiles = Array.from(browserFiles).filter(this.config.acceptFilter);
    if (validFiles.length === 0) return;

    // Batch limit
    if (validFiles.length > 50) {
      this.showWarning("Max 50 files at a time. Please drop fewer files.", "red");
      return;
    }

    // File size warning (> 5 GB)
    const bigFiles = validFiles.filter((f) => f.size > 5 * 1024 * 1024 * 1024);
    if (bigFiles.length > 0) {
      this.showWarning(
        `${bigFiles.length} file${bigFiles.length > 1 ? "s" : ""} over 5 GB — processing may be slow.`,
        "yellow"
      );
    }

    // Show loading indicator while locating files
    if (isFirstDrop && validFiles.length > 1) {
      this.fileList.classList.remove("hidden");
      this.fileList.textContent = "";
      const loadingEl = document.createElement("div");
      loadingEl.className = "file-loading";
      loadingEl.textContent = `Loading ${validFiles.length} files...`;
      this.fileList.appendChild(loadingEl);
    }

    let located = 0;
    const locating = validFiles.map(async (f) => {
      try {
        const electronPath = f.path;
        const knownPath = electronPath || dragPaths[f.name];
        const diskPath = electronPath
          ? electronPath
          : knownPath
            ? await verifyPath(knownPath, f.name, f.size)
            : await locateFile(f.name, f.size);
        this.pendingFiles.push({ name: f.name, size: f.size, path: diskPath });
        located++;
        // Update loading progress
        const loadingEl = this.fileList.querySelector(".file-loading");
        if (loadingEl) loadingEl.textContent = `Loading files... ${located} of ${validFiles.length}`;
        return { name: f.name, size: f.size, path: diskPath };
      } catch (err) {
        located++;
        return { name: f.name, size: f.size, error: err.message };
      }
    });

    await Promise.all(locating);
    this.renderFileList(this.pendingFiles);

    this.fileList.classList.remove("hidden");
    // Keep dropzone visible but smaller so user can add more files
    this.dropzone.classList.add("dropzone-mini");

    if (this.pendingFiles.length > 0) {
      this.controls.classList.remove("hidden");
      // Update suffix preview with actual filename
      const suffixPreviews = this.el.querySelectorAll(".suffix-preview");
      if (suffixPreviews.length >= 1) {
        if (this.pendingFiles.length === 1) {
          const nameWithoutExt = this.pendingFiles[0].name.replace(/\.[^.]+$/, "");
          suffixPreviews[0].textContent = nameWithoutExt;
        } else {
          suffixPreviews[0].textContent = `(${this.pendingFiles.length} files)`;
        }
      }
      if (this.config.onFilesReady) {
        this.config.onFilesReady(this);
      }
      if (this.config.checkWarnings) {
        this.config.checkWarnings(this);
      }
    }
  }

  renderFileList(files) {
    this.fileList.innerHTML = files
      .map((f, i) => {
        if (f.error) {
          return `<div class="file-item file-error">
            <div class="file-name">${escapeHtml(f.name)}</div>
            <div class="file-meta">${escapeHtml(f.error)}</div>
          </div>`;
        }
        return `<div class="file-item">
          <button class="file-remove-btn" data-index="${i}">&times;</button>
          <div class="file-name">${escapeHtml(f.name)}</div>
          <div class="file-meta">${formatSize(f.size)} &middot; ${escapeHtml(shortenPath(f.path))}</div>
        </div>`;
      })
      .join("");

    // Bind X remove buttons
    this.fileList.querySelectorAll(".file-remove-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        this.pendingFiles.splice(idx, 1);

        if (this.pendingFiles.length === 0) {
          this.fileList.classList.add("hidden");
          this.controls.classList.add("hidden");
          this.results.classList.add("hidden");
          this.dropzone.classList.remove("dropzone-mini");
          this.fileInput.value = "";
          // Invalidate any in-flight estimates
          estimateGeneration++;
        } else {
          const items = this.pendingFiles.map((f) => ({
            name: f.name,
            size: f.size,
            path: f.path,
          }));
          this.renderFileList(items);
          // Reschedule estimate with updated file list
          if (this.config.id === "tool-image-converter") scheduleEstimate();
          if (this.config.id === "tool-video-converter") scheduleVideoEstimate();
          if (this.config.id === "tool-gif-maker") scheduleGifEstimate();
          if (this.config.id === "tool-pdf-compressor") schedulePdfEstimate();
        }
      });
    });
  }

  showWarning(msg, level = "yellow") {
    if (!this.warningEl) return;
    this.warningEl.textContent = msg;
    this.warningEl.className = `tool-warning warn-${level}`;
    this.warningEl.classList.remove("hidden");
  }

  hideWarning() {
    if (!this.warningEl) return;
    this.warningEl.classList.add("hidden");
    this.warningEl.className = "tool-warning hidden";
  }

  getCompressionMode() {
    const activeBtn = this.el.querySelector(".mode-btn.active");
    return activeBtn?.dataset.mode || "quality";
  }

  async process() {
    if (this.pendingFiles.length === 0) return;

    // Clamp target size before processing (only in target mode)
    if (this.getCompressionMode() === "target") {
      const targetInput = this.el.querySelector('[id$="-target"]');
      if (targetInput && targetInput.value) {
        const toggleBtn = targetInput.closest(".size-input-group")?.querySelector(".size-unit-toggle");
        const unit = toggleBtn?.dataset.unit || "KB";
        const val = parseInt(targetInput.value) || 0;
        const maxKB = this.config.id === "tool-gif-maker" ? 102400 : 512000;
        const maxInUnit = unit === "MB" ? Math.floor(maxKB / 1024) : maxKB;
        if (val > maxInUnit) {
          targetInput.value = maxInUnit;
          this.showWarning(`Target size capped to ${maxInUnit} ${unit}.`, "yellow");
        }
      }
    }

    this.goBtn.disabled = true;
    this.controls.classList.add("hidden");
    this.fileList.classList.add("hidden");
    this.progress.classList.remove("hidden");
    this.results.classList.add("hidden");

    const total = this.pendingFiles.length;

    try {
      const allResults = [];
      const allErrors = [];

      for (let i = 0; i < total; i++) {
        if (total > 1) {
          this.progressText.textContent = `Processing ${i + 1} of ${total}...`;
          this.batchCounter.textContent = `File: ${this.pendingFiles[i].name}`;
          this.batchCounter.classList.remove("hidden");
        }

        const singleFile = this.pendingFiles[i];
        const payload = this.config.getPayload(this, singleFile);
        const res = await fetch(this.config.apiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (data.results) allResults.push(...data.results);
        if (data.errors) allErrors.push(...data.errors);

        // Update quality slider with server's actual quality (for target size mode)
        if (data.results) {
          for (const r of data.results) {
            if (r.qualityUsed !== undefined) {
              const slider = this.el.querySelector(".quality-slider");
              const valSpan = this.el.querySelector(".slider-val");
              if (slider && valSpan) {
                slider.value = r.qualityUsed;
                valSpan.textContent = r.qualityUsed;
              }
            }
          }
        }
      }

      let html = "";

      for (const r of allResults) {
        html += this.config.renderResult(r);
      }

      for (const e of allErrors) {
        html += `<div class="result-card result-error">
          <div class="result-header">${escapeHtml(e.file)}</div>
          <div class="result-meta">Error: ${escapeHtml(e.error)}</div>
        </div>`;
      }

      this.results.innerHTML = html;
      this.progress.classList.add("hidden");
      this.batchCounter.classList.add("hidden");
      this.results.classList.remove("hidden");
      this.dropzone.classList.remove("hidden");

      // Bind reveal buttons
      this.results.querySelectorAll(".reveal-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          fetch("/api/reveal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: btn.dataset.path }),
          });
        });
      });

      // Init comparison sliders if any
      initComparisonSliders();
    } catch (err) {
      this.progress.classList.add("hidden");
      this.batchCounter.classList.add("hidden");
      this.controls.classList.remove("hidden");
      this.fileList.classList.remove("hidden");
      this.goBtn.disabled = false;
      alert("Error: " + err.message);
      return;
    }
    this.goBtn.disabled = false;
    this.pendingFiles = [];
    this.fileInput.value = "";
  }

  reset() {
    // Smooth fade-out before resetting
    this.results.style.transition = "opacity 0.25s ease, transform 0.25s ease";
    this.results.style.opacity = "0";
    this.results.style.transform = "translateY(8px)";
    setTimeout(() => {
      this.pendingFiles = [];
      this.fileList.textContent = "";
      this.fileList.classList.add("hidden");
      this.controls.classList.add("hidden");
      this.results.classList.add("hidden");
      this.results.textContent = "";
      this.results.style.opacity = "";
      this.results.style.transform = "";
      this.results.style.transition = "";
      this.progress.classList.add("hidden");
      this.dropzone.classList.remove("dropzone-mini");
      this.hideWarning();
      this.goBtn.disabled = false;
    }, 250);
  }
}

// --- Result rendering ---

function renderResult(r, isSingleFile) {
  const origBytes = r.originalSize;
  const outBytes = r.outputSize;
  const origDisplay = formatSize(origBytes);
  const outDisplay = formatSize(outBytes);
  const savedPercent = r.savedPercent;
  const isSmaller = savedPercent > 0;

  const savingsClass = isSmaller ? "positive" : "negative";
  const savingsText = isSmaller
    ? `-${savedPercent}% smaller`
    : savedPercent === 0
      ? "Same size"
      : `+${Math.abs(savedPercent)}% larger`;

  const warningHtml = r.warning
    ? `<div class="result-warning-text">${escapeHtml(r.warning)}</div>`
    : "";

  const methodHtml = r.method
    ? `<div class="result-meta">Method: ${escapeHtml(r.method)}</div>`
    : "";

  const dimsHtml = r.dimensions
    ? `<div class="result-meta">${escapeHtml(r.dimensions)}</div>`
    : "";

  // Before/after comparison slider (single images only)
  let comparisonHtml = "";
  if (isSingleFile && r.originalPath && r.savedTo) {
    const origSrc = `/api/serve-file?path=${encodeURIComponent(r.originalPath)}`;
    const outSrc = `/api/serve-file?path=${encodeURIComponent(r.savedTo)}`;
    comparisonHtml = `
    <div class="comparison-container" data-position="50">
      <img class="comp-before" src="${origSrc}" alt="Original">
      <div class="comp-after-wrap" style="clip-path: inset(0 0 0 50%);">
        <img class="comp-after" src="${outSrc}" alt="Compressed">
      </div>
      <div class="comparison-divider" style="left: 50%;"></div>
      <div class="comparison-handle" style="left: 50%;">
        <svg viewBox="0 0 14 14"><path d="M4 7L1 4M1 4L4 1M1 4H6M10 7L13 4M13 4L10 1M13 4H8M4 13L1 10M1 10L4 7M1 10H6M10 13L13 10M13 10L10 7M13 10H8" stroke="#1A1410" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
      </div>
      <div class="comparison-labels">
        <span>Before</span>
        <span>After</span>
      </div>
      <button class="comp-maximize-btn" data-orig="${escapeAttr(origSrc)}" data-out="${escapeAttr(outSrc)}" title="Fullscreen comparison">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 2 14 2 14 6"/><polyline points="6 14 2 14 2 10"/><line x1="14" y1="2" x2="9" y2="7"/><line x1="2" y1="14" x2="7" y2="9"/></svg>
      </button>
    </div>`;
  }

  return `<div class="result-card${r.warning ? ' result-warning' : ''}">
    <button class="results-close-btn" title="Close">&times;</button>
    <div class="result-header">${escapeHtml(r.outputName)}</div>
    <div class="result-savings ${savingsClass}">${savingsText}</div>
    <div class="result-details">
      <span>${origDisplay}</span>
      <span class="arrow">&rarr;</span>
      <span>${outDisplay}</span>
    </div>
    ${dimsHtml}
    ${warningHtml}
    ${comparisonHtml}
    <div class="saved-path">Saved to ${escapeHtml(shortenPath(r.savedTo))}</div>
    <button class="reveal-btn" data-path="${escapeAttr(r.savedTo)}">Show in Finder</button>
  </div>`;
}

function renderVideoResult(r) {
  const origBytes = r.originalSize;
  const outBytes = r.outputSize;
  const origDisplay = formatSize(origBytes);
  const outDisplay = formatSize(outBytes);
  const savedPercent = r.savedPercent;
  const isSmaller = savedPercent > 0;

  const savingsClass = isSmaller ? "positive" : "negative";
  const savingsText = isSmaller
    ? `-${savedPercent}% smaller`
    : savedPercent === 0
      ? "Same size"
      : `+${Math.abs(savedPercent)}% larger`;

  const warningHtml = r.warning
    ? `<div class="result-warning-text">${escapeHtml(r.warning)}</div>`
    : "";

  const qualityMeta = r.qualityUsed
    ? ` &middot; CRF ${Math.round(51 - (r.qualityUsed * 33 / 100))}`
    : "";

  return `<div class="result-card${r.warning ? ' result-warning' : ''}">
    <button class="results-close-btn" title="Close">&times;</button>
    <div class="result-header">${escapeHtml(r.outputName)}</div>
    <div class="result-savings ${savingsClass}">${savingsText}</div>
    <div class="result-details">
      <span>${origDisplay}</span>
      <span class="arrow">&rarr;</span>
      <span>${outDisplay}</span>
    </div>
    <div class="result-meta">${escapeHtml(r.dimensions)} &middot; ${escapeHtml(r.codec)}${qualityMeta}</div>
    ${warningHtml}
    <div class="saved-path">Saved to ${escapeHtml(shortenPath(r.savedTo))}</div>
    <button class="reveal-btn" data-path="${escapeAttr(r.savedTo)}">Show in Finder</button>
  </div>`;
}

function renderGifResult(r) {
  const origBytes = r.originalSize;
  const outBytes = r.outputSize;
  const origDisplay = formatSize(origBytes);
  const outDisplay = formatSize(outBytes);
  const savedPercent = r.savedPercent;
  const isSmaller = savedPercent > 0;

  const savingsClass = isSmaller ? "positive" : "negative";
  const savingsText = isSmaller
    ? `-${savedPercent}% smaller`
    : savedPercent === 0
      ? "Same size"
      : `+${Math.abs(savedPercent)}% larger`;

  const warningHtml = r.warning
    ? `<div class="result-warning-text">${escapeHtml(r.warning)}</div>`
    : "";

  const colorsInfo = r.colorsUsed ? `${r.colorsUsed} colors` : "";
  const fpsInfo = r.fps ? `${r.fps} FPS` : "";
  const dimsInfo = r.dimensions || "";
  const metaParts = [dimsInfo, fpsInfo, colorsInfo].filter(Boolean);

  return `<div class="result-card${r.warning ? ' result-warning' : ''}">
    <button class="results-close-btn" title="Close">&times;</button>
    <div class="result-header">${escapeHtml(r.outputName)}</div>
    <div class="result-savings ${savingsClass}">${savingsText}</div>
    <div class="result-details">
      <span>${origDisplay}</span>
      <span class="arrow">&rarr;</span>
      <span>${outDisplay}</span>
    </div>
    ${metaParts.length ? `<div class="result-meta">${escapeHtml(metaParts.join(" \u00b7 "))}</div>` : ""}
    ${warningHtml}
    <div class="saved-path">Saved to ${escapeHtml(shortenPath(r.savedTo))}</div>
    <button class="reveal-btn" data-path="${escapeAttr(r.savedTo)}">Show in Finder</button>
  </div>`;
}

// Store transcripts by output path for clipboard copy
const transcriptStore = {};

function renderTranscriptResult(r) {
  const transcript = r.transcript || "";
  const transcriptPreview = transcript.length > 2000
    ? transcript.slice(0, 2000) + "..."
    : transcript || "(empty transcript)";

  // Store full transcript for copy button
  transcriptStore[r.savedTo] = transcript;

  // Escape HTML
  const escaped = transcriptPreview
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<div class="result-card transcript-result">
    <button class="results-close-btn" title="Close">&times;</button>
    <div class="result-header">${escapeHtml(r.outputName)}</div>
    <div class="result-meta">${escapeHtml(r.model)} model &middot; ${escapeHtml(r.language)} &middot; ${escapeHtml(r.outputFormat.toUpperCase())}</div>
    <div class="transcript-box"><pre class="transcript-text">${escaped}</pre></div>
    <button class="copy-transcript-btn" data-key="${escapeAttr(r.savedTo)}">Copy to Clipboard</button>
    <div class="saved-path">Saved to ${escapeHtml(shortenPath(r.savedTo))}</div>
    <button class="reveal-btn" data-path="${escapeAttr(r.savedTo)}">Show in Finder</button>
  </div>`;
}

// --- Warning helpers ---

async function checkVideoWarnings(card) {
  if (card.pendingFiles.length === 0) return;
  const targetEl = document.getElementById("vc-target");
  const toggleBtn = targetEl?.closest(".size-input-group")?.querySelector(".size-unit-toggle");
  const targetBytes = getTargetBytes(targetEl, toggleBtn);
  if (targetBytes <= 0) { card.hideWarning(); return; }

  try {
    const res = await fetch("/api/file-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: card.pendingFiles[0].path, type: "video" }),
    });
    const info = await res.json();
    const origBytes = info.sizeBytes;
    const ratio = targetBytes / origBytes;
    const targetKB = targetBytes / 1024;

    if (targetKB < 50) {
      card.showWarning("Target is very small. Video quality will be extremely poor.", "red");
    } else if (ratio < 0.05) {
      card.showWarning("Target is less than 5% of original. Expect severe quality loss.", "red");
    } else if (ratio < 0.15) {
      card.showWarning("Target is very aggressive. Quality may be poor.", "yellow");
    } else {
      card.hideWarning();
    }
  } catch (_) {}
}

// --- Video resolution detection ---

async function detectVideoResolution(card) {
  if (card.pendingFiles.length === 0) return;

  try {
    const res = await fetch("/api/file-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: card.pendingFiles[0].path, type: "video" }),
    });
    const info = await res.json();

    if (info.width && info.height) {
      card.sourceWidth = info.width;
      card.sourceHeight = info.height;

      // Show source resolution
      const srcResEl = document.getElementById("vc-source-res");
      const srcResVal = document.getElementById("vc-source-res-value");
      if (srcResEl && srcResVal) {
        const label = getResolutionLabel(info.width, info.height);
        srcResVal.textContent = `${info.width}x${info.height}${label ? ` (${label})` : ""}`;
        srcResEl.classList.remove("hidden");
      }

      disableVideoUpscaleOptions(info.width, info.height);
      updateVideoSuffixSuggestion();
    }
  } catch (_) {}
}

function getResolutionLabel(w, h) {
  const maxDim = Math.max(w, h);
  if (maxDim >= 3840) return "4K";
  if (maxDim >= 2560) return "1440p";
  if (maxDim >= 1920) return "1080p";
  if (maxDim >= 1280) return "720p";
  if (maxDim >= 854) return "480p";
  return "";
}

function updateVideoSuffixSuggestion() {
  const resSelect = document.getElementById("vc-resolution");
  const suffixInput = document.querySelector("#tool-video-converter .suffix-input");
  if (!resSelect || !suffixInput) return;

  const val = resSelect.value;
  if (val === "original") {
    suffixInput.placeholder = "-filey";
  } else if (val === "custom") {
    const customW = document.getElementById("vc-custom-width")?.value;
    suffixInput.placeholder = customW ? `-${customW}p` : "-filey";
  } else {
    const labels = { "3840": "-4K", "2560": "-1440p", "1920": "-1080p", "1280": "-720p", "854": "-480p" };
    suffixInput.placeholder = labels[val] || "-filey";
  }
}

// --- Image dimension detection ---

async function detectImageDimensions(card) {
  if (card.pendingFiles.length === 0) return;

  try {
    const res = await fetch("/api/file-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: card.pendingFiles[0].path, type: "image" }),
    });
    const info = await res.json();

    if (info.width && info.height) {
      card.sourceWidth = info.width;
      card.sourceHeight = info.height;

      // Show source resolution
      const srcResEl = document.getElementById("ic-source-res");
      const srcResVal = document.getElementById("ic-source-res-value");
      if (srcResEl && srcResVal) {
        srcResVal.textContent = `${info.width} × ${info.height}`;
        srcResEl.classList.remove("hidden");
      }

      updateImageScaleLabels(info.width, info.height);
    }
  } catch (_) {}
}

function updateImageScaleLabels(srcW, srcH) {
  const scaleSelect = document.getElementById("ic-scale");
  if (!scaleSelect) return;

  Array.from(scaleSelect.options).forEach((opt) => {
    const val = opt.value;
    if (val === "custom" || val === "100") {
      if (val === "100") {
        opt.textContent = `Original (${srcW} × ${srcH})`;
      }
      return;
    }
    const pct = parseInt(val);
    if (!pct) return;
    const w = Math.round(srcW * pct / 100);
    const h = Math.round(srcH * pct / 100);
    opt.textContent = `${pct}% (${w} × ${h})`;
  });
}

// --- Image resize preset handling ---

document.getElementById("ic-scale")?.addEventListener("change", (e) => {
  const customRow = document.getElementById("ic-custom-dims-row");
  if (e.target.value === "custom") {
    customRow?.classList.remove("hidden");
  } else {
    customRow?.classList.add("hidden");
  }
});

document.getElementById("ic-custom-width")?.addEventListener("input", (e) => {
  const lockBtn = document.getElementById("ic-aspect-lock");
  const heightInput = document.getElementById("ic-custom-height");
  if (!lockBtn?.classList.contains("active") || !heightInput) return;

  const w = parseInt(e.target.value) || 0;
  if (w > 0 && imageCard?.sourceWidth && imageCard?.sourceHeight) {
    const aspect = imageCard.sourceHeight / imageCard.sourceWidth;
    heightInput.value = Math.round(w * aspect);
  } else {
    heightInput.value = "";
  }
});

document.getElementById("ic-custom-height")?.addEventListener("input", (e) => {
  const lockBtn = document.getElementById("ic-aspect-lock");
  const widthInput = document.getElementById("ic-custom-width");
  if (!lockBtn?.classList.contains("active") || !widthInput) return;

  const h = parseInt(e.target.value) || 0;
  if (h > 0 && imageCard?.sourceWidth && imageCard?.sourceHeight) {
    const aspect = imageCard.sourceWidth / imageCard.sourceHeight;
    widthInput.value = Math.round(h * aspect);
  } else {
    widthInput.value = "";
  }
});

document.getElementById("ic-aspect-lock")?.addEventListener("click", (e) => {
  const btn = e.currentTarget;
  btn.classList.toggle("active");
});

// --- Video upscale prevention ---

function disableVideoUpscaleOptions(sourceWidth, sourceHeight) {
  const resSelect = document.getElementById("vc-resolution");
  if (!resSelect) return;

  // Presets represent the long edge, so compare against source long edge
  const longEdge = Math.max(sourceWidth, sourceHeight || sourceWidth);

  Array.from(resSelect.options).forEach((opt) => {
    const val = opt.value;
    if (val === "original" || val === "custom") return;

    const presetVal = parseInt(val);
    if (presetVal > longEdge) {
      opt.disabled = true;
      if (!opt.textContent.includes("(upscale)")) {
        opt.textContent = opt.textContent + " (upscale)";
      }
    } else {
      opt.disabled = false;
      opt.textContent = opt.textContent.replace(" (upscale)", "");
    }
  });
}

// --- Video resolution preset handling ---

document.getElementById("vc-resolution")?.addEventListener("change", (e) => {
  const customRow = document.getElementById("vc-custom-res-row");
  if (e.target.value === "custom") {
    customRow?.classList.remove("hidden");
  } else {
    customRow?.classList.add("hidden");
  }
  updateVideoSuffixSuggestion();
});

document.getElementById("vc-custom-width")?.addEventListener("input", () => {
  updateVideoSuffixSuggestion();
  // Upscale warning for custom width
  const customW = parseInt(document.getElementById("vc-custom-width")?.value) || 0;
  if (customW > 0 && videoCard?.sourceWidth && customW > videoCard.sourceWidth) {
    videoCard.showWarning(`${customW}px exceeds source width (${videoCard.sourceWidth}px). This will upscale the video.`, "yellow");
  } else {
    videoCard.hideWarning();
  }
});

// --- GIF width preset handling ---

document.getElementById("gm-width-preset")?.addEventListener("change", (e) => {
  const customRow = document.getElementById("gm-custom-width-row");
  if (e.target.value === "custom") {
    customRow?.classList.remove("hidden");
  } else {
    customRow?.classList.add("hidden");
  }
  const suffixInput = document.querySelector("#tool-gif-maker .suffix-input");
  if (suffixInput) {
    const w = e.target.value === "custom"
      ? document.getElementById("gm-custom-width")?.value || ""
      : e.target.value;
    suffixInput.placeholder = w ? `-${w}px` : "-filey";
  }
});

document.getElementById("gm-custom-width")?.addEventListener("input", (e) => {
  const suffixInput = document.querySelector("#tool-gif-maker .suffix-input");
  if (suffixInput) {
    suffixInput.placeholder = e.target.value ? `-${e.target.value}px` : "-filey";
  }
});

// --- Helper to get video resolution from controls ---

function getVideoResolution() {
  const resSelect = document.getElementById("vc-resolution");
  const val = resSelect?.value;

  if (!val || val === "original") {
    return { resWidth: 0, resHeight: 0, scale: 100 };
  }

  if (val === "custom") {
    const customW = parseInt(document.getElementById("vc-custom-width")?.value) || 0;
    return { resWidth: customW, resHeight: 0, scale: 100 };
  }

  // Resolution presets represent the long edge of standard resolutions.
  // For portrait videos (height > width), apply preset as height instead of width.
  const presetVal = parseInt(val);
  const isPortrait = videoCard?.sourceHeight > videoCard?.sourceWidth;

  if (isPortrait) {
    return { resWidth: 0, resHeight: presetVal, scale: 100 };
  }
  return { resWidth: presetVal, resHeight: 0, scale: 100 };
}

function getGifWidth() {
  const preset = document.getElementById("gm-width-preset");
  const val = preset?.value;

  if (val === "custom") {
    return parseInt(document.getElementById("gm-custom-width")?.value) || 480;
  }

  return parseInt(val) || 480;
}

// --- Comparison slider ---

// Single delegated comparison slider handler (no per-container window listeners)
let _activeSlider = null;

function _updateSliderPosition(container, clientX) {
  const rect = container.getBoundingClientRect();
  let pct = ((clientX - rect.left) / rect.width) * 100;
  pct = Math.max(0, Math.min(100, pct));
  container.dataset.position = pct;
  container.querySelector(".comp-after-wrap").style.clipPath = `inset(0 0 0 ${pct}%)`;
  container.querySelector(".comparison-divider").style.left = `${pct}%`;
  container.querySelector(".comparison-handle").style.left = `${pct}%`;
}

document.addEventListener("mousedown", (e) => {
  const container = e.target.closest(".comparison-container");
  if (!container) return;
  e.preventDefault();
  _activeSlider = container;
  _updateSliderPosition(container, e.clientX);
});

window.addEventListener("mousemove", (e) => {
  if (!_activeSlider) return;
  e.preventDefault();
  _updateSliderPosition(_activeSlider, e.clientX);
});

window.addEventListener("mouseup", () => { _activeSlider = null; });

document.addEventListener("touchstart", (e) => {
  const container = e.target.closest(".comparison-container");
  if (!container) return;
  _activeSlider = container;
  _updateSliderPosition(container, e.touches[0].clientX);
}, { passive: true });

window.addEventListener("touchmove", (e) => {
  if (!_activeSlider) return;
  _updateSliderPosition(_activeSlider, e.touches[0].clientX);
}, { passive: true });

window.addEventListener("touchend", () => { _activeSlider = null; });

function initComparisonSliders() {
  // No-op: delegated handlers above cover all comparison containers automatically
}

// --- Comparison modal ---

function openComparisonModal(origSrc, outSrc) {
  const modal = document.getElementById("comp-modal");
  if (!modal) return;
  document.getElementById("comp-modal-before").src = origSrc;
  document.getElementById("comp-modal-after").src = outSrc;
  modal.classList.remove("hidden");
  // Reset slider position
  const container = modal.querySelector(".comp-modal-slider");
  container.dataset.position = 50;
  container.querySelector(".comp-after-wrap").style.clipPath = "inset(0 0 0 50%)";
  container.querySelector(".comparison-divider").style.left = "50%";
  container.querySelector(".comparison-handle").style.left = "50%";
  // Init slider interaction for the modal
  initComparisonSliders();
}

function closeComparisonModal() {
  const modal = document.getElementById("comp-modal");
  if (!modal) return;
  modal.classList.add("hidden");
}

document.addEventListener("click", (e) => {
  const maxBtn = e.target.closest(".comp-maximize-btn");
  if (maxBtn) {
    e.stopPropagation();
    openComparisonModal(maxBtn.dataset.orig, maxBtn.dataset.out);
    return;
  }
  if (e.target.closest(".comp-modal-close") || e.target.closest(".comp-modal-backdrop")) {
    closeComparisonModal();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeComparisonModal();
});

// --- Dynamic button labels ---

function updateImageButtonLabel() {
  const btn = document.querySelector("#tool-image-converter .tool-go-btn");
  if (!btn) return;

  const format = document.getElementById("ic-format")?.value || "auto";
  const scale = document.getElementById("ic-scale")?.value || "100";
  const mode = imageCard?.getCompressionMode?.() || "quality";

  const customW = document.getElementById("ic-custom-width")?.value;
  const customH = document.getElementById("ic-custom-height")?.value;
  const hasCustomDims = scale === "custom" && (customW || customH);
  const hasResize = scale !== "100" || hasCustomDims;

  let hasCompression = false;
  if (mode === "quality") {
    const q = parseInt(document.querySelector("#tool-image-converter .quality-slider")?.value) || 85;
    hasCompression = q < 100 || hasResize;
  } else {
    const targetEl = document.getElementById("ic-target");
    const toggleBtn = targetEl?.closest(".size-input-group")?.querySelector(".size-unit-toggle");
    hasCompression = getTargetBytes(targetEl, toggleBtn) > 0;
  }

  const isConverting = format !== "auto";

  if (isConverting && hasCompression) {
    btn.textContent = "Convert & Compress";
  } else if (isConverting) {
    btn.textContent = "Convert";
  } else {
    btn.textContent = "Compress";
  }
}

function updateVideoButtonLabel() {
  const btn = document.querySelector("#tool-video-converter .tool-go-btn");
  if (!btn) return;

  const format = document.getElementById("vc-format")?.value || "mp4";
  const resolution = document.getElementById("vc-resolution")?.value || "original";
  const mode = videoCard?.getCompressionMode?.() || "quality";

  let hasCompression = false;
  if (mode === "quality") {
    const q = parseInt(document.querySelector("#tool-video-converter .quality-slider")?.value) || 70;
    hasCompression = q < 100 || resolution !== "original";
  } else {
    const targetEl = document.getElementById("vc-target");
    const toggleBtn = targetEl?.closest(".size-input-group")?.querySelector(".size-unit-toggle");
    hasCompression = getTargetBytes(targetEl, toggleBtn) > 0 || resolution !== "original";
  }

  // Detect format change — MP4 is default, MOV is a conversion
  const isConverting = format !== "mp4";

  if (isConverting && hasCompression) {
    btn.textContent = "Convert & Compress";
  } else if (isConverting) {
    btn.textContent = "Convert";
  } else {
    btn.textContent = "Compress";
  }
}

// --- Estimated file size (image tool only) ---

let estimateTimer = null;
let estimateGeneration = 0;

function scheduleEstimate() {
  clearTimeout(estimateTimer);

  const estimateEl = document.getElementById("ic-estimate");
  const estimateVal = document.getElementById("ic-estimate-value");
  if (!estimateEl || !estimateVal) return;

  // Hide if no files
  if (!imageCard?.pendingFiles?.length) {
    estimateEl.classList.add("hidden");
    return;
  }

  // Hide in target mode (the target IS the estimate)
  if (imageCard.getCompressionMode() === "target") {
    estimateEl.classList.add("hidden");
    return;
  }

  estimateVal.textContent = "calculating...";
  estimateEl.classList.remove("hidden");

  const thisGeneration = ++estimateGeneration;
  estimateTimer = setTimeout(async () => {
    try {
      const scaleVal = document.getElementById("ic-scale")?.value;
      let resize = {};
      if (scaleVal === "custom") {
        const w = parseInt(document.getElementById("ic-custom-width")?.value) || 0;
        const h = parseInt(document.getElementById("ic-custom-height")?.value) || 0;
        resize = { width: w || undefined, height: h || undefined };
      } else {
        resize = { scale: parseInt(scaleVal) || 100 };
      }

      const quality = parseInt(document.querySelector("#tool-image-converter .quality-slider")?.value) || 85;
      const format = document.getElementById("ic-format")?.value || "auto";

      // Estimate all files in batch
      const files = imageCard.pendingFiles;
      let totalOriginal = 0;
      let totalEstimated = 0;
      const perFileEstimates = [];

      for (const file of files) {
        if (thisGeneration !== estimateGeneration) return; // stale request
        const res = await fetch("/api/estimate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filePath: file.path,
            outputFormat: format,
            quality: quality,
            resize: resize,
          }),
        });

        const data = await res.json();
        if (data.error) continue;

        const estBytes = data.optimizedEstimate || data.estimatedBytes;
        totalOriginal += file.size;
        totalEstimated += estBytes;
        perFileEstimates.push({ name: file.name, original: file.size, estimated: estBytes });
      }

      if (thisGeneration !== estimateGeneration) return; // stale request

      if (perFileEstimates.length === 0) {
        estimateEl.classList.add("hidden");
        return;
      }

      if (files.length === 1) {
        const beforeStr = formatSize(totalOriginal) + " → ";
        if (totalEstimated >= totalOriginal * 0.95) {
          estimateVal.textContent = `${beforeStr}~${formatSize(totalEstimated)} (minimal change at this quality)`;
        } else {
          estimateVal.textContent = `${beforeStr}~${formatSize(totalEstimated)}`;
        }
      } else {
        const beforeStr = formatSize(totalOriginal) + " → ";
        estimateVal.textContent = `${beforeStr}~${formatSize(totalEstimated)} (${files.length} files)`;
      }
    } catch (_) {
      if (thisGeneration === estimateGeneration) estimateEl.classList.add("hidden");
    }
  }, 500);
}

// --- Video estimate ---
let videoEstimateTimer;
function scheduleVideoEstimate() {
  clearTimeout(videoEstimateTimer);
  const estimateEl = document.getElementById("vc-estimate");
  const estimateVal = document.getElementById("vc-estimate-value");
  if (!estimateEl || !estimateVal) return;
  if (!videoCard?.pendingFiles?.length) { estimateEl.classList.add("hidden"); return; }
  if (videoCard.getCompressionMode() === "target") { estimateEl.classList.add("hidden"); return; }

  estimateVal.textContent = "calculating...";
  estimateEl.classList.remove("hidden");

  videoEstimateTimer = setTimeout(async () => {
    try {
      const quality = parseInt(document.querySelector("#tool-video-converter .quality-slider")?.value) || 70;
      const resVal = document.getElementById("vc-resolution")?.value;
      const resWidth = resVal === "original" || resVal === "custom" ? 0 : parseInt(resVal) || 0;
      const codec = document.getElementById("vc-codec")?.value || "auto";

      const res = await fetch("/api/estimate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: videoCard.pendingFiles[0].path,
          quality,
          resWidth,
          codec,
        }),
      });
      const data = await res.json();
      if (data.error) { estimateEl.classList.add("hidden"); return; }
      const originalSize = videoCard.pendingFiles[0]?.size;
      const beforeStr = originalSize ? formatSize(originalSize) + " → " : "";
      estimateVal.textContent = `${beforeStr}~${formatSize(data.estimatedBytes)}`;
    } catch (_) { estimateEl.classList.add("hidden"); }
  }, 300);
}

// --- PDF estimate ---
function schedulePdfEstimate() {
  const estimateEl = document.getElementById("pdf-estimate");
  const estimateVal = document.getElementById("pdf-estimate-value");
  if (!estimateEl || !estimateVal) return;
  if (!pdfCard?.pendingFiles?.length) { estimateEl.classList.add("hidden"); return; }

  const quality = document.getElementById("pdf-quality")?.value || "medium";
  const originalSize = pdfCard.pendingFiles[0]?.size;
  if (!originalSize) { estimateEl.classList.add("hidden"); return; }

  // Quick local estimate without API call
  const ratios = { low: 0.25, medium: 0.45, high: 0.70, lossless: 0.90 };
  const ratio = ratios[quality] || 0.45;
  const estimated = Math.round(originalSize * ratio);
  const beforeStr = formatSize(originalSize) + " → ";
  estimateVal.textContent = `${beforeStr}~${formatSize(estimated)}`;
  estimateEl.classList.remove("hidden");
}

// --- GIF estimate ---
function scheduleGifEstimate() {
  const estimateEl = document.getElementById("gif-estimate");
  const estimateVal = document.getElementById("gif-estimate-value");
  if (!estimateEl || !estimateVal) return;
  if (!gifCard?.pendingFiles?.length) { estimateEl.classList.add("hidden"); return; }
  if (gifCard.getCompressionMode() === "target") { estimateEl.classList.add("hidden"); return; }

  const originalSize = gifCard.pendingFiles[0]?.size;
  if (!originalSize) { estimateEl.classList.add("hidden"); return; }

  // GIF estimates are very rough — based on width, fps, and colors
  const width = getGifWidth();
  const fps = parseInt(document.getElementById("gm-fps")?.value) || 10;
  const colors = parseInt(document.querySelector("#tool-gif-maker .quality-slider")?.value) || 256;

  // Rough heuristic: GIF size scales with width^2 * fps * (colors/256)
  // Base ratio at 480px/10fps/256colors is ~0.15 of video size
  const widthRatio = (width / 480) * (width / 480);
  const fpsRatio = fps / 10;
  const colorRatio = colors / 256;
  const baseRatio = 0.15;
  const estimated = Math.round(originalSize * baseRatio * widthRatio * fpsRatio * colorRatio);

  const beforeStr = formatSize(originalSize) + " → ";
  estimateVal.textContent = `${beforeStr}~${formatSize(estimated)} (rough estimate)`;
  estimateEl.classList.remove("hidden");
}

// --- Format hint for image card ---

function updateFormatHint() {
  const hintEl = document.getElementById("ic-format-hint");
  if (!hintEl) return;

  const format = document.getElementById("ic-format")?.value || "auto";
  const quality = parseInt(document.querySelector("#tool-image-converter .quality-slider")?.value) || 85;

  // Detect the actual output format
  let actualFormat = format;
  if (format === "auto" && imageCard?.pendingFiles?.length) {
    const ext = imageCard.pendingFiles[0].name.split(".").pop().toLowerCase();
    if (ext === "heic" || ext === "heif") actualFormat = "jpg";
    else actualFormat = ext === "jpeg" ? "jpg" : ext;
  }

  if (actualFormat === "png" && quality >= 80) {
    hintEl.textContent = "PNGs are lossless — the quality slider has minimal effect above 80%. Most savings come from automatic optimization.";
    hintEl.classList.remove("hidden");
  } else if (actualFormat === "png" && quality < 80) {
    hintEl.textContent = "Reducing PNG quality below 80% applies color quantization (fewer colors, smaller file).";
    hintEl.classList.remove("hidden");
  } else {
    hintEl.classList.add("hidden");
  }
}

// --- Update image suffix extension preview ---

function updateImageExtPreview() {
  const previews = document.querySelectorAll("#tool-image-converter .suffix-preview");
  if (previews.length < 2) return;

  const format = document.getElementById("ic-format")?.value || "auto";
  let ext;
  if (format === "auto") {
    // Use the file's original extension
    if (imageCard?.pendingFiles?.length) {
      ext = "." + imageCard.pendingFiles[0].name.split(".").pop().toLowerCase();
      if (ext === ".jpeg") ext = ".jpg";
      if (ext === ".heic" || ext === ".heif") ext = ".jpg"; // HEIC auto-converts to JPG
    } else {
      ext = ".*";
    }
  } else {
    ext = "." + format;
  }
  previews[1].textContent = ext;
}

// --- Smart suffix for image card ---

function updateImageSmartSuffix() {
  const suffixInput = document.querySelector("#tool-image-converter .suffix-input");
  if (!suffixInput) return;

  const format = document.getElementById("ic-format")?.value || "auto";
  const quality = parseInt(document.querySelector("#tool-image-converter .quality-slider")?.value) || 85;
  const scale = document.getElementById("ic-scale")?.value || "100";
  const stripMeta = true; // always optimize
  const mode = imageCard?.getCompressionMode?.() || "quality";

  let parts = ["-filey"];

  // Format conversion
  if (format !== "auto") {
    parts.push(format);
  }

  // Quality (only in quality mode, skip if 100 since that's lossless)
  if (mode === "quality" && quality < 100) {
    parts.push("q" + quality);
  }

  // Resize
  if (scale !== "100" && scale !== "custom") {
    parts.push(scale + "pct");
  } else if (scale === "custom") {
    const w = document.getElementById("ic-custom-width")?.value;
    if (w) parts.push(w + "w");
  }

  // Strip metadata
  if (stripMeta) {
    parts.push("strip");
  }

  // Build the suffix string
  let smart;
  if (parts.length === 1) {
    // Only "-filey" with no modifications
    smart = "-filey";
  } else {
    smart = parts.join("-");
  }

  suffixInput.placeholder = smart;
}

// --- Tool instances ---

// Image Converter
const imageCard = new ToolCard({
  id: "tool-image-converter",
  acceptFilter: (f) =>
    f.type.startsWith("image/") ||
    /\.(jpg|jpeg|png|webp|heic|heif|tiff|gif)$/i.test(f.name),
  apiEndpoint: "/api/process-image",
  onFilesReady: (card) => {
    detectImageDimensions(card);
  },
  getPayload: (card, file) => {
    const mode = card.getCompressionMode();
    const scaleVal = document.getElementById("ic-scale")?.value;

    let resize = {};
    if (scaleVal === "custom") {
      const w = parseInt(document.getElementById("ic-custom-width")?.value) || 0;
      const h = parseInt(document.getElementById("ic-custom-height")?.value) || 0;
      resize = { width: w || undefined, height: h || undefined, maintainAspect: true };
    } else {
      resize = { scale: parseInt(scaleVal) || 100 };
    }

    const payload = {
      filePath: file.path,
      outputFormat: document.getElementById("ic-format").value,
      quality: 85,
      stripMeta: true,
      optimize: true,
      resize: resize,
      targetBytes: 0,
      suffix: getSuffix(card),
    };

    if (mode === "quality") {
      payload.quality = parseInt(card.el.querySelector(".quality-slider")?.value) || 85;
    } else {
      const targetEl = document.getElementById("ic-target");
      const toggleBtn = targetEl?.closest(".size-input-group")?.querySelector(".size-unit-toggle");
      payload.targetBytes = getTargetBytes(targetEl, toggleBtn);
    }

    return payload;
  },
  renderResult: (r) => renderResult(r, imageCard?.pendingFiles?.length === 1),
});

// Video Converter
const videoCard = new ToolCard({
  id: "tool-video-converter",
  acceptFilter: (f) =>
    (f.type.startsWith("video/") && !f.type.includes("gif")) ||
    /\.(mp4|mov|avi|mkv|webm)$/i.test(f.name),
  apiEndpoint: "/api/process-video",
  onFilesReady: (card) => {
    detectVideoResolution(card);
    scheduleVideoEstimate();
  },
  checkWarnings: (() => {
    let bound = false;
    return (card) => {
      if (!bound) {
        const targetEl = document.getElementById("vc-target");
        if (targetEl) targetEl.addEventListener("input", () => checkVideoWarnings(card));
        bound = true;
      }
      checkVideoWarnings(card);
    };
  })(),
  getPayload: (card, file) => {
    const mode = card.getCompressionMode();
    const { resWidth, resHeight, scale } = getVideoResolution();

    const payload = {
      filePath: file.path,
      format: document.getElementById("vc-format").value,
      codec: document.getElementById("vc-codec").value,
      audio: document.getElementById("vc-audio").value,
      trimStart: parseTimeInput(document.getElementById("vc-trim-start")?.value),
      trimEnd: parseTimeInput(document.getElementById("vc-trim-end")?.value),
      denoise: document.getElementById("vc-denoise").checked,
      scale: scale,
      resWidth: resWidth,
      resHeight: resHeight,
      suffix: getSuffix(card),
      targetBytes: 0,
      quality: 0,
    };

    if (mode === "quality") {
      payload.quality = parseInt(card.el.querySelector(".quality-slider")?.value) || 70;
    } else {
      const targetEl = document.getElementById("vc-target");
      const toggleBtn = targetEl?.closest(".size-input-group")?.querySelector(".size-unit-toggle");
      payload.targetBytes = getTargetBytes(targetEl, toggleBtn);
    }

    return payload;
  },
  renderResult: (r) => renderVideoResult(r),
});

// GIF Maker
const gifCard = new ToolCard({
  id: "tool-gif-maker",
  acceptFilter: (f) =>
    f.type.startsWith("video/") ||
    /\.(mp4|mov|avi|mkv|webm)$/i.test(f.name),
  apiEndpoint: "/api/process-gif",
  onFilesReady: () => {
    scheduleGifEstimate();
  },
  getPayload: (card, file) => {
    const mode = card.getCompressionMode();

    const payload = {
      filePath: file.path,
      fps: document.getElementById("gm-fps").value,
      width: getGifWidth(),
      trimStart: parseTimeInput(document.getElementById("gm-trim-start")?.value),
      trimEnd: parseTimeInput(document.getElementById("gm-trim-end")?.value),
      bounce: document.getElementById("gm-bounce")?.checked || false,
      suffix: getSuffix(card),
      targetBytes: 0,
      quality: 256,
    };

    if (mode === "quality") {
      payload.quality = parseInt(card.el.querySelector(".quality-slider")?.value) || 256;
    } else {
      const targetEl = document.getElementById("gm-target");
      const toggleBtn = targetEl?.closest(".size-input-group")?.querySelector(".size-unit-toggle");
      payload.targetBytes = getTargetBytes(targetEl, toggleBtn);
    }

    return payload;
  },
  renderResult: (r) => renderGifResult(r),
});

// SVG Optimizer
const svgCard = new ToolCard({
  id: "tool-svg-optimizer",
  acceptFilter: (f) =>
    f.type === "image/svg+xml" ||
    /\.svg$/i.test(f.name),
  apiEndpoint: "/api/process-svg",
  getPayload: (card, file) => {
    return {
      filePath: file.path,
      suffix: getSuffix(card),
    };
  },
  renderResult: (r) => renderResult(r, false),
});

// PDF Compressor
const pdfCard = new ToolCard({
  id: "tool-pdf-compressor",
  acceptFilter: (f) =>
    f.type === "application/pdf" ||
    /\.pdf$/i.test(f.name),
  apiEndpoint: "/api/process-pdf",
  onFilesReady: (card) => {
    schedulePdfEstimate();
  },
  getPayload: (card, file) => {
    return {
      filePath: file.path,
      quality: document.getElementById("pdf-quality").value,
      suffix: getSuffix(card),
    };
  },
  renderResult: (r) => renderResult(r, false),
});

// Audio & Video Transcriber
const transcribeCard = new ToolCard({
  id: "tool-video-transcriber",
  acceptFilter: (f) =>
    f.type.startsWith("video/") ||
    f.type.startsWith("audio/") ||
    /\.(mp4|mov|avi|mkv|webm|mp3|wav|m4a|flac|ogg)$/i.test(f.name),
  apiEndpoint: "/api/transcribe",
  getPayload: (card, file) => {
    return {
      filePath: file.path,
      model: document.getElementById("vt-model").value,
      language: document.getElementById("vt-language").value,
      outputFormat: document.getElementById("vt-format").value,
      suffix: getSuffix(card),
    };
  },
  renderResult: (r) => renderTranscriptResult(r),
});

// Bind copy-to-clipboard for transcript results (delegated)
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".copy-transcript-btn");
  if (!btn) return;
  const text = transcriptStore[btn.dataset.key] || "";
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
});

// Update suffix preview extension when format changes
document.getElementById("vt-format")?.addEventListener("change", (e) => {
  const extMap = { txt: ".txt", srt: ".srt", vtt: ".vtt" };
  const previews = document.querySelectorAll("#tool-video-transcriber .suffix-preview");
  if (previews.length >= 2) {
    previews[1].textContent = extMap[e.target.value] || ".txt";
  }
});

// --- Wire dynamic button labels ---

// Image button label triggers
document.getElementById("ic-format")?.addEventListener("change", () => {
  updateImageButtonLabel();
  scheduleEstimate();
  updateImageSmartSuffix();
  updateImageExtPreview();
});
document.getElementById("ic-scale")?.addEventListener("change", () => {
  updateImageButtonLabel();
  scheduleEstimate();
  updateImageSmartSuffix();
});
document.querySelector("#tool-image-converter .quality-slider")?.addEventListener("input", () => {
  updateImageButtonLabel();
  scheduleEstimate();
  updateImageSmartSuffix();
  updateFormatHint();
});
document.getElementById("ic-format")?.addEventListener("change", () => {
  updateFormatHint();
  scheduleEstimate();
});
document.getElementById("ic-target")?.addEventListener("input", updateImageButtonLabel);
document.getElementById("ic-custom-width")?.addEventListener("input", () => {
  scheduleEstimate();
  updateImageSmartSuffix();
});
document.getElementById("ic-custom-height")?.addEventListener("input", scheduleEstimate);

// Image mode toggle — update button + estimate
document.querySelectorAll("#tool-image-converter .mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    // Small delay to let the panel swap happen first
    setTimeout(() => {
      updateImageButtonLabel();
      scheduleEstimate();
      updateImageSmartSuffix();
    }, 10);
  });
});

// Video button label triggers
document.getElementById("vc-format")?.addEventListener("change", updateVideoButtonLabel);
document.getElementById("vc-resolution")?.addEventListener("change", updateVideoButtonLabel);
document.querySelector("#tool-video-converter .quality-slider")?.addEventListener("input", updateVideoButtonLabel);
document.getElementById("vc-target")?.addEventListener("input", updateVideoButtonLabel);
document.querySelectorAll("#tool-video-converter .mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    setTimeout(updateVideoButtonLabel, 10);
  });
});

// Video estimate triggers
document.querySelector("#tool-video-converter .quality-slider")?.addEventListener("input", scheduleVideoEstimate);
document.getElementById("vc-resolution")?.addEventListener("change", scheduleVideoEstimate);
document.getElementById("vc-codec")?.addEventListener("change", scheduleVideoEstimate);
document.querySelectorAll("#tool-video-converter .mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => setTimeout(scheduleVideoEstimate, 10));
});

// PDF estimate triggers
document.getElementById("pdf-quality")?.addEventListener("change", schedulePdfEstimate);

// GIF estimate triggers
document.getElementById("gm-fps")?.addEventListener("change", scheduleGifEstimate);
document.getElementById("gm-width-preset")?.addEventListener("change", scheduleGifEstimate);
document.querySelector("#tool-gif-maker .quality-slider")?.addEventListener("input", scheduleGifEstimate);
document.querySelectorAll("#tool-gif-maker .mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => setTimeout(scheduleGifEstimate, 10));
});

// Trigger estimate when files are added (extend onFilesReady)
const origImageOnFilesReady = imageCard.config.onFilesReady;
imageCard.config.onFilesReady = (card) => {
  origImageOnFilesReady(card);
  scheduleEstimate();
  updateImageButtonLabel();
  updateImageSmartSuffix();
  updateFormatHint();
  updateImageExtPreview();
};

// --- Dependency status banner ---

(async function checkStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    const t = data.tools;
    const missing = [];

    if (!t.ffmpeg) missing.push("FFmpeg (required for video/GIF)");

    const optimTools = [t.mozjpeg, t.oxipng, t.pngquant, t.jpegoptim, t.advpng, t.zopflipng];
    const optimInstalled = optimTools.filter(Boolean).length;
    if (optimInstalled === 0) missing.push("image optimizers (mozjpeg, oxipng, etc.)");

    if (!t.gifski) missing.push("gifski (higher quality GIFs)");
    if (!t.svgo) missing.push("svgo (SVG optimization)");

    if (missing.length === 0) return; // all good

    const isCore = !t.ffmpeg;

    const banner = document.createElement("div");
    banner.className = "status-banner";

    const content = document.createElement("div");
    content.className = "status-banner-content";

    const title = document.createElement("strong");
    title.textContent = isCore ? "Missing required tools" : "Optional tools not installed";
    content.appendChild(title);

    const desc = document.createElement("span");
    desc.textContent = missing.join(", ");
    content.appendChild(desc);

    const details = document.createElement("details");
    details.className = "status-install-help";
    const summary = document.createElement("summary");
    summary.textContent = "Install commands";
    details.appendChild(summary);
    const code = document.createElement("code");
    const cmds = [];
    if (isCore) cmds.push(data.install.core);
    if (optimInstalled === 0) cmds.push(data.install.optimization);
    if (!t.svgo) cmds.push(data.install.svg);
    code.textContent = cmds.join("\n");
    details.appendChild(code);
    content.appendChild(details);

    const dismiss = document.createElement("button");
    dismiss.className = "status-dismiss";
    dismiss.textContent = "\u00d7";
    dismiss.addEventListener("click", () => banner.remove());
    content.appendChild(dismiss);

    banner.appendChild(content);
    document.querySelector(".container").prepend(banner);
  } catch (_) {}
})();

// --- Version display ---
fetch("/api/version").then(r => r.json()).then(d => {
  document.getElementById("app-version").textContent = "v" + d.version;
}).catch(() => {});

// --- Check for updates button ---
document.getElementById("check-for-updates")?.addEventListener("click", () => {
  fetch("/api/check-updates", { method: "POST" })
    .then(r => r.json())
    .then(d => {
      if (!d.ok) window.open("https://github.com/adamscooch/filey/releases/latest", "_blank");
    })
    .catch(() => {});
});

// --- Update overlay (Electron only) ---
if (window.fileyUpdater) {
  const overlay = document.createElement("div");
  overlay.id = "update-overlay";
  overlay.className = "update-overlay hidden";

  const content = document.createElement("div");
  content.className = "update-overlay-content";

  const spinner = document.createElement("div");
  spinner.className = "update-spinner";

  const ring = document.createElement("div");
  ring.className = "update-spinner-ring";

  const pctEl = document.createElement("div");
  pctEl.className = "update-spinner-percent";
  pctEl.id = "update-overlay-pct";

  spinner.appendChild(ring);
  spinner.appendChild(pctEl);

  const textEl = document.createElement("div");
  textEl.className = "update-overlay-text";
  textEl.id = "update-overlay-text";

  const subEl = document.createElement("div");
  subEl.className = "update-overlay-subtext";
  subEl.id = "update-overlay-sub";

  content.appendChild(spinner);
  content.appendChild(textEl);
  content.appendChild(subEl);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  window.fileyUpdater.onUpdateStatus((data) => {
    const text = document.getElementById("update-overlay-text");
    const pct = document.getElementById("update-overlay-pct");
    const sub = document.getElementById("update-overlay-sub");
    if (!text) return;

    switch (data.status) {
      case "downloading":
        overlay.classList.remove("hidden");
        pct.textContent = (data.percent || 0) + "%";
        text.textContent = "Updating Filey";
        sub.textContent = "Downloading new version...";
        break;
      case "installing":
        overlay.classList.remove("hidden");
        pct.textContent = "";
        text.textContent = "Installing update";
        sub.textContent = "Almost there...";
        break;
      case "restarting":
        overlay.classList.remove("hidden");
        pct.textContent = "";
        text.textContent = "Restarting";
        sub.textContent = "";
        break;
      case "error":
        overlay.classList.add("hidden");
        break;
      default:
        overlay.classList.add("hidden");
        break;
    }
  });
}
