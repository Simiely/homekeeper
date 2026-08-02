// Web Push 订阅：VAPID 公钥获取 + Service Worker 注册 + 订阅保存
// 从 app.js 拆出，职责独立；app.js 只调用 initPush()
import { api } from "./api.js";

// Base64 URL 安全解码（PushManager 需要 Uint8Array）
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const b64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// VAPID 公钥（失败返回空串，按钮点击时会重试）
async function getVapidKey() {
  try {
    const data = await api.get("/push/vapid-public-key");
    return data.public_key || "";
  } catch {
    return "";
  }
}

async function saveSubscription(sub) {
  const raw = sub.toJSON();
  await api.post("/push/subscribe", {
    endpoint: raw.endpoint,
    auth_key: raw.keys.auth,
    p256dh_key: raw.keys.p256dh,
  });
}

export async function initPush() {
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

  // 获取 VAPID 公钥（异步，失败静默）
  const publicKey = await getVapidKey();

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
      pk = await getVapidKey();
      if (!pk) {
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
