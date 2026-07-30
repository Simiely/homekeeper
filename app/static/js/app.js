// 导航调度：视图切换、鉴权检查
import { getToken, logout } from "./api.js";
import { renderItems } from "./items.js";
import { renderLocations } from "./locations.js";
import { renderCategories } from "./categories.js";
import { renderDashboard } from "./dashboard.js";
import { renderTags } from "./tags.js";

if (!getToken()) location.href = "/login.html";

document.getElementById("logout").onclick = logout;

// ========== Web Push 订阅 ==========

async function initPush() {
  const notifBtn = document.getElementById("notif-btn");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    notifBtn.textContent = "🔕";
    notifBtn.title = "此浏览器不支持推送";
    return;
  }
  try {
    // 获取 VAPID 公钥
    const resp = await fetch("/api/push/vapid-public-key");
    if (!resp.ok) {
      notifBtn.textContent = "🔕";
      notifBtn.title = "推送未配置（管理员未设置 VAPID 密钥）";
      return;
    }
    const { public_key } = await resp.json();

    // 检查权限
    if (Notification.permission === "denied") {
      notifBtn.textContent = "🔕";
      notifBtn.title = "推送已被拒绝，请在浏览器设置中开启";
      return;
    }

    // 注册 Service Worker
    const reg = await navigator.serviceWorker.register("/service-worker.js");
    const existingSub = await reg.pushManager.getSubscription();

    if (existingSub) {
      notifBtn.textContent = "🔔";
      notifBtn.title = "推送已开启";
      return;
    }

    if (Notification.permission === "granted") {
      // 权限已给但无订阅 → 创建订阅
      const newSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      });
      await saveSubscription(newSub);
      notifBtn.textContent = "🔔";
      notifBtn.title = "推送已开启";
      return;
    }

    // permission === "default" → 还没问过，显示默认状态
    notifBtn.textContent = "🔕";
    notifBtn.title = "点击开启推送通知";
    notifBtn.onclick = async () => {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
      try {
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(public_key),
        });
        await saveSubscription(sub);
        notifBtn.textContent = "🔔";
        notifBtn.title = "推送已开启";
        notifBtn.onclick = null;
      } catch (e) {
        console.warn("订阅失败:", e.message);
      }
    };
  } catch (e) {
    console.warn("推送初始化失败:", e.message);
  }
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

// 在页面加载后执行
initPush();

// ========== 导航调度 ==========
const views = {
  dashboard: renderDashboard,
  items: renderItems,
  locations: renderLocations,
  categories: renderCategories,
  tags: renderTags,
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
