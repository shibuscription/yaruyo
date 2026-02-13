import {
  auth,
  cancelPlan,
  createFamily,
  declarePlan,
  ensureAnonymousAuth,
  getFamily,
  getMyUser,
  getPlanById,
  joinFamilyByCode,
  closeFamily as closeFamilyCallable,
  leaveFamily,
  listFamilyMembers,
  listInviteCodes,
  listOpenPlansPage,
  listPlans,
  listRecordsPage,
  listRecords,
  recordPlan,
  signInWithLineIdToken,
  signInWithLineIdTokenHttp,
  subscribeMyUser,
  updateFamilyName,
  updateMySettings,
  upsertMyLineProfile,
  waitAuth,
  writeDebugLog,
} from "./api.js";
import { state } from "./state.js";
import {
  SUBJECT_PACKS,
  getPackById,
  getPackEntries,
  getSubjectLabel,
  resolveEnabledSubjects,
} from "./subjects.js";

function normalizeLiffUrl() {
  const { pathname, search, hash } = window.location;
  if (pathname === "/liff" || pathname === "/liff/") {
    window.location.replace(`/liff/index.html${search}${hash}`);
    return false;
  }
  return true;
}

const shouldBoot = normalizeLiffUrl();
const root = document.getElementById("app-root");
const params = new URLSearchParams(location.search);
const rawView = params.get("view");
const mappedView = rawView === "yaruyo" ? "declare" : rawView;
const view = ["declare", "record", "stats", "settings", "plans", "subjects"].includes(mappedView) ? mappedView : null;
const SETTINGS_DEBUG = params.get("debug") === "1";
const DEBUG_QUERY_ENABLED = params.get("debug") === "1";
const DEBUG_UIDS = [
  // Add allowed production debug UIDs here.
  "Ufc376e023c7898e1d19b620f79cdf54c", // Example UID
];
const DEBUG_HUD_COLLAPSED_KEY = "yaruyo_debug_hud_collapsed";
const LIFF_ID = "2009111070-71hr5ID2";
const ENABLE_DEBUG = false;
const ENABLE_DEBUG_LOG_UPLOAD = false;
let buildIdText = "unknown";
let buildIdBadgeEl = null;
let debugHudEl = null;
let debugHudWatchdog = null;
let debugHudNetworkBound = false;
let preDebugHudEl = null;
let preDebugHudTicker = null;
let preDebugHudBound = false;

const prodDebug = {
  requested: DEBUG_QUERY_ENABLED,
  enabled: false,
  uid: null,
  familyId: null,
  tasks: new Map(),
  logs: [],
  lastSuccessApi: null,
  lastError: null,
  warning: null,
  collapsed: false,
};

function getHashParam(key) {
  const raw = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  const hashParams = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  return hashParams.get(key);
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const rawLiffState = ENABLE_DEBUG ? params.get("liff.state") ?? getHashParam("liff.state") : "";
const decodedLiffState = ENABLE_DEBUG && rawLiffState ? safeDecodeURIComponent(rawLiffState) : "";
const debugFromSearch = ENABLE_DEBUG && params.get("debug") === "1";
const debugFromHash = ENABLE_DEBUG && (getHashParam("debug") === "1" || location.hash.includes("debug=1"));
const debugFromLiffState =
  ENABLE_DEBUG &&
  (decodedLiffState.includes("debug=1") || (rawLiffState ? rawLiffState.includes("debug%3D1") : false));
let debugEnabled = ENABLE_DEBUG && (debugFromSearch || debugFromHash || debugFromLiffState);
const debugVersion = ENABLE_DEBUG ? (params.get("v") ?? getHashParam("v") ?? "") : "";

const UI = {
  declareTitle: "やるよ",
  declareSubmit: "やるよ！",
  recordTitle: "やったよ",
  recordSubmit: "やったよ！",
  statsTitle: "過去のやったよ",
  labelWhen: "いつから",
  labelWhat: "なにを",
  labelHowMuch: "どのくらい",
  hiddenTypeLabel: "種類",
  doneAt: "完了時刻",
  subject: "教科",
  startAt: "開始時刻",
  amount: "分量",
  memo: "メモ",
  sectionRecord: "やったよ",
  sectionPlan: "やるよ",
  placeholder: "—",
  subjectCustomizeTitle: "教科のカスタマイズ",
};

let currentPanel = null;
let liffProfile = null;
let unsubscribeUser = null;
let settingsModalState = null;
let familyModalState = null;
let webMode = false;
let debugPanelEl = null;
let avatarErrorHandlerRegistered = false;
let confirmModalOpen = false;
const globalState = window;
let currentBootPhase = "BOOT";
let loadingBannerEl = null;
let loadingBannerTimer = null;
let loadingBannerStartedAtMs = 0;
let globalErrorHandlersRegistered = false;
let preDebugStartedAtMs = 0;
let preDebugLastError = null;
let preDebugStep = "-";

function extractErrorMeta(error) {
  if (error instanceof Error) {
    return {
      message: error.message || String(error),
      stack: error.stack || "(no stack)",
    };
  }
  if (typeof error === "object" && error && "message" in error) {
    return {
      message: String(error.message),
      stack: typeof error.stack === "string" ? error.stack : "(no stack)",
    };
  }
  return {
    message: String(error),
    stack: "(no stack)",
  };
}

function phaseLog(phase, detail = undefined) {
  currentBootPhase = phase;
  if (detail !== undefined) console.info(`[BOOT] ${phase}`, detail);
  else console.info(`[BOOT] ${phase}`);
  renderPreDebugHud();
  if (prodDebug.enabled) {
    debugLog("phase", phase, detail ?? null);
  }
}

function ensureBuildIdBadge() {
  if (buildIdBadgeEl) {
    buildIdBadgeEl.textContent = `build: ${buildIdText || "unknown"}`;
    return;
  }
  buildIdBadgeEl = el(`<div class="build-id-badge"></div>`);
  buildIdBadgeEl.textContent = `build: ${buildIdText || "unknown"}`;
  document.body.appendChild(buildIdBadgeEl);
}

function toShortErrorMessage(error) {
  const raw = extractErrorMeta(error).message || "unknown";
  return raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
}

function ensurePreDebugHud() {
  if (!DEBUG_QUERY_ENABLED) return;
  if (preDebugHudEl) return;
  preDebugStartedAtMs = Date.now();
  preDebugHudEl = el(`
    <aside class="pre-debug-hud">
      <div class="pre-debug-title">Pre-Debug</div>
      <div id="pre-debug-body" class="pre-debug-body"></div>
    </aside>
  `);
  document.body.appendChild(preDebugHudEl);
  if (!preDebugHudTicker) {
    preDebugHudTicker = setInterval(() => {
      renderPreDebugHud();
    }, 1000);
  }
  if (!preDebugHudBound) {
    preDebugHudBound = true;
    window.addEventListener("online", renderPreDebugHud);
    window.addEventListener("offline", renderPreDebugHud);
  }
  renderPreDebugHud();
}

function stopPreDebugHud() {
  if (preDebugHudTicker) {
    clearInterval(preDebugHudTicker);
    preDebugHudTicker = null;
  }
  if (preDebugHudEl) {
    preDebugHudEl.remove();
    preDebugHudEl = null;
  }
}

function setPreDebugError(error) {
  if (!DEBUG_QUERY_ENABLED) return;
  preDebugLastError = toShortErrorMessage(error);
  renderPreDebugHud();
}

function setPreDebugStep(step) {
  if (!DEBUG_QUERY_ENABLED) return;
  preDebugStep = step;
  renderPreDebugHud();
}

function renderPreDebugHud() {
  if (!DEBUG_QUERY_ENABLED || !preDebugHudEl || prodDebug.enabled) return;
  const body = preDebugHudEl.querySelector("#pre-debug-body");
  if (!body) return;
  const elapsedSec = preDebugStartedAtMs ? Math.max(0, Math.floor((Date.now() - preDebugStartedAtMs) / 1000)) : 0;
  body.innerHTML = [
    `elapsed: ${elapsedSec}s`,
    `phase: ${escapeHtml(currentBootPhase)}`,
    `step: ${escapeHtml(preDebugStep)}`,
    `net: ${navigator.onLine ? "online" : "offline"}`,
    `lastError: ${escapeHtml(preDebugLastError ?? "-")}`,
  ].join("<br>");
}

function withDebugTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(`timeout: ${label}`);
        if (DEBUG_QUERY_ENABLED) {
          setPreDebugError(error);
          console.warn(`[DEBUG_TIMEOUT] ${label}`, { ms });
        }
        reject(error);
      }, ms);
    }),
  ]);
}

async function callSignInWithRetry(idToken) {
  const appId = LIFF_ID.split("-")[0];
  try {
    return await withDebugTimeout(signInWithLineIdToken(idToken, appId), 15000, "signInWithLineIdToken");
  } catch (err) {
    const msg = err?.message ?? "";
    if (typeof msg === "string" && msg.includes("timeout")) {
      if (DEBUG_QUERY_ENABLED) {
        console.warn("[RETRY] signInWithLineIdToken retrying once...");
      }
      setPreDebugStep("auth:fallback:http:start");
      try {
        const result = await signInWithLineIdTokenHttp(idToken, appId, 15000);
        setPreDebugStep("auth:fallback:http:end");
        return result;
      } catch (httpErr) {
        setPreDebugStep("auth:fallback:http:error");
        throw httpErr;
      }
    }
    throw err;
  }
}

async function loadBuildId() {
  try {
    const mod = await import("./buildId.js");
    if (typeof mod?.BUILD_ID === "string" && mod.BUILD_ID.trim()) {
      buildIdText = mod.BUILD_ID.trim();
    }
  } catch {
    buildIdText = "unknown";
  }
  ensureBuildIdBadge();
  if (prodDebug.enabled) renderDebugHud();
}

async function uploadDebugLogIfEnabled(type, payload = {}) {
  if (!ENABLE_DEBUG_LOG_UPLOAD) return;
  try {
    const uid = auth?.currentUser?.uid ?? "unknown";
    await writeDebugLog(uid, {
      type,
      phase: currentBootPhase,
      href: location.href,
      payload,
    });
  } catch (error) {
    console.warn("debug log upload failed", error);
  }
}

function showLoadingBanner() {
  if (loadingBannerTimer) {
    clearInterval(loadingBannerTimer);
    loadingBannerTimer = null;
  }
  if (!root) return;
  if (!loadingBannerEl) {
    loadingBannerStartedAtMs = Date.now();
    loadingBannerEl = el(`
      <div id="boot-loading-banner" style="margin:8px 0;padding:12px 14px;border-radius:12px;background:#f8f6ef;color:#31423b;border:1px solid #e7dfd0;">
        <div style="font-weight:700;">読み込み中… 少々お待ちください</div>
        <div id="boot-loading-slow" style="margin-top:6px;font-size:13px;color:#6b746f;display:none;">読み込みに時間がかかっています…</div>
        <div id="boot-loading-reopen" style="margin-top:4px;font-size:13px;color:#6b746f;display:none;">一度閉じて開き直してください</div>
      </div>
    `);
    root.prepend(loadingBannerEl);
  }
  const slowEl = loadingBannerEl.querySelector("#boot-loading-slow");
  const reopenEl = loadingBannerEl.querySelector("#boot-loading-reopen");
  loadingBannerTimer = setInterval(() => {
    if (!loadingBannerEl) return;
    const elapsedSec = Math.floor((Date.now() - loadingBannerStartedAtMs) / 1000);
    if (slowEl) slowEl.style.display = elapsedSec >= 5 ? "block" : "none";
    if (reopenEl) reopenEl.style.display = elapsedSec >= 10 ? "block" : "none";
  }, 500);
}

function hideLoadingBanner() {
  if (loadingBannerTimer) {
    clearInterval(loadingBannerTimer);
    loadingBannerTimer = null;
  }
  if (!loadingBannerEl) return;
  loadingBannerEl.remove();
  loadingBannerEl = null;
  loadingBannerStartedAtMs = 0;
}

function renderFatalErrorPanel(phase, error) {
  if (!root) return;
  const { message, stack } = extractErrorMeta(error);
  const stackHtml = stack ? `<pre style="white-space:pre-wrap;word-break:break-word;margin:8px 0 0;">${escapeHtml(stack)}</pre>` : "";
  root.innerHTML = `
    <div class="card" style="border:1px solid #ef4444;background:#fef2f2;color:#991b1b;">
      <h3 style="margin:0 0 8px;">初期化エラー</h3>
      <div><strong>phase:</strong> ${escapeHtml(phase)}</div>
      <div style="margin-top:6px;"><strong>message:</strong> ${escapeHtml(message)}</div>
      ${stackHtml}
    </div>
  `;
}

function registerGlobalErrorHandlers() {
  if (globalErrorHandlersRegistered) return;
  globalErrorHandlersRegistered = true;
  window.onerror = (message, source, lineno, colno, error) => {
    const err = error ?? new Error(`${message} (${source}:${lineno}:${colno})`);
    setPreDebugError(err);
    phaseLog("WINDOW_ERROR", { message: String(message), source, lineno, colno });
    console.error("[BOOT] window.onerror", err);
    renderFatalErrorPanel(currentBootPhase, err);
    uploadDebugLogIfEnabled("window.onerror", {
      message: String(message),
      source: source ?? null,
      lineno: lineno ?? null,
      colno: colno ?? null,
      stack: extractErrorMeta(err).stack,
    });
  };
  window.onunhandledrejection = (event) => {
    const reason = event?.reason ?? new Error("Unhandled rejection");
    setPreDebugError(reason);
    phaseLog("UNHANDLED_REJECTION", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
    console.error("[BOOT] window.onunhandledrejection", reason);
    renderFatalErrorPanel(currentBootPhase, reason);
    uploadDebugLogIfEnabled("unhandledrejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: extractErrorMeta(reason).stack,
    });
  };
}

const debugState = ENABLE_DEBUG
  ? {
  stage: "boot",
  liffInit: "pending",
  isInClient: "n/a",
  isLoggedIn: "n/a",
  context: null,
  os: "n/a",
  language: "n/a",
  version: "n/a",
  href: location.href,
  userAgent: navigator.userAgent,
  rawSearch: location.search || "(none)",
  rawHash: location.hash || "(none)",
  rawLiffState: rawLiffState ?? "(none)",
  decodedLiffState: decodedLiffState || "(none)",
  queryV: debugVersion || "(none)",
  errorMessage: null,
  errorStack: null,
  firebaseUser: null,
  firebaseClaims: null,
}
  : null;

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function debugAllowed(uid) {
  if (!prodDebug.requested) return false;
  return DEBUG_UIDS.includes(uid);
}

function loadDebugHudCollapsed() {
  if (!prodDebug.requested) return false;
  try {
    return localStorage.getItem(DEBUG_HUD_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveDebugHudCollapsed(collapsed) {
  if (!prodDebug.requested) return;
  try {
    localStorage.setItem(DEBUG_HUD_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // no-op
  }
}

function debugNowTime() {
  return new Date().toLocaleTimeString("ja-JP", { hour12: false });
}

function debugLog(category, message, meta = null) {
  if (!prodDebug.enabled) return;
  prodDebug.logs.unshift({
    at: debugNowTime(),
    category,
    message,
    meta,
  });
  prodDebug.logs = prodDebug.logs.slice(0, 10);
  renderDebugHud();
}

function activateProdDebug(uid) {
  if (!debugAllowed(uid)) return;
  if (prodDebug.enabled) return;
  stopPreDebugHud();
  prodDebug.enabled = true;
  prodDebug.uid = uid;
  prodDebug.collapsed = loadDebugHudCollapsed();
  ensureDebugHud();
  debugLog("debug", "prod debug enabled", { uid });
}

function ensureDebugHud() {
  if (!prodDebug.enabled) return;
  if (!debugHudEl) {
    debugHudEl = el(`
      <aside class="debug-hud">
        <div class="debug-hud-head">
          <strong>Debug HUD</strong>
          <button type="button" id="debug-hud-status" class="debug-hud-status-btn">OK</button>
        </div>
        <div class="debug-hud-meta" id="debug-hud-meta"></div>
        <div class="debug-hud-section">
          <div class="debug-hud-title">Tasks</div>
          <div id="debug-hud-tasks" class="debug-hud-list muted">none</div>
        </div>
        <div class="debug-hud-section">
          <div class="debug-hud-title">Logs</div>
          <div id="debug-hud-logs" class="debug-hud-list"></div>
        </div>
        <div class="debug-hud-actions">
          <button type="button" id="debug-hud-copy" class="secondary">Copy</button>
          <button type="button" id="debug-hud-clear" class="secondary">Clear</button>
        </div>
      </aside>
    `);
    document.body.appendChild(debugHudEl);
    debugHudEl.querySelector("#debug-hud-copy").addEventListener("click", async () => {
      const payload = JSON.stringify(
        {
          view,
          buildId: buildIdText,
          uid: prodDebug.uid,
          familyId: prodDebug.familyId,
          online: navigator.onLine,
          tasks: Array.from(prodDebug.tasks.values()),
          lastSuccessApi: prodDebug.lastSuccessApi,
          lastError: prodDebug.lastError,
          logs: prodDebug.logs,
        },
        null,
        2,
      );
      try {
        await copyTextToClipboard(payload);
        await showToast("debugログをコピーしました");
      } catch {
        await showToast("コピーに失敗しました");
      }
    });
    debugHudEl.querySelector("#debug-hud-clear").addEventListener("click", () => {
      prodDebug.logs = [];
      prodDebug.lastError = null;
      prodDebug.warning = null;
      renderDebugHud();
    });
    debugHudEl.querySelector("#debug-hud-status").addEventListener("click", () => {
      prodDebug.collapsed = !prodDebug.collapsed;
      saveDebugHudCollapsed(prodDebug.collapsed);
      renderDebugHud();
    });
  }
  if (!debugHudWatchdog) {
    debugHudWatchdog = setInterval(() => {
      if (!prodDebug.enabled) return;
      const stuck = Array.from(prodDebug.tasks.values()).find((task) => Date.now() - task.startedAtMs >= 15000);
      if (stuck) {
        prodDebug.warning = `task timeout: ${stuck.name} (${Math.round((Date.now() - stuck.startedAtMs) / 1000)}s)`;
      } else {
        prodDebug.warning = null;
      }
      renderDebugHud();
    }, 1000);
  }
  if (!debugHudNetworkBound) {
    debugHudNetworkBound = true;
    window.addEventListener("online", () => {
      debugLog("net", "online");
    });
    window.addEventListener("offline", () => {
      debugLog("net", "offline");
    });
  }
  renderDebugHud();
}

function renderDebugHud() {
  if (!prodDebug.enabled || !debugHudEl) return;
  const metaEl = debugHudEl.querySelector("#debug-hud-meta");
  const tasksEl = debugHudEl.querySelector("#debug-hud-tasks");
  const logsEl = debugHudEl.querySelector("#debug-hud-logs");
  const statusEl = debugHudEl.querySelector("#debug-hud-status");
  const pendingTaskCount = prodDebug.tasks.size;
  const currentView = new URLSearchParams(location.search).get("view") ?? "declare(tab)";
  metaEl.innerHTML = `
    view: ${escapeHtml(String(currentView))}<br>
    build: ${escapeHtml(buildIdText || "unknown")}<br>
    uid: ${escapeHtml(prodDebug.uid ?? "-")}<br>
    familyId: ${escapeHtml(prodDebug.familyId ?? "-")}<br>
    online: ${navigator.onLine ? "online" : "offline"}<br>
    lastSuccessApi: ${escapeHtml(prodDebug.lastSuccessApi ?? "-")}<br>
    lastError: ${escapeHtml(prodDebug.lastError?.message ?? "-")}
  `;
  const taskRows = Array.from(prodDebug.tasks.values()).map((task) => {
    const sec = ((Date.now() - task.startedAtMs) / 1000).toFixed(1);
    return `${task.name} (${sec}s)`;
  });
  tasksEl.innerHTML = taskRows.length ? taskRows.map((t) => `<div>${escapeHtml(t)}</div>`).join("") : "<div>none</div>";
  logsEl.innerHTML = prodDebug.logs
    .map((log) => `<div>[${escapeHtml(log.at)}] ${escapeHtml(log.category)}: ${escapeHtml(log.message)}</div>`)
    .join("");
  if (!prodDebug.logs.length) logsEl.innerHTML = "<div class='muted'>no logs</div>";
  if (prodDebug.warning) {
    debugHudEl.classList.add("warn");
    statusEl.textContent = "WARN";
    statusEl.title = prodDebug.warning;
  } else {
    debugHudEl.classList.remove("warn");
    statusEl.textContent = "OK";
    statusEl.title = "";
  }
  if (prodDebug.collapsed) {
    debugHudEl.classList.add("collapsed");
    statusEl.textContent = `${statusEl.textContent} (${pendingTaskCount})`;
  } else {
    debugHudEl.classList.remove("collapsed");
  }
}

function beginDebugTask(name, detail = null) {
  if (!prodDebug.enabled) return null;
  const id = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  prodDebug.tasks.set(id, { id, name, detail, startedAtMs: Date.now() });
  debugLog("task", `start:${name}`);
  return id;
}

function endDebugTask(id, { ok = true, detail = null, error = null } = {}) {
  if (!prodDebug.enabled || !id) return;
  const task = prodDebug.tasks.get(id);
  if (task) prodDebug.tasks.delete(id);
  if (ok) {
    if (task?.name) prodDebug.lastSuccessApi = task.name;
    debugLog("task", `done:${task?.name ?? id}`, detail);
  } else {
    const msg = error?.message ?? String(error ?? "unknown");
    prodDebug.lastError = { at: Date.now(), message: msg };
    debugLog("task", `error:${task?.name ?? id}`, { message: msg });
  }
}

async function traceAsync(name, fn) {
  const started = performance.now();
  const taskId = beginDebugTask(name);
  try {
    const result = await fn();
    endDebugTask(taskId, { ok: true, detail: { ms: Math.round(performance.now() - started) } });
    return result;
  } catch (error) {
    endDebugTask(taskId, { ok: false, error });
    throw error;
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function setDebugError(error) {
  if (!ENABLE_DEBUG || !debugState) return;
  if (error instanceof Error) {
    debugState.errorMessage = `${error.name}: ${error.message}`;
    debugState.errorStack = error.stack ?? null;
  } else {
    debugState.errorMessage = String(error);
    debugState.errorStack = null;
  }
  renderDebugPanel();
}

function clearDebugError() {
  if (!ENABLE_DEBUG || !debugState) return;
  debugState.errorMessage = null;
  debugState.errorStack = null;
  renderDebugPanel();
}

async function updateFirebaseAuthDebug(user) {
  if (!ENABLE_DEBUG || !debugState) return;
  if (!user) {
    debugState.firebaseUser = null;
    debugState.firebaseClaims = null;
    renderDebugPanel();
    return;
  }

  debugState.firebaseUser = {
    uid: user.uid ?? null,
    isAnonymous: user.isAnonymous ?? null,
    providerData: Array.isArray(user.providerData)
      ? user.providerData.map((p) => ({
          providerId: p.providerId ?? null,
          uid: p.uid ?? null,
        }))
      : [],
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    metadata: {
      creationTime: user.metadata?.creationTime ?? null,
      lastSignInTime: user.metadata?.lastSignInTime ?? null,
    },
  };

  try {
    const tokenResult = await user.getIdTokenResult();
    const claims = tokenResult?.claims ?? {};
    debugState.firebaseClaims = {
      sub: claims.sub ?? null,
      user_id: claims.user_id ?? null,
      lineUserId: claims.lineUserId ?? null,
      firebase: claims.firebase ?? null,
    };
  } catch (error) {
    debugState.firebaseClaims = { error: error instanceof Error ? error.message : String(error) };
  }

  renderDebugPanel();
}

function renderDebugPanel() {
  if (!ENABLE_DEBUG || !debugState || !debugEnabled) return;
  const app = document.querySelector(".app");
  if (!app) return;
  if (!debugPanelEl) {
    debugPanelEl = el(`<section id="debug-panel" class="debug-panel"></section>`);
    app.appendChild(debugPanelEl);
  }

  const liffOk = debugState.isInClient === true ? "LIFF OK ✅" : "LIFF NG";
  debugPanelEl.innerHTML = `
    <div class="debug-title">Debug Panel (${liffOk})</div>
    <pre class="debug-pre">${escapeHtml(
      [
        `stage: ${debugState.stage}`,
        `liffInit: ${debugState.liffInit}`,
        `liff.isInClient(): ${String(debugState.isInClient)}`,
        `liff.isLoggedIn(): ${String(debugState.isLoggedIn)}`,
        `liff.getOS(): ${String(debugState.os)}`,
        `liff.getLanguage(): ${String(debugState.language)}`,
        `liff.getVersion(): ${String(debugState.version)}`,
        `query.v: ${debugState.queryV}`,
        `raw location.search: ${debugState.rawSearch}`,
        `raw location.hash: ${debugState.rawHash}`,
        `raw liff.state: ${debugState.rawLiffState}`,
        `decoded liff.state: ${debugState.decodedLiffState}`,
        `location.href: ${debugState.href}`,
        `navigator.userAgent: ${debugState.userAgent}`,
        `liff.getContext(): ${safeJson(debugState.context)}`,
        `firebaseUser: ${safeJson(debugState.firebaseUser)}`,
        `firebaseClaims: ${safeJson(debugState.firebaseClaims)}`,
        `errorMessage: ${debugState.errorMessage ?? "(none)"}`,
        `errorStack: ${debugState.errorStack ?? "(none)"}`,
      ].join("\n"),
    )}</pre>
  `;
}

function collectLiffDebug(stage, collectLiffApi = false) {
  if (!ENABLE_DEBUG || !debugState) return;
  debugState.stage = stage;
  const liffApi = window.liff;
  if (!liffApi) {
    debugState.liffInit = "sdk-not-found";
    debugState.isInClient = false;
    debugState.isLoggedIn = false;
    renderDebugPanel();
    return;
  }

  if (!collectLiffApi) {
    renderDebugPanel();
    return;
  }

  try {
    debugState.isInClient = typeof liffApi.isInClient === "function" ? liffApi.isInClient() : "unsupported";
  } catch (error) {
    debugState.isInClient = "error";
    setDebugError(error);
  }
  try {
    debugState.isLoggedIn = typeof liffApi.isLoggedIn === "function" ? liffApi.isLoggedIn() : "unsupported";
  } catch (error) {
    debugState.isLoggedIn = "error";
    setDebugError(error);
  }
  try {
    debugState.context = typeof liffApi.getContext === "function" ? liffApi.getContext() : null;
    if (debugState.context && !debugEnabled) {
      debugEnabled = true;
    }
  } catch (error) {
    debugState.context = "error";
    setDebugError(error);
  }
  try {
    debugState.os = typeof liffApi.getOS === "function" ? liffApi.getOS() : "unsupported";
  } catch (error) {
    debugState.os = "error";
    setDebugError(error);
  }
  try {
    debugState.language = typeof liffApi.getLanguage === "function" ? liffApi.getLanguage() : "unsupported";
  } catch (error) {
    debugState.language = "error";
    setDebugError(error);
  }
  try {
    debugState.version = typeof liffApi.getVersion === "function" ? liffApi.getVersion() : "unsupported";
  } catch (error) {
    debugState.version = "error";
    setDebugError(error);
  }
  renderDebugPanel();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toDateMaybe(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object") {
    // joinedAt が Firestore Timestamp 互換({_seconds/_nanoseconds})で来るケースに未対応だと並びが効かない。
    if (typeof value.seconds === "number") {
      const nanos = typeof value.nanoseconds === "number" ? value.nanoseconds : 0;
      return new Date(value.seconds * 1000 + Math.floor(nanos / 1e6));
    }
    if (typeof value._seconds === "number") {
      const nanos = typeof value._nanoseconds === "number" ? value._nanoseconds : 0;
      return new Date(value._seconds * 1000 + Math.floor(nanos / 1e6));
    }
  }
  return null;
}

function sortMembersByJoinedAtAsc(members) {
  return members
    .map((member, index) => ({ member, index }))
    .sort((aWrap, bWrap) => {
      const a = aWrap.member;
      const b = bWrap.member;
      // joinedAt が欠けるケースでは createdAt を使い、最後は入力順で安定化して逆転を防ぐ。
      const at = toDateMaybe(a?.joinedAt)?.getTime() ?? toDateMaybe(a?.createdAt)?.getTime();
      const bt = toDateMaybe(b?.joinedAt)?.getTime() ?? toDateMaybe(b?.createdAt)?.getTime();
      const aKey = Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
      const bKey = Number.isFinite(bt) ? bt : Number.POSITIVE_INFINITY;
      if (aKey !== bKey) return aKey - bKey;
      if (aWrap.index !== bWrap.index) return aWrap.index - bWrap.index;
      return String(a?.userId ?? "").localeCompare(String(b?.userId ?? ""));
    })
    .map((wrapped) => wrapped.member);
}

function sortMembersByRoleThenJoinedAtAsc(members) {
  const roleRank = (role) => (role === "parent" ? 0 : role === "child" ? 1 : 2);
  return members
    .map((member, index) => ({ member, index }))
    .sort((aWrap, bWrap) => {
      const a = aWrap.member;
      const b = bWrap.member;
      const roleDiff = roleRank(a?.role) - roleRank(b?.role);
      if (roleDiff !== 0) return roleDiff;
      const at = toDateMaybe(a?.joinedAt)?.getTime() ?? toDateMaybe(a?.createdAt)?.getTime();
      const bt = toDateMaybe(b?.joinedAt)?.getTime() ?? toDateMaybe(b?.createdAt)?.getTime();
      const aKey = Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
      const bKey = Number.isFinite(bt) ? bt : Number.POSITIVE_INFINITY;
      if (aKey !== bKey) return aKey - bKey;
      if (aWrap.index !== bWrap.index) return aWrap.index - bWrap.index;
      return String(a?.userId ?? "").localeCompare(String(b?.userId ?? ""));
    })
    .map((wrapped) => wrapped.member);
}

function formatDateTime(value) {
  const d = toDateMaybe(value);
  if (!d) return UI.placeholder;
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}/${map.month}/${map.day} ${map.hour}:${map.minute}`;
}

function formatStartSlot(slot) {
  if (typeof slot !== "string" || !/^\d{12}$/.test(slot)) return UI.placeholder;
  return `${slot.slice(0, 4)}/${slot.slice(4, 6)}/${slot.slice(6, 8)} ${slot.slice(8, 10)}:${slot.slice(10, 12)}`;
}

function formatPlanStart(plan) {
  if (!plan) return UI.placeholder;
  if (plan.startAt) return formatDateTime(plan.startAt);
  if (plan.startSlot) return formatStartSlot(plan.startSlot);
  return UI.placeholder;
}

function formatStartSlotTime(slot) {
  if (typeof slot !== "string" || !/^\d{12}$/.test(slot)) return UI.placeholder;
  return `${slot.slice(8, 10)}:${slot.slice(10, 12)}`;
}

function normalizePackSelection(packId) {
  return getPackById(packId ?? state.me?.subjectPackId ?? "middle");
}

function getEffectiveSubjectConfig(user = state.me) {
  const pack = normalizePackSelection(user?.subjectPackId);
  const enabledSubjects = resolveEnabledSubjects({
    packId: pack.id,
    enabledSubjects: user?.enabledSubjects,
  });
  return {
    pack,
    entries: getPackEntries(pack.id),
    enabledSubjects,
  };
}

function subjectDisplay(code) {
  return getSubjectLabel(code);
}

function resultLabel(value) {
  if (value === "light") return "軽め";
  if (value === "as_planned") return "予定通り";
  if (value === "extra") return "多め";
  return value ?? UI.placeholder;
}

function getEffectiveDisplayName(user, fallbackUid, { allowLiffFallback = false } = {}) {
  const displayName = typeof user?.displayName === "string" ? user.displayName.trim() : "";
  if (displayName) return displayName;
  const appDisplayName = typeof user?.appDisplayName === "string" ? user.appDisplayName.trim() : "";
  if (appDisplayName) return appDisplayName;
  const lineDisplayName = typeof user?.lineDisplayName === "string" ? user.lineDisplayName.trim() : "";
  if (lineDisplayName) return lineDisplayName;
  if (allowLiffFallback) {
    const liffName = typeof liffProfile?.displayName === "string" ? liffProfile.displayName.trim() : "";
    if (liffName) return liffName;
  }
  return fallbackUid;
}

function getPictureUrl(user) {
  return typeof user?.pictureUrl === "string" && user.pictureUrl ? user.pictureUrl : null;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function avatarFallbackData(user, fallbackUid = "") {
  const uid = (user?.uid ?? user?.userId ?? fallbackUid ?? "").toString();
  const displayName = (getEffectiveDisplayName(user, uid) || "ユーザー").trim();
  const initial = displayName.slice(0, 1) || "U";
  const hue = hashString(uid || displayName) % 360;
  return {
    uid,
    initial,
    bg: `hsl(${hue}, 65%, 55%)`,
  };
}

function avatarHtml(user, alt = "avatar", fallbackUid = "") {
  const url = getPictureUrl(user);
  const fallback = avatarFallbackData(user, fallbackUid);
  if (url) {
    return `
      <span class="avatar has-image" style="--avatar-bg:${fallback.bg};" aria-label="${escapeHtml(alt)}">
        <span class="avatar-fallback-text" aria-hidden="true">${escapeHtml(fallback.initial)}</span>
        <img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" data-avatar-img="1" />
      </span>
    `;
  }
  return `
    <span class="avatar avatar-fallback-only" style="--avatar-bg:${fallback.bg};" aria-label="${escapeHtml(alt)}">
      <span class="avatar-fallback-text" aria-hidden="true">${escapeHtml(fallback.initial)}</span>
    </span>
  `;
}

function handleAvatarImageError(img) {
  if (!img || img.dataset.avatarErrorHandled === "1") return;
  img.dataset.avatarErrorHandled = "1";
  const host = img.closest(".avatar.has-image");
  if (host) host.classList.add("avatar-img-error");
  img.remove();
}

function ensureAvatarErrorHandler() {
  if (avatarErrorHandlerRegistered) return;
  avatarErrorHandlerRegistered = true;
  document.addEventListener(
    "error",
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      if (!img.matches("img[data-avatar-img]")) return;
      handleAvatarImageError(img);
    },
    true,
  );
}

function refreshHeaderView() {
  const header = root.querySelector(".profile-header");
  if (!header || !state.me?.uid) return;
  const avatar = header.querySelector(".header-avatar");
  const name = header.querySelector(".header-name");
  if (avatar) avatar.innerHTML = avatarHtml(state.me, "me");
  if (name) name.textContent = getEffectiveDisplayName(state.me, state.me.uid, { allowLiffFallback: true });
  if (prodDebug.enabled) {
    prodDebug.familyId = state.familyId ?? state.me?.familyId ?? null;
    renderDebugHud();
  }
}

function startUserSubscription(uid) {
  if (unsubscribeUser) {
    unsubscribeUser();
    unsubscribeUser = null;
  }
  unsubscribeUser = subscribeMyUser(uid, (userDoc) => {
    state.me = { uid, ...(userDoc ?? {}) };
    state.familyId = userDoc?.familyId ?? state.familyId ?? null;
    if (prodDebug.enabled) {
      prodDebug.familyId = state.familyId ?? null;
      debugLog("user", "subscribe update", { hasFamily: !!state.familyId });
    }
    refreshHeaderView();
  });
}

async function getLiffProfileSafe() {
  if (webMode) return null;
  const liffApi = window.liff;
  if (!liffApi || typeof liffApi.getProfile !== "function") return null;
  if (typeof liffApi.isInClient === "function" && !liffApi.isInClient()) return null;
  try {
    return await liffApi.getProfile();
  } catch {
    return null;
  }
}

async function initLiffOptional() {
  collectLiffDebug("before-liff-init");
  const liffApi = window.liff;
  if (!liffApi || typeof liffApi.init !== "function") {
    webMode = true;
    if (debugState) debugState.liffInit = "skipped";
    collectLiffDebug("liff-unavailable");
    return;
  }

  const liffId = LIFF_ID;
  if (!liffId) {
    webMode = true;
    if (debugState) debugState.liffInit = "missing-liff-id";
    collectLiffDebug("liff-missing-id");
    return;
  }

  if (globalState.__LIFF_INITIALIZED__) {
    webMode = typeof liffApi.isInClient === "function" ? !liffApi.isInClient() : true;
    if (debugState) debugState.liffInit = "already-initialized";
    try {
      collectLiffDebug("after-liff-init-ok", true);
    } catch (error) {
      setDebugError(error);
    }
    return;
  }

  if (globalState.__LIFF_INIT_PROMISE__) {
    try {
      await globalState.__LIFF_INIT_PROMISE__;
      webMode = typeof liffApi.isInClient === "function" ? !liffApi.isInClient() : true;
      if (debugState) debugState.liffInit = "already-initialized";
      try {
        collectLiffDebug("after-liff-init-ok", true);
      } catch (error) {
        setDebugError(error);
      }
      return;
    } catch (error) {
      globalState.__LIFF_INIT_PROMISE__ = null;
      console.warn("LIFF init shared promise failed. Fallback to web preview mode.", error);
      webMode = true;
      if (debugState) debugState.liffInit = "failed";
      setDebugError(error);
      collectLiffDebug("after-liff-init-failed");
      return;
    }
  }

  try {
    globalState.__LIFF_INIT_PROMISE__ = liffApi.init({ liffId });
    await globalState.__LIFF_INIT_PROMISE__;
    globalState.__LIFF_INITIALIZED__ = true;
    webMode = typeof liffApi.isInClient === "function" ? !liffApi.isInClient() : true;
    if (debugState) debugState.liffInit = "ok";
    try {
      collectLiffDebug("after-liff-init-ok", true);
    } catch (error) {
      setDebugError(error);
    }
  } catch (error) {
    console.warn("LIFF init failed. Fallback to web preview mode.", error);
    webMode = true;
    if (debugState) debugState.liffInit = "failed";
    setDebugError(error);
    collectLiffDebug("after-liff-init-failed");
  } finally {
    if (!globalState.__LIFF_INITIALIZED__) {
      globalState.__LIFF_INIT_PROMISE__ = null;
    }
  }
}

function formatUid(uid) {
  if (!uid) return "";
  if (uid.length <= 15) return uid;
  return `${uid.slice(0, 8)}…${uid.slice(-6)}`;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "absolute";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  return ok;
}

function getDecodedIdTokenSafe() {
  if (webMode) return null;
  const liffApi = window.liff;
  if (!liffApi || typeof liffApi.getDecodedIDToken !== "function") return null;
  try {
    return liffApi.getDecodedIDToken() ?? null;
  } catch {
    return null;
  }
}

function ensureWebPreviewBanner() {
  if (!webMode) return;
  if (document.getElementById("web-preview-banner")) return;
  const app = document.querySelector(".app");
  if (!app) return;
  const banner = el(`<div id="web-preview-banner" class="web-preview-banner">Webプレビューで動作中</div>`);
  app.appendChild(banner);
}

function bindSettingsAvatarDebug(wrapper) {
  if (!SETTINGS_DEBUG) return;
  const statusEl = wrapper.querySelector("#settings-avatar-debug");
  if (!statusEl) return;
  const img = wrapper.querySelector(".settings-user-card .header-avatar img");
  if (!img) {
    statusEl.textContent = "画像なし（fallback表示）";
    return;
  }
  const showError = () => {
    const href = img.currentSrc || img.src;
    statusEl.innerHTML = `画像読み込み失敗${href ? `: <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">画像URLを開く</a>` : ""}`;
  };
  img.addEventListener("error", showError, { once: true });
  if (img.complete && img.naturalWidth === 0) {
    showError();
  }
}

async function loadSettingsDebugInfo(wrapper) {
  if (!SETTINGS_DEBUG) return;
  const panel = wrapper.querySelector("#settings-debug-panel");
  if (!panel) return;

  const debug = {
    href: location.href,
    webMode,
    liff: {
      isLoggedIn: null,
      permissionGrantedAll: null,
      profile: null,
      decodedIdToken: null,
      errors: {},
    },
  };
  const liffApi = window.liff;
  if (!liffApi) {
    debug.liff.errors.sdk = "LIFF SDK not found";
    panel.innerHTML = `<pre class="debug-pre">${escapeHtml(safeJson(debug))}</pre>`;
    return;
  }

  try {
    debug.liff.isLoggedIn = typeof liffApi.isLoggedIn === "function" ? liffApi.isLoggedIn() : "unsupported";
  } catch (error) {
    debug.liff.errors.isLoggedIn = error instanceof Error ? error.message : String(error);
  }

  try {
    if (liffApi.permission && typeof liffApi.permission.getGrantedAll === "function") {
      debug.liff.permissionGrantedAll = await liffApi.permission.getGrantedAll();
    } else {
      debug.liff.permissionGrantedAll = "unsupported";
    }
  } catch (error) {
    debug.liff.errors.permission = error instanceof Error ? error.message : String(error);
  }

  try {
    if (typeof liffApi.getProfile === "function") {
      const p = await liffApi.getProfile();
      debug.liff.profile = {
        displayName: p?.displayName ?? null,
        userId: p?.userId ?? null,
        pictureUrl: p?.pictureUrl ?? null,
      };
    } else {
      debug.liff.profile = "unsupported";
    }
  } catch (error) {
    debug.liff.errors.getProfile = error instanceof Error ? error.message : String(error);
  }

  try {
    if (typeof liffApi.getDecodedIDToken === "function") {
      const token = liffApi.getDecodedIDToken();
      debug.liff.decodedIdToken = token
        ? {
            name: token.name ?? null,
            picture: token.picture ?? null,
          }
        : null;
    } else {
      debug.liff.decodedIdToken = "unsupported";
    }
  } catch (error) {
    debug.liff.errors.getDecodedIDToken = error instanceof Error ? error.message : String(error);
  }

  panel.innerHTML = `<pre class="debug-pre">${escapeHtml(safeJson(debug))}</pre>`;
}

async function syncLiffProfile(uid) {
  liffProfile = await traceAsync("liff.getProfileSafe", () => getLiffProfileSafe());
  const decodedIdToken = getDecodedIdTokenSafe();
  if (!liffProfile && !decodedIdToken) return;
  try {
    await traceAsync("firestore.upsertMyLineProfile", () =>
      upsertMyLineProfile(uid, {
        profile: liffProfile,
        decodedIdToken,
      }),
    );
  } catch (error) {
    console.warn("Profile upsert skipped.", error);
  }
}

const JST_OFFSET_MINUTES = 9 * 60;
const JST_OFFSET_MS = JST_OFFSET_MINUTES * 60 * 1000;

function buildStartTimeOptionsNowJst(now = new Date()) {
  const result = [{ label: "未定", value: "" }];
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const year = jstNow.getUTCFullYear();
  const month = jstNow.getUTCMonth();
  const day = jstNow.getUTCDate();
  const minutesNow = jstNow.getUTCHours() * 60 + jstNow.getUTCMinutes();
  const startMinutes = minutesNow % 30 === 0 ? minutesNow : minutesNow + (30 - (minutesNow % 30));
  const lastMinutes = 23 * 60 + 30;

  if (startMinutes > lastMinutes) {
    return result;
  }

  for (let minutes = startMinutes; minutes <= lastMinutes; minutes += 30) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    const utcMs = Date.UTC(year, month, day, Math.floor(minutes / 60), minutes % 60) - JST_OFFSET_MS;
    result.push({ label: `${hh}:${mm}`, value: new Date(utcMs).toISOString() });
  }
  return result;
}

function buildStartTimeOptions() {
  return buildStartTimeOptionsNowJst();
}

function navigateToView(nextView) {
  if (prodDebug.enabled) debugLog("nav", `navigate:${nextView}`);
  const q = new URLSearchParams(location.search);
  q.set("view", nextView);
  q.delete("planId");
  const query = q.toString();
  location.href = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
}

function navigateToRecordWithPlan(planId) {
  if (prodDebug.enabled) debugLog("nav", `navigate:record planId=${planId ? "yes" : "no"}`);
  const q = new URLSearchParams(location.search);
  q.set("view", "record");
  q.set("planId", planId);
  const query = q.toString();
  location.href = `${location.pathname}?${query}${location.hash}`;
}

async function tryCloseLiffWindow() {
  if (webMode) {
    if (history.length > 1) history.back();
    return;
  }
  const liffApi = window.liff;
  if (liffApi && typeof liffApi.closeWindow === "function") {
    try {
      liffApi.closeWindow();
      return;
    } catch {
      // fallback
    }
  }
  if (history.length > 1) history.back();
}

function panelTitleHtml(title, { showGear = true, showSubjects = false } = {}) {
  const actionButtons = [
    showSubjects
      ? '<button type="button" class="icon-btn panel-subjects-btn" aria-label="subjects">📚</button>'
      : "",
    showGear
      ? '<button type="button" class="icon-btn panel-settings-btn" aria-label="settings">&#9881;</button>'
      : "",
  ].join("");
  return `
    <div class="panel-title-row">
      <h3>${escapeHtml(title)}</h3>
      <div class="panel-actions">${actionButtons}</div>
    </div>
  `;
}

function showToast(message, durationMs = 1000) {
  const toast = el(`<div class="toast">${escapeHtml(message)}</div>`);
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  return new Promise((resolve) => {
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => {
        toast.remove();
        resolve();
      }, 180);
    }, durationMs);
  });
}

function showConfirmModal({
  title = "確認",
  message = "",
  okText = "OK",
  cancelText = "キャンセル",
} = {}) {
  if (confirmModalOpen) {
    return Promise.resolve(false);
  }
  confirmModalOpen = true;
  return new Promise((resolve) => {
    const overlay = el(`
      <div class="modal-overlay confirm-overlay">
        <div class="modal-card confirm-modal-card">
          <div class="confirm-modal-body">
            <h3 class="confirm-modal-title">${escapeHtml(title)}</h3>
            <div class="confirm-modal-message">${escapeHtml(message)}</div>
            <div class="confirm-modal-actions">
              <button type="button" class="secondary" id="confirm-cancel">${escapeHtml(cancelText)}</button>
              <button type="button" id="confirm-ok">${escapeHtml(okText)}</button>
            </div>
          </div>
        </div>
      </div>
    `);

    let settled = false;
    const close = (result) => {
      if (settled) return;
      settled = true;
      confirmModalOpen = false;
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector("#confirm-cancel").onclick = () => close(false);
    overlay.querySelector("#confirm-ok").onclick = () => close(true);
    document.body.appendChild(overlay);
  });
}

async function getMyOpenPlans(limitCount = 200) {
  if (!state.familyId || !auth.currentUser?.uid) return [];
  const uid = auth.currentUser.uid;
  const plans = await listPlans(state.familyId, uid, false, limitCount);
  return plans
    .filter((p) => p?.userId === uid && p?.status === "declared" && !p?.recordedAt && !p?.cancelledAt)
    .sort((a, b) => {
      const aSlot = typeof a?.startSlot === "string" && /^\d{12}$/.test(a.startSlot) ? a.startSlot : "999999999999";
      const bSlot = typeof b?.startSlot === "string" && /^\d{12}$/.test(b.startSlot) ? b.startSlot : "999999999999";
      if (aSlot !== bSlot) return aSlot.localeCompare(bSlot);
      const aCreated = toDateMaybe(a?.createdAt)?.getTime() ?? 0;
      const bCreated = toDateMaybe(b?.createdAt)?.getTime() ?? 0;
      return aCreated - bCreated;
    });
}

function toUserErrorMessage(error) {
  if (!error) return "参加に失敗しました。";
  const message = String(error?.message ?? error);
  if (message.includes("invalid") || message.includes("code")) return "招待コードが正しくありません。";
  if (message.includes("already")) return "すでに家族に参加しています。";
  if (message.includes("permission")) return "権限エラーで参加できませんでした。";
  if (message.includes("unauth")) return "認証が必要です。";
  return message;
}

function bindPanelGear(container) {
  const subjectBtn = container.querySelector(".panel-subjects-btn");
  if (subjectBtn) {
    subjectBtn.addEventListener("click", () => navigateToView("subjects"));
  }
  const btn = container.querySelector(".panel-settings-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (!auth.currentUser) return;
    openSettingsModal();
  });
}

async function loadInviteCodesInto(wrapper) {
  const section = wrapper.querySelector("#invite-codes-section");
  const status = wrapper.querySelector("#invite-code-status");
  const parentInput = wrapper.querySelector("#invite-parent-code");
  const childInput = wrapper.querySelector("#invite-child-code");
  const parentCopy = wrapper.querySelector("#copy-parent-code");
  const childCopy = wrapper.querySelector("#copy-child-code");
  if (!status || !parentInput || !childInput || !parentCopy || !childCopy) return;

  if (!state.familyId) {
    status.textContent = "家族未作成";
    return;
  }
  if (state.role !== "parent") {
    if (section) section.style.display = "none";
    return;
  }
  try {
    const codes = await listInviteCodes(state.familyId);
    parentInput.value = codes.parent ?? "—";
    childInput.value = codes.child ?? "—";
    parentCopy.disabled = !codes.parent;
    childCopy.disabled = !codes.child;
    status.textContent = "";
  } catch {
    status.textContent = "取得できませんでした";
  }
}

function bindCopyButton(button, input) {
  button.addEventListener("click", async () => {
    const code = input.value;
    if (!code || code === "—") return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        return;
      }
    } catch {
      // fallback below
    }
    input.focus();
    input.select();
  });
}

function bindCopyValueButton(button, valueProvider) {
  button.addEventListener("click", async () => {
    const value = valueProvider();
    if (!value || value === "—") return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        await showToast("コピーしました");
        return;
      }
    } catch {
      // fallback below
    }
    await showToast("コピーに対応していません");
  });
}

async function ensureMyRole() {
  if (!state.familyId || !auth.currentUser?.uid) return null;
  if (state.role) return state.role;
  try {
    const members = await listFamilyMembers(state.familyId);
    const me = members.find((m) => m.userId === auth.currentUser.uid) ?? null;
    state.role = me?.role ?? null;
  } catch {
    state.role = null;
  }
  return state.role;
}

async function resolveCurrentFamilyName() {
  if (!state.familyId) return "-";
  try {
    const family = await getFamily(state.familyId);
    const name = typeof family?.name === "string" ? family.name.trim() : "";
    return name || "-";
  } catch {
    return "-";
  }
}

function createSettingsContent({ modal = false, showBack = false, familyName = "-" } = {}) {
  const displayNameForInput =
    state.me?.displayName ?? state.me?.appDisplayName ?? state.me?.lineDisplayName ?? liffProfile?.displayName ?? "";
  const displayNameForHeader = displayNameForInput || "ユーザー";
  const uidText = state.me?.uid ?? "";

  const wrapper = el(`
    <div class="settings-root">
      ${showBack ? `
      <div class="settings-page-header">
        <button id="settings-back" class="secondary">戻る</button>
        <div class="settings-page-title">設定</div>
      </div>` : ""}
      <div class="card">
        <div class="settings-user-card profile-header">
          <div class="header-avatar">${avatarHtml(state.me, "me")}</div>
          <div class="profile-meta">
            <div class="profile-name">${escapeHtml(displayNameForHeader)}</div>
            ${
              uidText
                ? `
                  <div class="uid-row">
                    <span class="muted uid-short">UID: ${escapeHtml(formatUid(uidText))}</span>
                    <button type="button" id="copy-uid-btn" class="secondary uid-copy-btn">コピー</button>
                  </div>
                  <div id="uid-copy-status" class="muted uid-copy-status" aria-live="polite"></div>
                  ${SETTINGS_DEBUG ? `<div class="muted uid-full">フルUID: ${escapeHtml(uidText)}</div>` : ""}
                `
                : ""
            }
            <a href="#" id="open-family-modal-link" class="settings-family-link-text">家族：${escapeHtml(familyName || "-")}</a>
          </div>
        </div>
        ${SETTINGS_DEBUG ? `<div id="settings-avatar-debug" class="muted"></div>` : ""}
        ${modal ? "" : `<h3 class="settings-title">設定</h3>`}
        <input id="displayName" placeholder="表示名" value="${escapeHtml(displayNameForInput)}" />
        <div class="setting-toggle-row">
          <span>やるよ通知を受け取る</span>
          <input id="notifyPlan" type="checkbox" ${state.me.notifyActivityPlan ? "checked" : ""} />
        </div>
        <div class="setting-toggle-row">
          <span>やったよ通知を受け取る</span>
          <input id="notifyRecord" type="checkbox" ${state.me.notifyActivityRecord ? "checked" : ""} />
        </div>
        <div class="setting-toggle-row">
          <span>開始時刻リマインドを受け取る</span>
          <input id="notifyStartReminder" type="checkbox" ${state.me.notificationSettings?.startReminderEnabled === true ? "checked" : ""} />
        </div>
        ${SETTINGS_DEBUG ? `<div id="settings-debug-panel" class="card"></div>` : ""}
        <button id="save-settings">保存する</button>
      </div>
    </div>
  `);

  if (showBack) {
    wrapper.querySelector("#settings-back").onclick = () => navigateToView("declare");
  }

  wrapper.querySelector("#save-settings").onclick = async () => {
    const saveBtn = wrapper.querySelector("#save-settings");
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    const original = saveBtn.textContent;
    saveBtn.textContent = "保存中...";
    try {
      await traceAsync("firestore.updateMySettings", () => updateMySettings(auth.currentUser.uid, {
        appDisplayName: wrapper.querySelector("#displayName").value || null,
        notifyActivityPlan: wrapper.querySelector("#notifyPlan").checked,
        notifyActivityRecord: wrapper.querySelector("#notifyRecord").checked,
        notificationSettings: {
          startReminderEnabled: wrapper.querySelector("#notifyStartReminder").checked,
        },
        updatedAt: new Date(),
      }));
      const me = await traceAsync("firestore.getMyUser", () => getMyUser(auth.currentUser.uid));
      state.me = { uid: auth.currentUser.uid, ...(me ?? {}) };
      refreshHeaderView();
      const nextName =
        state.me?.displayName ?? state.me?.appDisplayName ?? state.me?.lineDisplayName ?? liffProfile?.displayName ?? "";
      wrapper.querySelector("#displayName").value = nextName;
      const titleName = wrapper.querySelector(".settings-user-card .profile-name");
      if (titleName) titleName.textContent = nextName || "ユーザー";
      await showToast("保存しました。");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = original;
    }
  };

  const uidCopyBtn = wrapper.querySelector("#copy-uid-btn");
  if (uidCopyBtn && uidText) {
    uidCopyBtn.addEventListener("click", async () => {
      const status = wrapper.querySelector("#uid-copy-status");
      try {
        const ok = await copyTextToClipboard(uidText);
        if (status) {
          status.textContent = ok ? "コピーしました" : "コピーできませんでした";
          setTimeout(() => {
            status.textContent = "";
          }, 1200);
        }
      } catch {
        if (status) {
          status.textContent = "コピーできませんでした";
          setTimeout(() => {
            status.textContent = "";
          }, 1200);
        }
      }
    });
  }
  const familyLink = wrapper.querySelector("#open-family-modal-link");
  if (familyLink) {
    familyLink.addEventListener("click", async (e) => {
      e.preventDefault();
      closeSettingsModal();
      await openFamilyModal();
    });
  }
  bindSettingsAvatarDebug(wrapper);
  loadSettingsDebugInfo(wrapper);

  return wrapper;
}

function closeSettingsModal() {
  if (!settingsModalState) return;
  document.removeEventListener("keydown", settingsModalState.onKeyDown);
  settingsModalState.overlay.remove();
  settingsModalState = null;
}

async function openSettingsModal() {
  if (settingsModalState) return;
  if (familyModalState) closeFamilyModal();
  await ensureMyRole();
  const familyName = await resolveCurrentFamilyName();
  const overlay = el(`
    <div class="settings-modal-overlay">
      <div class="settings-modal-card">
        <button class="settings-modal-close" aria-label="close">&times;</button>
        <div class="settings-modal-body"></div>
      </div>
    </div>
  `);
  const body = overlay.querySelector(".settings-modal-body");
  body.appendChild(createSettingsContent({ modal: true, showBack: false, familyName }));
  const onKeyDown = (e) => {
    if (e.key === "Escape") closeSettingsModal();
  };

  overlay.querySelector(".settings-modal-close").onclick = closeSettingsModal;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeSettingsModal();
  });

  settingsModalState = { overlay, onKeyDown };
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKeyDown);
}

function closeFamilyModal() {
  if (!familyModalState) return;
  document.removeEventListener("keydown", familyModalState.onKeyDown);
  familyModalState.overlay.remove();
  familyModalState = null;
}

function renderFamilyMemberRows(members, role) {
  const rows = sortMembersByJoinedAtAsc(members.filter((member) => member.role === role))
    .map((member) => {
      const uid = member.userId;
      const isMe = uid === auth.currentUser?.uid;
      return `
        <div class="family-member-row">
          <div class="family-member-avatar">${avatarHtml(member, "member", uid)}</div>
          <div class="family-member-name">${escapeHtml(getEffectiveDisplayName(member, uid))}</div>
          ${isMe ? '<span class="family-me-badge">自分</span>' : ""}
        </div>
      `;
    })
    .join("");
  return rows || '<div class="muted">メンバーがいません</div>';
}

async function createFamilyContent() {
  await ensureMyRole();
  const uid = auth.currentUser?.uid ?? "";
  const familyId = state.familyId ?? state.me?.familyId ?? null;
  const wrapper = el(`<div class="family-root"><div class="muted">読み込み中...</div></div>`);

  if (!familyId) {
    wrapper.innerHTML = `<div class="card"><h3>家族</h3><div class="muted">家族未作成です</div></div>`;
    return wrapper;
  }

  const [family, members, inviteCodes] = await Promise.all([
    traceAsync("firestore.getFamily", () => getFamily(familyId)),
    traceAsync("firestore.listFamilyMembers", () => listFamilyMembers(familyId)),
    state.role === "parent"
      ? traceAsync("firestore.listInviteCodes", () => listInviteCodes(familyId))
      : Promise.resolve({ parent: null, child: null }),
  ]);
  const meMember = members.find((member) => member.userId === uid) ?? null;
  const isParent = meMember?.role === "parent";
  const familyName = (typeof family?.name === "string" && family.name.trim()) ? family.name.trim() : "わが家";
  const activeParentCount = members.filter((member) => member.role === "parent").length;
  const isLastParent = isParent && activeParentCount <= 1;

  wrapper.innerHTML = `
    <div class="card">
      <h3 class="family-modal-title">家族</h3>
      <section class="family-section">
        <div class="family-section-title">家族名</div>
        ${
          isParent
            ? `
              <div class="family-name-row">
                <input id="family-name-input" maxlength="20" value="${escapeHtml(familyName)}" />
                <button type="button" id="family-name-save">変更</button>
              </div>
            `
            : `<div class="family-name-text">${escapeHtml(familyName)}</div>`
        }
      </section>
      <section class="family-section">
        <div class="family-section-title">親</div>
        <div class="family-members">${renderFamilyMemberRows(members, "parent")}</div>
      </section>
      <section class="family-section">
        <div class="family-section-title">子</div>
        <div class="family-members">${renderFamilyMemberRows(members, "child")}</div>
      </section>
      ${
        isParent
          ? `
            <section class="family-section">
              <div class="family-section-title">家族招待コード</div>
              <div class="family-code-row">
                <span class="family-code-label">親用</span>
                <code class="family-code-value" id="family-code-parent">${escapeHtml(inviteCodes.parent ?? "—")}</code>
                <button type="button" class="secondary family-code-copy" id="copy-family-parent" ${inviteCodes.parent ? "" : "disabled"}>コピー</button>
              </div>
              <div class="family-code-row">
                <span class="family-code-label">子用</span>
                <code class="family-code-value" id="family-code-child">${escapeHtml(inviteCodes.child ?? "—")}</code>
                <button type="button" class="secondary family-code-copy" id="copy-family-child" ${inviteCodes.child ? "" : "disabled"}>コピー</button>
              </div>
            </section>
          `
          : ""
      }
      <section class="family-section family-danger-zone">
        <div class="family-danger-actions">
          <button type="button" id="leave-family-btn" class="family-leave-btn ${isLastParent ? "leave-disabled" : ""}">家族をぬける</button>
          ${
            isParent
              ? '<button type="button" id="close-family-btn" class="family-leave-btn">家族を作り直す</button>'
              : ""
          }
        </div>
      </section>
    </div>
  `;

  if (isParent) {
    const saveBtn = wrapper.querySelector("#family-name-save");
    const input = wrapper.querySelector("#family-name-input");
    if (saveBtn && input) {
      saveBtn.addEventListener("click", async () => {
        if (saveBtn.disabled) return;
        const name = input.value.trim();
        if (name.length < 1 || name.length > 20) {
          await showToast("家族名は1〜20文字で入力してください");
          return;
        }
        saveBtn.disabled = true;
        const original = saveBtn.textContent;
        saveBtn.textContent = "変更中...";
        try {
          await traceAsync("callable.updateFamilyName", () => updateFamilyName(name));
          await showToast("家族名を変更しました");
        } catch (error) {
          console.error("updateFamilyName failed", error);
          await showToast(toUserErrorMessage(error));
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = original;
        }
      });
    }

    const parentCopyBtn = wrapper.querySelector("#copy-family-parent");
    const childCopyBtn = wrapper.querySelector("#copy-family-child");
    const parentCodeEl = wrapper.querySelector("#family-code-parent");
    const childCodeEl = wrapper.querySelector("#family-code-child");
    if (parentCopyBtn && parentCodeEl) {
      bindCopyValueButton(parentCopyBtn, () => parentCodeEl.textContent?.trim() ?? "");
    }
    if (childCopyBtn && childCodeEl) {
      bindCopyValueButton(childCopyBtn, () => childCodeEl.textContent?.trim() ?? "");
    }
  }

  const leaveBtn = wrapper.querySelector("#leave-family-btn");
  if (leaveBtn) {
    leaveBtn.addEventListener("click", async () => {
      if (leaveBtn.disabled) return;
      if (isLastParent) {
        await showToast("最後の親は家族をぬけられません");
        return;
      }
      const ok = await showConfirmModal({
        title: "家族をぬけますか？",
        message: "家族をぬけると、\n家族の予定や記録は表示されなくなります。\n※自分の記録は消えません。",
        okText: "家族をぬける",
        cancelText: "やめる",
      });
      if (!ok) return;

      leaveBtn.disabled = true;
      const original = leaveBtn.textContent;
      leaveBtn.textContent = "処理中...";
      try {
        await traceAsync("callable.leaveFamily", () => leaveFamily());
        const me = await traceAsync("firestore.getMyUser", () => getMyUser(uid));
        state.me = { uid, ...(me ?? {}) };
        state.familyId = me?.familyId ?? null;
        state.role = null;
        closeFamilyModal();
        await showToast("家族をぬけました");
        await render();
      } catch (error) {
        console.error("leaveFamily failed", error);
        await showToast(toUserErrorMessage(error));
        leaveBtn.disabled = false;
        leaveBtn.textContent = original;
      }
    });
  }

  const closeFamilyBtn = wrapper.querySelector("#close-family-btn");
  if (closeFamilyBtn) {
    closeFamilyBtn.addEventListener("click", async () => {
      if (closeFamilyBtn.disabled) return;
      const ok = await showConfirmModal({
        title: "家族を作り直しますか？",
        message:
          "現在の家族は終了し、全員が家族から外れます。\n招待コードは無効になります。\n\n※予定や記録のデータは削除されません。",
        okText: "作り直す",
        cancelText: "やめる",
      });
      if (!ok) return;
      closeFamilyBtn.disabled = true;
      const original = closeFamilyBtn.textContent;
      closeFamilyBtn.textContent = "処理中...";
      try {
        await traceAsync("callable.closeFamily", () => closeFamilyCallable());
        const me = await traceAsync("firestore.getMyUser", () => getMyUser(uid));
        state.me = { uid, ...(me ?? {}) };
        state.familyId = null;
        state.role = null;
        closeFamilyModal();
        closeSettingsModal();
        await showToast("家族を作り直しました");
        await render();
      } catch (error) {
        console.error("closeFamily failed", error);
        await showToast(toUserErrorMessage(error));
        closeFamilyBtn.disabled = false;
        closeFamilyBtn.textContent = original;
      }
    });
  }

  return wrapper;
}

async function openFamilyModal() {
  if (familyModalState) return;
  if (settingsModalState) closeSettingsModal();
  const overlay = el(`
    <div class="settings-modal-overlay">
      <div class="settings-modal-card family-modal-card">
        <button class="settings-modal-close" aria-label="close">&times;</button>
        <div class="settings-modal-body"><div class="muted">読み込み中...</div></div>
      </div>
    </div>
  `);
  const onKeyDown = (e) => {
    if (e.key === "Escape") closeFamilyModal();
  };
  overlay.querySelector(".settings-modal-close").onclick = closeFamilyModal;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeFamilyModal();
  });
  familyModalState = { overlay, onKeyDown };
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKeyDown);

  try {
    const body = overlay.querySelector(".settings-modal-body");
    body.innerHTML = "";
    body.appendChild(await createFamilyContent());
  } catch (error) {
    console.error("openFamilyModal failed", error);
    const body = overlay.querySelector(".settings-modal-body");
    body.innerHTML = `<div class="card"><h3>家族</h3><div class="muted">${escapeHtml(toUserErrorMessage(error))}</div></div>`;
  }
}

function renderSettingsPage(panel) {
  panel.innerHTML = "";
  ensureMyRole().then(async () => {
    const familyName = await resolveCurrentFamilyName();
    panel.innerHTML = "";
    panel.appendChild(createSettingsContent({ modal: false, showBack: true, familyName }));
  });
}

async function bootstrap() {
  phaseLog("BOOT", {
    href: location.href,
    view: params.get("view"),
    mode: params.get("mode"),
  });
  await uploadDebugLogIfEnabled("boot", {
    search: location.search,
    hash: location.hash,
    userAgent: navigator.userAgent,
  });
  renderDebugPanel();
  phaseLog("LIFF_INIT");
  await traceAsync("liff.initOptional", () => initLiffOptional());
  phaseLog("LIFF_INIT_DONE", {
    webMode,
    liffInClient: typeof window.liff?.isInClient === "function" ? window.liff.isInClient() : "n/a",
    liffOs: typeof window.liff?.getOS === "function" ? window.liff.getOS() : "n/a",
  });
  ensureWebPreviewBanner();

  phaseLog("AUTH");
  if (webMode) {
    setPreDebugStep("auth:ensureAnonymousAuth:start");
    collectLiffDebug("webmode-anon-auth");
    await traceAsync("auth.ensureAnonymousAuth", () => ensureAnonymousAuth());
    setPreDebugStep("auth:ensureAnonymousAuth:end");
  } else {
    const liffApi = window.liff;
    if (!liffApi || typeof liffApi.isLoggedIn !== "function") {
      throw new Error("LIFF SDK is unavailable.");
    }
    if (!liffApi.isLoggedIn()) {
      collectLiffDebug("liff-login-redirect");
      liffApi.login({ redirectUri: location.href });
      return;
    }
    setPreDebugStep("auth:liff:getIdToken:start");
    const idToken = typeof liffApi.getIDToken === "function" ? liffApi.getIDToken() : null;
    setPreDebugStep("auth:liff:getIdToken:end");
    if (!idToken) {
      throw new Error("LIFF ID token is unavailable.");
    }
    collectLiffDebug("liff-exchange-token");
    setPreDebugStep("auth:liff:signInWithLineIdToken:start");
    await traceAsync("callable.signInWithLineIdToken", () => callSignInWithRetry(idToken));
    setPreDebugStep("auth:liff:signInWithLineIdToken:end");
  }

  phaseLog("AUTH_DONE");
  setPreDebugStep("auth:waitAuth:start");
  const user = await traceAsync("auth.waitAuth", () => waitAuth());
  setPreDebugStep("auth:waitAuth:end");
  stopPreDebugHud();
  collectLiffDebug("after-firebase-auth");
  await updateFirebaseAuthDebug(user);
  if (!user) {
    phaseLog("AUTH_NO_USER");
    root.innerHTML = `<div class="card">認証が必要です。</div>`;
    hideLoadingBanner();
    return;
  }
  clearDebugError();
  activateProdDebug(user.uid);
  prodDebug.familyId = state.familyId ?? null;
  phaseLog("USERDOC");
  let me = await traceAsync("firestore.getMyUser", () => getMyUser(user.uid));
  await traceAsync("syncLiffProfile", () => syncLiffProfile(user.uid));
  me = await traceAsync("firestore.getMyUser", () => getMyUser(user.uid));
  state.me = { uid: user.uid, ...(me ?? {}) };
  state.familyId = me?.familyId ?? null;
  if (prodDebug.enabled) {
    prodDebug.familyId = state.familyId ?? null;
  }
  startUserSubscription(user.uid);
  phaseLog("RENDER");
  await traceAsync("render", () => render());
  phaseLog("RENDER_DONE");
  hideLoadingBanner();
}

async function render() {
  if (prodDebug.enabled) debugLog("render", "render start", { hasFamily: !!state.familyId });
  if (!state.familyId) {
    renderOnboarding();
    if (prodDebug.enabled) debugLog("render", "onboarding");
    return;
  }
  await traceAsync("renderHome", () => renderHome());
}

function renderOnboarding() {
  root.innerHTML = `
    <div>
      <div class="card">
        <h3>家族を作成</h3>
        <button id="create-family" type="button">作成する</button>
      </div>
      <div class="card">
        <h3>コードで参加</h3>
        <input id="join-code" placeholder="6桁コード" maxlength="6" />
        <button id="join-family" type="button">参加する</button>
        <div id="join-status" class="muted"></div>
      </div>
    </div>
  `;
  const createBtn = root.querySelector("#create-family");
  const joinBtn = root.querySelector("#join-family");
  const codeInput = root.querySelector("#join-code");
  const status = root.querySelector("#join-status");

  createBtn.addEventListener("click", async () => {
    if (createBtn.disabled) return;
    createBtn.disabled = true;
    const original = createBtn.textContent;
    createBtn.textContent = "作成中...";
    const ok = await showConfirmModal({
      title: "家族を作成しますか？",
      message: "この端末のユーザーが「親」として家族を作成します。\nあとから家族に参加する人へ招待コードを共有できます。",
      okText: "作成する",
      cancelText: "やめる",
    });
    if (!ok) {
      createBtn.disabled = false;
      createBtn.textContent = original;
      return;
    }
    try {
      await traceAsync("callable.createFamily", () => createFamily());
      const me = await traceAsync("firestore.getMyUser", () => getMyUser(auth.currentUser.uid));
      state.familyId = me.familyId;
      await render();
    } catch (error) {
      console.error("createFamily failed", error);
      await showToast(toUserErrorMessage(error));
      createBtn.disabled = false;
      createBtn.textContent = original;
    }
  });

  joinBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    if (joinBtn.disabled) return;
    joinBtn.disabled = true;
    const original = joinBtn.textContent;
    joinBtn.textContent = "参加中...";
    const code = (codeInput.value || "").trim();
    if (!code) {
      status.textContent = "コードを入力してね";
      await showToast("コードを入力してね");
      joinBtn.disabled = false;
      joinBtn.textContent = original;
      return;
    }
    const ok = await showConfirmModal({
      title: "家族に参加しますか？",
      message: `招待コード: ${code}\n招待コードを確認して参加します。`,
      okText: "参加する",
      cancelText: "やめる",
    });
    if (!ok) {
      joinBtn.disabled = false;
      joinBtn.textContent = original;
      return;
    }
    status.textContent = "参加中...";
    try {
      const result = await traceAsync("callable.joinFamilyByCode", () => joinFamilyByCode(code));
      status.textContent = result?.ok ? "参加しました" : "参加処理を実行しました";
      state.familyId = result?.familyId ?? state.familyId;
      state.role = result?.role ?? state.role;
      for (let i = 0; i < 3; i += 1) {
        const me = await traceAsync("firestore.getMyUser", () => getMyUser(auth.currentUser.uid));
        if (me?.familyId) {
          state.familyId = me.familyId;
          break;
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      navigateToView("declare");
    } catch (error) {
      console.error("joinFamilyByCode failed", error);
      const message = toUserErrorMessage(error);
      status.textContent = message;
      await showToast(message);
      joinBtn.disabled = false;
      joinBtn.textContent = original;
    }
  });
}

async function renderHome() {
  if (prodDebug.enabled) debugLog("render", "renderHome");
  root.innerHTML = `
    <div>
      ${(!view || view === "settings") ? `
      <div class="card profile-header">
          <div class="header-avatar">${avatarHtml(state.me, "me")}</div>
          <div class="profile-meta">
            <div class="profile-name header-name">${escapeHtml(getEffectiveDisplayName(state.me, state.me.uid, { allowLiffFallback: true }))}</div>
            <div class="muted">family: ${escapeHtml(state.familyId ?? "-")}</div>
          </div>
        </div>` : ""}
      ${!view ? `
      <div class="card">
        <button id="nav-declare">${UI.declareTitle}</button>
        <button id="nav-record">${UI.recordTitle}</button>
        <button id="nav-stats">${UI.statsTitle}</button>
      </div>` : ""}
      <div id="panel"></div>
    </div>
  `;
  currentPanel = root.querySelector("#panel");

  if (!view) {
    root.querySelector("#nav-declare").onclick = () => renderDeclare(currentPanel);
    root.querySelector("#nav-record").onclick = () => renderRecord(currentPanel);
    root.querySelector("#nav-stats").onclick = () => renderStats(currentPanel);
    await renderDeclare(currentPanel);
    return;
  }
  if (view === "record") await renderRecord(currentPanel);
  else if (view === "stats") await renderStats(currentPanel);
  else if (view === "settings") renderSettingsPage(currentPanel);
  else if (view === "subjects") await renderSubjects(currentPanel);
  else if (view === "plans") await renderPlans(currentPanel);
  else await renderDeclare(currentPanel);
}

async function renderDeclare(panel) {
  const openPlans = await getMyOpenPlans();
  const plansLinkHtml =
    openPlans.length > 0
      ? `<button id="go-plans" type="button" class="link-btn">ほかのやるよ（${openPlans.length}）</button>`
      : "";
  const startOptions = buildStartTimeOptions().map((opt) => `<option value="${opt.value}">${opt.label}</option>`).join("");
  const subjectConfig = getEffectiveSubjectConfig();
  const visibleCodes = subjectConfig.enabledSubjects.length > 0
    ? subjectConfig.enabledSubjects
    : subjectConfig.entries.slice(0, subjectConfig.pack.maxEnabled).map((entry) => entry.code);
  const visibleCodeSet = new Set(visibleCodes);
  const subjectButtons = subjectConfig.entries
    .filter((entry) => visibleCodeSet.has(entry.code))
    .map((entry) => {
      const label = entry.emoji ? `${entry.emoji} ${entry.label}` : entry.label;
      return `<button type="button" class="subject-btn" data-subject="${entry.code}">${escapeHtml(label)}</button>`;
    })
    .join("");
  const amountValues = ['<option value="">-</option>'].concat(Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`)).join("");

  panel.innerHTML = `
    <div class="card">
      ${panelTitleHtml(UI.declareTitle, { showGear: view !== "settings", showSubjects: true })}
      <label for="startAt">${UI.labelWhen}</label>
      <select id="startAt">${startOptions}</select>
      <div>${UI.labelWhat}</div>
      <div class="subject-grid">${subjectButtons}</div>
      <div class="row amount-row">
        <div>
          <label for="amountValue">${UI.labelHowMuch}</label>
          <select id="amountValue">${amountValues}</select>
        </div>
        <div>
          <label for="amountType" class="label-placeholder">${UI.hiddenTypeLabel}</label>
          <input id="amountType" type="hidden" value="time" />
          <div class="amount-type-toggle" role="group" aria-label="どのくらいの単位">
            <button type="button" class="amount-type-btn" data-value="time">時間</button>
            <button type="button" class="amount-type-btn" data-value="page">ページ</button>
          </div>
        </div>
      </div>
      <textarea id="contentMemo" placeholder="内容メモ（任意）"></textarea>
      <div class="declare-actions">
        <button id="submit-declare">${UI.declareSubmit}</button>
        ${plansLinkHtml}
      </div>
    </div>
  `;
  bindPanelGear(panel);
  const goPlansBtn = panel.querySelector("#go-plans");
  if (goPlansBtn) {
    goPlansBtn.onclick = () => navigateToView("plans");
  }

  const selected = new Set();
  panel.querySelectorAll(".subject-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.dataset.subject;
      if (!code) return;
      if (selected.has(code)) {
        selected.delete(code);
        btn.classList.remove("active");
      } else {
        selected.add(code);
        btn.classList.add("active");
      }
    });
  });

  const amountTypeInput = panel.querySelector("#amountType");
  const amountTypeButtons = panel.querySelectorAll(".amount-type-btn");
  const setAmountType = (value) => {
    amountTypeInput.value = value;
    amountTypeButtons.forEach((btn) => {
      const active = btn.dataset.value === value;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  };
  amountTypeButtons.forEach((btn) => {
    btn.addEventListener("click", () => setAmountType(btn.dataset.value ?? ""));
  });
  setAmountType("time");

  panel.querySelector("#submit-declare").onclick = async () => {
    const submitBtn = panel.querySelector("#submit-declare");
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = "送信中...";
    const subjects = Array.from(selected);
    if (subjects.length === 0) {
      await showToast("教科を1つ以上選択してください。");
      submitBtn.disabled = false;
      submitBtn.textContent = original;
      return;
    }
    const startAt = panel.querySelector("#startAt").value || null;
    if (!startAt) {
      const ok = await showConfirmModal({
        title: "開始時刻が「未定」だけど、だいじょうぶ？",
        message: "開始時刻を決めずに作ります。あとから変更はできません。",
        okText: "このままやるよ",
        cancelText: "選びなおす",
      });
      if (!ok) {
        submitBtn.disabled = false;
        submitBtn.textContent = original;
        return;
      }
    }
    const amountType = panel.querySelector("#amountType").value || null;
    const amountValueRaw = panel.querySelector("#amountValue").value;
    try {
      await traceAsync("callable.declarePlan", () => declarePlan({
        subjects,
        startAt,
        amountType,
        amountValue: amountValueRaw ? Number(amountValueRaw) : null,
        contentMemo: panel.querySelector("#contentMemo").value || null,
      }));
      await showToast("やるよを送ったよ");
      navigateToView("plans");
    } catch (error) {
      console.error("declarePlan failed", error);
      await showToast(toUserErrorMessage(error));
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  };
}

async function renderSubjects(panel) {
  let pack = normalizePackSelection(state.me?.subjectPackId);
  let enabledSubjects = resolveEnabledSubjects({
    packId: pack.id,
    enabledSubjects: state.me?.enabledSubjects,
  });

  const renderPanel = () => {
    const entries = getPackEntries(pack.id);
    const enabledSet = new Set(enabledSubjects);
    const count = enabledSubjects.length;
    const grouped = entries.reduce((acc, entry) => {
      const key = pack.showCategories ? entry.category : "_flat";
      if (!acc.has(key)) acc.set(key, []);
      acc.get(key).push(entry);
      return acc;
    }, new Map());

    const listHtml = Array.from(grouped.entries())
      .map(([category, items]) => {
        const categoryTitle = pack.showCategories ? `<div class="subject-category-title">${escapeHtml(category)}</div>` : "";
        const buttons = items
          .map((entry) => {
            const active = enabledSet.has(entry.code);
            const label = entry.emoji ? `${entry.emoji} ${entry.label}` : entry.label;
            return `<button type="button" class="subject-pick-btn ${active ? "active" : ""}" data-code="${entry.code}" aria-pressed="${active}">${escapeHtml(label)}</button>`;
          })
          .join("");
        return `<div class="subject-category">${categoryTitle}<div class="subject-pick-grid">${buttons}</div></div>`;
      })
      .join("");

    panel.innerHTML = `
      <div class="card">
        ${panelTitleHtml(UI.subjectCustomizeTitle, { showGear: view !== "settings" })}
        <button type="button" id="subjects-back" class="secondary plans-back-btn">← 戻る</button>
        <label for="subject-pack-select">プリセット</label>
        <select id="subject-pack-select">
          ${SUBJECT_PACKS.map((p) => `<option value="${p.id}" ${p.id === pack.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
        </select>
        <div class="muted subject-count">${count}/${pack.maxEnabled}</div>
        <div id="subject-pick-list">${listHtml}</div>
        <button type="button" id="save-subject-settings">保存する</button>
      </div>
    `;
    bindPanelGear(panel);

    panel.querySelector("#subjects-back").onclick = () => navigateToView("declare");
    panel.querySelector("#subject-pack-select").addEventListener("change", (e) => {
      pack = normalizePackSelection(e.target.value);
      enabledSubjects = resolveEnabledSubjects({ packId: pack.id, enabledSubjects: [] });
      renderPanel();
    });

    panel.querySelectorAll(".subject-pick-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const code = btn.dataset.code;
        if (!code) return;
        const exists = enabledSubjects.includes(code);
        if (exists) {
          enabledSubjects = enabledSubjects.filter((v) => v !== code);
          renderPanel();
          return;
        }
        if (enabledSubjects.length >= pack.maxEnabled) {
          await showToast(`教科は最大${pack.maxEnabled}個までです`);
          return;
        }
        enabledSubjects = [...enabledSubjects, code];
        renderPanel();
      });
    });

    panel.querySelector("#save-subject-settings").addEventListener("click", async () => {
      const saveBtn = panel.querySelector("#save-subject-settings");
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      const original = saveBtn.textContent;
      saveBtn.textContent = "保存中...";
      const normalized = resolveEnabledSubjects({
        packId: pack.id,
        enabledSubjects,
      });
      try {
        await traceAsync("firestore.updateMySettings", () => updateMySettings(auth.currentUser.uid, {
          subjectPackId: pack.id,
          enabledSubjects: normalized,
          updatedAt: new Date(),
        }));
        const me = await traceAsync("firestore.getMyUser", () => getMyUser(auth.currentUser.uid));
        state.me = { uid: auth.currentUser.uid, ...(me ?? {}) };
        await showToast("保存しました。");
        navigateToView("declare");
      } catch (error) {
        console.error("save subject settings failed", error);
        await showToast(toUserErrorMessage(error));
        saveBtn.disabled = false;
        saveBtn.textContent = original;
      }
    });
  };

  renderPanel();
}

async function renderPlans(panel) {
  panel.innerHTML = `
    <div class="card">
      ${panelTitleHtml("ほかのやるよ", { showGear: view !== "settings" })}
      <button type="button" id="plans-back" class="secondary plans-back-btn">← 戻る</button>
      <div id="plans-list" class="plans-list"></div>
      <div id="plans-loading" class="muted" style="display:none;">読み込み中...</div>
      <div id="plans-sentinel"></div>
    </div>
  `;
  bindPanelGear(panel);
  panel.querySelector("#plans-back").onclick = () => navigateToView("declare");

  const listEl = panel.querySelector("#plans-list");
  const loadingEl = panel.querySelector("#plans-loading");
  const sentinel = panel.querySelector("#plans-sentinel");
  const titleEl = panel.querySelector(".panel-title-row h3");

  const planMap = new Map();
  let cursor = null;
  let hasMore = true;
  let isLoading = false;
  let totalLoaded = 0;

  const updateTitle = () => {
    titleEl.textContent = totalLoaded > 0 ? `ほかのやるよ（${totalLoaded}）` : "ほかのやるよ";
  };
  const updateEmptyState = () => {
    if (totalLoaded === 0) {
      listEl.innerHTML = `<div class="muted">ほかのやるよはありません</div>`;
    } else {
      const empty = listEl.querySelector(".muted");
      if (empty && empty.textContent === "ほかのやるよはありません") {
        empty.remove();
      }
    }
  };

  const renderPlanItem = (plan) => {
    const subjects = Array.isArray(plan.subjects) ? plan.subjects.map(subjectDisplay).join("・") : UI.placeholder;
    const startTime = formatStartSlotTime(plan.startSlot);
    return `
      <div class="plan-item" data-plan-id="${escapeHtml(plan.id)}" role="button" tabindex="0">
        <div class="plan-main">
          <div class="plan-time">${escapeHtml(startTime)}</div>
          <div class="plan-subjects">${escapeHtml(subjects)}</div>
        </div>
        <div class="plan-item-actions">
          <button type="button" class="secondary plan-action-btn" data-action="record" data-plan-id="${escapeHtml(plan.id)}">やったよ</button>
          <button type="button" class="secondary plan-action-btn" data-action="delete" data-plan-id="${escapeHtml(plan.id)}">削除</button>
        </div>
      </div>
    `;
  };

  const loadMore = async () => {
    if (isLoading || !hasMore) return;
    isLoading = true;
    loadingEl.style.display = "block";
    try {
      const page = await traceAsync("firestore.listOpenPlansPage", () => listOpenPlansPage({
        familyId: state.familyId,
        uid: auth.currentUser.uid,
        limitCount: 50,
        cursor,
      }));
      cursor = page.cursor;
      hasMore = page.hasMore;
      if (page.items.length === 0 && totalLoaded === 0) {
        listEl.innerHTML = `<div class="muted">ほかのやるよはありません</div>`;
      } else {
        page.items.forEach((plan) => {
          planMap.set(plan.id, plan);
          listEl.insertAdjacentHTML("beforeend", renderPlanItem(plan));
        });
        totalLoaded += page.items.length;
      }
      updateTitle();
    } finally {
      isLoading = false;
      loadingEl.style.display = "none";
    }
  };

  listEl.addEventListener("click", async (e) => {
    const actionBtn = e.target.closest(".plan-action-btn");
    if (actionBtn) {
      e.preventDefault();
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      const planId = actionBtn.dataset.planId;
      if (!planId) return;
      if (action === "record") {
        navigateToRecordWithPlan(planId);
        return;
      }
      if (action === "delete") {
        if (actionBtn.disabled) return;
        actionBtn.disabled = true;
        const ok = await showConfirmModal({
          title: "削除していい？",
          message: "この「やるよ」を消します。",
          okText: "削除する",
          cancelText: "やめる",
        });
        if (!ok) {
          actionBtn.disabled = false;
          return;
        }
        const item = actionBtn.closest(".plan-item");
        if (!item) {
          try {
            await traceAsync("firestore.cancelPlan", () => cancelPlan(planId));
            await showToast("削除しました");
          } catch (error) {
            console.error("cancelPlan failed (no plan-item)", error);
            await showToast("削除に失敗しました");
          } finally {
            actionBtn.disabled = false;
            await renderPlans(panel);
          }
          return;
        }
        const nextSibling = item?.nextSibling ?? null;
        const parent = item?.parentNode ?? null;
        const plan = planMap.get(planId) ?? null;
        const hadPlan = !!plan;
        item.style.opacity = "0.2";
        item.style.pointerEvents = "none";
        item.remove();
        if (hadPlan) {
          planMap.delete(planId);
          totalLoaded = Math.max(0, totalLoaded - 1);
          updateTitle();
          updateEmptyState();
        }
        try {
          await traceAsync("firestore.cancelPlan", () => cancelPlan(planId));
          await showToast("削除しました");
        } catch (error) {
          console.error("cancelPlan failed", error);
          if (parent && item) {
            parent.insertBefore(item, nextSibling);
            item.style.opacity = "";
            item.style.pointerEvents = "";
          }
          if (hadPlan && plan) {
            planMap.set(planId, plan);
            totalLoaded += 1;
            updateTitle();
            updateEmptyState();
          }
          actionBtn.disabled = false;
          await showToast("削除に失敗しました");
        }
      }
      return;
    }

    const item = e.target.closest(".plan-item");
    if (!item) return;
    const planId = item.dataset.planId;
    const plan = planId ? planMap.get(planId) : null;
    if (!plan) return;
    const overlay = createPlanDetailModal(plan);
    document.body.appendChild(overlay);
  });

  listEl.addEventListener("keydown", (e) => {
    const item = e.target.closest(".plan-item");
    if (!item) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const planId = item.dataset.planId;
    const plan = planId ? planMap.get(planId) : null;
    if (!plan) return;
    const overlay = createPlanDetailModal(plan);
    document.body.appendChild(overlay);
  });

  const observer = new IntersectionObserver((entries) => {
    const hit = entries.some((entry) => entry.isIntersecting);
    if (hit) loadMore();
  });
  observer.observe(sentinel);
  await loadMore();
}

function planSummary(plan) {
  const subjects = Array.isArray(plan.subjects) ? plan.subjects.map(subjectDisplay).join(", ") : UI.placeholder;
  const when = formatPlanStart(plan);
  const created = formatDateTime(plan.createdAt);
  return { subjects, when, created };
}

function renderRecordForm(panel, plan) {
  const summary = planSummary(plan);
  panel.innerHTML = `
    <div class="card">
      ${panelTitleHtml(UI.recordTitle, { showGear: view !== "settings" })}
      <div class="muted">${escapeHtml(summary.subjects)} ${escapeHtml(summary.when)}</div>
      <select id="result">
        <option value="light">軽め</option>
        <option value="as_planned">予定通り</option>
        <option value="extra">多め</option>
      </select>
      <textarea id="recordMemo" placeholder="内容メモ（任意）"></textarea>
      <button id="submit-record">${UI.recordSubmit}</button>
    </div>
  `;
  bindPanelGear(panel);
  panel.querySelector("#submit-record").onclick = async () => {
    const submitBtn = panel.querySelector("#submit-record");
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = "送信中...";
    const memo = panel.querySelector("#recordMemo").value || null;
    try {
      await traceAsync("callable.recordPlan", () => recordPlan(plan.id, panel.querySelector("#result").value, memo));
      await showToast("やったよを記録しました");
      await renderStats(panel);
    } catch (error) {
      console.error("recordPlan failed", error);
      await showToast(toUserErrorMessage(error));
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  };
}

async function renderRecord(panel) {
  panel.innerHTML = `<div class="card"><div class="muted">読み込み中...</div></div>`;
  const plans = await traceAsync("firestore.listPlans", () => listPlans(state.familyId, auth.currentUser.uid, false, 50));
  const openPlans = plans.filter((p) => p.status === "declared");
  const preferredPlanId = params.get("planId");
  if (preferredPlanId) {
    const preferred = openPlans.find((p) => p.id === preferredPlanId);
    if (preferred) {
      renderRecordForm(panel, preferred);
      return;
    }
  }
  if (openPlans.length === 0) {
    panel.innerHTML = `
      <div class="card">
        ${panelTitleHtml(UI.recordTitle, { showGear: view !== "settings" })}
        <div class="muted">やるよがありません</div>
        <button id="go-declare">やるよへ</button>
      </div>
    `;
    bindPanelGear(panel);
    panel.querySelector("#go-declare").onclick = () => navigateToView("declare");
    return;
  }
  if (openPlans.length === 1) {
    renderRecordForm(panel, openPlans[0]);
    return;
  }
  panel.innerHTML = `
    <div class="card">
      ${panelTitleHtml(UI.recordTitle, { showGear: view !== "settings" })}
      <div class="muted">対象のやるよを選択してください</div>
      <div class="record-grid" id="open-plan-list"></div>
    </div>
  `;
  bindPanelGear(panel);
  const list = panel.querySelector("#open-plan-list");
  openPlans.forEach((plan) => {
    const s = planSummary(plan);
    const card = el(`
      <button class="record-card">
        <div class="record-head">
          <div class="record-meta">
            <div class="record-name">${escapeHtml(s.subjects)}</div>
            <div class="muted">開始: ${escapeHtml(s.when)} / 作成: ${escapeHtml(s.created)}</div>
          </div>
        </div>
      </button>
    `);
    card.addEventListener("click", () => renderRecordForm(panel, plan));
    list.appendChild(card);
  });
}

function createRecordDetailModal(record, user) {
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal-card">
        <button class="modal-close" aria-label="close">&times;</button>
        <div class="modal-body">
          <div class="profile-header">
            ${avatarHtml(user, "user")}
            <div class="profile-meta">
              <div class="profile-name">${escapeHtml(getEffectiveDisplayName(user, record.userId))}</div>
            </div>
          </div>
          <section class="modal-section">
            <h4 class="section-title">${UI.sectionPlan}</h4>
            <div id="plan-detail-loading" class="muted">読み込み中...</div>
            <div id="plan-detail-content"></div>
          </section>
          <section class="modal-section">
            <h4 class="section-title">${UI.sectionRecord}</h4>
            <div class="section-row">
              <div class="section-label">${UI.doneAt}</div>
              <div class="section-value">
                <div class="section-inline">
                  <span>${formatDateTime(record.recordedAt || record.createdAt)}</span>
                  <span class="record-result">${escapeHtml(resultLabel(record.result))}</span>
                </div>
              </div>
            </div>
            <div class="section-row"><div class="section-label">${UI.memo}</div><div class="section-value detail-text">${record.memo ? escapeHtml(record.memo) : UI.placeholder}</div></div>
          </section>
        </div>
      </div>
    </div>
  `);
  const close = () => overlay.remove();
  overlay.querySelector(".modal-close").onclick = close;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  return overlay;
}

function buildPlanDetailRows(plan) {
  if (!plan) {
    return `
      <div class="section-row"><div class="section-label">${UI.subject}</div><div class="section-value">${UI.placeholder}</div></div>
      <div class="section-row"><div class="section-label">${UI.startAt}</div><div class="section-value">${UI.placeholder}</div></div>
      <div class="section-row"><div class="section-label">${UI.amount}</div><div class="section-value">${UI.placeholder}</div></div>
      <div class="section-row"><div class="section-label">${UI.memo}</div><div class="section-value">${UI.placeholder}</div></div>
    `;
  }
  const subjects = Array.isArray(plan.subjects) ? plan.subjects.map(subjectDisplay).join(", ") : UI.placeholder;
  const start = formatPlanStart(plan);
  let amount = UI.placeholder;
  if (plan.amountType && plan.amountValue != null) {
    amount = `${plan.amountValue}${plan.amountType === "time" ? "時間" : "ページ"}`;
  }
  const memo = plan.contentMemo ? escapeHtml(plan.contentMemo) : UI.placeholder;
  return `
    <div class="section-row"><div class="section-label">${UI.subject}</div><div class="section-value">${escapeHtml(subjects)}</div></div>
    <div class="section-row"><div class="section-label">${UI.startAt}</div><div class="section-value">${escapeHtml(start)}</div></div>
    <div class="section-row"><div class="section-label">${UI.amount}</div><div class="section-value">${escapeHtml(amount)}</div></div>
    <div class="section-row"><div class="section-label">${UI.memo}</div><div class="section-value detail-text">${memo}</div></div>
  `;
}

function createPlanDetailModal(plan) {
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal-card">
        <button class="modal-close" aria-label="close">&times;</button>
        <div class="modal-body">
          <section class="modal-section">
            <h4 class="section-title">${UI.sectionPlan}</h4>
            <div id="plan-detail-content">${buildPlanDetailRows(plan)}</div>
          </section>
        </div>
      </div>
    </div>
  `);
  const close = () => overlay.remove();
  overlay.querySelector(".modal-close").onclick = close;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  return overlay;
}

async function fillPlanDetail(overlay, record) {
  const loading = overlay.querySelector("#plan-detail-loading");
  const content = overlay.querySelector("#plan-detail-content");
  const plan = await traceAsync("firestore.getPlanById", () => getPlanById(record.planId || record.id));
  loading.remove();
  content.innerHTML = buildPlanDetailRows(plan);
}

async function renderStats(panel) {
  panel.innerHTML = "";
  let members;
  try {
    members = await traceAsync("firestore.listFamilyMembers", () => listFamilyMembers(state.familyId));
  } catch (error) {
    console.error("Query failed: listFamilyMembers", { familyId: state.familyId, error });
    throw error;
  }
  const userMap = new Map(members.map((m) => [m.userId, m]));
  userMap.set(state.me.uid, { ...state.me, userId: state.me.uid });

  const sortedMembers = sortMembersByRoleThenJoinedAtAsc(members);
  const myMember = sortedMembers.find((m) => m.userId === auth.currentUser.uid);
  const isParent = myMember?.role === "parent";
  const memberOptions = [`<option value="all">全員</option>`]
    .concat(sortedMembers.map((m) => `<option value="${m.userId}">${getEffectiveDisplayName(m, m.userId)}</option>`))
    .join("");

  let plans;
  try {
    plans = await traceAsync("firestore.listPlans", () => listPlans(state.familyId, auth.currentUser.uid, isParent, 500));
  } catch (error) {
    console.error("Query failed: listPlans", { familyId: state.familyId, isParent, error });
    throw error;
  }
  const planMap = new Map(plans.map((p) => [p.id, p]));

  const node = el(`
    <div class="card">
      ${panelTitleHtml(UI.statsTitle, { showGear: view !== "settings" })}
      ${isParent ? `<select id="memberFilter">${memberOptions}</select>` : ""}
      <div id="stats-record-list" class="record-grid"></div>
      <div id="stats-loading" class="muted" style="display:none;">読み込み中...</div>
      <div id="stats-sentinel"></div>
    </div>
  `);
  panel.appendChild(node);
  bindPanelGear(node);

  if (isParent) {
    node.querySelector("#memberFilter").value = state.memberFilter;
    node.querySelector("#memberFilter").onchange = async (e) => {
      state.memberFilter = e.target.value;
      await renderStats(panel);
    };
  }

  const listEl = node.querySelector("#stats-record-list");
  const loadingEl = node.querySelector("#stats-loading");
  const sentinel = node.querySelector("#stats-sentinel");
  const recordMap = new Map();
  let cursor = null;
  let hasMore = true;
  let isLoading = false;
  let totalLoaded = 0;

  const renderRecordCard = (record) => {
    const user = userMap.get(record.userId) || { userId: record.userId };
    const plan = planMap.get(record.planId || record.id);
    const planSubjects = Array.isArray(plan?.subjects) ? plan.subjects.map(subjectDisplay).join(", ") : UI.placeholder;
    const planStart = formatPlanStart(plan);
    const memoPreview = record.memo ? `<div class="record-memo">${escapeHtml(String(record.memo))}</div>` : "";
    return `
      <button class="record-card" data-record-id="${escapeHtml(record.id)}">
        <div class="record-head">
          ${avatarHtml(user, "user")}
          <div class="record-meta">
            <div class="record-name">${escapeHtml(getEffectiveDisplayName(user, record.userId))}</div>
            <div class="muted">${escapeHtml(planSubjects)}</div>
            <div class="muted">やるよ：${escapeHtml(planStart)}</div>
            <div class="muted">やったよ：${escapeHtml(formatDateTime(record.recordedAt || record.createdAt))}</div>
          </div>
          <span class="record-result">${escapeHtml(resultLabel(record.result))}</span>
        </div>
        ${memoPreview}
      </button>
    `;
  };

  const loadMore = async () => {
    if (isLoading || !hasMore) return;
    isLoading = true;
    loadingEl.style.display = "block";
    try {
      const page = await traceAsync("firestore.listRecordsPage", () => listRecordsPage({
        familyId: state.familyId,
        uid: auth.currentUser.uid,
        isParent,
        memberFilter: state.memberFilter,
        limitCount: 20,
        cursor,
      }));
      cursor = page.cursor;
      hasMore = page.hasMore;
      if (page.items.length === 0 && totalLoaded === 0) {
        listEl.innerHTML = "<div class='muted'>まだ過去のやったよがありません。</div>";
      } else {
        page.items.forEach((record) => {
          recordMap.set(record.id, record);
          listEl.insertAdjacentHTML("beforeend", renderRecordCard(record));
        });
        totalLoaded += page.items.length;
      }
    } finally {
      isLoading = false;
      loadingEl.style.display = "none";
    }
  };

  listEl.addEventListener("click", async (e) => {
    const card = e.target.closest(".record-card");
    if (!card) return;
    const recordId = card.dataset.recordId;
    const record = recordMap.get(recordId);
    if (!record) return;
    const user = userMap.get(record.userId) || { userId: record.userId };
    const overlay = createRecordDetailModal(record, user);
    document.body.appendChild(overlay);
    await fillPlanDetail(overlay, record);
  });

  const observer = new IntersectionObserver((entries) => {
    const hit = entries.some((entry) => entry.isIntersecting);
    if (hit) loadMore();
  });
  observer.observe(sentinel);
  await loadMore();
}

function bootstrapOnce() {
  if (!globalState.__YARUYO_BOOTSTRAP_PROMISE__) {
    globalState.__YARUYO_BOOTSTRAP_PROMISE__ = bootstrap();
  }
  return globalState.__YARUYO_BOOTSTRAP_PROMISE__;
}

if (shouldBoot) {
  ensureAvatarErrorHandler();
  loadBuildId();
  ensurePreDebugHud();
  registerGlobalErrorHandlers();
  showLoadingBanner();
  bootstrapOnce().catch((e) => {
    phaseLog("BOOTSTRAP_FATAL", { message: e?.message ?? String(e) });
    setPreDebugError(e);
    setDebugError(e);
    hideLoadingBanner();
    renderFatalErrorPanel(currentBootPhase, e);
    uploadDebugLogIfEnabled("bootstrap.catch", {
      message: e?.message ?? String(e),
      stack: extractErrorMeta(e).stack,
    });
  });
}
