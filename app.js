(() => {
  "use strict";

  // ---------- 共用小工具 ----------
  let nextId = 1;
  const newId = () => nextId++;

  function fmtSize(bytes) {
    if (bytes == null) return "--";
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + " MB";
    return Math.round(bytes / 1024) + " KB";
  }
  function fmtDuration(sec) {
    if (sec == null || isNaN(sec)) return "讀取中...";
    sec = Math.round(sec);
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }
  function extOf(name) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(name || "");
    return m ? m[1].toLowerCase() : "dat";
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  document.getElementById("file-protocol-warning").hidden = location.protocol !== "file:";

  // ---------- 分頁切換 ----------
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
    });
  });

  // ---------- 放大檢視（圖片用） ----------
  const lightbox = document.getElementById("lightbox");
  const lightboxContent = document.getElementById("lightbox-content");
  function openLightboxImage(url) {
    lightboxContent.innerHTML = "";
    const img = document.createElement("img");
    img.src = url;
    lightboxContent.appendChild(img);
    lightbox.classList.add("show");
  }
  lightbox.addEventListener("click", () => {
    lightbox.classList.remove("show");
    lightboxContent.innerHTML = "";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      lightbox.classList.remove("show");
      lightboxContent.innerHTML = "";
    }
  });

  // ---------- 拖放上傳共用 ----------
  function wireDropzone(dropzoneEl, inputEl, onFiles) {
    dropzoneEl.addEventListener("click", (e) => {
      if (e.target !== inputEl) inputEl.click();
    });
    inputEl.addEventListener("change", () => {
      onFiles(Array.from(inputEl.files));
      inputEl.value = "";
    });
    dropzoneEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzoneEl.classList.add("drag-over");
    });
    dropzoneEl.addEventListener("dragleave", () => dropzoneEl.classList.remove("drag-over"));
    dropzoneEl.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzoneEl.classList.remove("drag-over");
      onFiles(Array.from(e.dataTransfer.files));
    });
  }

  // ---------- 拖曳排序共用（支援跨分類拖曳） ----------
  // 拖曳一律從卡片上的 .drag-handle 把手開始，避免跟圖片放大／影片播放的點擊互相干擾。
  // 監聽器掛在整個 section（而不是只有 grid），這樣分類是空的時候也能把項目拖進去。
  const dragState = { array: null, idx: null, sectionEl: null };

  function enableSectionDrop(sectionEl, arrayRef, onDrop) {
    sectionEl.addEventListener("dragstart", (e) => {
      const handle = e.target.closest(".drag-handle");
      if (!handle) {
        e.preventDefault();
        return;
      }
      const card = handle.closest(".card");
      dragState.array = arrayRef;
      dragState.idx = Number(card.dataset.idx);
      dragState.sectionEl = sectionEl;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "drag");
      card.classList.add("dragging");
    });
    sectionEl.addEventListener("dragend", (e) => {
      const card = e.target.closest(".card");
      if (card) card.classList.remove("dragging");
      document.querySelectorAll(".section.drop-target-active").forEach((el) => el.classList.remove("drop-target-active"));
      dragState.array = null;
      dragState.idx = null;
      dragState.sectionEl = null;
    });
    sectionEl.addEventListener("dragover", (e) => {
      if (dragState.array == null) return;
      e.preventDefault();
      sectionEl.classList.add("drop-target-active");
    });
    sectionEl.addEventListener("dragleave", (e) => {
      if (e.target === sectionEl) sectionEl.classList.remove("drop-target-active");
    });
    sectionEl.addEventListener("drop", (e) => {
      if (dragState.array == null) return;
      e.preventDefault();
      sectionEl.classList.remove("drop-target-active");
      const card = e.target.closest(".card");
      let destIdx = arrayRef.length;
      if (card && sectionEl.contains(card)) destIdx = Number(card.dataset.idx);
      const srcArray = dragState.array;
      const srcIdx = dragState.idx;
      if (srcArray === arrayRef && srcIdx === destIdx) {
        dragState.array = null;
        dragState.idx = null;
        dragState.sectionEl = null;
        return;
      }
      const [moved] = srcArray.splice(srcIdx, 1);
      arrayRef.splice(destIdx, 0, moved);
      const movedAcrossCategory = srcArray !== arrayRef;
      dragState.array = null;
      dragState.idx = null;
      dragState.sectionEl = null;
      onDrop(movedAcrossCategory);
    });
  }

  // ====================================================================
  // 圖片分頁
  // ====================================================================
  const imageItems = [];
  let imageProcessed = false;

  const imageGrid = document.getElementById("image-grid");
  const imageEmptyHint = document.getElementById("image-empty-hint");
  const imageProcessBtn = document.getElementById("image-process-btn");
  const imageDownloadBtn = document.getElementById("image-download-btn");
  const imageProgress = document.getElementById("image-progress");
  const imagePrefixInput = document.getElementById("image-prefix");
  const imageStartInput = document.getElementById("image-start");
  const imagePng2JpgToggle = document.getElementById("image-png2jpg");

  function renderImageGrid() {
    imageGrid.innerHTML = "";
    imageEmptyHint.hidden = imageItems.length > 0;
    imageItems.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.idx = String(idx);
      card.innerHTML = `
        <div class="drag-handle" draggable="true">⠿ 拖曳排序</div>
        <div class="thumb-wrap">
          <img class="thumb" src="${item.url}" draggable="false">
          <span class="order-badge">${idx + 1}</span>
          <button class="remove-btn" title="移除">✕</button>
        </div>
        <div class="meta">
          <span class="name">${escapeHtml(item.name)}</span>
          ${fmtSize(item.size)}
        </div>
        <div class="status-line ${item.statusClass || ""}">${item.statusText || ""}</div>
      `;
      card.querySelector(".thumb").addEventListener("click", () => openLightboxImage(item.url));
      card.querySelector(".remove-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        URL.revokeObjectURL(item.url);
        imageItems.splice(idx, 1);
        imageProcessed = false;
        updateImageActionState();
        renderImageGrid();
      });
      imageGrid.appendChild(card);
    });
  }

  function updateImageActionState() {
    imageProcessBtn.disabled = imageItems.length === 0;
    imageDownloadBtn.hidden = !(imageProcessed && imageItems.length > 0);
  }

  enableSectionDrop(document.getElementById("image-dropzone").closest(".section"), imageItems, () => renderImageGrid());

  wireDropzone(document.getElementById("image-dropzone"), document.getElementById("image-input"), (files) => {
    const accepted = files.filter((f) => f.type.startsWith("image/"));
    accepted.forEach((file) => {
      imageItems.push({
        id: newId(),
        file,
        name: file.name,
        size: file.size,
        url: URL.createObjectURL(file),
        outBlob: null,
        outExt: null,
        outSize: null,
        statusText: "",
        statusClass: "",
      });
    });
    imageProcessed = false;
    updateImageActionState();
    renderImageGrid();
  });

  const MAX_LONG_EDGE = 3000;

  async function compressImage(file, targetBytes, pngToJpg, maxLongEdge) {
    const bitmap = await createImageBitmap(file);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = maxLongEdge / longEdge;
    const newW = Math.round(bitmap.width * scale);
    const newH = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext("2d");
    const isPng = extOf(file.name) === "png" || file.type === "image/png";
    const mime = isPng && !pngToJpg ? "image/png" : "image/jpeg";
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // 等比例縮放畫到新尺寸的 canvas 上（不裁剪、不拉伸單邊）
    ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, newW, newH);
    if (bitmap.close) bitmap.close();
    const resized = scale !== 1;
    if (mime === "image/png") {
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      return { blob, mime, ok: blob.size <= targetBytes, resized, newW, newH };
    }
    let quality = 0.92;
    let blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    while (blob.size > targetBytes && quality > 0.3) {
      quality = Math.max(0.3, quality - 0.08);
      blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    }
    return { blob, mime, ok: blob.size <= targetBytes, resized, newW, newH };
  }

  async function processImageItem(item, pngToJpg) {
    const TARGET = 500 * 1024;
    // 先判斷尺寸是否超過長邊上限，沒超過且檔案已經夠小才能整個跳過（原始位元組直接沿用）
    let longEdge = null;
    try {
      const bitmap = await createImageBitmap(item.file);
      longEdge = Math.max(bitmap.width, bitmap.height);
      if (bitmap.close) bitmap.close();
    } catch (e) {
      // 讀不到尺寸就直接進入壓縮流程，讓 compressImage 自己處理錯誤
    }
    const needResize = longEdge != null && longEdge !== MAX_LONG_EDGE;
    if (!needResize && item.size <= TARGET) {
      item.outBlob = item.file;
      item.outExt = extOf(item.name);
      item.outSize = item.size;
      item.statusText = `未超過 500KB 且長邊已經是 ${MAX_LONG_EDGE}px，僅改名（${fmtSize(item.size)}）`;
      item.statusClass = "status-skip";
      return;
    }
    try {
      const result = await compressImage(item.file, TARGET, pngToJpg, MAX_LONG_EDGE);
      item.outBlob = result.blob;
      item.outExt = result.mime === "image/png" ? "png" : "jpg";
      item.outSize = result.blob.size;
      const resizeNote = result.resized ? `，已等比例調整為 ${result.newW}×${result.newH}` : "";
      if (result.ok) {
        item.statusText = `壓縮完成：${fmtSize(item.size)} → ${fmtSize(result.blob.size)}${resizeNote}`;
        item.statusClass = "status-ok";
      } else {
        item.statusText = `已盡量壓縮，仍為 ${fmtSize(result.blob.size)}${resizeNote}（${
          result.mime === "image/png" ? "建議勾選上方「轉JPG」" : "畫質已達下限"
        }）`;
        item.statusClass = "status-warn";
      }
    } catch (e) {
      item.outBlob = item.file;
      item.outExt = extOf(item.name);
      item.outSize = item.size;
      item.statusText = "處理失敗，已改為僅改名：" + e.message;
      item.statusClass = "status-warn";
    }
  }

  imageProcessBtn.addEventListener("click", async () => {
    imageProcessBtn.disabled = true;
    const pngToJpg = imagePng2JpgToggle.checked;
    for (let i = 0; i < imageItems.length; i++) {
      imageProgress.textContent = `處理中 ${i + 1}/${imageItems.length} ...`;
      await processImageItem(imageItems[i], pngToJpg);
      renderImageGrid();
    }
    imageProgress.textContent = `完成，共處理 ${imageItems.length} 張圖片。`;
    imageProcessed = true;
    updateImageActionState();
  });

  imageDownloadBtn.addEventListener("click", async () => {
    const prefix = imagePrefixInput.value || "";
    const start = parseInt(imageStartInput.value, 10) || 0;
    const digits = Math.max(3, String(start + imageItems.length - 1).length);
    const zip = new JSZip();
    imageItems.forEach((item, idx) => {
      const num = String(start + idx).padStart(digits, "0");
      const ext = item.outExt || extOf(item.name);
      zip.file(`${prefix}${num}.${ext}`, item.outBlob || item.file);
    });
    imageProgress.textContent = "打包 ZIP 中...";
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `${prefix || "圖片"}.zip`);
    imageProgress.textContent = "已下載 ZIP。";
  });

  updateImageActionState();

  // ====================================================================
  // 影片分頁
  // ====================================================================
  const VIDEO_TARGETS = {
    loop: 3 * 1024 * 1024,
    project: 30 * 1024 * 1024,
    intro: 30 * 1024 * 1024,
  };
  const videoCategories = { loop: [], project: [], intro: [] };
  let videoProcessed = false;

  const videoProcessBtn = document.getElementById("video-process-btn");
  const videoDownloadBtn = document.getElementById("video-download-btn");
  const videoProgress = document.getElementById("video-progress");

  const videoSectionEls = Array.from(document.querySelectorAll('#panel-video .section[data-category]'));
  const videoCategoryUI = {};
  videoSectionEls.forEach((sectionEl) => {
    const cat = sectionEl.dataset.category;
    videoCategoryUI[cat] = {
      sectionEl,
      prefixInput: sectionEl.querySelector(".v-prefix"),
      startInput: sectionEl.querySelector(".v-start"),
      dropzone: sectionEl.querySelector(".v-dropzone"),
      input: sectionEl.querySelector(".v-input"),
      grid: sectionEl.querySelector(".v-grid"),
      emptyHint: sectionEl.querySelector(".v-empty-hint"),
    };
  });

  function totalVideoCount() {
    return videoCategories.loop.length + videoCategories.project.length + videoCategories.intro.length;
  }

  function updateVideoActionState() {
    videoProcessBtn.disabled = totalVideoCount() === 0;
    videoDownloadBtn.hidden = !(videoProcessed && totalVideoCount() > 0);
  }

  function renderVideoGrid(cat) {
    const ui = videoCategoryUI[cat];
    const items = videoCategories[cat];
    ui.grid.innerHTML = "";
    ui.emptyHint.hidden = items.length > 0;
    items.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.idx = String(idx);
      card.innerHTML = `
        <div class="drag-handle" draggable="true">⠿ 拖曳排序（可跨分類）</div>
        <div class="thumb-wrap">
          <video class="thumb" src="${item.url}" preload="metadata" muted controls draggable="false"></video>
          <span class="order-badge">${idx + 1}</span>
          <span class="dur-badge">${fmtDuration(item.duration)}</span>
          <button class="remove-btn" title="移除">✕</button>
        </div>
        <div class="meta">
          <span class="name">${escapeHtml(item.name)}</span>
          ${fmtSize(item.size)}
        </div>
        <div class="status-line ${item.statusClass || ""}">${item.statusText || ""}</div>
      `;
      card.querySelector(".remove-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        URL.revokeObjectURL(item.url);
        items.splice(idx, 1);
        videoProcessed = false;
        updateVideoActionState();
        renderVideoGrid(cat);
      });
      ui.grid.appendChild(card);
    });
  }

  function renderAllVideoGrids() {
    renderVideoGrid("loop");
    renderVideoGrid("project");
    renderVideoGrid("intro");
  }

  Object.keys(videoCategoryUI).forEach((cat) => {
    const ui = videoCategoryUI[cat];
    enableSectionDrop(ui.sectionEl, videoCategories[cat], (movedAcrossCategory) => {
      renderAllVideoGrids();
      if (movedAcrossCategory) {
        videoProcessed = false;
      }
      updateVideoActionState();
    });
    wireDropzone(ui.dropzone, ui.input, (files) => {
      const accepted = files.filter(
        (f) => f.type.startsWith("video/") || /\.(mp4|m4v|mov|webm)$/i.test(f.name)
      );
      accepted.forEach((file) => {
        const item = {
          id: newId(),
          file,
          name: file.name,
          size: file.size,
          url: URL.createObjectURL(file),
          duration: null,
          outBlob: null,
          outExt: null,
          outSize: null,
          statusText: "",
          statusClass: "",
        };
        videoCategories[cat].push(item);
        // 讀取影片長度
        const probe = document.createElement("video");
        probe.preload = "metadata";
        probe.src = item.url;
        probe.onloadedmetadata = () => {
          item.duration = probe.duration;
          renderVideoGrid(cat);
        };
      });
      videoProcessed = false;
      updateVideoActionState();
      renderVideoGrid(cat);
    });
  });

  let ffmpegPromise = null;
  function getFFmpeg(onLog) {
    if (ffmpegPromise) return ffmpegPromise;
    ffmpegPromise = (async () => {
      const { FFmpeg } = FFmpegWASM;
      const ffmpeg = new FFmpeg();
      if (onLog) ffmpeg.on("log", ({ message }) => onLog(message));
      const base = new URL("vendor/", location.href).href;
      await ffmpeg.load({
        classWorkerURL: base + "ffmpeg-worker.iife.js",
        coreURL: base + "ffmpeg-core.js",
        wasmURL: base + "ffmpeg-core.wasm",
      });
      return ffmpeg;
    })();
    return ffmpegPromise;
  }

  async function compressVideoItem(item, targetBytes) {
    if (item.size <= targetBytes) {
      item.outBlob = item.file;
      item.outExt = extOf(item.name);
      item.outSize = item.size;
      item.statusText = `未超過目標，僅改名（${fmtSize(item.size)}）`;
      item.statusClass = "status-skip";
      return;
    }
    if (!item.duration || item.duration <= 0) {
      item.outBlob = item.file;
      item.outExt = extOf(item.name);
      item.outSize = item.size;
      item.statusText = "無法讀取影片長度，已略過壓縮，僅改名";
      item.statusClass = "status-warn";
      return;
    }
    const ffmpeg = await getFFmpeg((msg) => {
      videoProgress.textContent = `處理中：${item.name}\n${msg}`;
    });
    const inName = `in_${item.id}.${extOf(item.name) || "mp4"}`;
    const outName = `out_${item.id}.mp4`;
    const buf = new Uint8Array(await item.file.arrayBuffer());
    await ffmpeg.writeFile(inName, buf);
    const audioKbps = 64;
    let videoKbps = Math.floor((targetBytes * 8 * 0.9) / 1024 / item.duration - audioKbps);
    if (videoKbps < 150) videoKbps = 150;
    try {
      await ffmpeg.exec([
        "-i", inName,
        "-c:v", "libx264", "-preset", "veryfast",
        "-b:v", videoKbps + "k",
        "-maxrate", Math.floor(videoKbps * 1.3) + "k",
        "-bufsize", Math.floor(videoKbps * 2) + "k",
        "-c:a", "aac", "-b:a", audioKbps + "k",
        "-movflags", "+faststart",
        outName,
      ]);
      const data = await ffmpeg.readFile(outName);
      const blob = new Blob([data], { type: "video/mp4" });
      item.outBlob = blob;
      item.outExt = "mp4";
      item.outSize = blob.size;
      if (blob.size <= targetBytes) {
        item.statusText = `壓縮完成：${fmtSize(item.size)} → ${fmtSize(blob.size)}（已轉存為 MP4）`;
        item.statusClass = "status-ok";
      } else {
        item.statusText = `已壓縮但仍超過目標（${fmtSize(blob.size)}），建議改用其他工具再處理`;
        item.statusClass = "status-warn";
      }
    } catch (e) {
      item.outBlob = item.file;
      item.outExt = extOf(item.name);
      item.outSize = item.size;
      item.statusText = "壓縮失敗，已改為僅改名：" + e.message;
      item.statusClass = "status-warn";
    } finally {
      try { await ffmpeg.deleteFile(inName); } catch (e) {}
      try { await ffmpeg.deleteFile(outName); } catch (e) {}
    }
  }

  videoProcessBtn.addEventListener("click", async () => {
    if (location.protocol === "file:") {
      videoProgress.textContent =
        "⚠️ 影片壓縮需要透過「啟動」腳本開啟本工具才能運作，無法直接雙擊 HTML 檔使用，請改用「啟動（Mac）.command」或「啟動（Windows）.bat」。";
      return;
    }
    videoProcessBtn.disabled = true;
    const order = ["loop", "project", "intro"];
    const total = totalVideoCount();
    let done = 0;
    for (const cat of order) {
      for (const item of videoCategories[cat]) {
        done++;
        videoProgress.textContent = `處理中 ${done}/${total}：${item.name}`;
        await compressVideoItem(item, VIDEO_TARGETS[cat]);
        renderVideoGrid(cat);
      }
    }
    videoProgress.textContent = `完成，共處理 ${total} 支影片。`;
    videoProcessed = true;
    updateVideoActionState();
  });

  videoDownloadBtn.addEventListener("click", async () => {
    const zip = new JSZip();
    ["loop", "project", "intro"].forEach((cat) => {
      const ui = videoCategoryUI[cat];
      const items = videoCategories[cat];
      const prefix = ui.prefixInput.value || "";
      const start = parseInt(ui.startInput.value, 10) || 0;
      const digits = Math.max(3, String(start + items.length - 1).length);
      items.forEach((item, idx) => {
        const num = String(start + idx).padStart(digits, "0");
        const ext = item.outExt || extOf(item.name);
        zip.file(`${prefix}${num}.${ext}`, item.outBlob || item.file);
      });
    });
    videoProgress.textContent = "打包 ZIP 中...";
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, "影片.zip");
    videoProgress.textContent = "已下載 ZIP。";
  });

  updateVideoActionState();
})();
