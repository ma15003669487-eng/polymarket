// Polymarket EOD Bot — V11.3 (Bottom Menu + >99.5% Filter)
// - 底部常驻按钮菜单（Reply Keyboard）
// - /help、/start、/latest
// - 分类切换（加密/体育/政治）
// - 概率红色强调（🟥 + <b>%</b>）
// - 中文翻译 + 剩余时间
// - 全面 HTML 转义 + 分块发送 + 错误捕获
// - 新增：去除 >99.5% 概率盘口（避免刷屏）

import axios from "axios";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import { ethers } from "ethers";
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const HOURS_AHEAD = Number(process.env.HOURS_AHEAD ?? 6);
const PRICE_THRESHOLD = Number(process.env.PRICE_THRESHOLD ?? 0.85);
const SCAN_INTERVAL_MIN = Number(process.env.SCAN_INTERVAL_MIN ?? 15);
const ARB_THRESHOLD = Number(process.env.ARB_THRESHOLD ?? 0.99);
const AUTO_TRADE = String(process.env.AUTO_TRADE ?? "false").toLowerCase() === "true";
const TRADE_SIZE = Number(process.env.TRADE_SIZE ?? 50);
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? 100);
const AUTO_CREATE_WALLET = String(process.env.AUTO_CREATE_WALLET ?? "true").toLowerCase() !== "false";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const MNEMONIC = process.env.WALLET_MNEMONIC;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("请在 .env 中配置 TELEGRAM_BOT_TOKEN 与 TELEGRAM_CHAT_ID");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const GAMMA_BASE = "https://gamma-api.polymarket.com";

// —— Arbitrage state ——
const pendingArb = new Map();
const tradedArb = new Set();
const alertedArb = new Set();
let cachedWallet = null;

// —— 可切换的分类开关 ——
let ENABLE_CRYPTO = true;
let ENABLE_SPORTS = true;
let ENABLE_POLITICS = true;

// —— 工具 ——
function esc(s=""){
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}
function textOf(m){
  const parts=[];
  if (m.question) parts.push(m.question);
  if (m.slug) parts.push(m.slug);
  if (m.description) parts.push(m.description);
  if (Array.isArray(m.tags)) parts.push(m.tags.join(" "));
  if (Array.isArray(m.categories)) parts.push(m.categories.join(" "));
  return (parts.join(" ") || "").toLowerCase();
}
function isCrypto(m){ if(!ENABLE_CRYPTO) return false; return /\b(btc|bitcoin|eth|ethereum|sol|solana|ada|doge|crypto|token|market cap|price of)\b/.test(textOf(m)); }
function isSports(m){ if(!ENABLE_SPORTS) return false; return /\b(win|lose|draw|vs\.|match|score|league|cup|goal|final)\b/.test(textOf(m)); }
function isPolitics(m){ if(!ENABLE_POLITICS) return false; return /\b(election|vote|trump|biden|democrat|republican|senate|house|primary|poll|approval|president|parliament)\b/.test(textOf(m)); }

function normalizeOutcomePrices(m){
  let prices = m.outcomePrices ?? m.prices;
  if (!prices) return null;
  if (Array.isArray(prices)) return prices.map(Number);
  try { return JSON.parse(prices).map(Number); } catch { return null; }
}
function isBinaryYesNo(m){
  let outs = m.outcomes;
  if (!outs) return false;
  if (typeof outs === "string"){
    try { outs = JSON.parse(outs); } catch { outs = outs.split(",").map(s=>s.trim()); }
  }
  if (!Array.isArray(outs) || outs.length!==2) return false;
  const a=String(outs[0]).toLowerCase(), b=String(outs[1]).toLowerCase();
  return (a.includes("yes") && b.includes("no")) || (a.includes("no") && b.includes("yes"));
}
function extractYesNo(m){
  try{
    let outs = m.outcomes;
    if (typeof outs === "string"){
      try { outs = JSON.parse(outs); } catch { outs = outs.split(",").map(s=>s.trim()); }
    }
    const prices = normalizeOutcomePrices(m);
    if (!outs || !prices || outs.length<2 || prices.length<2) return null;
    const yesIndex = String(outs[0]).toLowerCase().includes("yes") ? 0 : 1;
    return { yes: Number(prices[yesIndex]), no: Number(prices[1-yesIndex]) };
  } catch { return null; }
}
function toSGT(iso){ try{ return new Date(iso).toLocaleString("zh-CN",{timeZone:"Asia/Singapore"});}catch{return iso;} }
function msLeft(iso){ return new Date(iso) - new Date(); }
function timeLeftLabel(iso){
  let ms=msLeft(iso); if(ms<0) ms=0;
  const m=Math.floor(ms/60000), h=Math.floor(m/60), mm=m%60;
  return h<=0 ? `⏰ 剩余时间：${mm}分钟（即将收盘！）` : `⏱ 剩余时间：${h}小时${mm}分`;
}
function splitHTML(s, max=3500){ const arr=[]; for(let i=0;i<s.length;i+=max) arr.push(s.slice(i,i+max)); return arr; }

// —— 钱包与交易工具 ——
function getWallet(){
  if (cachedWallet) return cachedWallet;
  try{
    if (PRIVATE_KEY) {
      cachedWallet = new ethers.Wallet(PRIVATE_KEY);
    } else if (MNEMONIC) {
      cachedWallet = ethers.Wallet.fromPhrase(MNEMONIC);
    } else if (AUTO_CREATE_WALLET) {
      cachedWallet = ethers.Wallet.createRandom();
      console.log(`已自动生成新钱包：${cachedWallet.address}`);
    }
  }catch(e){
    console.error("创建钱包失败", e);
    cachedWallet = null;
  }
  return cachedWallet;
}

function walletSnapshot(){
  const w = getWallet();
  if (!w) return "未配置钱包，无法交易。请设置 PRIVATE_KEY 或 WALLET_MNEMONIC。";
  const pk = w.privateKey?.slice(0,10) + "…";
  return `地址：${w.address}\n私钥：${pk}`;
}

async function executeTrade(op, mode){
  const w = getWallet();
  if (!w) {
    return { ok:false, message:"未找到可用钱包，设置 PRIVATE_KEY 或 WALLET_MNEMONIC 后再试。" };
  }

  const capital = TRADE_SIZE;
  const cost = op.sum * capital;
  const slip = SLIPPAGE_BPS/10000;
  const expectedReturn = capital;
  const expectedProfit = expectedReturn - cost;
  const pseudoHash = ethers.id(`${op.marketId}-${Date.now()}-${Math.random()}`);

  return {
    ok:true,
    message:[
      `${mode === "auto" ? "🤖 自动" : "🧠 手动"}交易已提交（模拟）：`,
      `市场：${op.question}`,
      `钱包：${w.address}`,
      `买入：YES ${op.yesPrice.toFixed(4)} + NO ${op.noPrice.toFixed(4)}`,
      `成本：≈ ${cost.toFixed(2)} USDC （含滑点 ${(slip*100).toFixed(2)}%）`,
      `理论利润：≈ ${expectedProfit.toFixed(2)} USDC`,
      `伪Tx：${pseudoHash}`
    ].join("\n")
  };
}

// 英文 -> 中文（常见模板）
function translateTitle(en){
  try{
    let s=String(en||"").trim();
    function zhDate(m){
      const iso=/(\d{4})-(\d{1,2})-(\d{1,2})/.exec(m);
      if (iso) return `${iso[1]}年${iso[2]}月${iso[3]}日`;
      const months={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
      const m2=/([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?/i.exec(m);
      if (m2){ const mm=months[m2[1].toLowerCase()]||null; const dd=Number(m2[2]); const yy=m2[3]?`${m2[3]}年`:""; if(mm) return `${yy}${mm}月${dd}日`; }
      return m;
    }
    let m;
    m=/Will the price of ([^?]+?) be between \$?([\d.,]+)\s?(?:and|-)\s?\$?([\d.,]+)\s+on\s+([^?]+)\?/i.exec(s);
    if (m) return `${m[1]}在${zhDate(m[4])}的价格是否介于${m[2]}至${m[3]}美元之间？`;
    m=/Will (?:the price of )?([^?]+?) be (?:greater than|above)\s+\$?([\d.,]+)\s+on\s+([^?]+)\?/i.exec(s);
    if (m) return `${m[1]}在${zhDate(m[3])}价格是否高于${m[2]}美元？`;
    m=/Will (?:the price of )?([^?]+?) be (?:less than|below)\s+\$?([\d.,]+)\s+on\s+([^?]+)\?/i.exec(s);
    if (m) return `${m[1]}在${zhDate(m[3])}价格是否低于${m[2]}美元？`;
    m=/Will ([^?]+?) win on (\d{4}-\d{1,2}-\d{1,2})\?/i.exec(s);
    if (m) return `${m[1]}会在${zhDate(m[2])}获胜吗？`;
    m=/Will ([^?]+?) end in a draw\?/i.exec(s);
    if (m) return `${m[1]}会以平局结束吗？`;
    m=/Will (.+)\?/i.exec(s);
    if (m) return `${m[1]}是否会发生？`;
    return s;
  }catch{ return en; }
}

// —— 抓取 ——
async function fetchMarkets(hoursAhead){
  const now = new Date();
  const endMax = new Date(now.getTime()+hoursAhead*3600*1000);
  const params={limit:500, closed:false, end_date_min: now.toISOString(), end_date_max: endMax.toISOString(), order:"endDate", ascending:true};
  const { data } = await axios.get(`${GAMMA_BASE}/markets`, { params, timeout:15000 });
  return Array.isArray(data) ? data : [];
}

async function findArbitrageOpportunities(hoursAhead){
  const list = await fetchMarkets(hoursAhead);
  const ops = [];
  for (const m of list){
    if (!isBinaryYesNo(m)) continue;
    const prices = normalizeOutcomePrices(m);
    if (!prices || prices.length < 2) continue;

    const yesPrice = Number(prices[0]);
    const noPrice = Number(prices[1]);
    const sum = yesPrice + noPrice;
    if (Number.isNaN(sum) || sum >= ARB_THRESHOLD) continue;

    const key = `${m.id}-${Math.round(sum*10000)}`;
    const op = {
      id:key,
      marketId: m.id,
      slug: m.slug,
      question: m.question || m.slug || m.id,
      yesPrice,
      noPrice,
      sum,
      endDate: m.endDate,
      url:`https://polymarket.com/market/${m.slug || m.id}`
    };
    ops.push(op);
    pendingArb.set(key, op);
  }
  ops.sort((a,b)=>a.sum-b.sum);
  return ops;
}

function formatArbLine(op){
  const gap = (1 - op.sum) * 100;
  return [
    `📊 套利机会：YES ${op.yesPrice.toFixed(4)} + NO ${op.noPrice.toFixed(4)} = ${(op.sum).toFixed(4)}`,
    `潜在利润：≈ ${gap.toFixed(2)}%` ,
    timeLeftLabel(op.endDate),
    `市场：${esc(op.question)}`,
    `链接：${esc(op.url)}`
  ].join("\n");
}

// —— 组装 HTML ——
async function buildSweepHTML(){
  const list = await fetchMarkets(HOURS_AHEAD);
  const blocks={ politics:[], crypto:[], sports:[] };

  for (const m of list){
    if (!isBinaryYesNo(m)) continue;
    const yn = extractYesNo(m);
    if (!yn) continue;

    // 新增：跳过 >99.5% 概率盘口（避免锁死盘口刷屏）
    if (yn.yes >= 0.995 || yn.no >= 0.995) continue;

    const bestBid = Number(m.bestBid ?? 0);
    const bestAsk = Number(m.bestAsk ?? 1);
    const spreadOk = (bestAsk - bestBid) <= 0.08;
    const pass = spreadOk && (yn.yes >= PRICE_THRESHOLD || yn.no >= PRICE_THRESHOLD);
    if (!pass) continue;

    const side = yn.yes >= PRICE_THRESHOLD ? "YES" : "NO";
    const probPct = ((side==="YES"?yn.yes:yn.no)*100).toFixed(1) + "%";
    const probStr = `概率：🟥<b>${esc(probPct)}</b>`;
    const url = `https://polymarket.com/market/${m.slug || m.id}`;

    const line =
      `方向：${esc(side)}  ${probStr}\n` +
      `${esc(timeLeftLabel(m.endDate))}\n` +
      `收盘：${esc(toSGT(m.endDate))}\n` +
      `盘口：bid=${esc(bestBid.toFixed(2))}, ask=${esc(bestAsk.toFixed(2))}\n` +
      `英文：${esc(m.question || m.slug || m.id)}\n` +
      `中文：${esc(translateTitle(m.question || m.slug || ""))}\n` +
      `链接：${esc(url)}`;

    const ent = { ms: msLeft(m.endDate), text: line };
    if (isPolitics(m)) blocks.politics.push(ent);
    else if (isCrypto(m)) blocks.crypto.push(ent);
    else if (isSports(m)) blocks.sports.push(ent);
  }

  const asc=(a,b)=>a.ms-b.ms;
  blocks.politics.sort(asc); blocks.crypto.sort(asc); blocks.sports.sort(asc);

  const sections=[];
  if (blocks.politics.length) sections.push("🟡【政治盘口】\n"+blocks.politics.map(b=>b.text).join("\n\n"));
  if (blocks.crypto.length)   sections.push("🟢【加密盘】\n"+blocks.crypto.map(b=>b.text).join("\n\n"));
  if (blocks.sports.length)   sections.push("🔵【体育盘口】\n"+blocks.sports.map(b=>b.text).join("\n\n"));

  if (!sections.length) return "暂无符合条件的盘口。";
  const header = `Polymarket 扫尾盘提醒（窗口 ${HOURS_AHEAD}h，阈值 ≥ ${(PRICE_THRESHOLD*100).toFixed(0)}%）\n`;
  return esc(header) + sections.join("\n\n");
}

async function buildArbitrageHTML(){
  const ops = await findArbitrageOpportunities(HOURS_AHEAD);
  if (!ops.length) return "暂无套利机会（YES+NO < 1）。";

  const lines = ops.map(op=>{
    const label = formatArbLine(op);
    return label;
  });
  const header = `Polymarket 套利监控（YES+NO < ${ARB_THRESHOLD}，仓位 ${TRADE_SIZE} USDC）`;
  return esc(header + "\n\n" + lines.join("\n\n"));
}

async function sendArbAlerts(chatId){
  const ops = await findArbitrageOpportunities(HOURS_AHEAD);
  if (!ops.length){
    await bot.sendMessage(chatId, "暂无套利机会（YES+NO < 1）。", { disable_web_page_preview:true, ...bottomKeyboard() });
    return;
  }

  for (const op of ops){
    if (tradedArb.has(op.id) || alertedArb.has(op.id)) continue;
    const keyboard = {
      inline_keyboard:[
        [
          { text:"✅ 手动确认交易", callback_data:`trade:${op.id}` },
          { text:"🌐 查看市场", url: op.url }
        ],
        [
          { text: AUTO_TRADE ? "🤖 已开启自动交易" : "⚙️ 当前为手动确认", callback_data:"noop" }
        ]
      ]
    };

    await bot.sendMessage(chatId, formatArbLine(op), { parse_mode:"HTML", disable_web_page_preview:true, reply_markup: keyboard });
    alertedArb.add(op.id);

    if (AUTO_TRADE){
      const res = await executeTrade(op, "auto");
      if (res.ok) tradedArb.add(op.id);
      await bot.sendMessage(chatId, res.message, { disable_web_page_preview:true });
    }
  }
}

// —— 发送（分块 + 捕错） ——
async function sendHTML(chatId, html){
  for (const part of splitHTML(html)) {
    try{
      await bot.sendMessage(chatId, part, { parse_mode:"HTML", disable_web_page_preview:true });
    }catch(e){
      console.error("发送失败片段:", e?.response?.body || e.message || e);
    }
  }
}

// —— 底部常驻按钮菜单 ——
function bottomKeyboard(){
  return {
    reply_markup:{
      keyboard:[
        ["🚀 一键启动", "📋 最新尾盘"],
        ["🔁 刷新面板", "🧮 套利扫描", "👛 钱包信息"],
        ["💠 加密盘", "🏆 体育盘", "🇺🇳 政治盘"],
        ["ℹ️ 帮助"]
      ],
      resize_keyboard:true,
      one_time_keyboard:false
    }
  };
}

const HELP_TEXT = [
  "🛠 使用说明：",
  "• 按钮固定在底部，随时可点。",
  "• “🚀 一键启动” 会立即发送尾盘与套利机会，一步到位。",
  "• “📋 最新尾盘”立即拉取；“🔁 刷新面板”只重发菜单。",
  "• “🧮 套利扫描”会找出 YES+NO < 1 的机会，并支持手动确认/自动交易（模拟）。",
  "• “👛 钱包信息”展示当前私钥地址，如未配置则自动生成临时钱包。",
  "• 点击“💠/🏆/🇺🇳” 可切换对应分类（✅/❌ 实时生效）。",
  "• 跳过过高概率盘口（>99.5%），避免刷屏。",
  "• 文本使用 HTML 安全转义，概率用 🟥 + <b>粗体</b> 强调。",
  "• 命令：/start 菜单、/help 帮助、/latest 拉取尾盘、/arbitrage 套利扫描、/wallet 查看钱包。"
].join("\n");

// —— 自动循环 ——
async function sendSweep(){ const html = await buildSweepHTML(); await sendHTML(CHAT_ID, html); }
async function autoLoop(){
  console.log(`启动成功：每 ${SCAN_INTERVAL_MIN} 分钟扫描一次，窗口 ${HOURS_AHEAD} 小时，阈值 ${PRICE_THRESHOLD}`);
  await sendSweep();
  await sendArbAlerts(CHAT_ID);
  setInterval(async ()=>{
    await sendSweep();
    await sendArbAlerts(CHAT_ID);
  }, SCAN_INTERVAL_MIN*60*1000);
}

// —— Callback ——
bot.on("callback_query", async (q)=>{
  const data = q.data || "";
  if (data.startsWith("trade:")){
    const id = data.split(":")[1];
    const op = pendingArb.get(id);
    await bot.answerCallbackQuery(q.id, { text: op ? "正在执行" : "机会不存在" }).catch(()=>{});
    if (!op) return;
    const res = await executeTrade(op, "manual");
    if (res.ok) tradedArb.add(op.id);
    await bot.sendMessage(q.message.chat.id, res.message, { disable_web_page_preview:true });
  } else {
    await bot.answerCallbackQuery(q.id, { text:"已记录" }).catch(()=>{});
  }
});

// —— Commands ——
bot.setMyCommands([
  { command:"start", description:"显示主菜单" },
  { command:"latest", description:"获取最新尾盘" },
  { command:"arbitrage", description:"扫描 YES+NO < 1 套利" },
  { command:"wallet", description:"查看当前交易钱包" },
  { command:"help", description:"查看帮助" }
]);

bot.onText(/^\/start$/i, (msg)=> bot.sendMessage(msg.chat.id, "欢迎使用 Polymarket 扫尾盘机器人👇", bottomKeyboard()));
bot.onText(/^\/help$/i,  (msg)=> bot.sendMessage(msg.chat.id, esc(HELP_TEXT), { parse_mode:"HTML", ...bottomKeyboard() }));
bot.onText(/^\/latest$/i, async (msg)=>{
  await bot.sendMessage(msg.chat.id, "⏳ 正在获取最新尾盘...", bottomKeyboard());
  const html = await buildSweepHTML();
  await sendHTML(msg.chat.id, html);
});
bot.onText(/^\/arbitrage$/i, async (msg)=>{
  await bot.sendMessage(msg.chat.id, "⏳ 正在扫描套利机会...", bottomKeyboard());
  await sendArbAlerts(msg.chat.id);
});
bot.onText(/^\/wallet$/i, async (msg)=>{
  await bot.sendMessage(msg.chat.id, `当前钱包：\n${walletSnapshot()}`, bottomKeyboard());
});

// —— 处理底部按钮点击（按文本匹配） ——
bot.on("message", async (msg)=>{
  const t = (msg.text||"").trim();
  if (t === "🚀 一键启动"){
    await bot.sendMessage(msg.chat.id, "⚡️ 一键启动：正在推送尾盘 + 套利...", bottomKeyboard());
    const html = await buildSweepHTML();
    await sendHTML(msg.chat.id, html);
    await sendArbAlerts(msg.chat.id);
  } else if (t === "📋 最新尾盘"){
    await bot.sendMessage(msg.chat.id, "⏳ 正在获取最新尾盘...", bottomKeyboard());
    const html = await buildSweepHTML();
    await sendHTML(msg.chat.id, html);
  } else if (t === "🔁 刷新面板"){
    await bot.sendMessage(msg.chat.id, "✅ 面板已刷新。", bottomKeyboard());
  } else if (t === "🧮 套利扫描"){
    await bot.sendMessage(msg.chat.id, "⏳ 正在扫描套利机会...", bottomKeyboard());
    await sendArbAlerts(msg.chat.id);
  } else if (t === "👛 钱包信息"){
    await bot.sendMessage(msg.chat.id, `当前钱包：\n${walletSnapshot()}`, bottomKeyboard());
  } else if (t === "💠 加密盘"){
    ENABLE_CRYPTO = !ENABLE_CRYPTO;
    await bot.sendMessage(msg.chat.id, `加密盘：${ENABLE_CRYPTO?"✅ 开启":"❌ 关闭"}`, bottomKeyboard());
  } else if (t === "🏆 体育盘"){
    ENABLE_SPORTS = !ENABLE_SPORTS;
    await bot.sendMessage(msg.chat.id, `体育盘：${ENABLE_SPORTS?"✅ 开启":"❌ 关闭"}`, bottomKeyboard());
  } else if (t === "🇺🇳 政治盘"){
    ENABLE_POLITICS = !ENABLE_POLITICS;
    await bot.sendMessage(msg.chat.id, `政治盘：${ENABLE_POLITICS?"✅ 开启":"❌ 关闭"}`, bottomKeyboard());
  } else if (t === "ℹ️ 帮助"){
    await bot.sendMessage(msg.chat.id, esc(HELP_TEXT), { parse_mode:"HTML", ...bottomKeyboard() });
  }
});

// 启动：先发菜单 + 进入循环
bot.sendMessage(CHAT_ID, "👇 主菜单：", bottomKeyboard());
autoLoop();
