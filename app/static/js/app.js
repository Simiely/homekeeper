// 导航调度：视图切换、鉴权检查、管理员判断
import { getToken, logout, api } from "./api.js";
import { renderItems } from "./items.js";
import { renderLocations } from "./locations.js";
import { renderBackups } from "./backups.js";
import { renderCategories } from "./categories.js";
import { renderDashboard } from "./dashboard.js";
import { renderTags } from "./tags.js";
import { renderAdmin } from "./admin.js";

if (!getToken()) location.href = "/login.html";

document.getElementById("logout").onclick = logout;

// ========== 检查管理员身份 ==========

async function checkAdmin() {
  try {
    const user = await api.get("/auth/me");
    if (user.is_admin) {
      document.querySelectorAll(".admin-only").forEach((el) => (el.style.display = ""));
    }
  } catch {
    // 非管理员或请求失败，保持隐藏
  }
}
checkAdmin();

// ========== Web Push 订阅 ==========

async function initPush() {
  const notifBtn = document.getElementById("notif-btn");

  // 浏览器不支持推送 → 直接禁用
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    notifBtn.textContent = "🔕";
    notifBtn.title = "此浏览器不支持推送";
    return;
  }

  // 已经拒绝过 → 提示去设置开启
  if (Notification.permission === "denied") {
    notifBtn.textContent = "🔕";
    notifBtn.title = "推送已被拒绝，请在浏览器设置中开启";
    return;
  }

  // 获取 VAPID 公钥（异步）
  let publicKey = "";
  try {
    const resp = await fetch("/api/push/vapid-public-key");
    if (resp.ok) {
      const data = await resp.json();
      publicKey = data.public_key;
    }
  } catch {
    // VAPID 不可用时按钮照样可点，点击时再试
  }

  // 注册 Service Worker
  let reg = null;
  try {
    reg = await navigator.serviceWorker.register("/service-worker.js");
  } catch {
    // 注册失败，按钮仍然可点
  }

  // 检查已有订阅
  let existingSub = null;
  if (reg) {
    try {
      existingSub = await reg.pushManager.getSubscription();
    } catch {
      // 忽略
    }
  }

  if (existingSub) {
    notifBtn.textContent = "🔔";
    notifBtn.title = "推送已开启";
    return;
  }

  // ----- 统一点击处理：无论什么状态，点击就尝试开启 -----
  notifBtn.textContent = "🔕";
  notifBtn.title = "点击开启推送通知";

  notifBtn.onclick = async () => {
    // 请求权限
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      notifBtn.textContent = "🔕";
      notifBtn.title = "推送权限被拒绝";
      return;
    }

    // 重新获取 VAPID 公钥（如果之前没拿到）
    let pk = publicKey;
    if (!pk) {
      try {
        const resp = await fetch("/api/push/vapid-public-key");
        if (resp.ok) {
          const data = await resp.json();
          pk = data.public_key;
        }
      } catch {
        notifBtn.textContent = "🔕";
        notifBtn.title = "推送配置异常，请联系管理员";
        return;
      }
    }

    // 注册/获取 Service Worker
    let swReg = reg;
    if (!swReg) {
      try {
        swReg = await navigator.serviceWorker.register("/service-worker.js");
      } catch {
        notifBtn.textContent = "🔕";
        notifBtn.title = "Service Worker 注册失败";
        return;
      }
    }

    // 订阅推送
    try {
      const sub = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pk),
      });
      await saveSubscription(sub);
      notifBtn.textContent = "🔔";
      notifBtn.title = "推送已开启";
      notifBtn.onclick = null;
    } catch (e) {
      notifBtn.textContent = "🔕";
      notifBtn.title = "订阅失败: " + e.message;
    }
  };
}

async function saveSubscription(sub) {
  const raw = sub.toJSON();
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({
      endpoint: raw.endpoint,
      auth_key: raw.keys.auth,
      p256dh_key: raw.keys.p256dh,
    }),
  });
}

// Base64 URL 安全解码（PushManager 需要 Uint8Array）
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const b64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// 在页面加载后执行（仅已登录时初始化推送）
if (getToken()) initPush();

// ========== 导航调度 ==========
// 视图注册表：每个功能一个独立渲染模块（模块化约定：新增视图只需在此注册）
const views = {
  dashboard: renderDashboard,
  items: renderItems,
  locations: renderLocations,
  categories: renderCategories,
  tags: renderTags,
  admin: renderAdmin,
  backups: renderBackups,
};

// 设置下拉（管理板块入口：父项本身无视图，仅负责展开/收起子菜单）
const settingsToggle = document.getElementById("settings-toggle");
const settingsMenu = document.getElementById("settings-menu");
const settingsDropdown = settingsToggle ? settingsToggle.closest(".nav-dropdown") : null;

function closeSettingsMenu() {
  settingsMenu?.classList.add("hidden");
  settingsDropdown?.classList.remove("open");
}

settingsToggle?.addEventListener("click", (e) => {
  e.stopPropagation(); // 避免触发 document 级收起
  const willOpen = settingsMenu.classList.toggle("hidden");
  settingsDropdown.classList.toggle("open", !willOpen);
});

// 点击页面其他区域时收起下拉
document.addEventListener("click", closeSettingsMenu);

// ========== Hash 路由：每个视图有独立 URL（#/dashboard、#/items?kw=…），支持浏览器前进/后退 ==========

// 解析当前 hash → { view, params }
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, qs] = raw.split("?");
  const name = (path || "dashboard").split("/")[0];
  const params = new URLSearchParams(qs || "");
  return { view: views[name] ? name : "dashboard", params };
}

// 应用视图：高亮（含父项联动）、显示容器、调用渲染模块
function applyView(name, params) {
  document.querySelectorAll("nav button[data-view]").forEach((b) => b.classList.remove("active"));
  settingsToggle?.classList.remove("active"); // 父项高亮由子项联动决定，切换前先清除
  closeSettingsMenu();
  const btn = document.querySelector(`nav button[data-view="${name}"]`);
  if (btn) {
    btn.classList.add("active");
    // 子项激活时父项同步高亮（data-parent 指向父按钮 id）
    const parentId = btn.dataset.parent;
    if (parentId) {
      const parentBtn = document.getElementById(parentId);
      parentBtn?.classList.add("active");
    }
  }
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById(`view-${name}`).classList.remove("hidden");
  // 供各视图模块读取 URL 参数（如 ?q=搜索词、?open=展开位置）
  window.__viewParams = params;
  views[name]();
}

let __lastView = null;

function onHashChange() {
  const { view, params } = parseHash();
  window.__viewParams = params;
  // 同视图内参数变化（如展开位置）由 syncHash 标记跳过重渲染；视图切换才真正渲染
  if (window.__skipRender && view === __lastView) {
    window.__skipRender = false;
    return;
  }
  window.__skipRender = false;
  __lastView = view;
  applyView(view, params);
}

// 跨视图跳转（push 历史，浏览器后退可返回上一视图）
// 用法：window.showView("locations", { open: 4 })
window.showView = (name, params = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") q.set(k, v);
  }
  const qs = q.toString();
  location.hash = `#/${name}${qs ? "?" + qs : ""}`;
};

// 视图内状态同步：
//  - 默认 push 历史（可逐步后退，如位置展开 A→B，后退回到 A）
//  - replace=true 仅更新 URL 不产生历史（连续输入类状态，如搜索词/筛选）
//  - 数组值 → 重复 key（如 open:[4,7] → ?open=4&open=7），用于多选状态
window.syncHash = (params, opts = {}) => {
  const { view } = parseHash();
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) {
      v.forEach((x) => {
        if (x != null && x !== "") q.append(k, x);
      });
    } else {
      q.set(k, v);
    }
  }
  const qs = q.toString();
  const newHash = `#/${view}${qs ? "?" + qs : ""}`;
  if (location.hash === newHash) return; // 无变化不产生历史
  if (opts.replace) {
    history.replaceState(null, "", newHash);
  } else {
    window.__skipRender = true; // 同视图参数变化：hashchange 时跳过重渲染，避免闪动
    location.hash = newHash;
  }
};

// 导航按钮：写入 hash，由 hashchange 统一驱动渲染
document.querySelectorAll("nav button[data-view]").forEach((btn) => {
  btn.onclick = (e) => {
    e.stopPropagation();
    location.hash = `#/${btn.dataset.view}`;
  };
});

// 浏览器前进/后退 → hash 变化 → 渲染对应视图
window.addEventListener("hashchange", onHashChange);

// 初始渲染：读当前 hash（如刷新在 #/items 则回到物品页），默认归处
onHashChange();
