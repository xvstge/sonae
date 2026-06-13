const VISOR_VERSION = "8.1";
console.info(`Visor WhatsApp v${VISOR_VERSION}`);
"use strict";

let CHAT_MESSAGES = [];
let SESSION_KEY = null;
let starredIds = new Set();
let selectedMessageId = null;
let renderStart = 0;
let renderEnd = 0;
let loadingOlder = false;
let loadingNewer = false;
let printMode = false;
let imageObserver = null;
let searchMatches = [];
let currentSearchMatch = -1;
let searchTimer = null;
let idToIndex = new Map();
let dateToIndex = new Map();
let searchTexts = [];
const objectUrls = new Set();

const $ = id => document.getElementById(id);
const chat = $("chat");
const INITIAL_MESSAGES = Number(CHAT_CONFIG.initialMessages || 400);
const MESSAGE_BATCH = Number(CHAT_CONFIG.messageBatch || 400);
const MAX_RENDERED = Number(CHAT_CONFIG.maxRenderedMessages || 1200);

$("loginPhoto").src = CHAT_CONFIG.loginPhoto;
$("togglePassword").onclick = () => {
  $("passwordInput").type = $("passwordInput").type === "password" ? "text" : "password";
};

$("loginForm").onsubmit = async event => {
  event.preventDefault();
  $("loginError").textContent = "";
  if (!window.crypto || !window.crypto.subtle) {
    $("loginError").textContent = "Abre el enlace mediante HTTPS en Safari, Chrome, Firefox o Edge actualizado.";
    return;
  }
  try {
    const result = await decryptChat($("passwordInput").value);
    CHAT_MESSAGES = result.messages;
    SESSION_KEY = result.key;
    buildIndexes();
    starredIds = new Set(loadStarred());
    $("loginScreen").hidden = true;
    $("chatApp").hidden = false;
    setupHeader();
    configureDatePicker();
    initializeImageObserver();
    renderInitialWindow();
  } catch (error) {
    console.warn(error);
    $("loginError").textContent = "La contraseña no es correcta.";
  }
};

async function decryptChat(password) {
  const encoder = new TextEncoder();
  const salt = fromBase64(ENCRYPTED_CHAT.salt);
  const iv = fromBase64(ENCRYPTED_CHAT.iv);
  const encrypted = fromBase64(ENCRYPTED_CHAT.data);
  const material = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {name: "PBKDF2", salt, iterations: ENCRYPTED_CHAT.iterations, hash: "SHA-256"},
    material,
    {name: "AES-GCM", length: 256},
    false,
    ["decrypt"]
  );
  const raw = await crypto.subtle.decrypt({name: "AES-GCM", iv}, key, encrypted);
  return {messages: JSON.parse(new TextDecoder().decode(raw)), key};
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function buildIndexes() {
  idToIndex = new Map();
  dateToIndex = new Map();
  searchTexts = new Array(CHAT_MESSAGES.length);
  CHAT_MESSAGES.forEach((item, index) => {
    idToIndex.set(item.id, index);
    if (item.date && !dateToIndex.has(item.date)) dateToIndex.set(item.date, index);
    searchTexts[index] = `${item.text || ""} ${item.caption || ""} ${item.fileName || ""}`.toLowerCase();
  });
}

function setupHeader() {
  $("contactName").textContent = CHAT_CONFIG.contactName;
  $("contactStatus").textContent = CHAT_CONFIG.status;
  $("profilePhoto").src = CHAT_CONFIG.profilePhoto;
}

function configureDatePicker() {
  const dates = [...dateToIndex.keys()].sort();
  if (!dates.length) return;
  $("datePicker").min = dates[0];
  $("datePicker").max = dates[dates.length - 1];
  $("datePicker").value = dates[dates.length - 1];
}

function initializeImageObserver() {
  if (imageObserver) imageObserver.disconnect();
  imageObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      imageObserver.unobserve(entry.target);
      loadImagePlaceholder(entry.target);
    }
  }, {root: chat, rootMargin: "650px 0px"});
}

function renderInitialWindow() {
  const end = CHAT_MESSAGES.length;
  const start = Math.max(0, end - INITIAL_MESSAGES);
  renderWindow(start, end, {scrollBottom: true});
}

function renderWindow(start, end, options = {}) {
  cleanupAllEntries();
  const fragment = document.createDocumentFragment();
  for (let index = start; index < end; index += 1) {
    fragment.appendChild(createEntry(index));
  }
  chat.replaceChildren(fragment);
  renderStart = start;
  renderEnd = end;
  observeLazyImages(chat);
  requestAnimationFrame(() => {
    if (options.scrollBottom) chat.scrollTop = chat.scrollHeight;
    if (Number.isInteger(options.targetIndex)) {
      scrollToRenderedIndex(options.targetIndex, options.query || "", options.dateHighlight || false);
    }
  });
}

function createEntry(index, options = {}) {
  const item = CHAT_MESSAGES[index];
  const entry = document.createElement("div");
  entry.className = "chat-entry";
  entry.dataset.messageIndex = String(index);

  if (index === 0 || CHAT_MESSAGES[index - 1].date !== item.date) {
    const date = document.createElement("div");
    date.className = "date-divider";
    date.dataset.date = item.date;
    date.textContent = item.displayDate;
    entry.appendChild(date);
  }

  if (item.type === "system") {
    const system = document.createElement("div");
    system.className = "system-message";
    system.textContent = item.text;
    entry.appendChild(system);
    return entry;
  }

  const bubble = document.createElement("article");
  bubble.className = `message ${item.side}${item.mediaType === "sticker" ? " sticker-bubble" : ""}`;
  bubble.dataset.messageId = item.id;
  bubble.dataset.messageIndex = String(index);

  const media = createMediaPlaceholder(item, index, options);
  if (media) bubble.appendChild(media);

  const row = document.createElement("div");
  row.className = "message-row";
  const hasMedia = Boolean(item.secureMedia || item.missingMedia || item.omittedVideo);
  const visibleText = item.deleted
    ? "Se eliminó este mensaje."
    : (item.caption || (!hasMedia ? item.text : ""));

  if (visibleText) {
    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = visibleText;
    text.dataset.original = visibleText;
    row.appendChild(text);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  if (starredIds.has(item.id)) meta.appendChild(createStarIndicator());
  const time = document.createElement("span");
  time.textContent = item.time;
  meta.appendChild(time);
  if (item.side === CHAT_CONFIG.mySide) meta.insertAdjacentHTML(
    "beforeend",
    '<svg class="read-ticks" viewBox="0 0 20 12" aria-label="Leído"><path d="M1.5 6.5 5 10l6.7-8"/><path d="M7 7.2 10 10l8-8"/></svg>'
  );
  row.appendChild(meta);
  bubble.appendChild(row);

  bubble.addEventListener("click", event => {
    if (event.target.closest("button,a,audio,video")) return;
    openMessageMenu(item.id, event);
  });
  bubble.addEventListener("contextmenu", event => {
    event.preventDefault();
    openMessageMenu(item.id, event);
  });
  entry.appendChild(bubble);
  return entry;
}

function createStarIndicator() {
  const star = document.createElement("span");
  star.className = "star-indicator";
  star.setAttribute("aria-label", "Mensaje destacado");
  star.textContent = "★";
  return star;
}

function createMediaPlaceholder(item, index, options = {}) {
  if (item.omittedVideo) {
    const omitted = document.createElement("div");
    omitted.className = "omitted-video";
    omitted.innerHTML = '<span class="media-symbol">▶</span><span>Video omitido en esta versión</span>';
    return omitted;
  }
  if (item.missingMedia) {
    const missing = document.createElement("div");
    missing.className = "missing-media";
    missing.textContent = `No se encontró: ${item.fileName || "archivo"}`;
    return missing;
  }
  if (!item.secureMedia) return null;

  if (["image", "sticker"].includes(item.mediaType)) {
    const placeholder = document.createElement("button");
    placeholder.type = "button";
    placeholder.className = `media-placeholder lazy-media ${item.mediaType === "sticker" ? "sticker-placeholder" : ""}`;
    placeholder.dataset.mediaIndex = String(index);
    placeholder.innerHTML = '<span class="media-spinner"></span><span>Cargando imagen…</span>';
    placeholder.onclick = event => {
      event.stopPropagation();
      loadImagePlaceholder(placeholder);
    };
    if (options.print) placeholder.dataset.printMedia = "1";
    return placeholder;
  }

  if (item.mediaType === "audio") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "media-action audio-action";
    button.dataset.mediaIndex = String(index);
    button.innerHTML = '<span class="media-symbol">▶</span><span>Tocar para cargar audio</span>';
    button.onclick = event => {
      event.stopPropagation();
      loadAudio(button, item);
    };
    return button;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "media-action document-action";
  button.dataset.mediaIndex = String(index);
  button.innerHTML = `<span class="media-symbol">📄</span><span>${escapeHtml(item.fileName || "Abrir documento")}</span>`;
  button.onclick = event => {
    event.stopPropagation();
    loadDocument(button, item);
  };
  return button;
}

function observeLazyImages(root) {
  if (!imageObserver || printMode) return;
  root.querySelectorAll(".lazy-media:not([data-observed])").forEach(element => {
    element.dataset.observed = "1";
    imageObserver.observe(element);
  });
}

async function decryptMedia(info) {
  const response = await fetch(info.encryptedPath, {cache: "force-cache"});
  if (!response.ok) throw new Error(`No se pudo descargar ${info.encryptedPath}`);
  const encrypted = await response.arrayBuffer();
  const raw = await crypto.subtle.decrypt(
    {name: "AES-GCM", iv: fromBase64(info.iv)}, SESSION_KEY, encrypted
  );
  const url = URL.createObjectURL(new Blob([raw], {type: info.mime}));
  objectUrls.add(url);
  return url;
}

async function loadImagePlaceholder(placeholder) {
  if (!placeholder || placeholder.dataset.loading === "1") return;
  const index = Number(placeholder.dataset.mediaIndex);
  const item = CHAT_MESSAGES[index];
  if (!item || !item.secureMedia) return;
  placeholder.dataset.loading = "1";
  try {
    const url = await decryptMedia(item.secureMedia);
    const image = document.createElement("img");
    image.src = url;
    image.alt = item.fileName || "Imagen";
    image.className = item.mediaType === "sticker" ? "message-sticker" : "message-media";
    image.dataset.objectUrl = url;
    placeholder.replaceWith(image);
  } catch (error) {
    console.warn(error);
    placeholder.className = "missing-media";
    placeholder.textContent = `No se pudo cargar: ${item.fileName || "imagen"}`;
  }
}

async function loadAudio(button, item) {
  if (button.dataset.loading === "1") return;
  button.dataset.loading = "1";
  button.lastElementChild.textContent = "Cargando audio…";
  try {
    const url = await decryptMedia(item.secureMedia);
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.autoplay = true;
    audio.src = url;
    audio.className = "message-audio";
    audio.dataset.objectUrl = url;
    button.replaceWith(audio);
  } catch (error) {
    button.dataset.loading = "0";
    button.lastElementChild.textContent = "No se pudo cargar el audio";
  }
}

async function loadDocument(button, item) {
  if (button.dataset.loading === "1") return;
  button.dataset.loading = "1";
  try {
    const url = await decryptMedia(item.secureMedia);
    const link = document.createElement("a");
    link.href = url;
    link.download = item.fileName || "archivo";
    link.className = "document-card";
    link.dataset.objectUrl = url;
    link.innerHTML = `<span>📄</span><span>${escapeHtml(item.fileName || "Descargar documento")}</span>`;
    button.replaceWith(link);
  } catch (error) {
    button.dataset.loading = "0";
    button.lastElementChild.textContent = "No se pudo cargar el documento";
  }
}

function cleanupEntry(entry) {
  entry.querySelectorAll("[data-object-url]").forEach(element => {
    const url = element.dataset.objectUrl;
    if (url) {
      URL.revokeObjectURL(url);
      objectUrls.delete(url);
    }
  });
}

function cleanupAllEntries() {
  chat.querySelectorAll(".chat-entry").forEach(cleanupEntry);
  if (imageObserver) imageObserver.disconnect();
}

async function loadOlderMessages() {
  if (loadingOlder || printMode || renderStart <= 0) return;
  loadingOlder = true;
  const oldHeight = chat.scrollHeight;
  const oldTop = chat.scrollTop;
  const newStart = Math.max(0, renderStart - MESSAGE_BATCH);
  const fragment = document.createDocumentFragment();
  for (let index = newStart; index < renderStart; index += 1) fragment.appendChild(createEntry(index));
  chat.insertBefore(fragment, chat.firstChild);
  renderStart = newStart;
  observeLazyImages(chat);
  chat.scrollTop = oldTop + (chat.scrollHeight - oldHeight);
  trimBottomIfNeeded();
  loadingOlder = false;
}

async function loadNewerMessages() {
  if (loadingNewer || printMode || renderEnd >= CHAT_MESSAGES.length) return;
  loadingNewer = true;
  const newEnd = Math.min(CHAT_MESSAGES.length, renderEnd + MESSAGE_BATCH);
  const fragment = document.createDocumentFragment();
  for (let index = renderEnd; index < newEnd; index += 1) fragment.appendChild(createEntry(index));
  chat.appendChild(fragment);
  renderEnd = newEnd;
  observeLazyImages(chat);
  trimTopIfNeeded();
  loadingNewer = false;
}

function trimBottomIfNeeded() {
  const excess = renderEnd - renderStart - MAX_RENDERED;
  if (excess <= 0) return;
  for (let count = 0; count < excess; count += 1) {
    const entry = chat.lastElementChild;
    if (!entry) break;
    cleanupEntry(entry);
    entry.remove();
    renderEnd -= 1;
  }
}

function trimTopIfNeeded() {
  const excess = renderEnd - renderStart - MAX_RENDERED;
  if (excess <= 0) return;
  const oldHeight = chat.scrollHeight;
  for (let count = 0; count < excess; count += 1) {
    const entry = chat.firstElementChild;
    if (!entry) break;
    cleanupEntry(entry);
    entry.remove();
    renderStart += 1;
  }
  chat.scrollTop -= oldHeight - chat.scrollHeight;
}

let scrollTicking = false;
chat.addEventListener("scroll", () => {
  if (scrollTicking || printMode) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    if (chat.scrollTop < 180) loadOlderMessages();
    if (chat.scrollHeight - chat.clientHeight - chat.scrollTop < 180) loadNewerMessages();
    scrollTicking = false;
  });
});

function jumpToIndex(index, options = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= CHAT_MESSAGES.length) return;
  if (index >= renderStart && index < renderEnd) {
    scrollToRenderedIndex(index, options.query || "", options.dateHighlight || false);
    return;
  }
  const half = Math.floor(INITIAL_MESSAGES / 2);
  let start = Math.max(0, index - half);
  let end = Math.min(CHAT_MESSAGES.length, start + INITIAL_MESSAGES);
  start = Math.max(0, end - INITIAL_MESSAGES);
  renderWindow(start, end, {targetIndex: index, query: options.query || "", dateHighlight: options.dateHighlight || false});
}

function scrollToRenderedIndex(index, query = "", dateHighlight = false) {
  clearHighlights();
  const entry = chat.querySelector(`.chat-entry[data-message-index="${index}"]`);
  if (!entry) return;
  entry.scrollIntoView({behavior: "smooth", block: "center"});
  const bubble = entry.querySelector(".message, .system-message");
  if (bubble) bubble.classList.add("active-match");
  if (query) highlightText(entry, query);
  if (dateHighlight) {
    const divider = entry.querySelector(".date-divider") || entry.previousElementSibling?.querySelector(".date-divider");
    if (divider) {
      divider.classList.add("date-highlight");
      setTimeout(() => divider.classList.remove("date-highlight"), 1700);
    }
  }
}

function clearHighlights() {
  chat.querySelectorAll(".active-match").forEach(element => element.classList.remove("active-match"));
  chat.querySelectorAll(".message-text").forEach(text => {
    if (text.dataset.original) text.textContent = text.dataset.original;
  });
}

function highlightText(entry, query) {
  const text = entry.querySelector(".message-text");
  if (!text || !text.dataset.original) return;
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  text.innerHTML = text.dataset.original.replace(new RegExp(safe, "gi"), match => `<mark>${match}</mark>`);
}

const menuButton = $("menuButton");
const menuPanel = $("menuPanel");
const toolPanel = $("toolPanel");
const searchTools = $("searchTools");
const dateTools = $("dateTools");
const messageMenu = $("messageMenu");

menuButton.onclick = event => {
  event.stopPropagation();
  menuPanel.hidden = !menuPanel.hidden;
};

document.addEventListener("click", event => {
  if (!menuPanel.contains(event.target) && event.target !== menuButton) menuPanel.hidden = true;
  if (!messageMenu.contains(event.target) && !event.target.closest(".message")) messageMenu.hidden = true;
});

menuPanel.onclick = event => {
  const action = event.target.dataset.action;
  if (!action) return;
  menuPanel.hidden = true;
  if (action === "search") openOnlyTool("search");
  if (action === "date") openOnlyTool("date");
  if (action === "starred") openStarred();
  if (action === "theme") {
    document.body.classList.toggle("dark");
    localStorage.setItem("viewer-theme", document.body.classList.contains("dark") ? "dark" : "light");
  }
  if (action === "print") prepareFullPrint();
  if (action === "logout") location.reload();
};

function openOnlyTool(tool) {
  toolPanel.hidden = false;
  searchTools.hidden = tool !== "search";
  dateTools.hidden = tool !== "date";
  if (tool === "search") $("searchInput").focus();
}

function closeTools() {
  toolPanel.hidden = true;
  searchTools.hidden = true;
  dateTools.hidden = true;
  $("searchInput").value = "";
  $("searchCount").textContent = "";
  searchMatches = [];
  currentSearchMatch = -1;
  clearHighlights();
}

$("closeSearch").onclick = closeTools;
$("closeDate").onclick = closeTools;

$("searchInput").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 180);
};

function runSearch() {
  const query = $("searchInput").value.trim().toLowerCase();
  searchMatches = [];
  currentSearchMatch = -1;
  if (!query) {
    $("searchCount").textContent = "";
    clearHighlights();
    return;
  }
  for (let index = 0; index < searchTexts.length; index += 1) {
    if (searchTexts[index].includes(query)) searchMatches.push(index);
  }
  if (searchMatches.length) {
    currentSearchMatch = 0;
    focusSearchMatch();
  } else {
    $("searchCount").textContent = "0/0";
  }
}

function focusSearchMatch() {
  if (!searchMatches.length) return;
  const query = $("searchInput").value.trim();
  $("searchCount").textContent = `${currentSearchMatch + 1}/${searchMatches.length}`;
  jumpToIndex(searchMatches[currentSearchMatch], {query});
}

$("nextResult").onclick = () => {
  if (!searchMatches.length) return;
  currentSearchMatch = (currentSearchMatch + 1) % searchMatches.length;
  focusSearchMatch();
};

$("prevResult").onclick = () => {
  if (!searchMatches.length) return;
  currentSearchMatch = (currentSearchMatch - 1 + searchMatches.length) % searchMatches.length;
  focusSearchMatch();
};

$("goDate").onclick = () => {
  const selected = $("datePicker").value;
  const index = dateToIndex.get(selected);
  if (Number.isInteger(index)) jumpToIndex(index, {dateHighlight: true});
};

function storageKey() {
  return `starred-${CHAT_CONFIG.storageNamespace}`;
}

function loadStarred() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey()) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveStarred() {
  localStorage.setItem(storageKey(), JSON.stringify([...starredIds]));
}

function openMessageMenu(id, event) {
  selectedMessageId = id;
  $("toggleStarMessage").textContent = starredIds.has(id) ? "★ Quitar de destacados" : "☆ Destacar";
  const shell = document.querySelector(".phone-shell").getBoundingClientRect();
  messageMenu.style.left = `${Math.max(8, Math.min(event.clientX - shell.left, shell.width - 190))}px`;
  messageMenu.style.top = `${Math.max(66, Math.min(event.clientY - shell.top, shell.height - 70))}px`;
  messageMenu.hidden = false;
}

function updateStarIndicator(messageId) {
  const bubble = chat.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (!bubble) return;
  const meta = bubble.querySelector(".meta");
  if (!meta) return;
  const current = meta.querySelector(".star-indicator");
  if (starredIds.has(messageId) && !current) meta.prepend(createStarIndicator());
  if (!starredIds.has(messageId) && current) current.remove();
}

$("toggleStarMessage").onclick = () => {
  const id = selectedMessageId;
  if (!id) return;
  if (starredIds.has(id)) starredIds.delete(id); else starredIds.add(id);
  saveStarred();
  updateStarIndicator(id);
  messageMenu.hidden = true;
  selectedMessageId = null;
};

function openStarred() {
  closeTools();
  renderStarred();
  $("starredPanel").hidden = false;
}

function renderStarred() {
  const list = $("starredList");
  list.innerHTML = "";
  const indexes = [...starredIds]
    .map(id => idToIndex.get(id))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
  $("starredCount").textContent = `${indexes.length} ${indexes.length === 1 ? "mensaje" : "mensajes"}`;
  if (!indexes.length) {
    const empty = document.createElement("div");
    empty.className = "starred-empty";
    empty.textContent = "Aún no hay mensajes destacados.";
    list.appendChild(empty);
    return;
  }
  for (const index of indexes) {
    const item = CHAT_MESSAGES[index];
    const button = document.createElement("button");
    button.className = "starred-item";
    button.innerHTML = `<span class="starred-item-date">${item.displayDate} · ${item.time}</span><span>${escapeHtml(item.caption || item.text || item.fileName || "Multimedia")}</span>`;
    button.onclick = () => {
      $("starredPanel").hidden = true;
      jumpToIndex(index);
    };
    list.appendChild(button);
  }
}

$("closeStarred").onclick = () => $("starredPanel").hidden = true;
$("exportStarred").onclick = () => {
  const blob = new Blob([JSON.stringify({messageIds: [...starredIds]}, null, 2)], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "mensajes-destacados.json";
  link.click();
  URL.revokeObjectURL(url);
};
$("importStarredButton").onclick = () => $("importStarredInput").click();
$("importStarredInput").onchange = async () => {
  try {
    const file = $("importStarredInput").files[0];
    if (!file) return;
    const payload = JSON.parse(await file.text());
    starredIds = new Set((payload.messageIds || []).filter(id => idToIndex.has(id)));
    saveStarred();
    chat.querySelectorAll("[data-message-id]").forEach(element => updateStarIndicator(element.dataset.messageId));
    renderStarred();
  } catch {
    alert("Archivo de destacados inválido.");
  } finally {
    $("importStarredInput").value = "";
  }
};

function getCurrentAnchor() {
  const chatTop = chat.getBoundingClientRect().top;
  for (const entry of chat.querySelectorAll(".chat-entry")) {
    if (entry.getBoundingClientRect().bottom >= chatTop) {
      return Number(entry.dataset.messageIndex);
    }
  }
  return renderEnd - 1;
}

async function prepareFullPrint() {
  if (printMode) return;
  printMode = true;
  const anchor = getCurrentAnchor();
  const overlay = createProgressOverlay();
  cleanupAllEntries();
  chat.innerHTML = "";
  const printImages = [];
  let fragment = document.createDocumentFragment();

  for (let index = 0; index < CHAT_MESSAGES.length; index += 1) {
    const entry = createEntry(index, {print: true});
    fragment.appendChild(entry);
    const placeholder = entry.querySelector(".lazy-media");
    if (placeholder) printImages.push(placeholder);
    if ((index + 1) % 500 === 0) {
      chat.appendChild(fragment);
      fragment = document.createDocumentFragment();
      updateProgress(overlay, `Preparando mensajes ${index + 1}/${CHAT_MESSAGES.length}`);
      await nextFrame();
    }
  }
  chat.appendChild(fragment);

  for (let index = 0; index < printImages.length; index += 1) {
    await loadImagePlaceholder(printImages[index]);
    if ((index + 1) % 10 === 0) {
      updateProgress(overlay, `Preparando imágenes ${index + 1}/${printImages.length}`);
      await nextFrame();
    }
  }

  updateProgress(overlay, "Abriendo impresión…");
  overlay.remove();
  const restore = () => {
    window.removeEventListener("afterprint", restore);
    printMode = false;
    jumpToIndex(anchor);
  };
  window.addEventListener("afterprint", restore);
  window.print();
}

function createProgressOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "progress-overlay";
  overlay.innerHTML = '<div class="progress-card"><span class="media-spinner"></span><strong>Preparando conversación…</strong><span class="progress-copy"></span></div>';
  document.body.appendChild(overlay);
  return overlay;
}

function updateProgress(overlay, text) {
  const copy = overlay.querySelector(".progress-copy");
  if (copy) copy.textContent = text;
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

window.addEventListener("beforeunload", () => {
  for (const url of objectUrls) URL.revokeObjectURL(url);
});

if (localStorage.getItem("viewer-theme") === "dark") document.body.classList.add("dark");
