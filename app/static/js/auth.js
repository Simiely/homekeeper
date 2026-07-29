// 登录 / 注册逻辑
import { API } from "./api.js";

let mode = "login";

const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const form = document.getElementById("auth-form");
const submitBtn = document.getElementById("submit-btn");
const msg = document.getElementById("msg");

function setMode(m) {
  mode = m;
  tabLogin.classList.toggle("active", m === "login");
  tabRegister.classList.toggle("active", m === "register");
  submitBtn.textContent = m === "login" ? "登录" : "注册";
  msg.textContent = "";
}
tabLogin.onclick = () => setMode("login");
tabRegister.onclick = () => setMode("register");

form.onsubmit = async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  msg.textContent = "";
  try {
    if (mode === "login") {
      const fd = new FormData();
      fd.append("username", username);
      fd.append("password", password);
      const res = await fetch(`${API}/auth/login`, { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).detail || "登录失败");
      const data = await res.json();
      localStorage.setItem("hk_token", data.access_token);
    } else {
      const res = await fetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "注册失败");
      const data = await res.json();
      localStorage.setItem("hk_token", data.access_token);
    }
    location.href = "/";
  } catch (err) {
    msg.textContent = err.message;
  }
};
