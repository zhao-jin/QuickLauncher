// MadAppLauncher .mal -> QuickLauncher config.json 转换器
//
// 用法：
//   node scripts/convert-mal.mjs <input.mal> [outputPath]
// 默认 output = scripts/default-config.json
//
// 映射规则：
//   - <MATab> -> tabs[]:  tabID -> id(tab-mal-<tabID>),  tabName -> name
//   - <MAButton> -> items[]:
//       buttonID(btnMA<X>) -> key:
//           btnMAQ -> 'Q'; btnMASemicolon -> ';';
//           btnMACOMMA -> ','; btnMAPERIOD -> '.'
//       buttonText          -> name
//       fileName            -> target
//       arguments           -> arguments
//       workingDirectory    -> startIn
//       windowStyle (0/1/2/3) -> run (normal/min/max/hidden)
//       runAsAdmin (true/false) -> runAsAdmin
//   - 图标统一用 iconMode="default"（让 QuickLauncher 基于 target 自动提取）
//     因当前版本不支持 DLL+iconIndex 指向性提取
//
// 布局默认 10×3（MadAppLauncher 经典布局），热键 Ctrl+`

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const inputPath = argv[0] || "d:\\tools\\MadAppLauncher\\miles.mal";
const outputPath =
  argv[1] || path.join(projectRoot, "scripts", "default-config.json");

if (!fs.existsSync(inputPath)) {
  console.error(`[convert-mal] input not found: ${inputPath}`);
  process.exit(1);
}

// ---------- 简易 XML 解析（只处理 MAConfig 结构） ----------
// 我们只需要 <MATab>/<MAButton> + 子元素文本，避免引入 xml2js 等依赖。

const raw = fs.readFileSync(inputPath, "utf8");

/**
 * 从 xml 中提取所有 <tag>...</tag> 内容（非嵌套 tag）
 */
function extractBlocks(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

/**
 * 在单个 block 中读取 <key>...</key> 的文本（支持 <key/> 自闭合）
 */
function getText(block, key) {
  // 自闭合：<key />
  if (new RegExp(`<${key}\\s*/>`).test(block)) return "";
  const m = new RegExp(`<${key}>([\\s\\S]*?)</${key}>`).exec(block);
  if (!m) return "";
  return decodeXmlEntities(m[1]).trim();
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// ---------- 键位映射 ----------
const SYMBOL_MAP = {
  COMMA: ",",
  PERIOD: ".",
  SEMICOLON: ";",
  SLASH: "/",
  MINUS: "-",
  EQUAL: "=",
  LBRACKET: "[",
  RBRACKET: "]",
  BACKSLASH: "\\",
  QUOTE: "'",
};

function mapButtonIdToKey(buttonId) {
  // 去掉前缀 btnMA
  if (!buttonId || !buttonId.startsWith("btnMA")) return null;
  const rest = buttonId.slice(5); // "Q" / "COMMA" / "Semicolon"
  const upper = rest.toUpperCase();
  if (SYMBOL_MAP[upper]) return SYMBOL_MAP[upper];
  if (upper.length === 1 && /[A-Z0-9]/.test(upper)) return upper;
  // 未识别
  return null;
}

function mapWindowStyle(v) {
  switch ((v || "0").trim()) {
    case "1":
      return "min";
    case "2":
      return "max";
    case "3":
      return "hidden";
    case "0":
    default:
      return "normal";
  }
}

function toBool(s) {
  return String(s).trim().toLowerCase() === "true";
}

// ---------- 主流程 ----------
const malTabs = extractBlocks(raw, "MATab");
if (malTabs.length === 0) {
  console.error("[convert-mal] no <MATab> found in XML");
  process.exit(2);
}

const tabs = [];
let totalBtns = 0;
let skippedBtns = 0;
const skipSamples = [];

for (const tabXml of malTabs) {
  const tabID = getText(tabXml, "tabID") || `t${tabs.length}`;
  const tabName = getText(tabXml, "tabName") || `Tab${tabs.length + 1}`;

  const items = [];
  const usedKeys = new Set();

  const buttonsXml = extractBlocks(tabXml, "MAButton");
  for (const bXml of buttonsXml) {
    totalBtns++;
    const buttonID = getText(bXml, "buttonID");
    const key = mapButtonIdToKey(buttonID);
    const buttonText = getText(bXml, "buttonText");
    const fileName = getText(bXml, "fileName");
    if (!key || !fileName) {
      skippedBtns++;
      if (skipSamples.length < 5)
        skipSamples.push({ tab: tabName, buttonID, buttonText, fileName });
      continue;
    }
    if (usedKeys.has(key)) {
      // 同一 tab 同一 key 冲突——保留先出现的
      skippedBtns++;
      if (skipSamples.length < 5)
        skipSamples.push({
          tab: tabName,
          buttonID,
          reason: `duplicate key ${key}`,
          buttonText,
        });
      continue;
    }
    usedKeys.add(key);

    // 图标处理：MAL 的 iconFile 若非空，回填为 resource 模式（dll/exe + index）
    const iconFile = getText(bXml, "iconFile");
    const iconIndexRaw = getText(bXml, "iconIndex");
    const iconIndex = parseInt(iconIndexRaw || "0", 10) || 0;
    const hasResIcon = iconFile && iconFile.trim() !== "";

    items.push({
      key,
      name: buttonText || fileName,
      target: fileName,
      arguments: getText(bXml, "arguments"),
      startIn: getText(bXml, "workingDirectory"),
      run: mapWindowStyle(getText(bXml, "windowStyle")),
      runAsAdmin: toBool(getText(bXml, "runAsAdmin")),
      iconMode: hasResIcon ? "resource" : "default",
      iconPath: hasResIcon ? iconFile : "",
      iconIndex: hasResIcon ? iconIndex : 0,
    });
  }

  tabs.push({
    id: `tab-mal-${tabID}`,
    name: tabName,
    items,
  });
}

// ---------- 生成最终 config ----------
// MadAppLauncher .mal 没有显式的 F 行 topBar 数据；这里给出 10 个常用默认，
// 让用户首次启动就能看到顶栏可用，再按需右键改/拖入文件覆盖。
function mkTop(key, name, target) {
  return {
    key,
    name,
    target,
    arguments: "",
    startIn: "",
    run: "normal",
    runAsAdmin: false,
    iconMode: "default",
    iconPath: "",
    iconIndex: 0,
  };
}
const defaultTopBar = [
  mkTop("F1", "资源管理器", "explorer.exe"),
  mkTop("F2", "记事本", "notepad.exe"),
  mkTop("F3", "计算器", "calc.exe"),
  mkTop("F4", "命令行", "cmd.exe"),
  mkTop("F5", "PowerShell", "powershell.exe"),
  mkTop("F6", "任务管理器", "taskmgr.exe"),
  mkTop("F7", "控制面板", "control.exe"),
  mkTop("F8", "画图", "mspaint.exe"),
  mkTop("F9", "注册表", "regedit.exe"),
  mkTop("F10", "系统信息", "msinfo32.exe"),
];

const config = {
  version: 1,
  hotkey: "Ctrl+`",
  layout: { cols: 10, rows: 3 },
  appearance: {
    theme: "darkAcrylic",
    opacity: 0.98,
    iconSize: 32,
  },
  behavior: {
    hideOnFocusLost: true,
    hideAfterLaunch: true,
    autoStart: false,
  },
  topBar: defaultTopBar,
  tabs,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(config, null, 2) + "\n", "utf8");

// ---------- 报告 ----------
const totalRes = tabs.reduce(
  (n, t) => n + t.items.filter((i) => i.iconMode === "resource").length,
  0
);
console.log(`[convert-mal] ok  input=${inputPath}`);
console.log(`[convert-mal]     output=${outputPath}`);
console.log(
  `[convert-mal]     tabs=${tabs.length}  buttons=${totalBtns}  imported=${
    totalBtns - skippedBtns
  }  skipped=${skippedBtns}  resourceIcons=${totalRes}`
);
for (const t of tabs) {
  const r = t.items.filter((i) => i.iconMode === "resource").length;
  console.log(
    `[convert-mal]       - ${t.name.padEnd(8)}  items=${t.items
      .length.toString()
      .padStart(2)}  resIcons=${r}`
  );
}
if (skippedBtns > 0) {
  console.log("[convert-mal] skipped samples:");
  for (const s of skipSamples) console.log("  ", JSON.stringify(s));
}
