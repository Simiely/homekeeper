// 概览：总数、按状态统计、即将过期
import { api } from "./api.js";

export async function renderDashboard() {
  const el = document.getElementById("view-dashboard");
  el.innerHTML = "<h2>概览</h2><div class='loading'>加载中…</div>";
  try {
    const [summary, expiring] = await Promise.all([
      api.get("/dashboard/summary"),
      api.get("/dashboard/expiring?days=30"),
    ]);
    const chips = Object.entries(summary.by_status || {})
      .map(([k, v]) => `<span class="chip">${k}：${v}</span>`)
      .join("");
    const list = expiring.length
      ? expiring
          .map((i) => `<li>${escapeHtml(i.name)} · 到期 ${i.expiry_date}</li>`)
          .join("")
      : "<li class='muted'>近 30 天无即将过期物品</li>";

    el.innerHTML = `
      <h2>概览</h2>
      <div class="stat">物品总数：<b>${summary.total}</b></div>
      <div class="chips">${chips}</div>
      <h3>近 30 天即将过期</h3>
      <ul class="expiring">${list}</ul>
    `;
  } catch (e) {
    el.innerHTML = `<p class="err">${e.message}</p>`;
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}
