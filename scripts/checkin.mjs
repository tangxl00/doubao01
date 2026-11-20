#!/usr/bin/env node
import { chromium } from "playwright";

const CHECKIN_URL = "https://www.doubao.com/pc/agent-explore";

const args = parseArgs();
const cookie = args.cookie || process.env.DOUBAO_COOKIE;
const headless = args.headless !== false && process.env.HEADLESS !== "0";
const dryRun = args.dryRun || process.env.DRY_RUN === "1";
const timeout = args.timeout || 30000;

if (!cookie) { console.error("❌ 缺少 DOUBAO_COOKIE"); process.exit(1); }

const cookies = parseCookieString(cookie);
console.log("\n🎯 豆包每日签到\n" + "─".repeat(50));
console.log("Cookie 条数  ", cookies.length);
console.log("Headless     ", headless);

const browser = await chromium.launch({ headless });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
});
await context.addCookies(cookies);
const page = await context.newPage();

// 保存所有 console 和 response 用于调试
page.on("console", msg => console.log("[page]", msg.text().slice(0, 200)));
page.on("response", async resp => {
  const url = resp.url();
  if (url.includes("checkin") || url.includes("campaign") || url.includes("reward")) {
    try { console.log("[API]", url.slice(0, 120), await resp.text()); } catch {}
  }
});

try {
  console.log("\n① 打开签到页...");
  await page.goto(CHECKIN_URL, { waitUntil: "domcontentloaded", timeout });
  console.log("   URL:", page.url());
  
  // 等待更长时间让 SPA 渲染
  await page.waitForTimeout(5000);

  // 地域封锁检测
  const bodyText = await page.evaluate(() => document.body.innerText || "").catch(() => "");
  if (bodyText.includes("暂时不可用") || bodyText.includes("区域限制") || bodyText.includes("访问受限")) {
    console.error("❌ 触发豆包地域封锁");
    await page.screenshot({ path: "debug-blocked.png", fullPage: true });
    process.exit(3);
  }

  // 保存页面快照（调试用）
  await page.screenshot({ path: "debug-page.png", fullPage: true });
  const html = await page.content();
  console.log("   HTML 长度:", html.length, "字符");

  // 打印页面前 300 字文本（帮我判断页面实际内容）
  const preview = bodyText.slice(0, 500).replace(/\n/g, " | ");
  console.log("   页面预览:", preview);

  // 多选择器探测签到按钮
  console.log("\n② 探测签到按钮（多选择器尝试）...");
  const selectors = [
    '[data-reward-code="daily_signin"]',
    '[data-reward-code="daily_checkin"]', 
    '[class*="signin"]',
    '[class*="checkin"]',
    '[class*="reward"]',
    '[class*="campaign"]',
    '[class*="daily"]',
    'button',
  ];

  let found = null;
  for (const sel of selectors) {
    const count = await page.locator(sel).count().catch(() => 0);
    if (count > 0) {
      console.log(`   命中 ${sel} → ${count} 个元素`);
      // 打印前几个的文本
      for (let i = 0; i < Math.min(count, 5); i++) {
        const text = await page.locator(sel).nth(i).innerText().catch(() => "");
        if (text.trim()) console.log(`      [${i}] "${text.trim().slice(0, 60)}"`);
      }
      if (!found && /sign|check|reward|领取|签到|每日|免费/.test(await page.locator(sel).first().innerText().catch(() => ""))) {
        found = sel;
      }
    }
  }

  // 也试试直接搜文本
  const textHits = await page.getByText(/签到|领取|免费领|每日/i).count().catch(() => 0);
  console.log(`   文本 "签到/领取/免费领/每日" 命中: ${textHits}`);

  if (dryRun) {
    console.log("\n🔍 Dry-Run 完成");
    await browser.close();
    process.exit(0);
  }

  if (!found && textHits === 0) {
    console.error("\n❌ 所有选择器和文本都没匹配到签到按钮");
    console.error("   可能原因: Cookie 不完整 / 页面结构变更 / 该账号今日已签到");
    console.error("   已保存 debug-page.png 供排查");
    process.exit(1);
  }

  // 尝试点击找到的按钮
  const target = found 
    ? page.locator(found).first()
    : page.getByText(/签到|领取/i).first();

  console.log("\n③ 点击签到按钮...");
  await target.click({ force: true }).catch(async () => {
    await target.evaluate(el => el.click());
  });

  await page.waitForTimeout(3000);
  console.log("\n④ 点击后页面预览:", (await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\n/g, " | "));
  await page.screenshot({ path: "debug-after-click.png", fullPage: true });

  console.log("\n✅ 签到流程完成");
  await browser.close();
  process.exit(0);
} catch (err) {
  console.error("❌ 异常:", err.message);
  await page?.screenshot?.({ path: "debug-error.png", fullPage: true }).catch(() => {});
  await browser.close();
  process.exit(1);
}

// ─── utils ───────────────────────────
function parseCookieString(str) {
  return str.split(";").map(kv => kv.trim()).filter(Boolean).map(pair => {
    const idx = pair.indexOf("=");
    if (idx === -1) return null;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!name) return null;
    return { name, value, domain: ".doubao.com", path: "/" };
  }).filter(Boolean);
}

function parseArgs() {
  const r = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i], n = process.argv[i + 1];
    if (a === "--dry-run") r.dryRun = true;
    else if (a === "--no-headless") r.headless = false;
    else if (a === "--timeout" && n) { r.timeout = parseInt(n, 10); i++; }
  }
  return r;
}
