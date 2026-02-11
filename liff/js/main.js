import {
  auth,
  createFamily,
  declarePlan,
  getMyUser,
  getPlanById,
  joinFamilyByCode,
  listFamilyMembers,
  listPlans,
  listRecords,
  recordPlan,
  subscribeMyUser,
  updateMySettings,
  upsertMyUserProfile,
  waitAuth,
} from "./api.js";
import { state } from "./state.js";
import { subjectLabel } from "./subjectDict.js";

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
const topbar = document.querySelector(".topbar");
const params = new URLSearchParams(location.search);
const view = ["declare", "record", "stats", "settings"].includes(params.get("view")) ? params.get("view") : null;

const UI = {
  declareTitle: "やるよ",
  declareSubmit: "やるよ！",
  recordTitle: "やったよ",
  recordSubmit: "やったよ！",
  statsTitle: "実績",
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
};

let currentPanel = null;
let liffProfile = null;
let unsubscribeUser = null;
let settingsModalState = null;

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
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
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  return null;
}

function formatDateTime(value) {
  const d = toDateMaybe(value);
  if (!d) return UI.placeholder;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function formatStartTime(value) {
  const d = toDateMaybe(value);
  if (!d) return UI.placeholder;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function resultLabel(value) {
  if (value === "light") return "軽め";
  if (value === "as_planned") return "予定通り";
  if (value === "extra") return "多め";
  return value ?? UI.placeholder;
}

function getEffectiveDisplayName(user, fallbackUid) {
  return user?.displayName ?? user?.appDisplayName ?? liffProfile?.displayName ?? fallbackUid;
}

function getPictureUrl(user) {
  return typeof user?.pictureUrl === "string" && user.pictureUrl ? user.pictureUrl : null;
}

function avatarHtml(user, alt = "avatar") {
  const url = getPictureUrl(user);
  if (url) {
    return `<span class="avatar"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" /></span>`;
  }
  return `<span class="avatar avatar-fallback" aria-label="${escapeHtml(alt)}"></span>`;
}

function refreshHeaderView() {
  const header = root.querySelector(".profile-header");
  if (!header || !state.me?.uid) return;
  const avatar = header.querySelector(".header-avatar");
  const name = header.querySelector(".header-name");
  if (avatar) avatar.innerHTML = avatarHtml(state.me, "me");
  if (name) name.textContent = getEffectiveDisplayName(state.me, state.me.uid);
}

function startUserSubscription(uid) {
  if (unsubscribeUser) {
    unsubscribeUser();
    unsubscribeUser = null;
  }
  unsubscribeUser = subscribeMyUser(uid, (userDoc) => {
    state.me = { uid, ...(userDoc ?? {}) };
    state.familyId = userDoc?.familyId ?? state.familyId ?? null;
    refreshHeaderView();
  });
}

async function getLiffProfileSafe() {
  const liffApi = window.liff;
  if (!liffApi || typeof liffApi.getProfile !== "function") return null;
  if (typeof liffApi.isInClient === "function" && !liffApi.isInClient()) return null;
  try {
    return await liffApi.getProfile();
  } catch {
    return null;
  }
}

async function syncLiffProfile(uid, me) {
  liffProfile = await getLiffProfileSafe();
  if (!liffProfile) return;
  const payload = {
    pictureUrl: liffProfile.pictureUrl ?? null,
    lineUserId: liffProfile.userId ?? null,
    updatedAt: new Date(),
  };
  if (!me?.displayName) payload.displayName = liffProfile.displayName ?? null;
  await upsertMyUserProfile(uid, payload);
}

function ceilToHalfHour(date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  if (m === 0 || m === 30) return d;
  if (m < 30) d.setMinutes(30);
  else {
    d.setHours(d.getHours() + 1);
    d.setMinutes(0);
  }
  return d;
}

function buildStartTimeOptions() {
  const now = new Date();
  const start = ceilToHalfHour(now);
  const end = new Date(now);
  end.setHours(21, 30, 0, 0);
  const result = [{ label: "未定", value: "" }];
  for (let t = new Date(start); t <= end; t = new Date(t.getTime() + 30 * 60 * 1000)) {
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    result.push({ label: `${hh}:${mm}`, value: t.toISOString() });
  }
  return result;
}

function navigateToView(nextView) {
  const q = new URLSearchParams(location.search);
  q.set("view", nextView);
  const query = q.toString();
  location.href = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
}

async function tryCloseLiffWindow() {
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

function ensureGearButton() {
  if (!topbar || topbar.querySelector("#global-settings")) return;
  const button = el(`<button id="global-settings" class="icon-btn" aria-label="settings">&#9881;</button>`);
  button.addEventListener("click", async () => {
    if (!auth.currentUser) return;
    openSettingsModal();
  });
  topbar.appendChild(button);
}

function createSettingsContent({ modal = false, showBack = false } = {}) {
  const displayNameForInput = state.me?.displayName ?? state.me?.appDisplayName ?? liffProfile?.displayName ?? "";
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
            ${uidText ? `<div class="muted">UID: ${escapeHtml(uidText)}</div>` : ""}
          </div>
        </div>
        ${modal ? "" : `<h3 class="settings-title">設定</h3>`}
        <input id="displayName" placeholder="表示名" value="${escapeHtml(displayNameForInput)}" />
        <div class="setting-toggle-row">
          <span>宣言通知を受け取る</span>
          <input id="notifyPlan" type="checkbox" ${state.me.notifyActivityPlan ? "checked" : ""} />
        </div>
        <div class="setting-toggle-row">
          <span>完了通知を受け取る</span>
          <input id="notifyRecord" type="checkbox" ${state.me.notifyActivityRecord ? "checked" : ""} />
        </div>
        <button id="save-settings">保存する</button>
      </div>
    </div>
  `);

  if (showBack) {
    wrapper.querySelector("#settings-back").onclick = () => navigateToView("declare");
  }

  wrapper.querySelector("#save-settings").onclick = async () => {
    await updateMySettings(auth.currentUser.uid, {
      appDisplayName: wrapper.querySelector("#displayName").value || null,
      notifyActivityPlan: wrapper.querySelector("#notifyPlan").checked,
      notifyActivityRecord: wrapper.querySelector("#notifyRecord").checked,
      updatedAt: new Date(),
    });
    const me = await getMyUser(auth.currentUser.uid);
    state.me = { uid: auth.currentUser.uid, ...(me ?? {}) };
    refreshHeaderView();
    const nextName = state.me?.displayName ?? state.me?.appDisplayName ?? liffProfile?.displayName ?? "";
    wrapper.querySelector("#displayName").value = nextName;
    const titleName = wrapper.querySelector(".settings-user-card .profile-name");
    if (titleName) titleName.textContent = nextName || "ユーザー";
    alert("保存しました。");
  };

  return wrapper;
}

function closeSettingsModal() {
  if (!settingsModalState) return;
  document.removeEventListener("keydown", settingsModalState.onKeyDown);
  settingsModalState.overlay.remove();
  settingsModalState = null;
}

function openSettingsModal() {
  if (settingsModalState) return;
  const overlay = el(`
    <div class="settings-modal-overlay">
      <div class="settings-modal-card">
        <button class="settings-modal-close" aria-label="close">&times;</button>
        <div class="settings-modal-body"></div>
      </div>
    </div>
  `);
  const body = overlay.querySelector(".settings-modal-body");
  body.appendChild(createSettingsContent({ modal: true, showBack: false }));
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

function renderSettingsPage(panel) {
  panel.innerHTML = "";
  panel.appendChild(createSettingsContent({ modal: false, showBack: true }));
}

async function bootstrap() {
  ensureGearButton();
  const user = await waitAuth();
  if (!user) {
    root.innerHTML = `<div class="card">認証が必要です。</div>`;
    return;
  }
  let me = await getMyUser(user.uid);
  await syncLiffProfile(user.uid, me);
  me = await getMyUser(user.uid);
  state.me = { uid: user.uid, ...(me ?? {}) };
  state.familyId = me?.familyId ?? null;
  startUserSubscription(user.uid);
  await render();
}

async function render() {
  if (!state.familyId) {
    renderOnboarding();
    return;
  }
  await renderHome();
}

function renderOnboarding() {
  root.innerHTML = `
    <div>
      <div class="card">
        <h3>家族を作成</h3>
        <button id="create-family">作成する</button>
      </div>
      <div class="card">
        <h3>コードで参加</h3>
        <input id="join-code" placeholder="6桁コード" maxlength="6" />
        <button id="join-family">参加する</button>
      </div>
    </div>
  `;
  root.querySelector("#create-family").onclick = async () => {
    await createFamily();
    const me = await getMyUser(auth.currentUser.uid);
    state.familyId = me.familyId;
    await render();
  };
  root.querySelector("#join-family").onclick = async () => {
    const code = root.querySelector("#join-code").value;
    await joinFamilyByCode(code);
    const me = await getMyUser(auth.currentUser.uid);
    state.familyId = me.familyId;
    await render();
  };
}

async function renderHome() {
  root.innerHTML = `
    <div>
      ${(!view || view === "settings") ? `
      <div class="card profile-header">
        <div class="header-avatar">${avatarHtml(state.me, "me")}</div>
        <div class="profile-meta">
          <div class="profile-name header-name">${escapeHtml(getEffectiveDisplayName(state.me, state.me.uid))}</div>
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
  else await renderDeclare(currentPanel);
}

async function renderDeclare(panel) {
  const startOptions = buildStartTimeOptions().map((opt) => `<option value="${opt.value}">${opt.label}</option>`).join("");
  const subjectOptions = [
    { code: "en", label: "英語" },
    { code: "math", label: "数学" },
    { code: "jp", label: "国語" },
    { code: "sci", label: "理科" },
    { code: "soc", label: "社会" },
    { code: "other", label: "その他" },
  ];
  const subjectButtons = subjectOptions.map((s) => `<button type="button" class="subject-btn" data-subject="${s.code}">${s.label}</button>`).join("");
  const amountValues = ['<option value="">-</option>'].concat(Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`)).join("");

  panel.innerHTML = `
    <div class="card">
      <h3>${UI.declareTitle}</h3>
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
          <select id="amountType">
            <option value="">-</option>
            <option value="time">時間</option>
            <option value="page">ページ</option>
          </select>
        </div>
      </div>
      <textarea id="contentMemo" placeholder="内容メモ（任意）"></textarea>
      <button id="submit-declare">${UI.declareSubmit}</button>
    </div>
  `;

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

  panel.querySelector("#submit-declare").onclick = async () => {
    const subjects = Array.from(selected);
    if (subjects.length === 0) {
      alert("教科を1つ以上選択してください。");
      return;
    }
    const startAt = panel.querySelector("#startAt").value || null;
    const amountType = panel.querySelector("#amountType").value || null;
    const amountValueRaw = panel.querySelector("#amountValue").value;
    await declarePlan({
      subjects,
      startAt,
      amountType,
      amountValue: amountValueRaw ? Number(amountValueRaw) : null,
      contentMemo: panel.querySelector("#contentMemo").value || null,
    });
    panel.innerHTML = `
      <div class="card">
        <h3>宣言しました！</h3>
        <div class="row">
          <button id="close-liff">閉じる</button>
          <button id="go-stats" class="secondary">実績を見る</button>
        </div>
      </div>
    `;
    panel.querySelector("#close-liff").onclick = () => tryCloseLiffWindow();
    panel.querySelector("#go-stats").onclick = () => navigateToView("stats");
  };
}

function planSummary(plan) {
  const subjects = Array.isArray(plan.subjects) ? plan.subjects.map(subjectLabel).join(", ") : UI.placeholder;
  const when = plan.startSlot || UI.placeholder;
  const created = formatDateTime(plan.createdAt);
  return { subjects, when, created };
}

function renderRecordForm(panel, plan) {
  const summary = planSummary(plan);
  panel.innerHTML = `
    <div class="card">
      <h3>${UI.recordTitle}</h3>
      <div class="muted">対象: ${escapeHtml(summary.subjects)} / ${escapeHtml(summary.when)}</div>
      <select id="result">
        <option value="light">軽め</option>
        <option value="as_planned">予定通り</option>
        <option value="extra">多め</option>
      </select>
      <textarea id="recordMemo" placeholder="内容メモ（任意）"></textarea>
      <button id="submit-record">${UI.recordSubmit}</button>
    </div>
  `;
  panel.querySelector("#submit-record").onclick = async () => {
    const memo = panel.querySelector("#recordMemo").value || null;
    await recordPlan(plan.id, panel.querySelector("#result").value, memo);
    alert("記録しました。");
    await renderStats(panel);
  };
}

async function renderRecord(panel) {
  panel.innerHTML = `<div class="card"><div class="muted">読み込み中...</div></div>`;
  const plans = await listPlans(state.familyId, auth.currentUser.uid, false, 50);
  const openPlans = plans.filter((p) => p.status === "declared");
  if (openPlans.length === 0) {
    panel.innerHTML = `
      <div class="card">
        <h3>${UI.recordTitle}</h3>
        <div class="muted">やるよがありません</div>
        <button id="go-declare">やるよへ</button>
      </div>
    `;
    panel.querySelector("#go-declare").onclick = () => navigateToView("declare");
    return;
  }
  if (openPlans.length === 1) {
    renderRecordForm(panel, openPlans[0]);
    return;
  }
  panel.innerHTML = `
    <div class="card">
      <h3>${UI.recordTitle}</h3>
      <div class="muted">対象のやるよを選択してください</div>
      <div class="record-grid" id="open-plan-list"></div>
    </div>
  `;
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
              <div class="muted">${resultLabel(record.result)}</div>
            </div>
          </div>
          <section class="modal-section">
            <h4 class="section-title">${UI.sectionRecord}</h4>
            <div class="section-row"><div class="section-label">${UI.doneAt}</div><div class="section-value">${formatDateTime(record.recordedAt || record.createdAt)}</div></div>
            <div class="section-row"><div class="section-label">${UI.memo}</div><div class="section-value detail-text">${record.memo ? escapeHtml(record.memo) : UI.placeholder}</div></div>
          </section>
          <section class="modal-section">
            <h4 class="section-title">${UI.sectionPlan}</h4>
            <div id="plan-detail-loading" class="muted">読み込み中...</div>
            <div id="plan-detail-content"></div>
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
  const plan = await getPlanById(record.planId || record.id);
  loading.remove();
  if (!plan) {
    content.innerHTML = `
      <div class="section-row"><div class="section-label">${UI.subject}</div><div class="section-value">${UI.placeholder}</div></div>
      <div class="section-row"><div class="section-label">${UI.startAt}</div><div class="section-value">${UI.placeholder}</div></div>
      <div class="section-row"><div class="section-label">${UI.amount}</div><div class="section-value">${UI.placeholder}</div></div>
      <div class="section-row"><div class="section-label">${UI.memo}</div><div class="section-value">${UI.placeholder}</div></div>
    `;
    return;
  }
  const subjects = Array.isArray(plan.subjects) ? plan.subjects.map(subjectLabel).join(", ") : UI.placeholder;
  const start = plan.startAt ? formatStartTime(plan.startAt) : UI.placeholder;
  let amount = UI.placeholder;
  if (plan.amountType && plan.amountValue != null) {
    amount = `${plan.amountValue}${plan.amountType === "time" ? "時間" : "ページ"}`;
  }
  const memo = plan.contentMemo ? escapeHtml(plan.contentMemo) : UI.placeholder;
  content.innerHTML = `
    <div class="section-row"><div class="section-label">${UI.subject}</div><div class="section-value">${escapeHtml(subjects)}</div></div>
    <div class="section-row"><div class="section-label">${UI.startAt}</div><div class="section-value">${escapeHtml(start)}</div></div>
    <div class="section-row"><div class="section-label">${UI.amount}</div><div class="section-value">${escapeHtml(amount)}</div></div>
    <div class="section-row"><div class="section-label">${UI.memo}</div><div class="section-value detail-text">${memo}</div></div>
  `;
}

async function renderStats(panel) {
  panel.innerHTML = "";
  const members = await listFamilyMembers(state.familyId);
  const userMap = new Map(members.map((m) => [m.userId, m]));
  userMap.set(state.me.uid, { ...state.me, userId: state.me.uid });

  const myMember = members.find((m) => m.userId === auth.currentUser.uid);
  const isParent = myMember?.role === "parent";
  const memberOptions = [`<option value="all">全員</option>`]
    .concat(members.map((m) => `<option value="${m.userId}">${getEffectiveDisplayName(m, m.userId)}</option>`))
    .join("");
  const records = await listRecords(state.familyId, auth.currentUser.uid, isParent, state.memberFilter, 20);
  const node = el(`
    <div class="card">
      <h3>${UI.statsTitle}</h3>
      ${isParent ? `<select id="memberFilter">${memberOptions}</select>` : ""}
      <div class="record-grid">
        ${
          records.length === 0
            ? "<div class='muted'>まだ実績がありません。</div>"
            : records
                .map((r) => {
                  const user = userMap.get(r.userId) || { userId: r.userId };
                  const memoPreview = r.memo ? `<div class="record-memo">${escapeHtml(String(r.memo))}</div>` : "";
                  return `
                    <button class="record-card" data-record-id="${r.id}">
                      <div class="record-head">
                        ${avatarHtml(user, "user")}
                        <div class="record-meta">
                          <div class="record-name">${escapeHtml(getEffectiveDisplayName(user, r.userId))}</div>
                          <div class="muted">${escapeHtml(formatDateTime(r.recordedAt || r.createdAt))}</div>
                        </div>
                        <span class="record-result">${escapeHtml(resultLabel(r.result))}</span>
                      </div>
                      ${memoPreview}
                    </button>
                  `;
                })
                .join("")
        }
      </div>
    </div>
  `);
  panel.appendChild(node);

  if (isParent) {
    node.querySelector("#memberFilter").value = state.memberFilter;
    node.querySelector("#memberFilter").onchange = async (e) => {
      state.memberFilter = e.target.value;
      await renderStats(panel);
    };
  }
  node.querySelectorAll(".record-card").forEach((card) => {
    card.addEventListener("click", async () => {
      const recordId = card.dataset.recordId;
      const record = records.find((r) => r.id === recordId);
      if (!record) return;
      const user = userMap.get(record.userId) || { userId: record.userId };
      const overlay = createRecordDetailModal(record, user);
      document.body.appendChild(overlay);
      await fillPlanDetail(overlay, record);
    });
  });
}

if (shouldBoot) {
  bootstrap().catch((e) => {
    root.innerHTML = `<div class="card">初期化エラー: ${e.message}</div>`;
  });
}
