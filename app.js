const DB_NAME = "loopwise";
const DB_VERSION = 1;
const DEFAULT_PUSH_SERVER = deriveDefaultPushServer();

const state = {
  db: null,
  activeSession: null,
  lessons: [],
  settings: {
    pushServerUrl: DEFAULT_PUSH_SERVER
  },
  reminderKey: "",
  reflectionKey: ""
};

const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  activeSessionPanel: document.querySelector("#activeSessionPanel"),
  startPanel: document.querySelector("#startPanel"),
  reflectionPanel: document.querySelector("#reflectionPanel"),
  endPanel: document.querySelector("#endPanel"),
  activeFocus: document.querySelector("#activeFocus"),
  activeAdjustment: document.querySelector("#activeAdjustment"),
  sessionForm: document.querySelector("#sessionForm"),
  reflectionForm: document.querySelector("#reflectionForm"),
  lessonForm: document.querySelector("#lessonForm"),
  lessonList: document.querySelector("#lessonList"),
  endSessionButton: document.querySelector("#endSessionButton"),
  reflectNowButton: document.querySelector("#reflectNowButton"),
  remindNowButton: document.querySelector("#remindNowButton"),
  enablePushButton: document.querySelector("#enablePushButton"),
  testPushButton: document.querySelector("#testPushButton"),
  pushServerInput: document.querySelector("#pushServerInput"),
  pushStatus: document.querySelector("#pushStatus"),
  pageButtons: document.querySelectorAll("[data-page-button]"),
  pages: document.querySelectorAll("[data-page]"),
  toast: document.querySelector("#toast")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  state.db = await openDb();
  await registerServiceWorker();
  state.settings = { ...state.settings, ...(await getSetting("settings")) };
  if (!state.settings.pushServerUrl) {
    state.settings.pushServerUrl = DEFAULT_PUSH_SERVER;
  }
  els.pushServerInput.value = state.settings.pushServerUrl || "";
  state.activeSession = await getActiveSession();
  state.lessons = await getAll("lessons");
  render();
  bindEvents();
  scheduleTick();
  updateConnectionStatus();
  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);
}

function bindEvents() {
  els.sessionForm.addEventListener("submit", startSession);
  els.reflectionForm.addEventListener("submit", saveReflection);
  els.lessonForm.addEventListener("submit", saveLesson);
  els.endSessionButton.addEventListener("click", () => {
    els.endPanel.hidden = false;
    els.endPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  els.reflectNowButton.addEventListener("click", showReflection);
  els.remindNowButton.addEventListener("click", () => notify("reminder"));
  els.enablePushButton.addEventListener("click", enablePush);
  els.testPushButton.addEventListener("click", sendTestPush);
  els.pushServerInput.addEventListener("change", savePushServer);
  els.pageButtons.forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.pageButton));
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("reflections")) {
        db.createObjectStore("reflections", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("lessons")) {
        db.createObjectStore("lessons", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(storeName, mode = "readonly") {
  return state.db.transaction(storeName, mode).objectStore(storeName);
}

function put(storeName, value) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").put(value);
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function getSetting(key) {
  return new Promise((resolve, reject) => {
    const request = tx("settings").get(key);
    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => reject(request.error);
  });
}

async function setSetting(key, value) {
  await put("settings", { key, value });
}

async function getActiveSession() {
  const sessions = await getAll("sessions");
  return sessions
    .filter((session) => !session.endedAt)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] || null;
}

async function startSession(event) {
  event.preventDefault();
  const session = {
    id: crypto.randomUUID(),
    focus: document.querySelector("#focusInput").value.trim(),
    reminderMinute: clampMinute(document.querySelector("#reminderMinute").value),
    reflectionMinute: clampMinute(document.querySelector("#reflectionMinute").value),
    lastAdjustment: "",
    startedAt: new Date().toISOString(),
    endedAt: ""
  };

  await put("sessions", session);
  state.activeSession = session;
  els.sessionForm.reset();
  document.querySelector("#reminderMinute").value = session.reminderMinute;
  document.querySelector("#reflectionMinute").value = session.reflectionMinute;
  render();
  showPage("session");
  await syncPushSchedule();
  toast("Session startad.");
}

async function saveReflection(event) {
  event.preventDefault();
  if (!state.activeSession) return;

  const reflection = {
    id: crypto.randomUUID(),
    sessionId: state.activeSession.id,
    worked: document.querySelector("#workedInput").value.trim(),
    different: document.querySelector("#differentInput").value.trim(),
    createdAt: new Date().toISOString()
  };

  state.activeSession.lastAdjustment = reflection.different;
  await put("reflections", reflection);
  await put("sessions", state.activeSession);
  els.reflectionForm.reset();
  els.reflectionPanel.hidden = true;
  render();
  await syncPushSchedule();
  toast("Lärdomen är sparad.");
}

async function saveLesson(event) {
  event.preventDefault();
  if (!state.activeSession) return;

  const lesson = {
    id: crypto.randomUUID(),
    sessionId: state.activeSession.id,
    focus: state.activeSession.focus,
    lesson: document.querySelector("#lessonInput").value.trim(),
    createdAt: new Date().toISOString()
  };

  state.activeSession.endedAt = new Date().toISOString();
  await put("lessons", lesson);
  await put("sessions", state.activeSession);
  state.lessons = await getAll("lessons");
  state.activeSession = null;
  els.lessonForm.reset();
  els.endPanel.hidden = true;
  render();
  showPage("archive");
  await syncPushSchedule();
  toast("Lärdomen är sparad.");
}

function render() {
  const hasSession = Boolean(state.activeSession);
  els.activeSessionPanel.hidden = !hasSession;
  els.startPanel.hidden = hasSession;
  els.endSessionButton.hidden = !hasSession;
  els.reflectionPanel.hidden = true;

  if (hasSession) {
    els.activeFocus.textContent = state.activeSession.focus;
    els.activeAdjustment.textContent = state.activeSession.lastAdjustment || "Ingen lärdom än.";
  }

  const lessons = [...state.lessons].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  els.lessonList.innerHTML = lessons.length
    ? lessons.map(renderLesson).join("")
    : "<li><time>Ingen lärdom sparad än</time><span>Avsluta en session för att bygga arkivet.</span></li>";

  els.pushStatus.textContent = getPushStatusText();
}

function renderLesson(lesson) {
  const date = new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(lesson.createdAt));

  return `<li><time>${escapeHtml(date)}</time><span>${escapeHtml(lesson.lesson)}</span></li>`;
}

function showReflection() {
  if (!state.activeSession) return;
  els.reflectionPanel.hidden = false;
  els.reflectionPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#workedInput").focus();
}

function scheduleTick() {
  window.setInterval(checkSchedule, 20 * 1000);
  checkSchedule();
}

function checkSchedule() {
  if (!state.activeSession) return;
  const now = new Date();
  const minute = now.getMinutes();
  const hourKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;

  if (minute === Number(state.activeSession.reminderMinute) && state.reminderKey !== hourKey) {
    state.reminderKey = hourKey;
    notify("reminder");
  }

  if (minute === Number(state.activeSession.reflectionMinute) && state.reflectionKey !== hourKey) {
    state.reflectionKey = hourKey;
    notify("reflection");
    showReflection();
  }
}

async function notify(type) {
  if (!("Notification" in window)) {
    toast("Den här webbläsaren stöder inte notiser.");
    return;
  }

  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }

  if (Notification.permission !== "granted") {
    toast("Notiser är inte tillåtna.");
    return;
  }

  const registration = await navigator.serviceWorker?.ready;
  if (!registration || !state.activeSession) return;

  const title = "Loopwise";
  const body = type === "reflection"
    ? "Vad fungerade bra?\n\nVad kan du göra annorlunda nästa gång?"
    : `${state.activeSession.focus}\n\n${state.activeSession.lastAdjustment || "Ingen senaste lärdom än."}`;

  await registration.showNotification(title, {
    body,
    tag: `loopwise-${type}`,
    icon: "assets/icon-192.png",
    badge: "assets/icon-192.png",
    data: { type }
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("sw.js");
  } catch (error) {
    console.warn("Service worker kunde inte registreras.", error);
  }
}

async function savePushServer() {
  state.settings.pushServerUrl = els.pushServerInput.value.trim().replace(/\/$/, "");
  await setSetting("settings", state.settings);
  render();
}

async function enablePush() {
  try {
    await savePushServer();
    const serverUrl = state.settings.pushServerUrl;
    if (!serverUrl) {
      toast("Ange pushserver först.");
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast("Web Push stöds inte i den här webbläsaren.");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toast("Push kräver att notiser tillåts.");
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const vapidResponse = await fetch(`${serverUrl}/vapid-public-key`);
    if (!vapidResponse.ok) throw new Error("Kunde inte hämta VAPID-nyckel.");
    const { publicKey } = await vapidResponse.json();

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await fetchJson(`${serverUrl}/subscribe`, {
      subscription,
      schedule: buildSchedulePayload()
    });
    await setSetting("pushSubscription", subscription.toJSON());
    render();
    toast("Push är aktiverat.");
  } catch (error) {
    console.warn("Push kunde inte aktiveras.", error);
    toast("Kunde inte aktivera push. Kontrollera serveradressen.");
  }
}

async function sendTestPush() {
  try {
    await savePushServer();
    if (!state.settings.pushServerUrl) {
      toast("Ange pushserver först.");
      return;
    }
    await fetchJson(`${state.settings.pushServerUrl}/push/test`, buildSchedulePayload());
    toast("Testpush skickad.");
  } catch (error) {
    console.warn("Testpush misslyckades.", error);
    toast("Kunde inte skicka testpush.");
  }
}

async function syncPushSchedule() {
  const serverUrl = state.settings.pushServerUrl;
  const subscription = await getSetting("pushSubscription");
  if (!serverUrl || !subscription) return;
  try {
    await fetchJson(`${serverUrl}/schedule`, {
      subscription,
      schedule: buildSchedulePayload()
    });
  } catch (error) {
    console.warn("Kunde inte synka pushschema.", error);
  }
}

function buildSchedulePayload() {
  return {
    active: Boolean(state.activeSession),
    focus: state.activeSession?.focus || "",
    lastAdjustment: state.activeSession?.lastAdjustment || "",
    reminderMinute: state.activeSession?.reminderMinute ?? null,
    reflectionMinute: state.activeSession?.reflectionMinute ?? null
  };
}

async function fetchJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function getPushStatusText() {
  if (!state.settings.pushServerUrl) return "Ange en HTTPS-adress till pushservern.";
  return `Pushserver: ${state.settings.pushServerUrl}`;
}

function updateConnectionStatus() {
  els.connectionStatus.textContent = navigator.onLine ? "Online" : "Offline";
}

function showPage(pageName) {
  els.pages.forEach((page) => {
    page.hidden = page.dataset.page !== pageName;
    page.classList.toggle("active", page.dataset.page === pageName);
  });
  els.pageButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.pageButton === pageName);
  });
}

function clampMinute(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.min(59, parsed));
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function deriveDefaultPushServer() {
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const firstSegment = pathParts.length ? `/${pathParts[0]}` : "";
  return `${window.location.origin}${firstSegment}`;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  window.setTimeout(() => els.toast.classList.remove("visible"), 2600);
}
