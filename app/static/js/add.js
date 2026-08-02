// 添加/编辑物品页（#/add）：独立页面承载完整物品表单
// 流程：顶栏 ＋ 进入添加模式；扫码/输入条码 → 自动回填曾录入的信息（保质期除外）→ 用户修改 → 保存
// 编辑模式：物品页详情卡片点「编辑」→ #/add?id=N，表单回填，保存后返回物品页并选中该物品
import { api } from "./api.js";
import { buildTreeOptions, escapeHtml, showDialog, viewError, viewLoading } from "./utils.js";

// 状态字典：由后端 /api/meta 提供（单一数据源），此处为离线兜底值
let STATUS_OPTIONS = ["在库", "临期", "定期处理", "已处理", "损坏丢弃"];

export async function renderAdd() {
  const el = document.getElementById("view-add");
  el.innerHTML = viewLoading("添加物品");
  const editId = Number(window.__viewParams?.get("id")) || null;

  try {
    const [locations, categories, tags, meta] = await Promise.all([
      api.get("/locations"),
      api.get("/categories"),
      api.get("/tags"),
      api.get("/meta"),
    ]);
    if (meta?.statuses?.length) STATUS_OPTIONS = meta.statuses;

    const title = editId ? "编辑物品" : "添加物品";
    el.innerHTML = `
      <div class="add-head">
        <h2>${title}</h2>
        <button id="add-back" class="ghost" type="button">← 返回</button>
      </div>
      <form id="item-form" class="card add-form">
        <fieldset class="form-group">
          <legend>条码</legend>
          <div class="form-field full">
            <label for="f-barcode">条码</label>
            <div class="barcode-row">
              <input id="f-barcode" name="barcode" placeholder="扫码 / 扫码枪 / 手动输入" />
              <button type="button" id="barcode-scan" class="ghost hidden" title="用摄像头扫码">扫码</button>
            </div>
          </div>
          <p class="form-hint">扫码或输入条码：曾录入过的物品会自动回填名称、位置、数量等信息（保质期除外），改好即可保存。</p>
        </fieldset>

        <fieldset class="form-group">
          <legend>基本信息</legend>
          <div class="form-field full">
            <label for="f-name">物品名称 <em>*</em></label>
            <input id="f-name" name="name" placeholder="如：生抽、雨伞" required />
          </div>
          <div class="form-field full">
            <label for="f-description">描述</label>
            <input id="f-description" name="description" placeholder="用途 / 规格 / 备注" />
          </div>
          <div class="form-field full">
            <label for="f-category">分类</label>
            <select id="f-category" name="category_id">
              <option value="">分类（可选）</option>
              ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
            </select>
          </div>
        </fieldset>

        <fieldset class="form-group">
          <legend>存放位置</legend>
          <div class="form-field full">
            <label for="f-location">位置</label>
            <select id="f-location" name="location_id">
              ${buildTreeOptions(locations, "位置（可选）")}
            </select>
          </div>
          <div class="form-field full">
            <label for="f-location-note">位置备注</label>
            <input id="f-location-note" name="location_note" placeholder="如：第二层靠左" />
          </div>
        </fieldset>

        <fieldset class="form-group">
          <legend>数量与状态</legend>
          <div class="form-field">
            <label for="f-quantity">数量</label>
            <input id="f-quantity" name="quantity" type="number" step="any" value="1" />
          </div>
          <div class="form-field">
            <label for="f-unit">单位</label>
            <input id="f-unit" name="unit" value="个" />
          </div>
          <div class="form-field">
            <label for="f-status">状态</label>
            <select id="f-status" name="status">
              ${STATUS_OPTIONS.map((s) => `<option>${s}</option>`).join("")}
            </select>
          </div>
        </fieldset>

        <fieldset class="form-group">
          <legend>保质期</legend>
          <div class="form-field">
            <label for="f-shelf-days">保质期天数</label>
            <input id="f-shelf-days" name="shelf_life_days" type="number" min="1" placeholder="如：180" title="填写保质期天数，自动算出到期时间" />
          </div>
          <div class="form-field">
            <label for="f-purchase">生产日期</label>
            <input id="f-purchase" name="purchase_date" type="date" title="保质期按 生产日期 + 保质期天数 自动计算；未填则按今天" />
          </div>
          <div class="form-field">
            <label for="f-expiry">保质期到期</label>
            <input id="f-expiry" name="expiry_date" type="date" title="保质期到期日；也可直接填写" />
          </div>
          <p class="form-hint">填「保质期天数」+「生产日期」会自动算到期时间；或直接填「保质期到期」日。</p>
        </fieldset>

        <fieldset class="form-group">
          <legend>更多信息</legend>
          <div class="form-field">
            <label for="f-serial">序列号</label>
            <input id="f-serial" name="serial_number" placeholder="序列号 / 编号" />
          </div>
          <div class="form-field">
            <label for="f-price">价格（元）</label>
            <input id="f-price" name="price" type="number" step="0.01" placeholder="如：29.90" />
          </div>
          <div class="form-field">
            <label for="f-warranty">保修到期</label>
            <input id="f-warranty" name="warranty_expiry" type="date" title="保修到期" />
          </div>
          <div class="form-field full">
            <label for="f-tags">标签</label>
            <div id="tag-picker" class="tag-picker">
              ${tags.map((t) => `<button type="button" class="tag-chip tag-opt" data-tid="${t.id}">${escapeHtml(t.name)}</button>`).join("")}
              ${tags.length ? "" : '<span class="tag-picker-empty">暂无标签，可直接新建</span>'}
            </div>
            <div class="tag-new-row">
              <input id="tag-new-name" placeholder="新标签名，回车即创建并选中" maxlength="20" />
              <button type="button" id="tag-new-add" class="ghost">＋ 新标签</button>
            </div>
          </div>
        </fieldset>

        <fieldset class="form-group">
          <legend>照片（仅添加时可选）</legend>
          <div class="photo-pick full" id="item-photo-pick">
            <label class="photo-opt" id="item-photo-camera-label">
              <input id="item-photo-camera" type="file" accept="image/*" capture="environment" />
              <span>拍照</span>
            </label>
            <label class="photo-opt" id="item-photo-gallery-label">
              <input id="item-photo-gallery" type="file" accept="image/*" />
              <span>图库</span>
            </label>
            <p class="photo-hint">照片会自动压缩为 WebP（≤2000px）</p>
          </div>
          <img id="item-photo-preview" class="photo-preview full hidden" alt="照片预览" />
        </fieldset>

        <div class="form-actions">
          <button type="submit">${editId ? "保存" : "添加"}</button>
          <button type="button" id="add-cancel" class="ghost">取消</button>
        </div>
      </form>
    `;

    const form = el.querySelector("#item-form");
    const barcodeInput = form.querySelector("[name=barcode]");
    const shelfInput = form.querySelector("[name=shelf_life_days]");
    const expiryInput = form.querySelector("[name=expiry_date]");
    const purchaseInput = form.querySelector("[name=purchase_date]");

    // ---- 条形码：摄像头扫码（BarcodeDetector 渐进增强；不支持则仅手动/扫码枪输入）----
    const scanBtn = form.querySelector("#barcode-scan");
    if (scanBtn && "BarcodeDetector" in window && navigator.mediaDevices?.getUserMedia) {
      scanBtn.classList.remove("hidden");
      scanBtn.onclick = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          const video = document.createElement("video");
          video.srcObject = stream;
          video.setAttribute("playsinline", "");
          const holder = document.createElement("div");
          holder.className = "scan-view";
          holder.appendChild(video);
          form.insertBefore(holder, form.firstChild);
          await video.play();
          const detector = new BarcodeDetector({
            formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"],
          });
          const stop = () => {
            clearInterval(timer);
            clearTimeout(timeout);
            stream.getTracks().forEach((t) => t.stop());
            holder.remove();
          };
          const timer = setInterval(async () => {
            try {
              const codes = await detector.detect(video);
              if (codes.length) {
                barcodeInput.value = codes[0].rawValue;
                stop();
                fillFromBarcode(barcodeInput.value); // 扫码后自动回填曾录入的信息
              }
            } catch {
              // 帧检测失败忽略，继续
            }
          }, 300);
          const timeout = setTimeout(stop, 30000); // 30 秒未识别自动关闭
          holder.onclick = stop; // 点取景区域取消
        } catch (e) {
          showDialog({ title: "无法使用相机", message: e.message, confirmText: "知道了" });
        }
      };
    }

    // ---- 扫码记忆：条码曾录入过 → 自动回填表单（名称/描述/位置/数量/状态等，不含保质期）----
    const fillFromBarcode = async (barcode) => {
      if (!barcode) return;
      try {
        const res = await api.get(`/items?barcode=${encodeURIComponent(barcode)}&show_archived=true`);
        const tpl = res.items?.[0];
        if (!tpl) return;
        form.querySelector("[name=name]").value = tpl.name || "";
        form.querySelector("[name=description]").value = tpl.description || "";
        form.querySelector("[name=location_id]").value = tpl.location_id ?? "";
        form.querySelector("[name=location_note]").value = tpl.location_note || "";
        form.querySelector("[name=category_id]").value = tpl.category_id ?? "";
        form.querySelector("[name=quantity]").value = tpl.quantity ?? 1;
        form.querySelector("[name=unit]").value = tpl.unit || "个";
        form.querySelector("[name=status]").value = tpl.status || "在库";
        form.querySelector("[name=serial_number]").value = tpl.serial_number || "";
        form.querySelector("[name=price]").value = tpl.price ?? "";
        // 保质期相关字段清空（用户明确要求：回填时去掉保质期）
        if (shelfInput) shelfInput.value = "";
        if (expiryInput) expiryInput.value = "";
        if (purchaseInput) purchaseInput.value = "";
        showDialog({
          title: "已自动填充",
          message: `条码 ${barcode} 曾录入过「${tpl.name}」，已自动填好（保质期除外），改好即可保存。`,
          confirmText: "知道了",
        });
      } catch {
        // 查询失败静默（不影响手动输入）
      }
    };
    // 手动输入 / 扫码枪输入条码（回车或失焦）也触发回填
    barcodeInput?.addEventListener("change", () => fillFromBarcode(barcodeInput.value));

    // ---- 保质期天数 → 自动计算到期时间（购买日期 + 天数；无购买日期按今天）----
    const calcExpiry = () => {
      const days = parseInt(shelfInput?.value || "", 10);
      if (!days || days <= 0) return;
      const base = purchaseInput?.value || new Date().toISOString().slice(0, 10);
      const d = new Date(base + "T00:00:00");
      d.setDate(d.getDate() + days);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      expiryInput.value = `${y}-${m}-${dd}`;
    };
    shelfInput?.addEventListener("input", calcExpiry);
    purchaseInput?.addEventListener("change", calcExpiry);

    // ---- 照片选择 → 本地预览（仅新增模式；编辑已有物品补图走详情卡片）----
    const photoInputs = form.querySelectorAll("#item-photo-camera, #item-photo-gallery");
    const photoPick = form.querySelector("#item-photo-pick");
    const photoPreview = form.querySelector("#item-photo-preview");
    let photoFile = null;
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

    // ---- 标签按钮式多选（选中高亮 / 未选中灰色）+ 新建标签 ----
    const tagPicker = form.querySelector("#tag-picker");
    const tagNewName = form.querySelector("#tag-new-name");
    const tagNewAdd = form.querySelector("#tag-new-add");

    // 点击标签 chip → 切换选中
    tagPicker.addEventListener("click", (e) => {
      const chip = e.target.closest(".tag-opt");
      if (!chip) return;
      chip.classList.toggle("active");
      chip.blur(); // 消除点击后 focus 残留
    });

    // 新建标签：输入名 → 立即创建并选中；同名已存在则直接选中
    const addNewTag = async () => {
      const name = tagNewName.value.trim();
      if (!name) return;
      // 同名标签已存在 → 直接选中，不重复创建
      const dup = [...tagPicker.querySelectorAll(".tag-opt")].find((b) => b.textContent === name);
      if (dup) {
        dup.classList.add("active");
        tagNewName.value = "";
        return;
      }
      try {
        const t = await api.post("/tags", { name });
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "tag-chip tag-opt active";
        chip.dataset.tid = t.id;
        chip.textContent = t.name;
        tagPicker.appendChild(chip);
        tagPicker.querySelector(".tag-picker-empty")?.remove();
        tagNewName.value = "";
      } catch (err) {
        showDialog({ title: "新建标签失败", message: err.message, confirmText: "知道了" });
      }
    };
    tagNewAdd.onclick = addNewTag;
    tagNewName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addNewTag();
      }
    });

    // ---- 返回 / 取消（有历史则后退，否则回物品页）----
    const goBack = () => {
      if (history.length > 1) history.back();
      else window.showView("items");
    };
    el.querySelector("#add-back").onclick = goBack;
    el.querySelector("#add-cancel").onclick = goBack;

    // ---- 编辑模式：回填表单（照片区域隐藏，编辑补图走详情卡片）----
    if (editId) {
      try {
        const item = await api.get(`/items/${editId}`);
        photoPick?.classList.add("hidden");
        form.querySelector("[name=name]").value = item.name || "";
        form.querySelector("[name=description]").value = item.description || "";
        form.querySelector("[name=location_id]").value = item.location_id ?? "";
        form.querySelector("[name=location_note]").value = item.location_note || "";
        form.querySelector("[name=category_id]").value = item.category_id ?? "";
        form.querySelector("[name=quantity]").value = item.quantity;
        form.querySelector("[name=unit]").value = item.unit || "";
        form.querySelector("[name=status]").value = item.status || "在库";
        form.querySelector("[name=expiry_date]").value = item.expiry_date || "";
        form.querySelector("[name=shelf_life_days]").value = item.shelf_life_days ?? "";
        form.querySelector("[name=purchase_date]").value = item.purchase_date || "";
        form.querySelector("[name=serial_number]").value = item.serial_number || "";
        barcodeInput.value = item.barcode || "";
        form.querySelector("[name=price]").value = item.price ?? "";
        form.querySelector("[name=warranty_expiry]").value = item.warranty_expiry || "";
        // 标签 chips 回填选中
        (item.tags || []).forEach((t) => {
          const chip = tagPicker.querySelector(`.tag-opt[data-tid="${t.id}"]`);
          if (chip) chip.classList.add("active");
        });
      } catch (e) {
        el.innerHTML = viewError(e.message);
        return;
      }
    }

    // ---- 提交（新增/编辑共用）----
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const selectedTags = [...tagPicker.querySelectorAll(".tag-opt.active")].map((b) => b.dataset.tid);
      try {
        let itemId;
        if (editId) {
          await api.put(`/items/${editId}`, buildPayload(fd, STATUS_OPTIONS?.[0]));
          itemId = editId;
          // 编辑时移除不再选中的标签
          const current = await api.get(`/items/${itemId}`);
          const removeTags = (current.tags || []).map((t) => t.id).filter((id) => !selectedTags.includes(String(id)));
          for (const tid of removeTags) {
            await api.del(`/items/${itemId}/tags/${tid}`);
          }
        } else {
          const created = await api.post("/items", buildPayload(fd, STATUS_OPTIONS?.[0]));
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
        if (!editId && photoFile) {
          const fdata = new FormData();
          fdata.append("file", photoFile);
          try {
            await api.upload(`/items/${itemId}/images`, fdata);
          } catch (err) {
            showDialog({
              title: "照片上传失败",
              message: `物品已创建，但照片上传失败：${err.message}（可在物品页详情卡片补传）`,
              confirmText: "知道了",
            });
          }
        }
        // 保存成功 → 回物品页并选中该物品
        window.showView("items", { sel: itemId });
      } catch (err) {
        showDialog({ title: "保存失败", message: err.message, confirmText: "知道了" });
      }
    };
  } catch (e) {
    el.innerHTML = viewError(e.message);
  }
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
    shelf_life_days: fd.get("shelf_life_days") ? Number(fd.get("shelf_life_days")) : null,
    serial_number: fd.get("serial_number") || null,
    barcode: fd.get("barcode")?.trim() || null,
    price: fd.get("price") ? Number(fd.get("price")) : null,
    warranty_expiry: fd.get("warranty_expiry") || null,
  };
  const lid = fd.get("location_id");
  const cid = fd.get("category_id");
  if (lid) p.location_id = Number(lid);
  if (cid) p.category_id = Number(cid);
  return p;
}
