// 管理页：用户管理
import { api } from "./api.js";
import { showDialog, viewError } from "./utils.js";

export async function renderAdmin() {
  const view = document.getElementById("view-admin");
  view.innerHTML = `
    <h2>用户管理</h2>
    <div class="card" style="flex-direction:column">
      <h3>添加用户</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <input id="new-username" placeholder="用户名" style="flex:1;min-width:140px" />
        <input id="new-password" type="password" placeholder="密码" style="flex:1;min-width:140px" />
        <button id="btn-add-user" style="background:var(--accent);color:#fff;border:none;padding:8px 18px;border-radius:8px;font-weight:600">添加</button>
      </div>
      <p id="admin-msg" class="msg" style="margin-top:8px"></p>
    </div>
    <div id="user-list" class="loading">加载中…</div>
  `;

  document.getElementById("btn-add-user").onclick = () => addUser();
  document.getElementById("new-password").onkeydown = (e) => {
    if (e.key === "Enter") addUser();
  };

  await loadUsers();
}

async function addUser() {
  const username = document.getElementById("new-username").value.trim();
  const password = document.getElementById("new-password").value;
  const msg = document.getElementById("admin-msg");
  msg.textContent = "";
  if (!username || !password) {
    msg.textContent = "用户名和密码不能为空";
    return;
  }
  try {
    await api.post("/admin/users", { username, password });
    document.getElementById("new-username").value = "";
    document.getElementById("new-password").value = "";
    msg.textContent = "";
    msg.style.color = "var(--accent)";
    msg.textContent = `用户「${username}」已创建`;
    await loadUsers();
  } catch (err) {
    msg.style.color = "var(--danger)";
    msg.textContent = err.message;
  }
}

async function loadUsers() {
  const container = document.getElementById("user-list");
  try {
    const users = await api.get("/admin/users");
    container.innerHTML = `
      <table class="list">
        <thead><tr><th>ID</th><th>用户名</th><th>管理员</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>
          ${users.map((u) => `
            <tr>
              <td>${u.id}</td>
              <td>${u.username}${u.is_admin ? ' <span class="chip" style="font-size:11px;padding:1px 8px">admin</span>' : ''}</td>
              <td>${u.is_admin ? '是' : '否'}</td>
              <td>${new Date(u.created_at).toLocaleDateString()}</td>
              <td>${u.is_admin ? '' : `<button class="del-user" data-id="${u.id}" data-name="${u.username}" style="background:transparent;border:1px solid var(--border);color:var(--danger);padding:4px 10px;border-radius:6px">删除</button>`}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    container.querySelectorAll(".del-user").forEach((btn) => {
      btn.onclick = async () => {
        const name = btn.dataset.name;
        const ok = await showDialog({
          title: "删除用户",
          message: `确定删除用户「${name}」？此操作不可撤销。`,
          confirmText: "删除",
          cancelText: "取消",
          danger: true,
        });
        if (!ok) return;
        try {
          await api.del(`/admin/users/${btn.dataset.id}`);
          await loadUsers();
        } catch (err) {
          showDialog({ title: "操作失败", message: err.message, confirmText: "知道了" });
        }
      };
    });
  } catch (err) {
    container.innerHTML = viewError(err.message);
  }
}
