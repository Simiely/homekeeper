// 登录逻辑
import { API } from "./api.js";

const form = document.getElementById("auth-form");
const msg = document.getElementById("msg");

// 修复自动填充后的样式（不用 box-shadow，只用 transition-delay 冻结颜色）
function fixAutofill() {
  document.querySelectorAll("input").forEach((el) => {
    if (el.matches(":-webkit-autofill")) {
      el.style.setProperty("background-color", "transparent", "important");
      el.style.setProperty("-webkit-box-shadow", "none", "important");
      el.style.setProperty("box-shadow", "none", "important");
    }
  });
}

// 页面加载后等一段时间再查（等浏览器自动填充完成）
setTimeout(fixAutofill, 200);
setTimeout(fixAutofill, 800);

form.onsubmit = async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  msg.textContent = "";
  try {
    const fd = new FormData();
    fd.append("username", username);
    fd.append("password", password);
    const res = await fetch(`${API}/auth/login`, { method: "POST", body: fd });
    if (!res.ok) throw new Error((await res.json()).detail || "登录失败");
    const data = await res.json();
    localStorage.setItem("hk_token", data.access_token);
    location.href = "/";
  } catch (err) {
    msg.textContent = err.message;
  }
};
