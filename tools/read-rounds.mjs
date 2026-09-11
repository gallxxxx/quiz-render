// Достаёт данные видео оттуда, где они сейчас лежат:
// сначала пробует defaultProps в Root.tsx (туда пишет кнопка Save в студии),
// если там ещё ссылки на константы — читает src/thisorthat-data.ts.
import fs from "fs";
import path from "path";

const SRC = path.join(process.cwd(), "src");
const ROOT = path.join(SRC, "Root.tsx");
const DATA = path.join(SRC, "thisorthat-data.ts");
const MARKER = "defaultProps={";

// вырезает сбалансированный {...} начиная с позиции открывающей скобки
const braceBlock = (text, start) => {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

// Находит кусок `defaultProps={...}` в Root.tsx.
// props будет null, если там ещё ссылки на константы, а не JSON.
const readRootBlock = () => {
  if (!fs.existsSync(ROOT)) return null;
  const text = fs.readFileSync(ROOT, "utf8");
  const at = text.indexOf(MARKER);
  if (at === -1) return null;

  const start = at + MARKER.length;
  const block = braceBlock(text, start);
  if (!block) return null;

  let props = null;
  try {
    props = JSON.parse(block);
  } catch {
    // там ещё `{ intro: INTRO, rounds: ROUNDS, ... }` — это нормально
  }
  return { text, start, block, props };
};

const readRootProps = () => {
  const b = readRootBlock();
  return b?.props ? b : null;
};

// ——— раунды из файла с данными (запасной путь) ———
// Важно вытащить не только подписи, но и картинки с цветами,
// иначе при обратной записи они потеряются.
const roundsFromData = () => {
  const text = fs.readFileSync(DATA, "utf8");

  // цвета: сначала сама палитра, потом короткие псевдонимы T / TD / Q / QD
  const palette = {};
  const paletteBlock = text.match(/export const PALETTE = \{([\s\S]*?)\};/);
  if (paletteBlock) {
    for (const m of paletteBlock[1].matchAll(/(\w+):\s*"(#[0-9a-fA-F]+)"/g)) {
      palette[m[1]] = m[2];
    }
  }
  const alias = {};
  for (const m of text.matchAll(/const (\w+) = PALETTE\.(\w+);/g)) {
    alias[m[1]] = palette[m[2]] ?? "#000000";
  }
  const toColor = (token) => {
    const t = token.trim().replace(/^"|"$/g, "");
    if (t.startsWith("#")) return t;
    return alias[t] ?? palette[t.replace("PALETTE.", "")] ?? "#000000";
  };

  const side = (block) => {
    const label = block.match(/label:\s*"([^"]*)"/);
    const image = block.match(/image:\s*"([^"]*)"/);
    const color = block.match(/color:\s*([^,}]+)/);
    return {
      label: label ? label[1] : "",
      image: image ? image[1] : "",
      color: color ? toColor(color[1]) : "#000000",
    };
  };

  const re =
    /top:\s*(\{[^}]*\})\s*,\s*bottom:\s*(\{[^}]*\})\s*,\s*topPercent:\s*(\d+)/g;
  const rounds = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    rounds.push({ top: side(m[1]), bottom: side(m[2]), topPercent: Number(m[3]) });
  }
  return rounds;
};

const textsFromData = () => {
  const text = fs.readFileSync(DATA, "utf8");
  const grab = (block, key) => {
    const b = text.match(new RegExp(`export const ${block}[^=]*=\\s*\\{([\\s\\S]*?)\\};`));
    if (!b) return "";
    const v = b[1].match(new RegExp(`${key}:\\s*"([^"]*)"`));
    return v ? v[1] : "";
  };
  return {
    intro: { hook: grab("INTRO", "hook"), edition: grab("INTRO", "edition") },
    outro: {
      title: grab("OUTRO", "title"),
      subtitle: grab("OUTRO", "subtitle"),
      cta: grab("OUTRO", "cta"),
    },
  };
};

// ————————————————————————— То, чем пользуются скрипты —————————————————————————

export const readRounds = () => {
  const root = readRootProps();
  const rounds = Array.isArray(root?.props?.rounds) ? root.props.rounds : roundsFromData();
  if (!rounds || rounds.length === 0) {
    throw new Error("Не удалось прочитать раунды ни из Root.tsx, ни из thisorthat-data.ts");
  }
  return rounds;
};

export const readTexts = () => {
  const root = readRootProps();
  const fallback = textsFromData();
  return {
    intro: root?.props?.intro ?? fallback.intro,
    outro: root?.props?.outro ?? fallback.outro,
  };
};

// Записывает данные обратно в defaultProps в Root.tsx — тем же способом,
// каким это делает кнопка Save в студии.
//
// Меняется только то, что передали: не передал intro — заставка останется
// прежней. Так скрипт не может случайно стереть то, чего не трогал.
export const writeToRoot = ({ rounds, intro, outro } = {}) => {
  const root = readRootBlock();
  if (!root) return false;

  // Если там ещё ссылки на константы — разворачиваем их в настоящие данные,
  // чтобы подстановка работала и до первого Save в студии.
  const base = root.props ?? { ...textsFromData(), rounds: roundsFromData() };

  const updated = {
    intro: intro ? { ...base.intro, ...intro } : base.intro,
    rounds: rounds ?? base.rounds,
    outro: outro ? { ...base.outro, ...outro } : base.outro,
  };

  const text =
    root.text.slice(0, root.start) +
    JSON.stringify(updated) +
    root.text.slice(root.start + root.block.length);

  fs.writeFileSync(ROOT, text, "utf8");
  return true;
};

// Старое имя — им пользуются кнопки подбора видео и фото.
export const writeRoundsToRoot = (rounds) => writeToRoot({ rounds });

// Все места ролика по порядку: верх и низ каждого вопроса.
// Номер (n) — это то, чем места называет человек: 1, 2, 3…
export const slots = (rounds) => {
  const list = [];
  rounds.forEach((r, i) => {
    for (const side of ["top", "bottom"]) {
      list.push({
        n: list.length + 1,
        round: i,
        side,
        label: r[side].label,
        image: r[side].image ?? "",
      });
    }
  });
  return list;
};
