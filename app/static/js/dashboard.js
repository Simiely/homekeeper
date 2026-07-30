// 概览：总数、按状态/分类统计、即将过期（天数可调）
import { api } from "./api.js";
import { escapeHtml } from "./utils.js";

export async function renderDashboard() {
  const el = document.getElementById("view-dashboard");
  el.innerHTML = "<h2>概览</h2><div class='loading'>加载中…</div>";
  try {
    const [summary, items, categories] = await Promise.all([
      api.get("/dashboard/summary"),
      api.get("/items"),
      api.get("/categories"),
    ]);

    const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));
    const byCat = {};
    for (const it of items) {
      const key = it.category_id ? catMap[it.category_id] || "未分类" : "未分类";
      byCat[key] = (byCat[key] || 0) + 1;
    }
    const statusChips = Object.entries(summary.by_status || {})
      .map(([k, v]) => `<span class="chip">${escapeHtml(k)}：${v}</span>`)
      .join("");
    const catChips = Object.entries(byCat)
      .map(([k, v]) => `<span class="chip">${escapeHtml(k)}：${v}</span>`)
      .join("");
    const valueChips = Object.entries(summary.by_category_value || {})
      .map(([k, v]) => `<span class="chip">${escapeHtml(k)}：¥${Number(v).toFixed(2)}</span>`)
      .join("");

    el.innerHTML = `
      <h2>概览</h2>
      <div class="stat">物品总数：<b>${summary.total}</b></div>
      <div class="stat" style="font-size:18px">资产总值：<b style="color:var(--accent)">¥${(summary.total_value || 0).toFixed(2)}</b></div>
      <h3>按状态</h3>
      <div class="chips">${statusChips || '<span class="muted">暂无</span>'}</div>
      <h3>按分类</h3>
      <div class="chips">${catChips || '<span class="muted">暂无</span>'}</div>
      <h3>分类资产</h3>
      <div class="chips">${valueChips || '<span class="muted">暂无</span>'}</div>
      <h3>即将过期</h3>
      <div class="card" style="align-items:center">
        <label>未来 <input id="exp-days" type="number" min="1" value="30" style="width:72px" /> 天内</label>
        <button id="exp-btn" type="button">查看</button>
      </div>
      <ul class="expiring" id="exp-list"><li class="loading">加载中…</li></ul>
    `;

    const loadExpiring = async () => {
      const days = el.querySelector("#exp-days").value || 30;
      const listEl = el.querySelector("#exp-list");
      try {
        const expiring = await api.get(
          `/dashboard/expiring?days=${encodeURIComponent(days)}`
        );
        listEl.innerHTML = expiring.length
          ? expiring
              .map((i) => `<li>${escapeHtml(i.name)} · 到期 ${i.expiry_date}</li>`)
              .join("")
          : `<li class="muted">近 ${days} 天无即将过期物品</li>`;
      } catch (e) {
        listEl.innerHTML = `<li class="err">${e.message}</li>`;
      }
    };

    el.querySelector("#exp-btn").onclick = loadExpiring;
    el.querySelector("#exp-days").addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadExpiring();
    });
    loadExpiring();
  } catch (e) {
    el.innerHTML = `<p class="err">${e.message}</p>`;
  }
}
