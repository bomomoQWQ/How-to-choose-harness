import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];

/* 极简 DOM：记录每个元素的 class 与 innerHTML */
const els = new Map();
function makeEl(id){
  const cls = new Set();
  const el = {
    id, style:{}, textContent:"", _html:"", onclick:null,
    get innerHTML(){ return el._html; },
    set innerHTML(v){ el._html = v; },
    appendChild(){}, querySelectorAll(){ return []; }, querySelector(){ return null; },
    classList:{
      toggle(n, f){ (f === undefined ? !cls.has(n) : f) ? cls.add(n) : cls.delete(n); },
      contains(n){ return cls.has(n); }, add(n){ cls.add(n); }, remove(n){ cls.delete(n); }
    }
  };
  els.set(id, el);
  return el;
}
["screen-start","screen-quiz","screen-result","screen-catalog",
 "qIndex","qPhase","qHint","qBar","qText","qSub","qOpts","qTrail",
 "resBody","catBody"].forEach(makeEl);

const sandbox = {
  document:{ getElementById:id => els.get(id) || makeEl(id), addEventListener(){}, createElement:() => makeEl("tmp" + Math.random()) },
  window:{ scrollTo(){} },
  console:{ log(){}, error(...a){ console.log("  [页面报错]", ...a); }, warn(){} },
  navigator:{ clipboard:{ writeText(){ return Promise.resolve(); } } },
  setTimeout(){},
  Math, Promise, Object, Array, String, Number, JSON
};
const ctx = vm.createContext(sandbox);
vm.runInContext(js, ctx);

const fails = [];
const R = () => els.get("resBody").innerHTML || "";
const Q = () => els.get("qText").textContent || "";

function drive(label, picks){
  ctx.restart();
  try { picks.forEach(i => ctx.pick(i)); }
  catch (e) { fails.push(label + " 驱动失败: " + String(e.message).replace(/[^\x20-\x7E]/g, "?")); return; }
  const out = R();
  const checks = [
    ["结论标题", out.includes('<div class="tag">') || out.includes("警告")],
    ["为什么", out.includes("为什么推荐这个给你")],
    ["红线对照", out.includes("对照你的红线")],
    ["怎么开始", out.includes("怎么开始")],
    ["坑", out.includes("别踩这些")],
    ["备选卡片", out.includes("如果这个不合适")],
    ["无 undefined", !out.includes("undefined")],
    ["无 NaN", !out.includes("NaN")],
    ["无 [object", !out.includes("[object")]
  ];
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n);
  console.log((bad.length ? "FAIL " : "OK   ") + label + "  (" + out.length + " 字符)" + (bad.length ? "  缺: " + bad.join("/") : ""));
  if (bad.length) fails.push(label + " -> " + bad.join("/"));
}
function expect(label, cond, detail){
  if (cond) console.log("OK   " + label);
  else { console.log("FAIL " + label + (detail ? "  (" + detail + ")" : "")); fails.push(label); }
}

console.log("== 红线行为 ==");
// q0动手 → key知道 → 命令行熟 → Linux → 在意隐私 → 要开源 → 写代码 → 进仓库 → 不能付美元 → 订阅套餐(被拦) → g-zp 选"换国产开源CLI"
drive("隐私+开源红线：订阅套餐被拦后改走开源 CLI", [0,0,0,2,0,0,0,0,2,0,2]);
let o = R();
expect("被拦记录出现在结论页", o.includes("被你的红线拦下过"));
expect("红线徽章：在意隐私", o.includes("红线：在意隐私"));
expect("红线徽章：只看开源", o.includes("红线：只看开源"));
expect("落到开源 CLI（Qwen Code）", o.includes("Qwen Code"), o.slice(0, 80));
expect("开源要求被判定为满足或说明", o.includes("开源要求满足") || o.includes("开源：是"));

// 同一路线，但在拦截页选择"我知道，我还是要用" → 应该能到 claude-code，且标注"已确认接受代价"
drive("拦截页确认接受 → Claude Code", [0,0,0,2,0,0,0,0,0,0]);
o = R();
expect("标注已确认接受代价", o.includes("已确认接受代价"));
expect("明确写出与隐私红线冲突", o.includes("与你的隐私要求冲突"));
expect("确实是 Claude Code 那条", o.includes("Claude Code"));

// 不设红线 → 不该出现任何拦截痕迹
drive("不设红线 → 直达 Claude Code，无拦截", [0,0,0,2,2,1,0,0,0]);
o = R();
expect("没有拦截记录", !o.includes("被你的红线拦下过"));
expect("显示隐私不介意", o.includes("隐私：不介意"));
expect("显示开源不要求", o.includes("开源：不要求"));

// chat 被开源红线拦下
drive("要求开源 → 官方 App 被拦后确认接受", [0,0,0,0,0,0,1,1,2,0]);
o = R();
expect("官方 App 路线也被红线拦过", o.includes("被你的红线拦下过") || o.includes("已确认接受代价"));

console.log("\n== 基础关与其它分支 ==");
drive("不懂命令行 → 桌面版", [0,0,2]);
expect("落到桌面版", R().includes("DSH 桌面版"));
drive("不知道 API key → 补课页", [0,1]);
expect("落到补课页", R().includes("API key"));
drive("在意但不懂 → 数据边界页", [0,0,0,0,1]);
expect("落到数据边界页", R().includes("数据边界"));
drive("打算买中转 → 警告型结论", [0,0,0,0,2,1,0,0,3]);
expect("以警告结论呈现", R().includes("警告"));
drive("QQ 机器人 → AstrBot", [0,0,0,3,2,1,2,0,0]);
expect("落到 AstrBot", R().includes("AstrBot"));
drive("通用常驻 → Docker 自托管", [0,0,0,3,2,1,1,0,0]);
expect("落到 Docker 自托管", R().includes("Docker 自托管"));

console.log("\n== 「为什么推荐这个给你」的逐条依据 ==");
const countWhy = s => (s.match(/说明/g) || []).length;

ctx.restart(); [0,0,0,2,2,1,0,0,2,1].forEach(i => ctx.pick(i));
let w = R();
expect("正常路径：逐条依据够多（10 条）", countWhy(w) >= 9, "说明×" + countWhy(w));
expect("正常路径：显示完整路径", w.includes("完整路径"));
expect("正常路径：不该出现「没有逐题依据」", !w.includes("没有逐题依据"));

ctx.restart(); ctx.renderResult("cn-cli");
w = R();
expect("从候选总览打开：明说没有依据（而不是静默少一块）", w.includes("这一页没有逐题依据"));
expect("从候选总览打开：给出「走一遍决策树」入口", w.includes("走一遍决策树"));
expect("从候选总览打开：不显示完整路径", !w.includes("完整路径"));

ctx.restart(); [0,0,2].forEach(i => ctx.pick(i));
ctx.renderResult("dsh-cli");
w = R();
expect("备选卡片：标注这是备选、依据属于原结论", w.includes("这一页是备选方案"));
expect("备选卡片：仍保留原路径依据", countWhy(w) >= 3, "说明×" + countWhy(w));

console.log("\n== 作者个人附注（Claude / GLM 两张卡片） ==");
ctx.restart(); [0,0,0,2,2,1,0,0,0].forEach(i => ctx.pick(i));   // → claude-code
let pn = R();
expect("Claude 卡片显示个人附注", pn.includes("博馍馍 提醒您"));
expect("Claude 卡片附注文案正确", pn.includes("字母表上一头一尾，➗生公司一中一美"));
expect("附注被标注为个人观点", pn.includes("不代表本页对任何厂商的事实认定"));
expect("附注用的是中文引号（不破坏 HTML）", pn.includes("「字母表上一头一尾"));
expect("附注位置：在「为什么推荐这个给你」上面", pn.indexOf("博馍馍 提醒您") < pn.indexOf("为什么推荐这个给你"),
       "why@" + pn.indexOf("为什么推荐这个给你") + " note@" + pn.indexOf("博馍馍 提醒您"));
expect("附注位置：在结论卡下面", pn.indexOf('<div class="tag">') < pn.indexOf("博馍馍 提醒您"));

ctx.restart(); [0,0,0,2,2,1,0,0,2,0].forEach(i => ctx.pick(i));  // → zhipu-plan（q7 选订阅套餐）
pn = R();
expect("GLM 卡片显示个人附注", pn.includes("博馍馍 提醒您") && pn.includes("字母表上一头一尾，➗生公司一中一美"));

ctx.restart(); [0,0,2].forEach(i => ctx.pick(i));                // → dsh-desktop
pn = R();
expect("其它卡片没有这条附注", !pn.includes("博馍馍"));

console.log("\n== 逐叶子渲染（从「全部候选」直接打开、无答题路径） ==");
const all = Object.keys(vm.runInContext("RESULTS", ctx));
let n = 0;
all.forEach(id => {
  ctx.restart();
  ctx.renderResult(id);
  const out = R();
  const ok = out.length > 300 && !out.includes("undefined") && out.includes("怎么开始") && out.includes("对照你的红线");
  if (!ok) { fails.push("叶子 " + id + " 渲染异常"); console.log("FAIL " + id); } else n++;
});
console.log("OK   " + n + "/" + all.length + " 个叶子渲染正常");

if (fails.length) { console.log("\n=== " + fails.length + " 项失败 ==="); fails.forEach(x => console.log(" - " + x)); process.exit(1); }
console.log("\n=== 渲染与红线行为检查全部通过 ===");
