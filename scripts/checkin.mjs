#!/usr/bin/env node
/**
 * 豆包网页版每日签到脚本 - Playwright + Cookie
 */

import { chromium } from "playwright";

const CHECKIN_URL = "https://www.doubao.com/pc/agent-explore";
const DAILY_REWARD_SELECTOR = '[data-reward-code="daily_signin"]';

const args = parseArgs();
const cookie = args.cookie || process.env.DOUBAO_COOKIE;
const ua = args.ua || process.env.DOUBAO_UA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const headless = args.headless !== false && process.env.HEADLESS !== "0";
const dryRun = args.dryRun || process.env.DRY_RUN === "1";
const timeout = args.timeout || 20000;

if (!cookie) {
  console.error("❌ 缺少 DOUBAO_COOKIE 环境变量");
  process.exit(1);
}

const cookies = parseCookieString(cookie);
if (!cookies.length) {
  console.error("❌ Cookie 解析失败");
  process.exit(1);
}

console.log("\n🎯 豆包每日签到\n" + "─".repeat(50));
console.log("Cookie 条数  ", cookies.length);
console.log("Headless     ", headless);
console.log("Dry-Run      ", !!dryRun);
console.log("─".repeat(50) + "\n");

const browser = await chromium.launch({ headless });
const context = await browser.newContext({ userAgent: ua, viewport: { width: 1280, height: 800 } });
await context.addCookies(cookies);
const page = await context.newPage();

try {
  console.log("① 打开签到页...");
  await page.goto(CHECKIN_URL, { waitUntil: "networkidle", timeout });
  await page.waitForTimeout(1500);

  // 地域封锁检测
  const blocked = await page.evaluate(() =>
    document.body.innerText.includes("暂时不可用") ||
    document.body.innerText.includes("区域限制") ||
    document.body.innerText.includes("访问受限")
  ).catch(() => false);

  if (blocked) {
    console.error("❌ 触发豆包地域封锁 —— 当前 IP 不在中国大陆");
    console.error("   解决方案:");
    console.error("   1. 用 Gitee Go 国内 runner");
    console.error("   2. 在自己的国内 VPS 或 PC 上跑");
    console.error("   3. GitHub Actions 需配自建 runner (self-hosted, 中国大陆网络)");
    process.exit(3);
  }

  console.log("② 探测签到状态...");
  const state = await detectState(page);
  console.log("签到状态    ", state.status);
  console.log("按钮存在    ", !!state.buttonVisible);

  if (state.status === "已签到") {
    console.log("\n✅ 今日已签到, 无需重复操作");
    await browser.close();
    process.exit(0);
  }

  if (dryRun) {
    console.log("\n🔍 Dry-Run 模式 —— 探测到可签到, 未执行点击");
    await browser.close();
    process.exit(0);
  }

  if (!state.buttonVisible) {
    console.error("❌ 未找到签到按钮, Cookie 可能失效");
    await page.screenshot({ path: "debug-no-button.png" });
    await browser.close();
    process.exit(1);
  }

  console.log("③ 执行签到...");
  await clickButton(page);
  await page.waitForTimeout(2500);

  const after = await detectState(page);
  console.log("签到后状态  ", after.status);

  if (after.status === "已签到") {
    console.log("\n✅ 签到成功!");
    await browser.close();
    process.exit(0);
  } else {
    console.error("\n❌ 签到后状态未变化");
    await page.screenshot({ path: "debug-after-click.png" });
    await browser.close();
    process.exit(1);
  }
} catch (err) {
  console.error("❌ 执行异常:", err.message);
  await page?.screenshot?.({ path: "debug-error.png" }).catch(() => {});
  await browser.close();
  process.exit(1);
}

async function detectState(page) {
  try { await page.waitForSelector(DAILY_REWARD_SELECTOR, { timeout: 10000 }); } catch {}
  return await page.evaluate(() => {
    const card = document.querySelector('[data-reward-code="daily_signin"]');
    if (!card) return { status: "未知(未找到签到卡片)", buttonVisible: false };
    const checkmark = card.querySelector('[class*="check"], [class*="done"], [class*="success"]');
    const text = card.innerText;
    if (checkmark || text.includes("已签到") || text.includes("已领取")) {
      return { status: "已签到", buttonVisible: false };
    }
    const btn = card.querySelector("button, [role='button']");
    return { status: "未签到", buttonVisible: !!(btn && btn.offsetParent !== null) };
  });
}

async function clickButton(page) {
  const card = page.locator(DAILY_REWARD_SELECTOR);
  await card.locator("button").first().click({ force: true }).catch(async () => {
    await card.evaluate(el => el.querySelector("button, [role='button']")?.click());
  });
}

function parseCookieString(str) {
  if (!str) return [];
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
  const result = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const next = process.argv[i + 1];
    if (a === "--dry-run") result.dryRun = true;
    else if (a === "--no-headless") result.headless = false;
    else if (a === "--cookie" && next) { result.cookie = next; i++; }
    else if (a === "--timeout" && next) { result.timeout = parseInt(next, 10); i++; }
  }
  return result;
}
