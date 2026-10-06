import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 仓库根目录 = 本脚本所在目录的上一级；脚本不再依赖任何本机绝对路径
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "index.html");
const html = fs.readFileSync(FILE, "utf8");

const out = [];
const fail = [];
function ok(m){ out.push("OK   " + m); }
function bad(m){ fail.push("FAIL " + m); }

// ---- 1. 抽取 script ----
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log("FAIL 找不到 <script> 块"); process.exit(1); }
const js = m[1];

// ---- 2. 语法检查 ----
let sandbox;
const el = () => ({
  classList:{ toggle(){}, contains(){ return false; } },
  style:{}, textContent:"", innerHTML:"",
  appendChild(){}, querySelectorAll(){ return []; },
  set onclick(v){}, get onclick(){ return null; }
});
sandbox = {
  document:{ getElementById: el, addEventListener(){}, createElement: el },
  window:{ scrollTo(){} },
  console, navigator:{ clipboard:{ writeText(){ return Promise.resolve(); } } },
  setTimeout(){}
};
try {
  new vm.Script(js, { filename:"index.js" });
  ok("JS 语法通过 (vm.Script)");
} catch (e) {
  bad("JS 语法错误: " + String(e.message).replace(/[^\x20-\x7E]/g, "?"));
}

// ---- 3. 乱码/智能引号 ----
const smart = (html.match(/[\u201C\u201D\u2018\u2019\uFF02]/g) || []);
if (smart.length) bad("发现非 ASCII 引号 " + smart.length + " 个（会截断 JS 字符串）");
else ok("无智能/全角引号");

// ---- 4. 逐行 ASCII 双引号配平（只看 script 内） ----
const lines = js.split("\n");
const odd = [];
lines.forEach((l, i) => {
  const n = (l.match(/"/g) || []).length;
  if (n % 2 === 1) odd.push((i + 1) + ": " + l.trim().slice(0, 60));
});
if (odd.length) bad("引号不配平的行:\n     " + odd.join("\n     "));
else ok("script 内每行双引号都配平");

// ---- 5. 真跑一遍，拿数据 ----
let data = null;
try {
  const ctx = vm.createContext(sandbox);
  vm.runInContext(js + "\n;globalThis.__OUT = { RESULTS, NODES, CATALOG, META, EVENTS };", ctx);
  data = ctx.__OUT;
  ok("脚本可执行，数据取到");
} catch (e) {
  bad("脚本执行失败: " + String(e.message).replace(/[^\x20-\x7E]/g, "?"));
}

if (data) {
  const { RESULTS, NODES, CATALOG, META, EVENTS } = data;

  // 5a. 跳转目标存在
  let broken = [];
  for (const [nid, n] of Object.entries(NODES)) {
    n.options.forEach((o, i) => {
      if (!NODES[o.next] && !RESULTS[o.next]) broken.push(nid + ".options[" + i + "] -> " + o.next);
    });
  }
  broken.length ? bad("跳转目标不存在: " + broken.join(", ")) : ok("所有 next 目标都存在");

  // 5b. 备选卡片 id 存在
  let badAlt = [];
  for (const [rid, r] of Object.entries(RESULTS)) {
    (r.alts || []).forEach(a => { if (!RESULTS[a]) badAlt.push(rid + " -> " + a); });
  }
  badAlt.length ? bad("备选 id 不存在: " + badAlt.join(", ")) : ok("所有备选 id 都存在");

  // 5c. 字段完整性
  let missing = [];
  for (const [rid, r] of Object.entries(RESULTS)) {
    ["name","tagline","why","steps","badges"].forEach(k => {
      if (!r[k] || (Array.isArray(r[k]) && !r[k].length)) missing.push(rid + "." + k);
    });
  }
  missing.length ? bad("结果缺字段: " + missing.join(", ")) : ok("每个结果都有 name/tagline/why/steps/badges");

  // 5d. 树遍历：从 q0 走遍所有分支
  const reached = new Set();
  const leaves = new Set();
  (function walk(id, seenDepth){
    if (RESULTS[id]) { leaves.add(id); reached.add(id); return; }
    const n = NODES[id];
    if (!n) return;
    n.options.forEach(o => walk(o.next, seenDepth + 1));
  })("q0", 0);

  const orphans = Object.keys(RESULTS).filter(r => !leaves.has(r));
  orphans.length ? bad("从 q0 走不到的叶子: " + orphans.join(", ")) : ok("从 q0 可走到全部 " + leaves.size + " 个叶子");

  // 5e. 深度 & 题目数
  let maxDepth = 0, paths = 0;
  (function walk(id, d){
    if (RESULTS[id]) { paths++; maxDepth = Math.max(maxDepth, d); return; }
    (NODES[id] || {options:[]}).options.forEach(o => walk(o.next, d + 1));
  })("q0", 0);
  ok("总路径 " + paths + " 条，最长 " + maxDepth + " 题");

  // 5f. 每个可达节点都必须有 q 与 options
  const badNode = Object.entries(NODES).filter(([k,v]) => !v.q || !v.options || !v.options.length).map(([k]) => k);
  badNode.length ? bad("节点缺 q/options: " + badNode.join(", ")) : ok("所有节点都有题干和选项");

  // 5g. 目录 id 存在
  const badCat = CATALOG.filter(c => !RESULTS[c.id]).map(c => c.id);
  badCat.length ? bad("目录里有不存在的 id: " + badCat.join(", ")) : ok("目录 " + CATALOG.length + " 项全部有效");

  // 5h. sys 标记与 sysNotes
  const SYS = ["win","mac","linux","mixed"];
  let badSys = [];
  for (const [nid, n] of Object.entries(NODES)) {
    n.options.forEach((o, i) => { if (o.sys && !SYS.includes(o.sys)) badSys.push(nid + "[" + i + "]=" + o.sys); });
  }
  badSys.length ? bad("未知 sys 值: " + badSys.join(", ")) : ok("所有 sys 标记合法");

  let badNotes = [];
  for (const [rid, r] of Object.entries(RESULTS)) {
    Object.keys(r.sysNotes || {}).forEach(k => { if (!SYS.includes(k)) badNotes.push(rid + "." + k); });
  }
  badNotes.length ? bad("sysNotes 键非法: " + badNotes.join(", ")) : ok("sysNotes 键全部合法");
  const withNotes = Object.entries(RESULTS).filter(([, r]) => r.sysNotes).map(([k]) => k);
  ok(withNotes.length + " 个叶子带系统专属提示");

  // 5i. 目录覆盖所有叶子
  const inCat = new Set(CATALOG.map(c => c.id));
  const notInCat = [...leaves].filter(l => !inCat.has(l));
  const ghostCat = CATALOG.filter(c => !RESULTS[c.id]).map(c => c.id);
  notInCat.length ? bad("叶子没进目录: " + notInCat.join(", ")) : ok("全部 " + leaves.size + " 个叶子都在候选总览里");
  ghostCat.length ? bad("目录指向不存在的叶子: " + ghostCat.join(", ")) : ok("目录 " + CATALOG.length + " 项全部有效");

  // 5j. 内容完整度
  let thin = [];
  for (const [rid, r] of Object.entries(RESULTS)) {
    if (!r.alts || !r.alts.length) thin.push(rid + ".alts");
    if (!r.pitfalls || !r.pitfalls.length) thin.push(rid + ".pitfalls");
    if (!r.links || !r.links.length) thin.push(rid + ".links");
  }
  thin.length ? bad("内容不完整: " + thin.join(", ")) : ok("每个叶子都有备选/坑/链接");

  // 5k. META 档案
  const LV = ["na","low","cloud","warn"];
  let metaBad = [];
  for (const l of Object.keys(RESULTS)) {
    const m = META[l];
    if (!m) { metaBad.push(l + " 缺 META"); continue; }
    if (!LV.includes(m.level)) metaBad.push(l + ".level=" + m.level);
    if (!(m.open === true || m.open === false || m.open === null || m.open === "disputed")) metaBad.push(l + ".open=" + m.open);
    if (typeof m.data !== "string" || !m.data) metaBad.push(l + ".data 缺失");
  }
  const ghostMeta = Object.keys(META).filter(k => !RESULTS[k]);
  if (ghostMeta.length) metaBad.push("META 多余条目: " + ghostMeta.join(","));
  metaBad.length ? bad("META 问题: " + metaBad.join("; "))
                 : ok("META 覆盖全部 " + Object.keys(RESULTS).length + " 个叶子的开源/数据档案");

  // 5l. 红线配置结构
  let guardBad = [];
  for (const [nid, n] of Object.entries(NODES)) {
    n.options.forEach((o, i) => {
      (o.blockedBy || []).forEach(c => {
        if (!["privacy","opensrc"].includes(c.k)) guardBad.push(nid + "[" + i + "].k=" + c.k);
        if (!["care","require"].includes(c.v)) guardBad.push(nid + "[" + i + "].v=" + c.v);
      });
      if ((o.blockedBy || []).length && !NODES[o.guard]) guardBad.push(nid + "[" + i + "] guard 目标不存在: " + o.guard);
    });
  }
  guardBad.length ? bad("红线配置错误: " + guardBad.join("; ")) : ok("红线拦截配置合法（blockedBy + guard 目标都在）");

  // 5m. 状态机模拟：红线不可被绕过
  function simulate(allowAck){
    const seen = [];
    (function walk(id, st, depth){
      if (depth > 30) return;
      if (RESULTS[id]) { seen.push({leaf:id, st:Object.assign({}, st)}); return; }
      const n = NODES[id]; if (!n) return;
      n.options.forEach(o => {
        if (!allowAck && o.sets && o.sets.ack) return;   // 模拟"用户没有在拦截页确认接受"
        const st2 = Object.assign({}, st);
        const hit = (o.blockedBy || []).find(c => st2[c.k] === c.v);
        if (hit && st2.ack !== o.next){ walk(o.guard, st2, depth + 1); return; }
        if (o.sets) Object.assign(st2, o.sets);
        walk(o.next, st2, depth + 1);
      });
    })("q0", {}, 0);
    return seen;
  }

  const strict = simulate(false);
  let viol = [];
  strict.forEach(x => {
    const m = META[x.leaf]; if (!m) return;
    if (x.st.privacy === "care" && m.level === "warn" && m.advice !== "avoid")
      viol.push(x.leaf + "(在意隐私却可达 " + m.level + ")");
    if (x.st.opensrc === "require" && (m.open === false || m.open === "disputed"))
      viol.push(x.leaf + "(要求开源却可达 " + (m.open === "disputed" ? "开源存疑" : "闭源") + ")");
  });
  viol = [...new Set(viol)];
  viol.length ? bad("红线被绕过: " + viol.join("; "))
              : ok("★ 红线不变量成立：设了红线后，冲突结论在用户确认前一律不可达");

  const careAlts = ["cn-cli","opencode","docker-selfhost","dsh-cli","dsh-desktop"];
  const careLeaves = new Set(strict.filter(x => x.st.privacy === "care").map(x => x.leaf));
  const missingAlt = careAlts.filter(l => !careLeaves.has(l));
  missingAlt.length ? bad("在意隐私时合规选项太少，缺: " + missingAlt.join(", "))
                    : ok("在意隐私时仍有 " + careAlts.length + " 个合规方案可选（没把树拦死）");

  const withAck = new Set(simulate(true).map(x => x.leaf));
  const unreachable = ["claude-code","zhipu-plan","chat"].filter(l => !withAck.has(l));
  unreachable.length ? bad("拦截后无法恢复: " + unreachable.join(", "))
                     : ok("拦截可恢复：确认接受后 claude-code / zhipu-plan / chat 仍可到达");

  // 5n. 事件清单（EVENTS）结构与来源
  let evBad = [];
  if (!Array.isArray(EVENTS) || !EVENTS.length) evBad.push("EVENTS 为空");
  (EVENTS || []).forEach((g, gi) => {
    if (!g.vendor) evBad.push("组 " + gi + " 缺 vendor");
    if (!Array.isArray(g.items) || !g.items.length) evBad.push("组 " + gi + " 缺 items");
    (g.items || []).forEach((it, ii) => {
      const at = g.vendor + "[" + ii + "]";
      if (!it.d) evBad.push(at + " 缺日期");
      if (!it.t) evBad.push(at + " 缺标题");
      if (!it.x || it.x.length < 20) evBad.push(at + " 说明过短");
      if (!it.s || !it.s.t) evBad.push(at + " 缺来源名");
      else if (!/^https?:\/\//.test(it.s.u || "")) evBad.push(at + " 来源链接非法: " + it.s.u);
    });
  });
  const evCount = (EVENTS || []).reduce((n, g) => n + g.items.length, 0);
  evBad.length ? bad("事件清单问题: " + evBad.join("; "))
               : ok("事件清单 " + EVENTS.length + " 组 / " + evCount + " 条，全部带来源链接");

  console.log("叶子: " + [...leaves].sort().join(", "));
}

console.log("\n" + out.join("\n"));
if (fail.length) { console.log("\n" + fail.join("\n")); console.log("\n=== 有 " + fail.length + " 项失败 ==="); process.exit(1); }
console.log("\n=== 全部检查通过 ===");
