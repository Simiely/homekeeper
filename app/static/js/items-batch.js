// 物品批量操作：批量条绑定（勾选计数 / 全选 / 归档 / 删除 / 改状态 / 改分类）
// items-list.js 渲染列表后调用 ctx.bindBatch() 完成绑定；ctx 由 items.js 编排器创建
import { batchItems, showDialog } from "./utils.js";

export function initBatch(ctx) {
  const el = ctx.el;

  // 列表重渲染后调用：批量条元素是新 DOM，需重新绑定
  function bindBatch() {
    const batchBar = el.querySelector("#batch-bar");
    const batchCount = el.querySelector("#batch-count");
    if (!batchBar || !batchCount) return;

    function updateBatchBar() {
      const checked = el.querySelectorAll(".item-cb:checked");
      const count = checked.length;
      if (count > 0) {
        batchBar.style.display = "flex";
        batchCount.textContent = `已选 ${count} 件`;
      } else {
        batchBar.style.display = "none";
      }
    }

    // 单选
    el.querySelectorAll(".item-cb").forEach((cb) => {
      cb.onchange = updateBatchBar;
    });
    // 全选（当前页）
    const selectAll = el.querySelector("#select-all");
    if (selectAll) {
      selectAll.onchange = function () {
        el.querySelectorAll(".item-cb").forEach((cb) => (cb.checked = this.checked));
        updateBatchBar();
      };
    }
    // 批量归档
    el.querySelector("#batch-archive").onclick = () => {
      const ids = [...el.querySelectorAll(".item-cb:checked")].map((cb) => Number(cb.value));
      if (!ids.length) return;
      batchItems(ids, "archive").then(() => ctx.loadItems());
    };
    // 批量删除
    el.querySelector("#batch-delete").onclick = () => {
      const ids = [...el.querySelectorAll(".item-cb:checked")].map((cb) => Number(cb.value));
      if (!ids.length) return;
      showDialog({
        title: "批量删除",
        message: `确认删除 ${ids.length} 件物品？此操作不可恢复。`,
        confirmText: "删除",
        cancelText: "取消",
        danger: true,
      }).then((ok) => {
        if (ok) batchItems(ids, "delete").then(() => ctx.loadItems());
      });
    };
    // 批量改状态
    el.querySelector("#batch-status").onchange = function () {
      if (!this.value) return;
      const ids = [...el.querySelectorAll(".item-cb:checked")].map((cb) => Number(cb.value));
      if (!ids.length) return;
      batchItems(ids, "update", { status: this.value }).then(() => {
        this.value = "";
        ctx.loadItems();
      });
    };
    // 批量改分类
    el.querySelector("#batch-category").onchange = function () {
      if (!this.value) return;
      const ids = [...el.querySelectorAll(".item-cb:checked")].map((cb) => Number(cb.value));
      if (!ids.length) return;
      batchItems(ids, "update", { category_id: Number(this.value) }).then(() => {
        this.value = "";
        ctx.loadItems();
      });
    };
  }

  ctx.bindBatch = bindBatch;
}
