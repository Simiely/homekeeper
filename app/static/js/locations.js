// 位置视图 v4：方块卡片 + 自研拖拽调整层级（自动保存）
//
// 为什么自研：本环境（远程/虚拟机等）HTML5 DnD 的 dragstart 不触发，
// SortableJS 的原生模式与 forceFallback 各组合均无法启动拖拽。
// 自研方案基于 Pointer/Mouse 事件 + 坐标命中检测，不依赖 HTML5 DnD，最可靠。
//
// 交互约定（缝隙选择区域）：
// - 按住卡片任意位置（按钮除外）拖动
// - 鼠标【上下】位置确定缝隙（两个条目之间），选择区域实时跟随鼠标
// - 区域内【左右】选择：左半 = 与上方条目同级，右半 = 成为上方条目的子级
// - 松手落在区域内执行放置，落在区域外则取消；松手自动保存，失败自动还原
//
// 拖拽系统独立在 locations-drag.js（依赖注入解耦），本文件只做渲染与交互编排
import { api } from "./api.js";
import { buildLocTree, escapeHtml, showDialog, viewError, viewLoading } from "./utils.js";
import { attachDrag, consumeSuppress, initDrag } from "./locations-drag.js";

// 编辑模式（拖拽调层级）；默认关闭，点击卡片 = 改名
let editMode = false;

// 拖拽系统回调注入（与渲染层解耦）
initDrag({
  isEditMode: () => editMode,
  onRename: (card) => showRename(card),
  onStatus: (msg, isError, keep) => showStatus(msg, isError, keep),
  onRender: () => renderLocations(),
});

// ===== 渲染 =====

export async function renderLocations() {
  const el = document.getElementById("view-locations");
  el.innerHTML = viewLoading("位置");
  try {
    // 并行拉位置 + 物品全量（分页），按 location_id 分组（卡片显示物品数/展开列表）
    const [locs, firstPage] = await Promise.all([
      api.get("/locations"),
      api.get("/items?page_size=100"),
    ]);
    let allItems = firstPage.items || [];
    if (firstPage.total > allItems.length) {
      const pages = Math.ceil(firstPage.total / 100);
      for (let p = 2; p <= pages; p++) {
        const d = await api.get(`/items?page_size=100&page=${p}`);
        allItems = allItems.concat(d.items || []);
      }
    }
    const itemsByLoc = {};
    for (const it of allItems) {
      if (it.location_id == null) continue;
      (itemsByLoc[it.location_id] = itemsByLoc[it.location_id] || []).push(it);
    }

    el.innerHTML = `
      <div class="loc-toolbar">
        <h2>位置</h2>
        <button id="loc-edit-toggle" class="loc-edit-btn" title="进入拖拽模式">✎ 编辑</button>
      </div>
      <div id="loc-status" class="msg" style="display:none"></div>
      <div id="loc-tree"></div>
    `;

    // 编辑模式开关：进入后卡片可拖拽调整层级，再点退出
    const editBtn = el.querySelector("#loc-edit-toggle");
    editBtn.textContent = editMode ? "✔ 完成" : "✎ 编辑";
    editBtn.classList.toggle("active", editMode);
    document.body.classList.toggle("loc-edit-mode", editMode);
    editBtn.onclick = () => {
      editMode = !editMode;
      document.body.classList.toggle("loc-edit-mode", editMode);
      editBtn.textContent = editMode ? "✔ 完成" : "✎ 编辑";
      editBtn.classList.toggle("active", editMode);
      if (editMode) showStatus(EDIT_HINT, false, true);
      else showStatus("", false);
    };

    const tree = buildLocTree(locs);
    const treeEl = el.querySelector("#loc-tree");
    // renderCards 只输出 li（不含 ul 包裹），外层 ul 在此统一生成，
    // 避免递归时产生 <ul class="loc-children"><ul class="loc-list"> 的畸形嵌套
    treeEl.innerHTML = tree.length
      ? `<ul class="loc-list">${renderCards(tree, itemsByLoc)}</ul>`
      : '<p class="muted">暂无位置，请添加</p>';

    // 渲染后若仍在编辑模式，恢复常驻提示（DOM 重建后 #loc-status 是新的）
    if (editMode && editHintText) showStatus(editHintText, false, true);

    // 恢复展开状态：URL ?open=4&open=7（可多个；刷新/后退时逐个展开，不折叠其他分支）
    for (const id of getOpenList()) {
      const card = treeEl.querySelector(`.loc-card[data-id="${id}"]`);
      if (card) {
        card.classList.add("expanded");
        const itemsEl = card.querySelector(":scope > .loc-items");
        if (itemsEl) itemsEl.style.display = "flex";
      }
    }

    // 聚焦高亮（首页常用位置跳转的临时标记 ?focus=id）：折叠无关分支 + 高亮目标
    const focusId = Number(window.__viewParams?.get("focus") || 0);
    if (focusId) {
      const pmap = Object.fromEntries(locs.map((l) => [l.id, l.parent_id]));
      const chain = new Set([focusId]);
      let cur = pmap[focusId];
      while (cur) {
        chain.add(cur);
        cur = pmap[cur];
      }
      // 折叠不在目标祖先链上的所有分支的子级
      treeEl.querySelectorAll(".loc-card").forEach((card) => {
        const id = Number(card.dataset.id);
        if (!chain.has(id)) {
          const ch = card.querySelector(":scope > .loc-children");
          if (ch) ch.style.display = "none";
        }
      });
      // 高亮目标 + 滚动到视野（物品列表已在展开恢复中展开）
      const target = treeEl.querySelector(`.loc-card[data-id="${focusId}"]`);
      if (target) {
        target.classList.add("loc-focused");
        target.scrollIntoView({ block: "center" });
        setTimeout(() => target.classList.remove("loc-focused"), 2600);
      }
      // 一次性消费：从 URL 移除 focus 参数（replaceState，不产生历史）
      const q = new URLSearchParams(location.hash.split("?")[1] || "");
      q.delete("focus");
      const qs = q.toString();
      history.replaceState(null, "", `#/locations${qs ? "?" + qs : ""}`);
    }

    // 卡片操作（事件委托）：添加子位置 / 删除 / 非编辑模式点击展开物品 / ▸ 展开物品
    treeEl.addEventListener("click", async (e) => {
      if (consumeSuppress()) {
        return; // 拖拽后的 click 忽略（由 locations-drag 模块标记）
      }
      const addBtn = e.target.closest("[data-add-child]");
      if (addBtn) {
        e.stopPropagation();
        showInlineAdd(addBtn.closest(".loc-card"), Number(addBtn.dataset.addChild));
        return;
      }
      const btn = e.target.closest("[data-del]");
      if (btn) {
        const ok = await showDialog({
          title: "删除位置",
          message: "确认删除？子位置将提升一级。",
          confirmText: "删除",
          cancelText: "取消",
          danger: true,
        });
        if (!ok) return;
        await api.del(`/locations/${btn.dataset.del}`);
        renderLocations();
        return;
      }
      // ▸ 展开/收起该位置下的物品列表（编辑模式下已统一收起，禁用切换以保持状态）
      const toggle = e.target.closest(".loc-toggle");
      if (toggle && !editMode) {
        toggleItems(toggle.closest(".loc-card"));
        return;
      }
      // 非编辑模式：点击项目条任意处（除添加/删除按钮）→ 展开/收起该位置的物品列表
      const head = e.target.closest(".loc-head");
      if (head && !editMode) {
        toggleItems(head.closest(".loc-card"));
      }
      // 编辑模式下：单击卡片头部 = 改名（由 onDragEnd 的"未拖动"分支处理，这里不处理）
    });

    // 拖拽入口：绑定到重建的树容器（拖拽系统在 locations-drag.js）
    attachDrag(treeEl);
  } catch (e) {
    el.innerHTML = viewError(e.message);
  }
}

// 展开/收起卡片下的物品列表
function toggleItems(card) {
  if (!card) return;
  const itemsEl = card.querySelector(":scope > .loc-items");
  if (!itemsEl) return;
  // 用 .expanded 类判断（CSS 默认 display:none，内联 style 为空串，不能拿来判断）
  const willShow = !card.classList.contains("expanded");
  itemsEl.style.display = willShow ? "flex" : "none";
  card.classList.toggle("expanded", willShow);
  // URL 同步：维护多个展开位置 ?open=4&open=7（hash 路由，可刷新保留/逐级后退）
  const id = Number(card.dataset.id);
  const list = getOpenList();
  const idx = list.indexOf(id);
  if (willShow && idx < 0) list.push(id);
  if (!willShow && idx >= 0) list.splice(idx, 1);
  window.syncHash?.({ open: list.length ? list : undefined });
}

// 当前 URL 中已展开的位置 id 列表
function getOpenList() {
  const raw = window.__viewParams?.getAll("open") || [];
  return raw.map(Number).filter((n) => n > 0);
}

// ---- 方块卡片渲染（递归）----
// 注意：只返回 <li> 列表，不包裹 <ul>；<ul class="loc-list"> 由调用处生成，
// 子级 <ul class="loc-children"> 在此生成（内部仍是 li，不会再套 ul）。
// 每张卡片显示【物品数量】，点击头部可展开该位置下的物品列表。
// 「家」（id=1）为固定根：不可删除（无 ✕），保留 + 添加子项目。
function renderCards(nodes, itemsByLoc) {
  if (!nodes.length) return "";
  let html = "";
  for (const node of nodes) {
    const items = itemsByLoc[node.id] || [];
    const isRoot = node.id === 1;
    html += `<li class="loc-card" data-id="${node.id}">
      <div class="loc-head">
        <span class="loc-toggle">▸</span>
        <span class="loc-handle" title="可拖拽">≡</span>
        <span class="loc-name">${escapeHtml(node.name)}</span>
        ${node.note ? `<span class="loc-note">— ${escapeHtml(node.note)}</span>` : ""}
        <span class="loc-count">${items.length} 件</span>
        <span class="loc-actions">
          <button class="loc-add" data-add-child="${node.id}" title="在此位置下添加子位置">+</button>
          ${isRoot ? "" : `<button class="loc-del" data-del="${node.id}" title="删除">✕</button>`}
        </span>
      </div>
      ${
        items.length
          ? `<ul class="loc-items">${items
              .map(
                (it) =>
                  `<li>
                     <span class="loc-item-name">${escapeHtml(it.name)}</span>
                     <span class="loc-item-qty">×${it.quantity}${it.unit || ""}</span>
                     <span class="loc-item-status">${escapeHtml(it.status || "")}</span>
                   </li>`
              )
              .join("")}</ul>`
          : ""
      }
      ${node.children.length ? `<ul class="loc-children">${renderCards(node.children, itemsByLoc)}</ul>` : ""}
    </li>`;
  }
  return html;
}
//
// ===== 自研拖拽（Mouse 事件 + 缝隙选择区域）=====
//
// 交互（用户确认的模型：先上下定位，再左右选择）：
//   1) 鼠标【上下】位置确定"缝隙"：把整棵树所有条目按视觉顺序视为同一级别，
//      鼠标在哪两个条目之间，就在那里显示一个选择区域（跟鼠标强关联，实时跟随）。
//   2) 区域内【左右】选择：左半 = 与上方条目同级（插入其后）；右半 = 成为上方条目的子级。
//   3) 松手：落在区域内按左右执行放置；落在区域外则取消。
//
// 关键设计（历史 bug 教训）：
//   - 选择区域 fixed 绝对定位（不插 DOM，不改变布局），pointer-events:none，
//     高亮与松手判定一律用坐标 + getBoundingClientRect（不依赖 elementFromPoint，
//     避免悬浮层干扰命中导致目标递归跳变）。

// 编辑模式常驻提示文案（编辑模式下一直显示，直到点「完成」退出）
const EDIT_HINT = "编辑模式：单击卡片改名，拖动卡片调整层级，再点「完成」退出";
let editHintText = ""; // 当前常驻提示文案（空 = 无常驻提示）
let editHintTimer = null; // 编辑提示的恢复计时器

function showStatus(msg, isError, keep) {
  const status = document.getElementById("loc-status");
  if (!status) return;
  // 清理上一次的恢复计时器（避免多次设置互相覆盖）
  if (editHintTimer) {
    clearTimeout(editHintTimer);
    editHintTimer = null;
  }
  if (keep) {
    // 常驻：记录文案、显示且不清除，直到被清空/退出编辑模式
    editHintText = msg;
    status.textContent = msg;
    status.style.display = "";
    status.style.color = isError ? "var(--danger)" : "var(--accent)";
    return;
  }
  if (msg === "") {
    // 显式清空：同时清掉常驻文案
    editHintText = "";
    status.textContent = "";
    status.style.display = "none";
    return;
  }
  // 普通提示：2.5 秒后隐藏；若仍在编辑模式且有常驻提示，则恢复常驻提示
  status.textContent = msg;
  status.style.display = "";
  status.style.color = isError ? "var(--danger)" : "var(--accent)";
  editHintTimer = setTimeout(() => {
    status.style.display = "none";
    if (editMode && editHintText) {
      showStatus(editHintText, false, true);
    }
  }, 2500);
}

// ===== 内联添加子位置 =====

function showInlineAdd(card, parentId) {
  const existing = card.querySelector(".loc-inline-form");
  if (existing) {
    existing.remove();
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "loc-inline-form";
  wrap.innerHTML = `
    <form class="card" style="padding:8px;gap:8px;margin-top:8px">
      <input name="name" placeholder="子位置名称" required />
      <input name="note" placeholder="备注（可选）" />
      <button type="submit">添加</button>
      <button type="button" class="loc-inline-cancel ghost">取消</button>
    </form>`;
  card.querySelector(".loc-head").after(wrap);
  const form = wrap.querySelector("form");
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    await api.post("/locations", {
      name: fd.get("name"),
      note: fd.get("note") || "",
      parent_id: parentId,
    });
    renderLocations();
  };
  wrap.querySelector(".loc-inline-cancel").onclick = () => wrap.remove();
  form.querySelector("[name=name]").focus();
}

// ===== 内联改名 =====

function showRename(card) {
  const existing = card.querySelector(".loc-inline-form");
  if (existing) {
    existing.remove();
    return;
  }
  const id = Number(card.dataset.id);
  const nameEl = card.querySelector(".loc-name");
  const wrap = document.createElement("div");
  wrap.className = "loc-inline-form";
  wrap.innerHTML = `
    <form class="card" style="padding:8px;gap:8px;margin-top:8px">
      <input name="name" placeholder="位置名称" value="${escapeHtml(nameEl.textContent)}" required />
      <button type="submit">保存</button>
      <button type="button" class="loc-inline-cancel ghost">取消</button>
    </form>`;
  card.querySelector(".loc-head").after(wrap);
  const form = wrap.querySelector("form");
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    await api.put(`/locations/${id}`, { name: fd.get("name") });
    renderLocations();
  };
  wrap.querySelector(".loc-inline-cancel").onclick = () => wrap.remove();
  form.querySelector("[name=name]").focus();
  form.querySelector("[name=name]").select();
}
