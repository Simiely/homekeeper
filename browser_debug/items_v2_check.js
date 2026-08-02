// 新物品页流程验证 v1：主-从布局 + 详情卡片 + 添加页（扫码回填交互除外）
const path = require("path");
const fs = require("fs");
const puppeteer = require("C:/Users/260531/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const APP_URL = "http://127.0.0.1:8000/";
const OUT_DIR = path.resolve(__dirname, "shots_v2");

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
    if (["error", "warning"].includes(msg.type())) logs.push(`[console.${msg.type()}] ${msg.text().slice(0, 300)}`);
  });
  page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message.slice(0, 300)}`));
  page.on("requestfailed", (req) =>
    logs.push(`[requestfailed] ${req.url().slice(0, 150)} ${req.failure()?.errorText || ""}`)
  );
  page.on("response", async (res) => {
    const s = res.status();
    if (s >= 500 && !res.url().includes("login.html")) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 300);
      } catch {}
      logs.push(`[http ${s}] ${res.request().method()} ${res.url().slice(0, 120)} BODY: ${body}`);
    } else if (s >= 400 && !res.url().includes("login.html") && !res.url().includes("favicon")) {
      logs.push(`[http ${s}] ${res.request().method()} ${res.url().slice(0, 120)}`);
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

  // 1. 登录
  await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector("#auth-form", { timeout: 10000 });
  await page.type("#username", "admin");
  await page.type("#password", "Mm123456.");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {}), page.click("#submit-btn")]);
  await sleep(1200);
  console.log("== 登录后 URL:", page.url());

  // 2. 顶栏 ＋ 按钮存在 → 点击进入添加页
  await step("顶栏加号按钮存在", async () => {
    const btn = await page.waitForSelector("#add-item-btn", { timeout: 8000 });
    if (!btn) throw new Error("未找到 #add-item-btn");
  });
  await step("点击 ＋ 进入添加页", async () => {
    await page.click("#add-item-btn");
    await sleep(900);
    const inAdd = await page.evaluate(() => {
      const v = document.getElementById("view-add");
      return { url: location.hash, hidden: v?.classList.contains("hidden"), hasForm: !!document.querySelector("#view-add #item-form") };
    });
    console.log("   add-view:", JSON.stringify(inAdd));
    if (inAdd.hidden || !inAdd.hasForm) throw new Error("添加页未渲染");
    const groups = await page.evaluate(() =>
      [...document.querySelectorAll("#view-add .form-group legend")].map((l) => l.textContent)
    );
    console.log("   表单分组:", groups.join(" / "));
  });
  await page.screenshot({ path: path.join(OUT_DIR, "01-add-page.png") });

  // 3. 添加页填表保存 → 回到物品页且新物品被选中
  const createdName = "流程验证物品" + Date.now().toString().slice(-6);
  await step("添加页填表并保存", async () => {
    await page.type("#view-add [name=name]", createdName);
    await page.type("#view-add [name=quantity]", "3");
    await page.select("#view-add [name=status]", "在库");
    await page.evaluate(() => {
      const f = document.querySelector("#view-add #item-form");
      f.querySelector("button[type=submit]").click();
    });
    await sleep(1500);
    const st = await page.evaluate(() => ({
      url: location.hash,
      sel: window.__viewParams?.get("sel") || null,
      detailName: document.querySelector("#item-detail .detail-name")?.textContent || null,
    }));
    console.log("   保存后:", JSON.stringify(st));
    if (st.url.includes("items") && !st.sel) throw new Error("未带选中参数返回");
  });
  await page.screenshot({ path: path.join(OUT_DIR, "02-after-add.png") });

  // 4. 物品页：主-从布局 + 紧凑行信息
  await step("物品页列表行信息", async () => {
    await page.waitForSelector(".item-row", { timeout: 8000 });
    const info = await page.evaluate(() => {
      const row = document.querySelector(".item-row");
      return row
        ? {
            hasSel: !!row.dataset.sel,
            name: row.querySelector(".item-row-name")?.textContent,
            loc: row.querySelector(".item-row-loc")?.textContent,
            meta: row.querySelector(".item-row-meta")?.textContent,
            hasCheckbox: !!row.querySelector(".item-cb"),
            layout: getComputedStyle(document.querySelector(".items-layout")).display,
          }
        : null;
    });
    console.log("   首行:", JSON.stringify(info));
    if (!info?.hasSel) throw new Error("列表行缺少 data-sel");
  });
  await page.screenshot({ path: path.join(OUT_DIR, "03-items-list.png") });

  // 5. 点击另一行 → 详情卡片更新（选中高亮）
  await step("选中行 → 详情卡片更新", async () => {
    const before = await page.evaluate(() => document.querySelector("#item-detail .detail-name")?.textContent);
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".item-row")];
      const other = rows.find((r) => !r.classList.contains("active")) || rows[rows.length - 1];
      other.click();
    });
    await sleep(900);
    const after = await page.evaluate(() => ({
      name: document.querySelector("#item-detail .detail-name")?.textContent,
      activeId: document.querySelector(".item-row.active")?.dataset.sel || null,
      selParam: window.__viewParams?.get("sel") || null,
      fields: [...document.querySelectorAll("#item-detail .detail-field")].map((f) => f.textContent.trim().slice(0, 40)),
      actions: [...document.querySelectorAll("#item-detail [data-act]")].map((b) => b.textContent),
    }));
    console.log("   选中后:", JSON.stringify(after));
    if (!after.activeId) throw new Error("无高亮行");
    if (after.name === before) throw new Error("详情未更新");
    if (!after.fields.length) throw new Error("详情字段为空");
  });
  await page.screenshot({ path: path.join(OUT_DIR, "04-detail.png") });

  // 6. 详情卡片「编辑」→ 添加页编辑模式（表单回填）
  await step("详情编辑 → 添加页编辑模式", async () => {
    await page.evaluate(() => document.querySelector('#item-detail [data-act="edit"]').click());
    await sleep(900);
    const st = await page.evaluate(() => ({
      url: location.hash,
      title: document.querySelector("#view-add .add-head h2")?.textContent,
      nameVal: document.querySelector("#view-add [name=name]")?.value,
    }));
    console.log("   编辑模式:", JSON.stringify(st));
    if (!st.url.includes("add") || st.title !== "编辑物品") throw new Error("未进入编辑模式");
  });
  await page.screenshot({ path: path.join(OUT_DIR, "05-edit-mode.png") });

  // 7. 编辑页取消返回 → 回到物品页
  await step("编辑页取消返回", async () => {
    await page.evaluate(() => document.querySelector("#view-add #add-cancel").click());
    await sleep(800);
    const url = await page.evaluate(() => location.hash);
    console.log("   取消后:", url);
    if (!url.includes("items")) throw new Error("取消后未回到物品页");
  });

  // 8. 批量条：全选 + 勾选计数
  await step("批量条可用", async () => {
    const info = await page.evaluate(() => {
      const sa = document.querySelector("#select-all");
      if (!sa) return { ok: false, reason: "无 #select-all" };
      sa.click();
      const bar = document.querySelector("#batch-bar");
      return { ok: true, barShown: bar?.style.display === "flex", count: document.querySelector("#batch-count")?.textContent };
    });
    console.log("   全选:", JSON.stringify(info));
    if (!info.ok || !info.barShown) throw new Error("批量条未出现");
    // 取消全选，避免影响后续
    await page.evaluate(() => document.querySelector("#select-all").click());
  });

  // 9. 详情卡片「已处理」→ 列表刷新且详情显示撤销按钮
  await step("详情卡片已处理", async () => {
    const sel = await page.evaluate(() => {
      const active = document.querySelector(".item-row.active");
      return active ? Number(active.dataset.sel) : null;
    });
    if (!sel) throw new Error("无选中行");
    await page.evaluate(() => document.querySelector('#item-detail [data-act="archive"]')?.click());
    await sleep(1200);
    const st = await page.evaluate(() => ({
      hasUnarchive: !!document.querySelector('#item-detail [data-act="unarchive"]'),
      archivedCls: !!document.querySelector(".item-detail.archived"),
    }));
    console.log("   已处理后:", JSON.stringify(st));
    if (!st.hasUnarchive) throw new Error("已处理后无撤销按钮");
    // 撤销，恢复原状
    await page.evaluate(() => document.querySelector('#item-detail [data-act="unarchive"]').click());
    await sleep(1200);
  });

  // 10. 移动端视口：详情在上、列表在下
  await step("移动端布局", async () => {
    await page.setViewport({ width: 390, height: 844 });
    await sleep(600);
    const layout = await page.evaluate(() => {
      const listTop = document.querySelector(".items-pane-list").getBoundingClientRect().top;
      const detailTop = document.querySelector(".items-pane-detail").getBoundingClientRect().top;
      return { listTop: Math.round(listTop), detailTop: Math.round(detailTop), detailAbove: detailTop <= listTop };
    });
    console.log("   移动端:", JSON.stringify(layout));
    if (!layout.detailAbove) throw new Error("移动端详情未在列表上方");
    await page.setViewport({ width: 1280, height: 900 });
  });
  await page.screenshot({ path: path.join(OUT_DIR, "06-mobile.png") });

  // 11. 清理测试数据：删除名称以「流程验证物品」开头的物品
  await step("清理测试数据", async () => {
    const deleted = await page.evaluate(async (namePrefix) => {
      const token = localStorage.getItem("hk_token");
      const headers = { Authorization: "Bearer " + token };
      const res = await fetch("/api/items?keyword=" + encodeURIComponent(namePrefix) + "&page_size=50", { headers });
      const data = await res.json();
      let n = 0;
      for (const it of data.items || []) {
        if (it.name && it.name.startsWith(namePrefix)) {
          await fetch("/api/items/" + it.id, { method: "DELETE", headers });
          n++;
        }
      }
      return n;
    }, "流程验证物品");
    console.log("   已删除测试物品:", deleted, "件");
  });

  // 12. 日志输出
  console.log("\n===== CONSOLE / 错误日志 =====");
  logs.forEach((l) => console.log(l));
  if (!logs.length) console.log("(无错误日志)");

  await browser.close();
  console.log("\n完成。截图目录:", OUT_DIR);
})().catch((e) => {
  console.error("脚本失败:", e.message);
  process.exit(1);
});
