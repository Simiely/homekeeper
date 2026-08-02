// 编辑物品页标签改版验证：按钮式多选（选中高亮/未选中灰）+ 新建标签
const path = require("path");
const fs = require("fs");
const puppeteer = require("C:/Users/260531/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const APP_URL = "http://127.0.0.1:8000/";
const OUT_DIR = path.resolve(__dirname, "shots_v4");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1280,900"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const logs = [];
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) logs.push(`[console.${msg.type()}] ${msg.text().slice(0, 200)}`);
  });
  page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message.slice(0, 200)}`));
  page.on("response", (res) => {
    const s = res.status();
    if (s >= 400 && !res.url().includes("login.html") && !res.url().includes("favicon")) {
      logs.push(`[http ${s}] ${res.request().method()} ${res.url().slice(0, 100)}`);
    }
  });

  const step = async (name, fn) => {
    try {
      await fn();
      console.log("OK -", name);
    } catch (e) {
      console.log("FAIL -", name, "=>", e.message.slice(0, 200));
      logs.push(`[step-fail] ${name}: ${e.message.slice(0, 200)}`);
    }
  };

  await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector("#auth-form", { timeout: 10000 });
  await page.type("#username", "admin");
  await page.type("#password", "Mm123456.");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {}), page.click("#submit-btn")]);
  await sleep(1200);

  // 1. 进入添加页：标签区渲染为按钮 chips + 新建行
  await step("标签按钮式渲染", async () => {
    await page.click("#add-item-btn");
    await sleep(900);
    const info = await page.evaluate(() => ({
      chips: [...document.querySelectorAll("#tag-picker .tag-opt")].map((b) => b.textContent),
      hasMultiSelect: !!document.querySelector("#view-add [name=tags]"),
      hasNewRow: !!document.querySelector("#tag-new-add"),
      emptyText: document.querySelector(".tag-picker-empty")?.textContent || null,
    }));
    console.log("   ", JSON.stringify(info));
    if (info.hasMultiSelect) throw new Error("旧 multiple select 未移除");
    if (!info.hasNewRow) throw new Error("无新建标签行");
  });

  // 2. 点击 chip → active 高亮（accent 色）；再点 → 取消变灰
  //    注意 .tag-opt 有 transition:all .12s，读取计算样式需等过渡完成
  await step("点击切换选中态", async () => {
    const style = await page.evaluate(async () => {
      const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
      const b = document.querySelector("#tag-picker .tag-opt");
      b.click();
      await sleep2(250); // 等 transition 结束
      const activeCs = getComputedStyle(b);
      const activeInfo = { cls: b.className, color: activeCs.color, border: activeCs.borderColor, weight: activeCs.fontWeight, bg: activeCs.backgroundColor };
      b.click();
      await sleep2(250);
      const normalCs = getComputedStyle(b);
      return { activeInfo, normal: { cls: b.className, color: normalCs.color, border: normalCs.borderColor, bg: normalCs.backgroundColor } };
    });
    console.log("   ", JSON.stringify(style));
    if (!style.activeInfo.cls.includes("active")) throw new Error("点击后未激活");
    if (style.activeInfo.color === style.normal.color) throw new Error("选中/未选中颜色无差异");
    if (style.activeInfo.weight !== "600") throw new Error("选中未加粗");
  });

  // 3. 多选两个标签 → 提交表单，保存后详情卡片显示 2 个标签
  const itemName = "标签流程验证" + Date.now().toString().slice(-5);
  await step("多选标签并保存", async () => {
    await page.type("#view-add [name=name]", itemName);
    await page.evaluate(() => {
      const chips = [...document.querySelectorAll("#tag-picker .tag-opt")];
      chips.slice(0, 2).forEach((b) => b.classList.add("active")); // 选中前 2 个
      document.querySelector("#view-add #item-form button[type=submit]").click();
    });
    await sleep(1500);
    const st = await page.evaluate(() => ({
      sel: window.__viewParams?.get("sel") || null,
      detailTags: [...document.querySelectorAll("#item-detail .tag-chip")].map((c) => c.textContent),
    }));
    console.log("   保存后:", JSON.stringify(st));
    if (!st.sel) throw new Error("未返回选中");
    if (st.detailTags.length !== 2) throw new Error("详情标签数≠2");
  });

  // 4. 编辑该物品：标签 chips 回填选中（2 个 active）
  await step("编辑回填选中态", async () => {
    await page.evaluate(() => document.querySelector('#item-detail [data-act="edit"]').click());
    await sleep(900);
    const st = await page.evaluate(() => ({
      active: [...document.querySelectorAll("#tag-picker .tag-opt.active")].map((b) => b.textContent),
      title: document.querySelector("#view-add .add-head h2")?.textContent,
    }));
    console.log("   回填:", JSON.stringify(st));
    if (st.title !== "编辑物品") throw new Error("未进入编辑模式");
    if (st.active.length !== 2) throw new Error("回填 active 数≠2");
  });
  await page.screenshot({ path: path.join(OUT_DIR, "01-edit-tags-fill.png") });

  // 5. 新建标签：输入名回车 → 创建并自动选中；同名再次输入 → 不新建只选中
  const newTagName = "流程新标签" + Date.now().toString().slice(-4);
  await step("新建标签并自动选中", async () => {
    await page.type("#tag-new-name", newTagName);
    await page.keyboard.press("Enter");
    await sleep(1000);
    const st = await page.evaluate((name) => {
      const chips = [...document.querySelectorAll("#tag-picker .tag-opt")];
      const newChip = chips.find((b) => b.textContent === name);
      return { exists: !!newChip, active: newChip?.classList.contains("active") || false, total: chips.length };
    }, newTagName);
    console.log("   新建后:", JSON.stringify(st));
    if (!st.exists || !st.active) throw new Error("新标签未创建或未选中");
    // 同名再输一次 → 只选中不重复创建
    await page.type("#tag-new-name", newTagName);
    await page.keyboard.press("Enter");
    await sleep(700);
    const st2 = await page.evaluate((name) => ({
      count: [...document.querySelectorAll("#tag-picker .tag-opt")].filter((b) => b.textContent === name).length,
    }), newTagName);
    console.log("   同名重试:", JSON.stringify(st2));
    if (st2.count !== 1) throw new Error("同名标签重复创建");
  });
  await page.screenshot({ path: path.join(OUT_DIR, "02-new-tag.png") });

  // 6. 保存编辑 → 详情 3 个标签（原2+新1）
  await step("保存后 3 标签", async () => {
    await page.evaluate(() => document.querySelector("#view-add #item-form button[type=submit]").click());
    await sleep(1500);
    const tags = await page.evaluate(() => [...document.querySelectorAll("#item-detail .tag-chip")].map((c) => c.textContent));
    console.log("   详情标签:", tags);
    if (tags.length !== 3) throw new Error("详情标签数≠3");
  });

  // 7. 清理：删除测试物品 + 新标签（保持数据干净）
  await step("清理测试数据", async () => {
    const r = await page.evaluate(async (prefix) => {
      const token = localStorage.getItem("hk_token");
      const h = { Authorization: "Bearer " + token };
      const items = (await (await fetch("/api/items?keyword=" + encodeURIComponent(prefix) + "&page_size=50", { headers: h })).json()).items || [];
      for (const it of items) {
        if (it.name && it.name.startsWith(prefix)) await fetch("/api/items/" + it.id, { method: "DELETE", headers: h });
      }
      const tags = (await (await fetch("/api/tags", { headers: h })).json()) || [];
      let n = 0;
      for (const t of tags) {
        if (t.name && t.name.startsWith("流程新标签")) {
          await fetch("/api/tags/" + t.id, { method: "DELETE", headers: h });
          n++;
        }
      }
      return { items: items.filter((i) => i.name.startsWith(prefix)).length, tags: n };
    }, "标签流程验证");
    console.log("   已清理:", JSON.stringify(r));
  });

  console.log("\n===== CONSOLE / 错误日志 =====");
  logs.forEach((l) => console.log(l));
  if (!logs.length) console.log("(无错误日志)");
  await browser.close();
  console.log("\n完成。截图:", OUT_DIR);
})().catch((e) => {
  console.error("脚本失败:", e.message);
  process.exit(1);
});
