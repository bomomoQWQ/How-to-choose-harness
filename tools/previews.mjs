import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

function variant(name, drive){
  const inject = "\n<script>\n" + drive + "\n</script>\n</body>";
  fs.writeFileSync(path.join(ROOT, name), src.replace("</body>", inject), "utf8");
}

// 停在「隐私红线」这一题（基础关第 4 题）
variant("_preview-quiz.html", "window.addEventListener('load',()=>{restart();[0,0,0,0].forEach(pick);});");

// 红线拦截页：选了订阅套餐但与「在意隐私 / 要看开源」冲突 → g-zp
variant("_preview-guard.html", "window.addEventListener('load',()=>{restart();[0,0,0,2,0,0,0,0,2,0].forEach(pick);});");

// 最丰富的结论页：被拦下后改走开源 CLI，带红线对照 + Linux 系统提示
variant("_preview-result.html", "window.addEventListener('load',()=>{restart();[0,0,0,2,0,0,0,0,2,0,2].forEach(pick);});");

// 警告型结论（中转/代充）
variant("_preview-warn.html", "window.addEventListener('load',()=>{restart();[0,0,0,0,2,1,0,0,3].forEach(pick);});");

console.log("preview files written");
