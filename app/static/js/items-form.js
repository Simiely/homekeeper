// 物品表单：新增提交 / 编辑回填（startEdit/cancelEdit）/ buildPayload
// 通过 initForm(ctx) 注入上下文；ctx.startEdit 由此模块注入（列表行 [data-edit] 分派用）
import { api } from "./api.js";
import { showDialog } from "./utils.js";

export function initForm(ctx) {
  const el = ctx.el;
  const form = el.querySelector("#item-form");
  const photoInputs = el.querySelectorAll("#item-photo-camera, #item-photo-gallery"); // 拍照/图库双入口
  const photoPick = el.querySelector("#item-photo-pick");
  const photoPreview = el.querySelector("#item-photo-preview");
  let photoFile = null; // 待上传的照片文件（新增模式）

  // 照片选择 → 本地预览（仅新增模式展示；编辑已有行内上传/缩略图）
  const onPhotoPicked = (input) => {
    const f = input.files?.[0];
    photoFile = f || null;
    if (f) {
      photoPreview.src = URL.createObjectURL(f);
      photoPreview.classList.remove("hidden");
    } else {
      photoPreview.classList.add("hidden");
      photoPreview.removeAttribute("src");
    }
  };
  photoInputs.forEach((inp) => {
    inp.onchange = () => onPhotoPicked(inp);
  });

  // 编辑模式：回填表单 + 切换按钮（照片区域隐藏，编辑补图走列表行内上传）
  function startEdit(item) {
    ctx.editingItemId = item.id;
    photoPick?.classList.add("hidden");
    photoPreview?.classList.add("hidden");
    form.querySelector("[name=name]").value = item.name || "";
    form.querySelector("[name=description]").value = item.description || "";
    form.querySelector("[name=location_id]").value = item.location_id ?? "";
    form.querySelector("[name=location_note]").value = item.location_note || "";
    form.querySelector("[name=category_id]").value = item.category_id ?? "";
    form.querySelector("[name=quantity]").value = item.quantity;
    form.querySelector("[name=unit]").value = item.unit || "";
    form.querySelector("[name=status]").value = item.status || "在库";
    form.querySelector("[name=expiry_date]").value = item.expiry_date || "";
    form.querySelector("[name=purchase_date]").value = item.purchase_date || "";
    form.querySelector("[name=serial_number]").value = item.serial_number || "";
    form.querySelector("[name=price]").value = item.price ?? "";
    form.querySelector("[name=warranty_expiry]").value = item.warranty_expiry || "";
    const btn = form.querySelector("button[type=submit]");
    btn.textContent = "保存";
    if (!form.querySelector("#edit-cancel")) {
      const cancel = document.createElement("button");
      cancel.id = "edit-cancel";
      cancel.type = "button";
      cancel.textContent = "取消";
      cancel.className = "ghost";
      cancel.onclick = cancelEdit;
      btn.after(cancel);
    }
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function cancelEdit() {
    ctx.editingItemId = null;
    form.reset();
    form.querySelector("button[type=submit]").textContent = "添加";
    const cancel = form.querySelector("#edit-cancel");
    if (cancel) cancel.remove();
    // 恢复照片选择区并清空
    photoPick?.classList.remove("hidden");
    photoFile = null;
    photoInputs.forEach((inp) => { inp.value = ""; });
    if (photoPreview) {
      photoPreview.classList.add("hidden");
      photoPreview.removeAttribute("src");
    }
  }

  // 列表行 [data-edit] 分派入口（items-list 调用）
  ctx.startEdit = startEdit;

  // 新增/编辑提交（共用）
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const tagSelect = el.querySelector("[name=tags]");
      const selectedTags = tagSelect ? Array.from(tagSelect.selectedOptions).map(o => o.value).filter(v => v) : [];

      let itemId;
      if (ctx.editingItemId) {
        await api.put(`/items/${ctx.editingItemId}`, buildPayload(fd, ctx.statusOptions?.[0]));
        itemId = ctx.editingItemId;
        // 编辑时移除不再选中的标签
        const current = await api.get(`/items/${itemId}`);
        const removeTags = (current.tags || []).map((t) => t.id).filter((id) => !selectedTags.includes(String(id)));
        for (const tid of removeTags) {
          await api.del(`/items/${itemId}/tags/${tid}`);
        }
      } else {
        const created = await api.post("/items", buildPayload(fd, ctx.statusOptions?.[0]));
        itemId = created.id;
      }
      // 新增标签（已存在跳过）
      for (const tid of selectedTags) {
        try {
          await api.post(`/items/${itemId}/tags/${tid}`);
        } catch {
          // 标签已存在则忽略
        }
      }
      // 新增模式选了照片 → 创建成功后上传（后端自动压缩为 WebP ≤2000px）
      if (!ctx.editingItemId && photoFile) {
        const fdata = new FormData();
        fdata.append("file", photoFile);
        try {
          await api.upload(`/items/${itemId}/images`, fdata);
        } catch (err) {
          showDialog({
            title: "照片上传失败",
            message: `物品已创建，但照片上传失败：${err.message}（可稍后在列表点「+」补传）`,
            confirmText: "知道了",
          });
        }
      }
      cancelEdit();
      ctx.loadItems();
    } catch (err) {
      showDialog({ title: "保存失败", message: err.message, confirmText: "知道了" });
    }
  };
}

function buildPayload(fd, statusFallback) {
  const p = {
    name: fd.get("name"),
    description: fd.get("description") || "",
    location_note: fd.get("location_note") || "",
    quantity: Number(fd.get("quantity")) || 1,
    unit: fd.get("unit") || "个",
    status: fd.get("status") || statusFallback || "在库",
    expiry_date: fd.get("expiry_date") || null,
    purchase_date: fd.get("purchase_date") || null,
    serial_number: fd.get("serial_number") || null,
    price: fd.get("price") ? Number(fd.get("price")) : null,
    warranty_expiry: fd.get("warranty_expiry") || null,
  };
  const lid = fd.get("location_id");
  const cid = fd.get("category_id");
  if (lid) p.location_id = Number(lid);
  if (cid) p.category_id = Number(cid);
  return p;
}
