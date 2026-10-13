import { deleteLog, getEntry, getMedia, listEntries, openDb, putLog } from "./db.js";
import { closePopovers, mountEditor } from "./editor.js";
import { compareEntriesDesc, countWords, environmentRows, formatStamp, normalizeUrl, weatherLabel } from "./format.js";
import { sanitize } from "./sanitize.js";
import { readEnvironment } from "./sensors.js";

const THEME_KEY = "cyberlog-theme";
const AUDIO_LIMIT = 50 * 1024 * 1024;
const PHOTO_LIMIT = 15 * 1024 * 1024;
const PHOTO_MAX = 12;

const els = {
  dashboard: document.getElementById("view-dashboard"),
  editorView: document.getElementById("view-editor"),
  dashClock: document.getElementById("dash-clock"),
  editorClock: document.getElementById("editor-clock"),
  count: document.getElementById("entry-count"),
  list: document.getElementById("entry-list"),
  head: document.getElementById("entry-head"),
  empty: document.getElementById("empty-state"),
  newEntry: document.getElementById("new-entry"),
  recordBtn: document.getElementById("record-btn"),
  saveBtn: document.getElementById("save-btn"),
  saveMenu: document.getElementById("save-menu"),
  subject: document.getElementById("subject-input"),
  deleteLog: document.getElementById("delete-log"),
  back: document.getElementById("back-btn"),
  kind: document.getElementById("entry-kind"),
  subjectLabel: document.getElementById("entry-subject-label"),
  when: document.getElementById("entry-when"),
  editorBody: document.getElementById("editor-body"),
  dock: document.getElementById("dock"),
  envBtn: document.getElementById("env-btn"),
  audioBtn: document.getElementById("audio-btn"),
  photoBtn: document.getElementById("photo-btn"),
  panelEnv: document.getElementById("panel-env"),
  panelAudio: document.getElementById("panel-audio"),
  panelPhoto: document.getElementById("panel-photo"),
  optGps: document.getElementById("opt-gps"),
  optWeather: document.getElementById("opt-weather"),
  optElevation: document.getElementById("opt-elevation"),
  optTime: document.getElementById("opt-time"),
  acquire: document.getElementById("acquire-btn"),
  clearEnv: document.getElementById("clear-env"),
  envStatus: document.getElementById("env-status"),
  envReadout: document.getElementById("env-readout"),
  envStrip: document.getElementById("env-strip"),
  audioFile: document.getElementById("audio-file"),
  audioName: document.getElementById("audio-file-name"),
  audioClear: document.getElementById("audio-clear"),
  photoFile: document.getElementById("photo-file"),
  photoGrid: document.getElementById("photo-grid"),
  photoEmpty: document.getElementById("photo-empty"),
  media: document.getElementById("media-strip"),
  words: document.getElementById("word-count"),
  chars: document.getElementById("char-count"),
  recordModal: document.getElementById("record-modal"),
  recordLead: document.getElementById("record-lead"),
  liveVideo: document.getElementById("live-video"),
  reviewVideo: document.getElementById("review-video"),
  standby: document.getElementById("viewfinder-standby"),
  indicator: document.getElementById("rec-indicator"),
  recTimer: document.getElementById("rec-timer"),
  recordError: document.getElementById("record-error"),
  openWebcam: document.getElementById("open-webcam"),
  startRecord: document.getElementById("start-record"),
  stopRecord: document.getElementById("stop-record"),
  attachVideo: document.getElementById("attach-video"),
  retakeVideo: document.getElementById("retake-video"),
  discardTake: document.getElementById("discard-take"),
  confirm: document.getElementById("confirm-modal"),
  confirmTitle: document.getElementById("confirm-title"),
  confirmBody: document.getElementById("confirm-body"),
  confirmOk: document.getElementById("confirm-ok"),
  confirmCancel: document.getElementById("confirm-cancel"),
  toast: document.getElementById("toast"),
};

const state = {
  view: "dashboard",
  draft: null,
  dirty: false,
  loading: false,
  saving: false,
  opening: false,
  dock: null,
  saveOpen: false,
  highlightId: null,
  rec: {
    stream: null,
    recorder: null,
    chunks: [],
    recording: false,
    timer: 0,
    startedAt: 0,
    pending: null,
    mime: "",
  },
};

let confirmResolve = null;
let toastTimer = 0;

const editor = mountEditor({
  body: document.getElementById("log-body"),
  toolkit: document.getElementById("toolkit"),
  onChange() {
    markDirty();
    updateCounts();
  },
  onError: toast,
  onFiles: addFiles,
});

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2800);
}

function markDirty() {
  if (state.loading || !state.draft) return;
  state.dirty = true;
}

function tick() {
  const stamp = formatStamp(new Date());
  els.dashClock.textContent = `${stamp.date}  ${stamp.time}`;
  els.editorClock.textContent = stamp.time;
}

function show(view) {
  state.view = view;
  els.dashboard.hidden = view !== "dashboard";
  els.editorView.hidden = view !== "editor";
  const subject = state.draft?.subject?.trim();
  document.title = view === "dashboard" ? "Cyberlog" : `Cyberlog — ${subject || "New log"}`;
}

function askConfirm({ title, body, ok, cancel }) {
  if (confirmResolve) settleConfirm(false);
  els.confirmTitle.textContent = title;
  els.confirmBody.textContent = body;
  els.confirmOk.textContent = ok;
  els.confirmCancel.textContent = cancel;
  els.confirm.hidden = false;
  els.confirmCancel.focus();
  return new Promise((resolve) => { confirmResolve = resolve; });
}

function settleConfirm(value) {
  els.confirm.hidden = true;
  const resolve = confirmResolve;
  confirmResolve = null;
  resolve?.(value);
}

function releaseUrls(draft) {
  if (!draft) return;
  if (draft.audio?.url) URL.revokeObjectURL(draft.audio.url);
  for (const photo of draft.photos || []) {
    if (photo.url) URL.revokeObjectURL(photo.url);
  }
  if (draft.video?.url) URL.revokeObjectURL(draft.video.url);
}

function renderDashboard(entries) {
  const sorted = [...entries].sort(compareEntriesDesc);
  els.list.replaceChildren();
  els.empty.hidden = sorted.length > 0;
  els.head.hidden = sorted.length === 0;
  els.count.textContent = String(sorted.length).padStart(2, "0");
  for (const entry of sorted) {
    const stamp = formatStamp(entry.createdAt);
    const kindName = entry.type === "video" ? "video" : "text";
    const row = document.createElement("button");
    row.type = "button";
    row.className = `entry-row${entry.id === state.highlightId ? " is-fresh" : ""}`;
    row.dataset.id = entry.id;
    row.dataset.kind = kindName;
    row.setAttribute("role", "listitem");
    const kind = document.createElement("span");
    kind.className = `kind kind-${kindName}`;
    kind.textContent = kindName === "video" ? "VIDEO" : "TEXT";
    const date = document.createElement("span");
    date.className = "entry-date";
    date.textContent = stamp.date;
    const time = document.createElement("span");
    time.className = "entry-time";
    time.textContent = stamp.time;
    const subject = document.createElement("span");
    subject.className = "entry-subject";
    if (entry.subject) subject.textContent = entry.subject;
    else {
      subject.textContent = "NO SUBJECT";
      subject.classList.add("is-empty-subject");
    }
    row.setAttribute("aria-label", `${kind.textContent} log, ${stamp.date} ${stamp.time}, ${entry.subject || "no subject"}`);
    row.append(kind, date, time, subject);
    row.addEventListener("click", () => openEntry(entry.id));
    els.list.append(row);
  }
}

async function refreshDashboard() {
  const entries = await listEntries();
  renderDashboard(entries);
}

function setStatus(text, kind) {
  els.envStatus.textContent = text;
  els.envStatus.className = `sensor-status${kind ? ` ${kind}` : ""}`;
}

function selectedSensors() {
  return {
    gps: els.optGps.checked,
    weather: els.optWeather.checked,
    elevation: els.optElevation.checked,
    time: els.optTime.checked,
  };
}

function resetToggles() {
  els.optGps.checked = true;
  els.optWeather.checked = true;
  els.optElevation.checked = true;
  els.optTime.checked = true;
  setStatus("Location is read only when you acquire GPS, weather, or elevation.", "");
}

function syncToggles() {
  const included = state.draft?.environment?.included;
  els.optGps.checked = included ? Boolean(included.gps) : true;
  els.optWeather.checked = included ? Boolean(included.weather) : true;
  els.optElevation.checked = included ? Boolean(included.elevation) : true;
  els.optTime.checked = included ? Boolean(included.time) : true;
  const warnings = state.draft?.environment?.warnings || [];
  if (warnings.length) setStatus(warnings.join(" "), "is-warn");
  else if (state.draft?.environment) setStatus("Sensor readings saved with this log.", "is-ok");
  else setStatus("Location is read only when you acquire GPS, weather, or elevation.", "");
}

function envLine(row) {
  const line = document.createElement("p");
  const label = document.createElement("strong");
  label.textContent = row.label;
  const value = document.createElement("span");
  value.textContent = row.value;
  line.append(label, value);
  return line;
}

function renderEnvironment() {
  const rows = environmentRows(state.draft?.environment);
  els.envStrip.replaceChildren();
  els.envReadout.replaceChildren();
  els.envStrip.hidden = rows.length === 0;
  for (const row of rows) {
    els.envStrip.append(envLine(row));
    els.envReadout.append(envLine(row));
  }
}

function renderSubject() {
  const subject = state.draft?.subject?.trim() || "";
  els.subjectLabel.textContent = subject || "NO SUBJECT";
  if (state.view === "editor") document.title = `Cyberlog — ${subject || "New log"}`;
}

function renderWhen() {
  const stamp = formatStamp(state.draft.createdAt);
  els.when.textContent = `LOG  ${stamp.date}  ${stamp.time}`;
}

function setKind() {
  const video = Boolean(state.draft?.video);
  els.kind.textContent = video ? "VIDEO" : "TEXT";
  els.kind.className = `kind kind-${video ? "video" : "text"}`;
  els.deleteLog.textContent = state.draft?.persisted ? "DELETE LOG" : "DISCARD LOG";
}

function updateCounts() {
  const text = editor.getText();
  const words = countWords(text);
  const chars = text.replace(/\s/g, "").length;
  els.words.textContent = `${words} ${words === 1 ? "WORD" : "WORDS"}`;
  els.chars.textContent = `${chars} CHARACTERS`;
}

function renderAudioName() {
  const audio = state.draft?.audio;
  els.audioName.textContent = audio ? audio.name : "No audio file attached.";
  els.audioClear.hidden = !audio;
}

function renderPhotoGrid() {
  const photos = state.draft?.photos || [];
  els.photoGrid.replaceChildren();
  els.photoEmpty.hidden = photos.length > 0;
  for (const photo of photos) {
    const card = document.createElement("div");
    card.className = "photo-card";
    const image = document.createElement("img");
    image.src = photo.url;
    image.alt = photo.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${photo.name}`);
    remove.addEventListener("click", () => removePhoto(photo.id));
    card.append(image, remove);
    els.photoGrid.append(card);
  }
}

function renderMedia() {
  const draft = state.draft;
  els.media.replaceChildren();
  const hasMedia = Boolean(draft && (draft.audio || draft.photos.length || draft.video));
  els.media.hidden = !hasMedia;
  if (draft?.audio) {
    const label = document.createElement("p");
    label.className = "media-label";
    label.textContent = `AUDIO  ${draft.audio.name}`;
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = draft.audio.url;
    els.media.append(label, audio);
  }
  if (draft?.photos?.length) {
    const label = document.createElement("p");
    label.className = "media-label";
    label.textContent = "PHOTO";
    const grid = document.createElement("div");
    grid.className = "media-photos";
    for (const photo of draft.photos) {
      const image = document.createElement("img");
      image.src = photo.url;
      image.alt = photo.name;
      grid.append(image);
    }
    els.media.append(label, grid);
  }
  if (draft?.video) {
    const label = document.createElement("p");
    label.className = "media-label";
    label.textContent = "VIDEO";
    const video = document.createElement("video");
    video.controls = true;
    video.src = draft.video.url;
    els.media.append(label, video);
  }
  renderAudioName();
  renderPhotoGrid();
  setKind();
}

function closeDock() {
  state.dock = null;
  els.editorBody.classList.remove("dock-open");
  els.dock.hidden = true;
  for (const [name, button, panel] of [
    ["env", els.envBtn, els.panelEnv],
    ["audio", els.audioBtn, els.panelAudio],
    ["photo", els.photoBtn, els.panelPhoto],
  ]) {
    button.classList.remove("is-on");
    button.setAttribute("aria-expanded", "false");
    panel.hidden = true;
    void name;
  }
}

function toggleDock(name) {
  if (state.dock === name) {
    closeDock();
    return;
  }
  state.dock = name;
  els.editorBody.classList.add("dock-open");
  els.dock.hidden = false;
  const panels = { env: els.panelEnv, audio: els.panelAudio, photo: els.panelPhoto };
  const buttons = { env: els.envBtn, audio: els.audioBtn, photo: els.photoBtn };
  for (const key of Object.keys(panels)) {
    const on = key === name;
    panels[key].hidden = !on;
    buttons[key].classList.toggle("is-on", on);
    buttons[key].setAttribute("aria-expanded", String(on));
  }
  renderEnvironment();
  renderAudioName();
  renderPhotoGrid();
}

function closeSave() {
  state.saveOpen = false;
  els.saveMenu.hidden = true;
  els.saveBtn.setAttribute("aria-expanded", "false");
}

function toggleSave() {
  if (!state.draft) return;
  if (state.saveOpen) {
    closeSave();
    return;
  }
  state.saveOpen = true;
  els.saveMenu.hidden = false;
  els.saveBtn.setAttribute("aria-expanded", "true");
  els.subject.value = state.draft.subject || "";
  els.subject.focus();
  const end = els.subject.value.length;
  els.subject.setSelectionRange(end, end);
}

function blankDraft() {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    subject: "",
    environment: null,
    audio: null,
    photos: [],
    video: null,
    persisted: false,
  };
}

function enterEditor() {
  state.loading = true;
  els.subject.value = state.draft.subject || "";
  renderSubject();
  renderWhen();
  renderEnvironment();
  renderMedia();
  updateCounts();
  state.loading = false;
  state.dirty = false;
  closeDock();
  closeSave();
  show("editor");
  editor.focus();
}

function newEntry() {
  state.draft = blankDraft();
  editor.setHtml("");
  resetToggles();
  enterEditor();
}

function hydrate(media) {
  if (!media) return { audio: null, photos: [], video: null };
  return {
    audio: media.audio?.blob ? { ...media.audio, url: URL.createObjectURL(media.audio.blob) } : null,
    photos: (media.photos || []).filter((photo) => photo.blob).map((photo) => ({
      ...photo,
      url: URL.createObjectURL(photo.blob),
    })),
    video: media.video?.blob ? { ...media.video, url: URL.createObjectURL(media.video.blob) } : null,
  };
}

async function openEntry(id) {
  if (state.opening) return;
  state.opening = true;
  try {
    const entry = await getEntry(id);
    if (!entry) {
      toast("THAT LOG IS NO LONGER IN THE ARCHIVE");
      await refreshDashboard();
      return;
    }
    const media = hydrate(await getMedia(id));
    state.draft = {
      id: entry.id,
      createdAt: entry.createdAt,
      subject: entry.subject || "",
      environment: entry.environment || null,
      audio: media.audio,
      photos: media.photos,
      video: media.video,
      persisted: true,
    };
    editor.setHtml(entry.html || "");
    syncToggles();
    enterEditor();
  } catch {
    toast("THE LOG COULD NOT BE OPENED");
  } finally {
    state.opening = false;
  }
}

async function saveLog() {
  if (!state.draft || state.saving) return;
  state.saving = true;
  const persistedId = state.draft.id;
  try {
    const subject = els.subject.value.trim().slice(0, 80);
    state.draft.subject = subject;
    renderSubject();
    const entry = {
      id: state.draft.id,
      type: state.draft.video ? "video" : "text",
      subject,
      html: editor.getHtml(),
      createdAt: state.draft.createdAt,
      updatedAt: new Date().toISOString(),
      environment: state.draft.environment,
    };
    const media = {
      id: state.draft.id,
      audio: state.draft.audio
        ? { name: state.draft.audio.name, mime: state.draft.audio.mime, blob: state.draft.audio.blob }
        : null,
      photos: state.draft.photos.map((photo) => ({
        id: photo.id,
        name: photo.name,
        mime: photo.mime,
        blob: photo.blob,
      })),
      video: state.draft.video
        ? { mime: state.draft.video.mime, blob: state.draft.video.blob, durationMs: state.draft.video.durationMs || 0 }
        : null,
    };
    await putLog(entry, media);
    state.dirty = false;
    state.highlightId = persistedId;
    closeSave();
    closeRecorder();
    releaseUrls(state.draft);
    state.draft = null;
    await refreshDashboard();
    show("dashboard");
    toast("LOG SAVED");
  } catch {
    toast("THE LOG COULD NOT BE SAVED");
  } finally {
    state.saving = false;
  }
}

async function removeLog() {
  if (!state.draft) return;
  const persisted = state.draft.persisted;
  const ok = await askConfirm({
    title: persisted ? "DELETE LOG" : "DISCARD LOG",
    body: persisted
      ? "Delete this log from the archive? This cannot be undone."
      : "Discard this unsaved log?",
    ok: persisted ? "DELETE" : "DISCARD",
    cancel: "CANCEL",
  });
  if (!ok || !state.draft) return;
  try {
    if (persisted) await deleteLog(state.draft.id);
    state.dirty = false;
    closeRecorder();
    releaseUrls(state.draft);
    state.draft = null;
    closeSave();
    await refreshDashboard();
    show("dashboard");
    toast(persisted ? "LOG DELETED" : "LOG DISCARDED");
  } catch {
    toast("THE LOG COULD NOT BE DELETED");
  }
}

async function backToDashboard() {
  if (state.dirty) {
    const ok = await askConfirm({
      title: "UNSAVED LOG",
      body: "This log has not been saved. Leave it and return to the dashboard?",
      ok: "DISCARD",
      cancel: "KEEP EDITING",
    });
    if (!ok) return;
  }
  closeRecorder();
  releaseUrls(state.draft);
  state.draft = null;
  state.dirty = false;
  closeDock();
  closeSave();
  editor.closePopovers();
  await refreshDashboard();
  show("dashboard");
}

async function acquireEnv() {
  if (!state.draft || els.acquire.disabled) return;
  const options = selectedSensors();
  if (!options.gps && !options.weather && !options.elevation && !options.time) {
    setStatus("Select at least one reading to include.", "is-warn");
    return;
  }
  els.acquire.disabled = true;
  setStatus("Reading PC sensors…", "");
  try {
    state.draft.environment = await readEnvironment(options);
    markDirty();
    renderEnvironment();
    const warnings = state.draft.environment.warnings;
    if (warnings.length && !environmentRows(state.draft.environment).length) setStatus(warnings.join(" "), "is-bad");
    else if (warnings.length) setStatus(warnings.join(" "), "is-warn");
    else setStatus("Sensor readings captured.", "is-ok");
  } catch {
    setStatus("The sensor reading failed.", "is-bad");
  } finally {
    els.acquire.disabled = false;
  }
}

function clearEnvironment() {
  if (!state.draft?.environment) {
    setStatus("No environment data is attached.", "");
    return;
  }
  state.draft.environment = null;
  markDirty();
  renderEnvironment();
  setStatus("Environment data cleared.", "");
}

function onSensorToggle() {
  if (!state.draft?.environment) return;
  state.draft.environment.included = selectedSensors();
  markDirty();
  renderEnvironment();
}

function isAudio(file) {
  return file.type.startsWith("audio/") || /\.(mp3|wav|ogg|oga|m4a|flac|aac|webm|opus)$/i.test(file.name || "");
}

function isImage(file) {
  return /^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name || "");
}

function setAudio(file) {
  if (!state.draft) return;
  if (!isAudio(file)) {
    toast("CHOOSE AN AUDIO FILE");
    return;
  }
  if (file.size > AUDIO_LIMIT) {
    toast("AUDIO FILES NEED TO BE UNDER 50 MB");
    return;
  }
  if (state.draft.audio?.url) URL.revokeObjectURL(state.draft.audio.url);
  state.draft.audio = {
    name: file.name || "audio",
    mime: file.type || "audio/webm",
    blob: file,
    url: URL.createObjectURL(file),
  };
  markDirty();
  renderMedia();
  if (state.dock !== "audio") toggleDock("audio");
}

function clearAudio() {
  if (!state.draft?.audio) return;
  URL.revokeObjectURL(state.draft.audio.url);
  state.draft.audio = null;
  markDirty();
  renderMedia();
}

function addPhotos(files) {
  if (!state.draft) return;
  const images = files.filter(isImage);
  if (!images.length) {
    toast("CHOOSE AN IMAGE FILE");
    return;
  }
  let skipped = false;
  let added = 0;
  for (const file of images) {
    if (file.size > PHOTO_LIMIT || state.draft.photos.length >= PHOTO_MAX) {
      skipped = true;
      continue;
    }
    state.draft.photos.push({
      id: crypto.randomUUID(),
      name: file.name || "image",
      mime: file.type || "image/jpeg",
      blob: file,
      url: URL.createObjectURL(file),
    });
    added += 1;
  }
  if (added) markDirty();
  if (skipped) toast("SOME IMAGES WERE SKIPPED. USE FILES UNDER 15 MB, UP TO 12.");
  renderMedia();
  if (state.dock !== "photo") toggleDock("photo");
}

function removePhoto(id) {
  const photo = state.draft?.photos?.find((item) => item.id === id);
  if (!photo) return;
  URL.revokeObjectURL(photo.url);
  state.draft.photos = state.draft.photos.filter((item) => item.id !== id);
  markDirty();
  renderMedia();
}

function addFiles(files) {
  const images = files.filter(isImage);
  const audios = files.filter(isAudio);
  if (!images.length && !audios.length) {
    toast("DROP AN AUDIO FILE OR AN IMAGE");
    return;
  }
  if (audios[0]) setAudio(audios[0]);
  if (images.length) addPhotos(images);
}

function showRecordButtons(flags = {}) {
  els.openWebcam.hidden = !flags.open;
  els.startRecord.hidden = !flags.start;
  els.stopRecord.hidden = !flags.stop;
  els.attachVideo.hidden = !flags.attach;
  els.retakeVideo.hidden = !flags.retake;
  els.discardTake.hidden = !flags.discard;
}

function clearRecordError() {
  els.recordError.hidden = true;
  els.recordError.textContent = "";
}

function showRecordError(message) {
  els.recordError.hidden = false;
  els.recordError.textContent = message;
}

function resetViewfinder() {
  els.liveVideo.hidden = true;
  els.reviewVideo.hidden = true;
  els.standby.hidden = false;
  els.indicator.hidden = true;
  els.recordLead.textContent = "Open the webcam to record a video log entry.";
  clearRecordError();
}

function stopStream() {
  state.rec.stream?.getTracks().forEach((track) => track.stop());
  state.rec.stream = null;
  els.liveVideo.srcObject = null;
}

function revokePending() {
  if (state.rec.pending?.url && state.rec.pending.url !== state.draft?.video?.url) {
    URL.revokeObjectURL(state.rec.pending.url);
  }
  state.rec.pending = null;
}

function updateTimer() {
  const elapsed = Math.max(0, Math.floor((performance.now() - state.rec.startedAt) / 1000));
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  els.recTimer.textContent = `${minutes}:${seconds}`;
}

function openRecorder() {
  if (!state.draft) return;
  closeSave();
  editor.closePopovers();
  els.recordModal.hidden = false;
  clearRecordError();
  if (state.draft.video && !state.rec.stream) {
    els.reviewVideo.src = state.draft.video.url;
    els.reviewVideo.hidden = false;
    els.liveVideo.hidden = true;
    els.standby.hidden = true;
    els.indicator.hidden = true;
    els.recordLead.textContent = "This log has a video take. Open the webcam to record a new one, or discard it.";
    showRecordButtons({ open: true, discard: true });
    return;
  }
  resetViewfinder();
  showRecordButtons({ open: true });
}

async function openWebcam() {
  if (els.openWebcam.disabled) return;
  els.openWebcam.disabled = true;
  clearRecordError();
  if (!navigator.mediaDevices?.getUserMedia) {
    showRecordError("This PC has no webcam available to the journal.");
    els.openWebcam.disabled = false;
    return;
  }
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
  } catch {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      toast("MICROPHONE IS OFF. RECORDING PICTURE ONLY.");
    } catch {
      showRecordError("The webcam is not enabled. Allow camera access for Cyberlog and try again.");
      els.openWebcam.disabled = false;
      return;
    }
  }
  stopStream();
  state.rec.stream = stream;
  els.liveVideo.srcObject = stream;
  els.liveVideo.hidden = false;
  els.reviewVideo.hidden = true;
  els.standby.hidden = true;
  els.indicator.hidden = true;
  els.recordLead.textContent = "The webcam is open. Start recording when you are ready.";
  showRecordButtons({ start: true, discard: Boolean(state.draft?.video) });
  try { await els.liveVideo.play(); } catch { /* The click already granted playback. */ }
  els.openWebcam.disabled = false;
}

function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function startRecording() {
  if (!state.rec.stream) return;
  clearRecordError();
  const mime = pickMime();
  let recorder;
  try {
    recorder = mime ? new MediaRecorder(state.rec.stream, { mimeType: mime }) : new MediaRecorder(state.rec.stream);
  } catch {
    showRecordError("This PC could not start a video recording.");
    return;
  }
  revokePending();
  state.rec.chunks = [];
  state.rec.mime = recorder.mimeType || mime || "video/webm";
  recorder.ondataavailable = (event) => {
    if (event.data?.size) state.rec.chunks.push(event.data);
  };
  recorder.onstop = () => finishTake();
  recorder.onerror = () => showRecordError("The recording stopped because of a camera error.");
  state.rec.recorder = recorder;
  state.rec.startedAt = performance.now();
  state.rec.recording = true;
  recorder.start(200);
  updateTimer();
  state.rec.timer = setInterval(updateTimer, 200);
  els.indicator.hidden = false;
  els.recordLead.textContent = "Recording from the webcam.";
  showRecordButtons({ stop: true });
}

function stopRecording() {
  if (state.rec.recorder && state.rec.recorder.state !== "inactive") state.rec.recorder.stop();
}

function finishTake() {
  state.rec.recording = false;
  clearInterval(state.rec.timer);
  const blob = new Blob(state.rec.chunks, { type: state.rec.mime || "video/webm" });
  state.rec.chunks = [];
  if (blob.size < 100) {
    showRecordError("The recording was empty. Try again.");
    els.indicator.hidden = true;
    showRecordButtons({ start: true });
    return;
  }
  const url = URL.createObjectURL(blob);
  state.rec.pending = {
    mime: blob.type || state.rec.mime,
    blob,
    url,
    durationMs: Math.max(0, performance.now() - state.rec.startedAt),
  };
  els.reviewVideo.src = url;
  els.reviewVideo.hidden = false;
  els.liveVideo.hidden = true;
  els.indicator.hidden = true;
  els.recordLead.textContent = "Review the take, then attach it to this log.";
  showRecordButtons({ attach: true, retake: true, discard: true });
}

function attachTake() {
  if (!state.draft || !state.rec.pending) return;
  if (state.draft.video?.url && state.draft.video.url !== state.rec.pending.url) {
    URL.revokeObjectURL(state.draft.video.url);
  }
  state.draft.video = state.rec.pending;
  state.rec.pending = null;
  markDirty();
  renderMedia();
  closeRecorder();
  toast("VIDEO ATTACHED");
}

function retake() {
  revokePending();
  els.reviewVideo.removeAttribute("src");
  els.reviewVideo.load();
  clearRecordError();
  if (state.rec.stream) {
    els.liveVideo.hidden = false;
    els.reviewVideo.hidden = true;
    els.standby.hidden = true;
    els.recordLead.textContent = "The webcam is open. Start recording when you are ready.";
    showRecordButtons({ start: true });
    return;
  }
  resetViewfinder();
  showRecordButtons({ open: true });
}

function discardVideo() {
  if (state.rec.pending) {
    retake();
    return;
  }
  if (state.draft?.video) {
    URL.revokeObjectURL(state.draft.video.url);
    state.draft.video = null;
    markDirty();
    renderMedia();
    els.reviewVideo.removeAttribute("src");
    els.reviewVideo.load();
    toast("VIDEO REMOVED");
  }
  if (state.rec.stream) {
    els.liveVideo.hidden = false;
    els.reviewVideo.hidden = true;
    els.standby.hidden = true;
    showRecordButtons({ start: true });
    return;
  }
  resetViewfinder();
  showRecordButtons({ open: true });
}

function closeRecorder() {
  clearInterval(state.rec.timer);
  if (state.rec.recorder && state.rec.recorder.state !== "inactive") {
    state.rec.recorder.onstop = null;
    state.rec.recorder.stop();
  }
  state.rec.recorder = null;
  state.rec.recording = false;
  stopStream();
  revokePending();
  els.reviewVideo.removeAttribute("src");
  els.reviewVideo.load();
  els.recordModal.hidden = true;
  els.indicator.hidden = true;
}

function requestCloseRecorder() {
  if (state.rec.recording) {
    stopRecording();
    return;
  }
  closeRecorder();
}

document.getElementById("close-env").addEventListener("click", closeDock);
document.getElementById("close-audio").addEventListener("click", closeDock);
document.getElementById("close-photo").addEventListener("click", closeDock);
els.newEntry.addEventListener("click", newEntry);
els.back.addEventListener("click", () => { backToDashboard(); });
els.recordBtn.addEventListener("click", openRecorder);
els.saveBtn.addEventListener("click", toggleSave);
els.saveMenu.addEventListener("submit", (event) => {
  event.preventDefault();
  saveLog();
});
els.deleteLog.addEventListener("click", () => { removeLog(); });
els.subject.addEventListener("input", () => {
  if (!state.draft) return;
  state.draft.subject = els.subject.value;
  renderSubject();
  markDirty();
});
els.envBtn.addEventListener("click", () => toggleDock("env"));
els.audioBtn.addEventListener("click", () => toggleDock("audio"));
els.photoBtn.addEventListener("click", () => toggleDock("photo"));
els.acquire.addEventListener("click", () => { acquireEnv(); });
els.clearEnv.addEventListener("click", clearEnvironment);
for (const box of [els.optGps, els.optWeather, els.optElevation, els.optTime]) {
  box.addEventListener("change", onSensorToggle);
}
els.audioFile.addEventListener("change", () => {
  const file = els.audioFile.files?.[0];
  els.audioFile.value = "";
  if (file) setAudio(file);
});
els.audioClear.addEventListener("click", clearAudio);
els.photoFile.addEventListener("change", () => {
  const files = [...(els.photoFile.files || [])];
  els.photoFile.value = "";
  if (files.length) addPhotos(files);
});
els.openWebcam.addEventListener("click", () => { openWebcam(); });
els.startRecord.addEventListener("click", startRecording);
els.stopRecord.addEventListener("click", stopRecording);
els.attachVideo.addEventListener("click", attachTake);
els.retakeVideo.addEventListener("click", retake);
els.discardTake.addEventListener("click", discardVideo);
document.getElementById("record-close").addEventListener("click", requestCloseRecorder);
els.confirmOk.addEventListener("click", () => settleConfirm(true));
els.confirmCancel.addEventListener("click", () => settleConfirm(false));

document.addEventListener("pointerdown", (event) => {
  if (state.saveOpen && !event.target.closest("#save-menu, #save-btn")) closeSave();
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (state.view === "editor") saveLog();
  }
  if (event.key !== "Escape") return;
  if (confirmResolve) {
    settleConfirm(false);
    return;
  }
  if (!els.recordModal.hidden) {
    requestCloseRecorder();
    return;
  }
  if (state.saveOpen) {
    closeSave();
    return;
  }
  closePopovers();
  if (state.dock) closeDock();
});
window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => {
  if (event.target.closest("#log-body")) return;
  event.preventDefault();
  if (state.view !== "editor" || !state.draft) return;
  const files = [...(event.dataTransfer?.files || [])];
  if (files.length) addFiles(files);
});

window.__cyberlog = { sanitize, formatStamp, weatherLabel, normalizeUrl, environmentRows };

function applyTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === next));
  });
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* The theme still changes for this view when storage is blocked. */
  }
}

document.querySelectorAll("[data-theme-choice]").forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.themeChoice));
});
applyTheme(document.documentElement.dataset.theme || "dark");

tick();
setInterval(tick, 1000);
show("dashboard");
openDb()
  .then(refreshDashboard)
  .catch(() => toast("THE LOCAL ARCHIVE COULD NOT BE OPENED"));
