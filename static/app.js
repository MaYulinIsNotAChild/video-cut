// ── 全局状态 ──────────────────────────────────────────────────────────────────

const edit = {
  files: [], activeId: null, platform: "抖音", editPlan: null,
  hflip: false, vflip: false, rotate: 0, crop: "",
  bgmFileId: null,
};

const photo = {
  photos: [], bgmFileId: null, platform: "抖音", suggestions: null,
};

const $ = (id) => document.getElementById(id);

// ── API Key ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "openai_api_key";
$("apiKeyInput").value = localStorage.getItem(STORAGE_KEY) || "";
_updateKeyStatus();

$("apiKeyInput").addEventListener("input", () => {
  localStorage.setItem(STORAGE_KEY, $("apiKeyInput").value.trim());
  _updateKeyStatus();
});

$("verifyKeyBtn").addEventListener("click", async () => {
  const key = getApiKey();
  if (!key) { alert("请先填入 API Key"); return; }
  $("verifyKeyBtn").textContent = "验证中...";
  $("verifyKeyBtn").disabled = true;
  try {
    await post("/api/test-key", { api_key: key });
    $("apiKeyStatus").textContent = "✓ 有效";
    $("apiKeyStatus").className = "apikey-status ok";
  } catch (err) {
    $("apiKeyStatus").textContent = "✗ 无效";
    $("apiKeyStatus").className = "apikey-status err";
    alert(err.message);
  } finally {
    $("verifyKeyBtn").textContent = "验证";
    $("verifyKeyBtn").disabled = false;
  }
});

function getApiKey() { return $("apiKeyInput").value.trim(); }
function _updateKeyStatus() {
  const key = $("apiKeyInput").value.trim();
  const el = $("apiKeyStatus");
  if (!key) { el.textContent = ""; el.className = "apikey-status"; }
  else if (key.startsWith("sk-")) { el.textContent = "✓"; el.className = "apikey-status ok"; }
  else { el.textContent = "格式有误"; el.className = "apikey-status err"; }
}

// ── Tab ───────────────────────────────────────────────────────────────────────

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const isEdit = btn.dataset.tab === "edit";
    $("workspaceEdit").classList.toggle("hidden", !isEdit);
    $("workspacePhoto").classList.toggle("hidden", isEdit);
  });
});

// ── 手风琴 ────────────────────────────────────────────────────────────────────

document.querySelectorAll(".acc-header").forEach((hdr) => {
  hdr.addEventListener("click", () => {
    const body = $("acc-" + hdr.dataset.acc);
    const icon = hdr.querySelector(".acc-icon");
    const open = !body.classList.contains("hidden");
    body.classList.toggle("hidden", open);
    icon.textContent = open ? "▸" : "▾";
  });
});

// ── 色彩预设 ──────────────────────────────────────────────────────────────────

const PRESET_VALUES = {
  none:    { b: 0,   c: 100, s: 100 },
  warm:    { b: 5,   c: 110, s: 140 },
  cool:    { b: 2,   c: 100, s: 120 },
  vintage: { b: -2,  c: 120, s: 60  },
  bw:      { b: 0,   c: 120, s: 0   },
  vivid:   { b: 2,   c: 120, s: 200 },
};

document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const vals = PRESET_VALUES[btn.dataset.preset];
    if (vals) {
      _setSlider("optBrightness", "brightnessVal", vals.b);
      _setSlider("optContrast",   "contrastVal",   vals.c);
      _setSlider("optSaturation", "saturationVal", vals.s);
    }
  });
});

["optBrightness", "optContrast", "optSaturation"].forEach((id) => {
  $(id).addEventListener("input", () => {
    _updateSliderDisplay(id);
    // 手动调节时取消预设高亮
    document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
    document.querySelector('.preset-btn[data-preset="none"]').classList.add("active");
  });
});

$("optVolume").addEventListener("input",    () => _updateSliderDisplay("optVolume"));
$("optBgmVolume").addEventListener("input", () => _updateSliderDisplay("optBgmVolume"));

function _setSlider(id, valId, intVal) {
  $(id).value = intVal;
  _updateSliderDisplay(id);
}

function _updateSliderDisplay(id) {
  const v = parseInt($(id).value);
  const map = {
    optBrightness: ["brightnessVal", (v) => (v >= 0 ? "+" : "") + v],
    optContrast:   ["contrastVal",   (v) => (v / 100).toFixed(1)],
    optSaturation: ["saturationVal", (v) => (v / 100).toFixed(1)],
    optVolume:     ["volumeVal",     (v) => (v / 100).toFixed(1) + "×"],
    optBgmVolume:  ["bgmVolumeVal",  (v) => (v / 100).toFixed(1) + "×"],
  };
  const [valId, fmt] = map[id] || [];
  if (valId) $(valId).textContent = fmt(v);
}

function resetSlider(id, valId, def) {
  $(id).value = def;
  _updateSliderDisplay(id);
}

// ── 画面按钮 ──────────────────────────────────────────────────────────────────

function toggleBtn(el, key) {
  edit[key] = !edit[key];
  el.classList.toggle("active", edit[key]);
}

function setRotate(deg) {
  edit.rotate = edit.rotate === deg ? 0 : deg;
  ["btnRotCW", "btnRotCCW", "btnRot180"].forEach((id) => $(id)?.classList.remove("active"));
  const map = { 90: "btnRotCW", 270: "btnRotCCW", 180: "btnRot180" };
  if (edit.rotate && map[edit.rotate]) $(map[edit.rotate]).classList.add("active");
}

function setCrop(ratio) {
  edit.crop = ratio;
  ["btnCrop916","btnCrop11","btnCrop169","btnCropNone"].forEach((id) => $(id)?.classList.remove("active"));
  const map = { "9:16": "btnCrop916", "1:1": "btnCrop11", "16:9": "btnCrop169", "": "btnCropNone" };
  if (map[ratio]) $(map[ratio]).classList.add("active");
}

// ── 编辑 BGM 上传 ─────────────────────────────────────────────────────────────

$("editBgmUpload").addEventListener("click", () => $("editBgmInput").click());
$("editBgmInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  showLoading("上传背景音乐...", "loading", "loadingText");
  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();
    edit.bgmFileId = result.file_id;
    $("editBgmStatus").textContent = `✓ ${file.name}`;
    $("editBgmUpload").classList.add("has-file");
    $("bgmVolRow").style.display = "flex";
  } catch (err) { alert("BGM 上传失败：" + err.message); }
  finally { hideLoading("loading"); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 剪辑 Tab
// ══════════════════════════════════════════════════════════════════════════════

const uploadArea = $("uploadArea");
uploadArea.addEventListener("dragover", (e) => { e.preventDefault(); uploadArea.classList.add("drag-over"); });
uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("drag-over"));
uploadArea.addEventListener("drop", (e) => { e.preventDefault(); uploadArea.classList.remove("drag-over"); [...e.dataTransfer.files].forEach(uploadMediaFile); });
uploadArea.addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", (e) => [...e.target.files].forEach(uploadMediaFile));

document.querySelectorAll(".platform-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".platform-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    edit.platform = btn.dataset.platform;
  });
});

$("analyzeBtn").addEventListener("click", async () => {
  if (!edit.activeId) return;
  if (!getApiKey()) { alert("请先在右上角填入 OpenAI API Key"); return; }
  showLoading("AI 正在分析当前视频...", "loading", "loadingText");
  try {
    const plan = await post("/api/suggest", {
      file_id: edit.activeId,
      description: $("descriptionInput").value,
      platform: edit.platform,
      api_key: getApiKey(),
    });
    edit.editPlan = plan;
    renderPlan(plan);
    $("suggestionsPanel").classList.remove("hidden");
    $("suggestionsPanel").scrollIntoView({ behavior: "smooth" });
  } catch (err) { alert("AI 分析失败：" + err.message); }
  finally { hideLoading("loading"); }
});

$("analyzeAllBtn").addEventListener("click", async () => {
  if (edit.files.length < 2) return;
  if (!getApiKey()) { alert("请先在右上角填入 OpenAI API Key"); return; }
  showLoading(
    `正在抽帧分析 ${edit.files.length} 个视频（每5秒抽一帧，压缩480p）...`,
    "loading", "loadingText"
  );
  try {
    const result = await post("/api/suggest-multi", {
      file_ids: edit.files.map((f) => f.file_id),
      description: $("descriptionInput").value,
      platform: edit.platform,
      api_key: getApiKey(),
    });
    renderMultiPlan(result);
    $("multiPanel").classList.remove("hidden");
    $("multiPanel").scrollIntoView({ behavior: "smooth" });
  } catch (err) { alert("多视频分析失败：" + err.message); }
  finally { hideLoading("loading"); }
});

$("applyBtn").addEventListener("click", async () => {
  if (!edit.editPlan) return;
  showLoading("正在剪辑，请稍候...", "loading", "loadingText");
  try {
    const result = await post("/api/edit", {
      file_id: edit.activeId,
      segments_to_keep: edit.editPlan.segments_to_keep,
      platform: edit.platform,
      options: _buildEditOptions(),
    });
    $("downloadLink").href = result.download_url;
    $("downloadLink").setAttribute("download", result.filename);
    $("downloadPanel").classList.remove("hidden");
    $("downloadPanel").scrollIntoView({ behavior: "smooth" });
  } catch (err) { alert("剪辑失败：" + err.message); }
  finally { hideLoading("loading"); }
});

$("clearMediaBtn").addEventListener("click", () => {
  edit.files = []; edit.activeId = null; edit.editPlan = null;
  renderMediaList();
  ["mediaPreview","analysisPanel","suggestionsPanel","downloadPanel"].forEach((id) => $(id).classList.add("hidden"));
  $("analyzeBtn").disabled = true;
  $("mediaList").classList.add("hidden");
  uploadArea.classList.remove("hidden");
});

function _buildEditOptions() {
  const preset = document.querySelector(".preset-btn.active")?.dataset.preset || "none";
  return {
    remove_audio: $("optRemoveAudio").checked,
    transition:   $("optTransition").value,
    speed:        parseFloat($("optSpeed").value),
    brightness:   parseInt($("optBrightness").value) / 100,
    contrast:     parseInt($("optContrast").value) / 100,
    saturation:   parseInt($("optSaturation").value) / 100,
    color_preset: preset,
    hflip:        edit.hflip,
    vflip:        edit.vflip,
    rotate:       edit.rotate,
    crop_ratio:   edit.crop || null,
    volume:       parseInt($("optVolume").value) / 100,
    bgm_file_id:  edit.bgmFileId || null,
    bgm_volume:   parseInt($("optBgmVolume").value) / 100,
    quality:      $("optQuality").value,
  };
}

async function uploadMediaFile(file) {
  showLoading(`上传 ${file.name}...`, "loading", "loadingText");
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();
    result.name = file.name;
    edit.files.push(result);
    renderMediaList();
    selectMediaFile(result.file_id);
  } catch (err) { alert(`${file.name} 上传失败：` + err.message); }
  finally { hideLoading("loading"); }
}

function renderMediaList() {
  const listEl = $("mediaList");
  if (!edit.files.length) { listEl.classList.add("hidden"); uploadArea.classList.remove("hidden"); return; }
  uploadArea.classList.add("hidden");
  listEl.classList.remove("hidden");
  $("mediaCount").textContent = `${edit.files.length} 个文件`;
  $("mediaItems").innerHTML = edit.files.map((f) => `
    <div class="media-item ${f.file_id === edit.activeId ? "active" : ""}" onclick="selectMediaFile('${f.file_id}')">
      <span class="media-item-icon">${f.media_type === "video" ? "🎬" : "🎵"}</span>
      <div class="media-item-info">
        <div class="media-item-name" title="${f.name}">${f.name}</div>
        <div class="media-item-meta">${f.info.duration}s${f.info.width ? ` · ${f.info.width}×${f.info.height}` : ""}</div>
      </div>
      <button class="media-item-del" onclick="removeMediaFile('${f.file_id}',event)">×</button>
    </div>`).join("");
  // 有 2 个及以上视频时显示"分析全部"按钮
  const videoFiles = edit.files.filter((f) => f.media_type === "video");
  $("analyzeAllBtn").classList.toggle("hidden", videoFiles.length < 2);
}

function removeMediaFile(fileId, e) {
  e.stopPropagation();
  edit.files = edit.files.filter((f) => f.file_id !== fileId);
  if (edit.activeId === fileId) {
    edit.activeId = null;
    ["mediaPreview","analysisPanel","suggestionsPanel"].forEach((id) => $(id).classList.add("hidden"));
    $("analyzeBtn").disabled = true;
    if (edit.files.length) selectMediaFile(edit.files[0].file_id);
  }
  renderMediaList();
}

async function selectMediaFile(fileId) {
  edit.activeId = fileId;
  edit.editPlan = null;
  $("suggestionsPanel").classList.add("hidden");
  $("downloadPanel").classList.add("hidden");
  renderMediaList();
  const f = edit.files.find((x) => x.file_id === fileId);
  if (!f) return;
  const video = $("videoPlayer"), audio = $("audioPlayer");
  if (f.media_type === "video") {
    video.src = f.media_url; video.classList.remove("hidden"); audio.classList.add("hidden");
  } else {
    audio.src = f.media_url; audio.classList.remove("hidden"); video.classList.add("hidden");
  }
  $("mediaPreview").classList.remove("hidden");
  renderMediaInfo(f.info, f.media_type);
  showLoading("检测静音片段...", "loading", "loadingText");
  try {
    const result = await fetch(`/api/analyze/${fileId}`, { method: "POST" }).then((r) => r.json());
    renderSilences(result.silences);
    $("analysisPanel").classList.remove("hidden");
  } finally { hideLoading("loading"); }
  $("analyzeBtn").disabled = false;
}

function renderMediaInfo(info, type) {
  const tags = [`<div class="info-tag">时长：<span>${info.duration}s</span></div>`];
  if (type === "video") {
    tags.push(`<div class="info-tag">分辨率：<span>${info.width ?? "?"}×${info.height ?? "?"}</span></div>`);
    tags.push(`<div class="info-tag">帧率：<span>${info.fps ?? "?"} fps</span></div>`);
  }
  tags.push(`<div class="info-tag">音频：<span>${info.has_audio ? "有" : "无"}</span></div>`);
  $("mediaInfo").innerHTML = tags.join("");
}

function renderSilences(silences) {
  const valid = silences.filter((s) => s.end != null);
  $("silenceList").innerHTML = valid.length
    ? valid.map((s) => `<div class="silence-item"><span>${s.start.toFixed(1)}s ~ ${s.end.toFixed(1)}s</span><span class="silence-badge">${s.duration?.toFixed(1)}s</span></div>`).join("")
    : '<div class="silence-item">未检测到明显静音片段</div>';
}

function renderPlan(plan) {
  $("planNotes").textContent = plan.notes ?? "";
  $("suggestionsList").innerHTML = (plan.suggestions ?? []).map((s) => `<div class="suggestion-item">${s}</div>`).join("");
  _refreshPlanStats();
  _refreshSegmentList();
  renderTimeline(plan);
}

function _refreshPlanStats() {
  const segs = edit.editPlan?.segments_to_keep ?? [];
  const total = segs.reduce((s, seg) => s + (seg.end - seg.start), 0);
  $("planStats").innerHTML = [
    `<div class="stat-badge">预计时长：${total.toFixed(1)}s</div>`,
    `<div class="stat-badge">保留片段：${segs.length} 段</div>`,
  ].join("");
}

function _refreshSegmentList() {
  const segs = edit.editPlan?.segments_to_keep ?? [];
  $("segmentsList").innerHTML = segs.length
    ? segs.map((seg, i) => `
        <div class="segment-item">
          <span>片段 ${i + 1}：${seg.start.toFixed(1)}s → ${seg.end.toFixed(1)}s</span>
          <span class="segment-dur">${(seg.end - seg.start).toFixed(1)}s</span>
          <button class="seg-del-btn" onclick="deleteSegment(${i})" title="删除该片段">×</button>
        </div>`).join("")
    : '<div class="silence-item" style="color:var(--muted)">（无保留片段）</div>';
}

function deleteSegment(i) {
  if (!edit.editPlan) return;
  edit.editPlan.segments_to_keep.splice(i, 1);
  _renderTlSegments(edit.editPlan.segments_to_keep, getActiveDuration());
  _refreshSegmentList();
  _refreshPlanStats();
}

// ── 时间线 ────────────────────────────────────────────────────────────────────

let _tlDrag = null;

function getActiveDuration() {
  const f = edit.files.find((x) => x.file_id === edit.activeId);
  return f?.info?.duration || 60;
}

function renderTimeline(plan) {
  const duration = getActiveDuration();
  $("tlTotalTime").textContent = duration.toFixed(1) + "s";
  _renderTlSegments(plan.segments_to_keep || [], duration);
}

function _renderTlSegments(segs, duration) {
  const track = $("timelineTrack");
  track.innerHTML = "";
  segs.forEach((seg, i) => {
    const pct = (t) => (Math.max(0, Math.min(t / duration, 1)) * 100).toFixed(3) + "%";
    const div = document.createElement("div");
    div.className = "tl-segment";
    div.style.left = pct(seg.start);
    div.style.width = pct(seg.end - seg.start);

    const lh = document.createElement("div");
    lh.className = "tl-handle tl-handle-l";
    lh.title = "拖动调整起始时间";
    lh.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); _tlDrag = { i, side: "start" }; });

    const rh = document.createElement("div");
    rh.className = "tl-handle tl-handle-r";
    rh.title = "拖动调整结束时间";
    rh.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); _tlDrag = { i, side: "end" }; });

    const label = document.createElement("span");
    label.className = "tl-seg-label";
    label.textContent = (seg.end - seg.start).toFixed(1) + "s";

    const del = document.createElement("button");
    del.className = "tl-seg-del";
    del.title = "删除片段";
    del.textContent = "×";
    del.addEventListener("mousedown", (e) => e.stopPropagation());
    del.addEventListener("click", () => deleteSegment(i));

    div.appendChild(lh);
    div.appendChild(label);
    div.appendChild(rh);
    div.appendChild(del);
    track.appendChild(div);
  });
}

document.addEventListener("mousemove", (e) => {
  if (!_tlDrag || !edit.editPlan) return;
  const track = $("timelineTrack");
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const duration = getActiveDuration();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  const t = Math.round(x / rect.width * duration * 10) / 10;
  const seg = edit.editPlan.segments_to_keep[_tlDrag.i];
  if (!seg) return;
  const MIN = 0.3;
  if (_tlDrag.side === "start") {
    seg.start = Math.max(0, Math.min(t, seg.end - MIN));
  } else {
    seg.end = Math.max(seg.start + MIN, Math.min(t, duration));
  }
  _renderTlSegments(edit.editPlan.segments_to_keep, duration);
  _refreshSegmentList();
  _refreshPlanStats();
});

document.addEventListener("mouseup", () => { _tlDrag = null; });

// ══════════════════════════════════════════════════════════════════════════════
// 照片 Tab
// ══════════════════════════════════════════════════════════════════════════════

const photoUploadArea = $("photoUploadArea");
photoUploadArea.addEventListener("dragover", (e) => { e.preventDefault(); photoUploadArea.classList.add("drag-over"); });
photoUploadArea.addEventListener("dragleave", () => photoUploadArea.classList.remove("drag-over"));
photoUploadArea.addEventListener("drop", (e) => { e.preventDefault(); photoUploadArea.classList.remove("drag-over"); [...e.dataTransfer.files].forEach(uploadPhotoFile); });
photoUploadArea.addEventListener("click", () => $("photoFileInput").click());
$("photoFileInput").addEventListener("change", (e) => [...e.target.files].forEach(uploadPhotoFile));

$("bgmUploadArea").addEventListener("click", () => $("bgmFileInput").click());
$("bgmFileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0]; if (!file) return;
  showLoading("上传背景音乐...", "photoLoading", "photoLoadingText");
  try {
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();
    photo.bgmFileId = result.file_id;
    $("bgmStatus").textContent = `✓ ${file.name}`;
    $("bgmUploadArea").classList.add("has-file");
  } catch (err) { alert("BGM 上传失败：" + err.message); }
  finally { hideLoading("photoLoading"); }
});

document.querySelectorAll(".platform-btn-p").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".platform-btn-p").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active"); photo.platform = btn.dataset.platform;
  });
});

$("clearPhotosBtn").addEventListener("click", () => {
  photo.photos = []; photo.bgmFileId = null;
  $("photoGrid").innerHTML = "";
  $("photoGridHeader").classList.add("hidden");
  $("photoSuggestions").classList.add("hidden");
  $("photoDownloadPanel").classList.add("hidden");
  $("renderSlideshowBtn").disabled = true;
  $("photoSuggestBtn").disabled = true;
  $("bgmStatus").textContent = "点击选择音频文件";
  $("bgmUploadArea").classList.remove("has-file");
});

$("photoSuggestBtn").addEventListener("click", async () => {
  if (!getApiKey()) { alert("请先在右上角填入 OpenAI API Key"); return; }
  showLoading("AI 分析中...", "photoLoading", "photoLoadingText");
  try {
    const plan = await post("/api/photo-suggest", {
      photo_count: photo.photos.length,
      description: $("photoDescInput").value,
      platform: photo.platform,
      api_key: getApiKey(),
    });
    if (plan.duration_per_photo) $("optPhotoDuration").value = plan.duration_per_photo;
    if (plan.transition) $("optPhotoTransition").value = plan.transition;
    if (plan.effect) $("optKenBurns").checked = plan.effect === "kenburns";
    $("photoNotes").textContent = plan.notes ?? "";
    $("photoSuggestionsList").innerHTML = (plan.suggestions ?? []).map((s) => `<div class="suggestion-item">${s}</div>`).join("");
    $("photoSuggestions").classList.remove("hidden");
  } catch (err) { alert("AI 推荐失败：" + err.message); }
  finally { hideLoading("photoLoading"); }
});

$("renderSlideshowBtn").addEventListener("click", async () => {
  if (!photo.photos.length) return;
  showLoading(`正在生成 ${photo.photos.length} 张照片的视频...`, "photoLoading", "photoLoadingText");
  try {
    const result = await post("/api/render-slideshow", {
      photo_ids: photo.photos.map((p) => p.photo_id),
      bgm_file_id: photo.bgmFileId,
      options: {
        duration_per_photo: parseFloat($("optPhotoDuration").value),
        aspect_ratio: $("optAspectRatio").value,
        transition: $("optPhotoTransition").value,
        ken_burns: $("optKenBurns").checked,
      },
    });
    $("photoDownloadLink").href = result.download_url;
    $("photoDownloadLink").setAttribute("download", result.filename);
    $("photoDownloadPanel").classList.remove("hidden");
    $("photoDownloadPanel").scrollIntoView({ behavior: "smooth" });
  } catch (err) { alert("生成失败：" + err.message); }
  finally { hideLoading("photoLoading"); }
});

async function uploadPhotoFile(file) {
  if (!file.type.startsWith("image/")) return;
  showLoading(`上传 ${file.name}...`, "photoLoading", "photoLoadingText");
  const fd = new FormData(); fd.append("file", file);
  try {
    const res = await fetch("/api/upload-photo", { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json(); result.name = file.name;
    photo.photos.push(result);
    renderPhotoGrid();
    $("photoSuggestBtn").disabled = false;
    $("renderSlideshowBtn").disabled = false;
  } catch (err) { alert(`${file.name} 上传失败：` + err.message); }
  finally { hideLoading("photoLoading"); }
}

function renderPhotoGrid() {
  $("photoCount").textContent = `${photo.photos.length} 张照片`;
  $("photoGridHeader").classList.toggle("hidden", !photo.photos.length);
  $("photoGrid").innerHTML = photo.photos.map((p, i) => `
    <div class="photo-item" draggable="true" data-id="${p.photo_id}">
      <img src="${p.url}" alt="${p.name}">
      <span class="photo-num">${i + 1}</span>
      <button class="photo-del" onclick="removePhoto('${p.photo_id}',event)">×</button>
    </div>`).join("");
  $("photoGrid").querySelectorAll(".photo-item").forEach((item) => {
    item.addEventListener("dragstart", _dragStart);
    item.addEventListener("dragover",  _dragOver);
    item.addEventListener("dragleave", _dragLeave);
    item.addEventListener("drop",      _dragDrop);
    item.addEventListener("dragend",   _dragEnd);
  });
}

function removePhoto(photoId, e) {
  e.stopPropagation();
  photo.photos = photo.photos.filter((p) => p.photo_id !== photoId);
  if (!photo.photos.length) { $("renderSlideshowBtn").disabled = true; $("photoSuggestBtn").disabled = true; }
  renderPhotoGrid();
}

let _dragSrc = null;
function _dragStart(e) { _dragSrc = this; e.dataTransfer.effectAllowed = "move"; setTimeout(() => this.classList.add("dragging"), 0); }
function _dragOver(e)  { e.preventDefault(); if (this !== _dragSrc) this.classList.add("drag-over"); }
function _dragLeave()  { this.classList.remove("drag-over"); }
function _dragDrop(e) {
  e.preventDefault(); this.classList.remove("drag-over");
  if (_dragSrc && _dragSrc !== this) {
    const si = photo.photos.findIndex((p) => p.photo_id === _dragSrc.dataset.id);
    const di = photo.photos.findIndex((p) => p.photo_id === this.dataset.id);
    const [m] = photo.photos.splice(si, 1);
    photo.photos.splice(di, 0, m);
    renderPhotoGrid();
  }
}
function _dragEnd() { this.classList.remove("dragging"); }

// ── 工具 ──────────────────────────────────────────────────────────────────────

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function showLoading(text, lid, tid) { $(tid).textContent = text; $(lid).classList.remove("hidden"); }
function hideLoading(lid) { $(lid).classList.add("hidden"); }

// ── 多视频综合分析渲染 ────────────────────────────────────────────────────────

function renderMultiPlan(result) {
  const videos = result.videos || [];
  const seq = result.sequence || {};
  const order = seq.recommended_order || videos.map((_, i) => i);
  const transitions = seq.transitions || [];

  // 视频分析卡片
  const videoCards = videos.map((v, i) => {
    const f = edit.files.find((x) => x.file_id === v.file_id);
    const name = f ? f.name : `视频 ${i + 1}`;
    const plan = v.editing_plan || {};
    const segs = plan.segments_to_keep || [];
    const dur = segs.reduce((s, seg) => s + (seg.end - seg.start), 0);
    const suggestions = (plan.suggestions || []).map((s) => `<div class="suggestion-item">${s}</div>`).join("");
    const segList = segs.map((seg, si) =>
      `<span class="seg-badge">${si + 1}: ${seg.start.toFixed(1)}s→${seg.end.toFixed(1)}s</span>`
    ).join(" ");

    return `
      <div class="multi-video-card">
        <div class="mvc-header">
          <span class="mvc-index">${i + 1}</span>
          <span class="mvc-name">${name}</span>
          <span class="mvc-dur">${dur.toFixed(1)}s</span>
          <button class="btn-link-sm" onclick="applyMultiPlan('${v.file_id}', ${i})">用此方案剪辑</button>
        </div>
        <div class="mvc-summary">${v.content_summary || ""}</div>
        ${segs.length ? `<div class="mvc-segs">${segList}</div>` : ""}
        ${suggestions}
        ${plan.notes ? `<div class="mvc-notes">${plan.notes}</div>` : ""}
      </div>`;
  }).join("");

  // 推荐拼接顺序
  const orderBadges = order.map((idx) => {
    const f = edit.files.find((x) => x.file_id === (videos[idx] || {}).file_id);
    const name = f ? f.name.substring(0, 12) : `视频${idx + 1}`;
    return `<span class="order-badge">${idx + 1}. ${name}</span>`;
  }).join(" → ");

  // 衔接方式
  const transRows = transitions.map((t) => {
    const [a, b] = t.between_indices || [];
    return `<div class="trans-row">
      <span class="trans-badge">${t.type || "cut"}</span>
      <span>视频${(a ?? 0) + 1} → 视频${(b ?? 1) + 1}：${t.reason || ""}</span>
    </div>`;
  }).join("");

  $("multiPanelContent").innerHTML = `
    <div class="multi-section-title">各视频内容分析</div>
    ${videoCards}
    <div class="multi-section-title" style="margin-top:12px">推荐拼接顺序</div>
    <div class="order-row">${orderBadges}</div>
    ${transRows}
    ${seq.total_estimated_duration ? `<div class="mvc-notes">拼接后预计总时长：${seq.total_estimated_duration.toFixed(1)}s</div>` : ""}
    ${seq.overall_notes ? `<div class="mvc-notes">${seq.overall_notes}</div>` : ""}
  `;

  // 保存到全局供"用此方案剪辑"使用
  window._multiResult = result;
}

function applyMultiPlan(fileId, videoIdx) {
  const result = window._multiResult;
  if (!result) return;
  const v = result.videos[videoIdx];
  if (!v) return;
  selectMediaFile(fileId);
  edit.editPlan = v.editing_plan;
  renderPlan(v.editing_plan);
  $("suggestionsPanel").classList.remove("hidden");
  $("suggestionsPanel").scrollIntoView({ behavior: "smooth" });
}
