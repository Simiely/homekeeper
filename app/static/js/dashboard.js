// 首页：快速找物品（全局搜索）+ 临期清理工作台 + 常用位置 + 统计（底部边缘弱化）
import { api } from "./api.js";
import { escapeHtml, viewError, viewLoading } from "./utils.js";

const RECENT_KEY = "hk-recent-searches";
const RECENT_MAX = 8;

function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

function pushRecent(kw) {
  const t = (kw || "").trim();
  if (!t) return;
  const list = getRecent().filter((x) => x !== t);
  list.unshift(t);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function expiryLabel(d) {
  const days = Math.round((new Date(d) - new Date(todayStr())) / 86400000);
  return days < 0 ? `已过期${-days}天` : days === 0 ? "今天到期" : `剩${days}天`;
}

function locPath(id, locations) {
  if (!id) return null;
  const parentMap = Object.fromEntries(locations.map((l) => [l.id, l.parent_id]));
  const nameMap = Object.fromEntries(locations.map((l) => [l.id, l.name]));
  const parts = [];
  let cur = id;
  while (cur && nameMap[cur]) {
    parts.unshift(nameMap[cur]);
    cur = parentMap[cur];
  }
  return parts.join(" > ");
}

function goView(name, params) {
  window.showView?.(name, params || {});
}

export async function renderDashboard() {
  const el = document.getElementById("view-dashboard");
  el.innerHTML = viewLoading("归处");
  let locations = [];
  let allItems = [];
  let summary = { total: 0, total_value: 0 };
  try {
    const [s, locs, items] = await Promise.all([
      api.get("/dashboard/summary"),
      api.get("/locations"),
      api.get("/items?page_size=100"),
    ]);
    summary = s || summary;
    locations = locs || [];
    allItems = items.items || [];
  } catch (e) {
    el.innerHTML = viewError(e.message);
    return;
  }

  const pathOf = (id) => locPath(id, locations);

  // 常用位置：有物品的位置，按物品数降序取前 8
  const countByLoc = {};
  for (const it of allItems) {
    if (it.location_id) countByLoc[it.location_id] = (countByLoc[it.location_id] || 0) + 1;
  }
  const hotLocs = locations
    .filter((l) => countByLoc[l.id])
    .sort((a, b) => countByLoc[b.id] - countByLoc[a.id])
    .slice(0, 8);

  el.innerHTML = `
    <div class="home-search">
      <input id="home-q" type="search" placeholder="搜索：物品、位置、分类、标签…" autocomplete="off" />
      <div id="home-recent" class="home-recent"></div>
    </div>
    <div id="home-results" class="hidden"></div>

    <section class="home-exp">
      <h3>临期清理 <span class="exp-days"><input id="exp-days" type="number" min="1" value="30" /> 天内</span></h3>
      <div id="exp-groups"><p class="muted">加载中…</p></div>
      <div id="exp-actions" class="exp-actions hidden">
        <span id="exp-count" class="muted">已选 0 件</span>
        <button id="exp-archive" type="button">归档</button>
        <button id="exp-discard" type="button" class="danger">丢弃</button>
      </div>
    </section>

    <section class="home-hot">
      <h3>常用位置</h3>
      <div class="home-hot-grid">
        ${hotLocs.length
          ? hotLocs
              .map(
                (l) =>
                  `<button type="button" class="hot-loc" data-lid="${l.id}">${escapeHtml(l.name)}<span>${countByLoc[l.id]} 件</span></button>`
              )
              .join("")
          : '<span class="muted">暂无</span>'}
      </div>
    </section>

    <p class="home-stats muted">共 ${summary.total} 件物品 · 资产总值 ¥${(summary.total_value || 0).toFixed(2)}</p>
  `;

  // ---------- 最近搜索 ----------
  const recentEl = el.querySelector("#home-recent");
  const renderRecent = () => {
    const list = getRecent();
    recentEl.innerHTML = list.length
      ? `<span class="recent-label">最近搜过</span>` +
        list
          .map(
            (kw) =>
              `<button type="button" class="chip recent-chip" data-kw="${escapeHtml(kw)}">${escapeHtml(kw)}</button>`
          )
          .join("")
      : "";
    recentEl.querySelectorAll(".recent-chip").forEach((b) => {
      b.onclick = () => {
        qEl.value = b.dataset.kw;
        doSearch(b.dataset.kw);
      };
    });
  };

  // ---------- 搜索 ----------
  const qEl = el.querySelector("#home-q");
  const resultsEl = el.querySelector("#home-results");
  let searchTimer = null;

  const doSearch = async (kw) => {
    kw = (kw || "").trim();
    if (!kw) {
      resultsEl.classList.add("hidden");
      resultsEl.innerHTML = "";
      window.syncHash?.({}, { replace: true }); // 清空搜索参数（不产生历史）
      return;
    }
    pushRecent(kw);
    renderRecent();
    window.syncHash?.({ q: kw }, { replace: true }); // 搜索词同步 URL（输入类，不产生碎历史）
    resultsEl.innerHTML = '<p class="muted">搜索中…</p>';
    resultsEl.classList.remove("hidden");
    try {
      const data = await api.get(`/items?keyword=${encodeURIComponent(kw)}&page_size=30`);
      const list = data.items || [];
      resultsEl.innerHTML = list.length
        ? `<p class="result-count">找到 ${data.total} 件</p><ul class="home-results">` +
          list
            .map((it) => {
              const p = pathOf(it.location_id);
              const badge = it.expiry_date
                ? `<span class="badge ${it.expiry_date < todayStr() ? "badge-exp" : "badge-warn"}">${escapeHtml(expiryLabel(it.expiry_date))}</span>`
                : "";
              return `<li class="result-item">
                <span class="r-name">${escapeHtml(it.name)}</span>
                ${badge}
                <span class="r-loc" data-lid="${it.location_id || ""}">${p ? "📍 " + escapeHtml(p) : "未设置位置"}</span>
                <span class="r-status muted">${escapeHtml(it.status)}</span>
              </li>`;
            })
            .join("") +
          "</ul>"
        : `<p class="muted">没有找到「${escapeHtml(kw)}」，换个词试试？</p>`;
      // 点击位置路径 → 跳到位置页并展开该位置
      resultsEl.querySelectorAll(".r-loc[data-lid]").forEach((span) => {
        span.onclick = (e) => {
          e.stopPropagation();
          const lid = Number(span.dataset.lid);
          goView("locations", lid ? { open: lid } : {});
        };
      });
    } catch (e) {
      resultsEl.innerHTML = `<p class="err">${e.message}</p>`;
    }
  };

  qEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(qEl.value), 300);
  });
  qEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(searchTimer);
      doSearch(qEl.value);
    }
  });

  // ---------- 临期清理 ----------
  const groupsEl = el.querySelector("#exp-groups");
  const actionsEl = el.querySelector("#exp-actions");
  const countEl = el.querySelector("#exp-count");
  const selected = new Set();

  const updateActions = () => {
    countEl.textContent = `已选 ${selected.size} 件`;
    actionsEl.classList.toggle("hidden", selected.size === 0);
  };

  const itemRow = (i) => `
    <label class="exp-item ${i.expired ? "exp-red" : "exp-yellow"}">
      <input type="checkbox" data-id="${i.id}" ${selected.has(i.id) ? "checked" : ""} />
      <span class="e-name">${escapeHtml(i.name)}</span>
      <span class="e-loc muted">${i.location_id ? escapeHtml(pathOf(i.location_id) || "") : ""}</span>
      <span class="e-days">${i.expired ? `已过期 ${-i.days_left} 天` : `剩 ${i.days_left} 天`}</span>
    </label>`;

  const renderGroups = (list) => {
    const expired = list.filter((i) => i.expired);
    const upcoming = list.filter((i) => !i.expired);
    groupsEl.innerHTML = `
      ${expired.length ? `<p class="exp-h exp-h-red">已过期 · ${expired.length}</p>` + expired.map(itemRow).join("") : ""}
      ${upcoming.length ? `<p class="exp-h exp-h-yellow">即将过期 · ${upcoming.length}</p>` + upcoming.map(itemRow).join("") : ""}
      ${!expired.length && !upcoming.length ? '<p class="muted">近 30 天没有需要处理的物品</p>' : ""}
    `;
    groupsEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.onchange = () => {
        const id = Number(cb.dataset.id);
        if (cb.checked) selected.add(id);
        else selected.delete(id);
        updateActions();
      };
    });
  };

  const loadExpiring = async () => {
    const days = el.querySelector("#exp-days").value || 30;
    selected.clear();
    updateActions();
    try {
      const data = await api.get(`/dashboard/expiring?days=${encodeURIComponent(days)}`);
      renderGroups(data.expiring || []);
    } catch (e) {
      groupsEl.innerHTML = `<p class="err">${e.message}</p>`;
    }
  };

  el.querySelector("#exp-days").addEventListener("change", loadExpiring);
  el.querySelector("#exp-days").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadExpiring();
  });

  const runBatch = async (action) => {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === "delete" && !confirm(`确认丢弃选中的 ${ids.length} 件物品？此操作不可恢复。`)) return;
    try {
      await api.post("/items/batch", { item_ids: ids, action });
      await loadExpiring();
      renderDashboard(); // 刷新统计与常用位置
    } catch (e) {
      alert("操作失败：" + e.message);
    }
  };
  el.querySelector("#exp-discard").onclick = () => runBatch("delete");
  el.querySelector("#exp-archive").onclick = () => runBatch("archive");

  // 常用位置 → 位置页（URL 携带目标位置 id，位置页只展开并高亮该位置）
  el.querySelectorAll(".hot-loc").forEach((b) => {
    b.onclick = () => goView("locations", { open: Number(b.dataset.lid) });
  });

  // 从 URL 恢复搜索词（刷新 #/dashboard?q=xx 或浏览器后退回来）
  const urlQ = window.__viewParams?.get("q") || "";
  if (urlQ) {
    qEl.value = urlQ;
    doSearch(urlQ);
  }

  renderRecent();
  loadExpiring();
}
