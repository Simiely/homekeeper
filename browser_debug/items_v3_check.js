// v0.9.10 验证：排序下拉 / 标签多选 / 列表行位置突出 / 表单 label
const path = require("path");
const fs = require("fs");
const puppeteer = require("C:/Users/260531/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const APP_URL = "http://127.0.0.1:8000/";
const OUT_DIR = path.resolve(__dirname, "shots_v3");
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

  // 登录 → 物品页
  await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector("#auth-form", { timeout: 10000 });
  await page.type("#username", "admin");
  await page.type("#password", "Mm123456.");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {}), page.click("#submit-btn")]);
  await sleep(1200);
  await page.click('[data-view="items"]');
  await sleep(1500);
  await page.waitForSelector(".item-row", { timeout: 8000 });

  // 1. 排序下拉存在 + 标签 chips 存在
  await step("排序下拉与标签chips渲染", async () => {
    const info = await page.evaluate(() => ({
      sortOpts: [...document.querySelectorAll("#f-sort option")].map((o) => o.textContent),
      tagChips: document.querySelectorAll("#f-tags .filter-tag").length,
      hasSelect: !!document.querySelector("#f-tag"),
    }));
    console.log("   ", JSON.stringify(info));
    if (info.sortOpts.length !== 4) throw new Error("排序选项数不对");
    if (info.hasSelect) throw new Error("旧单选标签 select 未移除");
  });

  // 2. 列表行：位置 accent 色 + 突出样式
  await step("列表行位置突出", async () => {
    const style = await page.evaluate(() => {
      const loc = document.querySelector(".item-row .item-row-loc");
      if (!loc) return null;
      const cs = getComputedStyle(loc);
      return { color: cs.color, weight: cs.fontWeight, size: cs.fontSize, text: loc.textContent };
    });
    console.log("   位置样式:", JSON.stringify(style));
    if (!style || !["600", "700"].includes(style.weight)) throw new Error("位置未加粗突出");
    const exp = await page.evaluate(() => !!document.querySelector(".item-row .item-row-exp .badge"));
    console.log("   保质期角标在行右上:", exp);
  });

  // 3. 按保质期排序：记录默认顺序 → 切 expiry → 顺序变化
  await step("按保质期排序", async () => {
    const before = await page.evaluate(() => [...document.querySelectorAll(".item-row-name")].map((n) => n.textContent));
    await page.select("#f-sort", "expiry");
    await sleep(1200);
    const after = await page.evaluate(() => ({
      names: [...document.querySelectorAll(".item-row-name")].map((n) => n.textContent),
      url: location.hash,
    }));
    console.log("   默认:", before.slice(0, 4), "→ 保质期:", after.names.slice(0, 4), "URL:", after.url);
    if (JSON.stringify(before) === JSON.stringify(after.names)) throw new Error("排序未生效");
    if (!after.url.includes("sort=expiry")) throw new Error("URL 未同步 sort");
  });

  // 4. 标签多选：点第一个 chip → 列表过滤；点第二个 → 并集；URL tag_ids 数组
  await step("标签多选并集", async () => {
    const chips = await page.evaluate(() => [...document.querySelectorAll("#f-tags .filter-tag")].map((b) => b.dataset.tid));
    if (!chips.length) throw new Error("无标签 chip（可能无标签数据）");
    await page.evaluate(() => document.querySelector("#f-tags .filter-tag").click());
    await sleep(1200);
    const one = await page.evaluate(() => ({ count: document.querySelectorAll(".item-row").length, url: location.hash }));
    console.log("   选1个标签:", JSON.stringify(one));
    if (!one.url.includes("tag_ids")) throw new Error("URL 未同步 tag_ids");
    if (chips.length > 1) {
      await page.evaluate(() => document.querySelectorAll("#f-tags .filter-tag")[1].click());
      await sleep(1200);
      const two = await page.evaluate(() => ({ count: document.querySelectorAll(".item-row").length, url: location.hash, active: document.querySelectorAll("#f-tags .filter-tag.active").length }));
      console.log("   选2个标签:", JSON.stringify(two));
      if (two.active !== 2) throw new Error("两个 chip 未同时高亮");
      if (two.count < one.count) throw new Error("并集应 ≥ 单标签结果数");
    }
    // 重置
    await page.click("#f-reset");
    await sleep(1000);
  });

  // 5. 添加页：字段 label（价格/生产日期等）
  await step("添加页表单 label", async () => {
    await page.click("#add-item-btn");
    await sleep(900);
    const labels = await page.evaluate(() => [...document.querySelectorAll("#view-add .form-field label")].map((l) => l.textContent.trim()));
    console.log("   labels:", labels.join(" / "));
    const need = ["价格（元）", "生产日期", "物品名称 *", "保质期天数", "条码"];
    for (const n of need) if (!labels.includes(n)) throw new Error("缺 label: " + n);
  });
  await page.screenshot({ path: path.join(OUT_DIR, "01-add-labels.png") });

  // 6. 返回物品页，截新列表行
  await page.evaluate(() => document.querySelector("#view-add #add-cancel").click());
  await sleep(900);
  await page.screenshot({ path: path.join(OUT_DIR, "02-items-rows.png") });

  // 7. 筛选栏整体截图（排序+chips）
  await page.evaluate(() => document.querySelector("#filter-bar").scrollIntoView());
  await sleep(300);
  await page.screenshot({ path: path.join(OUT_DIR, "03-filter-bar.png") });

  console.log("\n===== CONSOLE / 错误日志 =====");
  logs.forEach((l) => console.log(l));
  if (!logs.length) console.log("(无错误日志)");
  await browser.close();
  console.log("\n完成。截图:", OUT_DIR);
})().catch((e) => {
  console.error("脚本失败:", e.message);
  process.exit(1);
});
