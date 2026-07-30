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
const views = {
  dashboard: renderDashboard,
  items: renderItems,
  locations: renderLocations,
  categories: renderCategories,
  tags: renderTags,
  backups: renderBackups,
  admin: renderAdmin,
};

document.querySelectorAll("nav button[data-view]").forEach((btn) => {
  btn.onclick = () => {
    document
      .querySelectorAll("nav button")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document
      .querySelectorAll(".view")
      .forEach((v) => v.classList.add("hidden"));
    const name = btn.dataset.view;
    document.getElementById(`view-${name}`).classList.remove("hidden");
    views[name]();
  };
});

views.dashboard();
