// Кнопка «12 Нарисовать заставку»: рисует заставку выпуска в Higgsfield
// и кладёт готовую картинку в папку «Обложки».
//
// Дальше всё как с нарисованными руками: кнопка 11 переносит их в проект,
// кнопка 6 собирает ролик.
//
// Как пользоваться из терминала:
//   node tools/make-cover.mjs                 — тема, которая сейчас в редакторе
//   node tools/make-cover.mjs beaches         — конкретная тема
//   node tools/make-cover.mjs --all           — все темы, у которых заставки ещё нет
//   node tools/make-cover.mjs beaches --import — сразу перенести в проект
//
// Вход в Higgsfield — один раз: higgsfield auth login
// Кредиты тратятся те же, что и в самом Higgsfield, отдельного счёта нет.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { THEMES } from "./themes.mjs";
import { COVER_ITEMS, promptFor } from "./cover-prompts.mjs";
import { readTexts } from "./read-rounds.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const INBOX = path.join(QUIZ, "..", "Обложки");
const DRAFTS = path.join(QUIZ, "..", "Черновики");
const COVERS = path.join(QUIZ, "public", "covers");
// Болванка Вики: две цветные половины и пустая табличка.
// Нейросеть только дорисовывает вокруг неё предметы.
const TEMPLATE = path.join(QUIZ, "_meta", "cover-template.jpg");

// Модель рисования. Меняется флагом --model, если появится что-то лучше.
const DEFAULT_MODEL = "nano_banana_pro";

// ————————————————————————— разбор аргументов —————————————————————————
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const words = argv.filter((a, i) => {
  if (a.startsWith("--")) return false;
  const prev = argv[i - 1];
  return !(prev === "--model" || prev === "--ratio" || prev === "--resolution");
});

const MODEL = value("model", DEFAULT_MODEL);
const RATIO = value("ratio", "9:16");
const RESOLUTION = value("resolution", "2k");

// ————————————————————————— какие темы рисуем —————————————————————————
// «BEACHES EDITION» / «beaches» / «11 BEACHES» — всё это одна и та же тема.
const findTheme = (query) => {
  const q = String(query).trim().toUpperCase().replace(/^\d+\s*/, "");
  return THEMES.find(
    (t) =>
      t.id.toUpperCase() === q.replace(/\s+/g, "-") ||
      t.edition.toUpperCase() === q ||
      t.edition.replace(/\s*EDITION\s*$/i, "").toUpperCase() === q,
  );
};

const hasCover = (id) =>
  [".jpg", ".jpeg", ".png"].some((ext) => fs.existsSync(path.join(COVERS, `${id}${ext}`)));

const pickThemes = () => {
  if (flag("all")) {
    const left = THEMES.filter((t) => COVER_ITEMS[t.id] && !hasCover(t.id));
    if (left.length === 0) console.log("Заставки уже есть у всех тем.");
    return left;
  }

  if (words.length) {
    const theme = findTheme(words.join(" "));
    if (!theme) {
      console.log(`Не понял тему: «${words.join(" ")}»`);
      console.log("");
      console.log("Темы:");
      for (const t of THEMES) console.log(`  ${t.id}  —  ${t.edition}`);
      return [];
    }
    return [theme];
  }

  // Без аргументов — то, что сейчас стоит в редакторе.
  let edition = "";
  try {
    edition = readTexts()?.intro?.edition ?? "";
  } catch {
    edition = "";
  }
  const theme = findTheme(edition);
  if (!theme) {
    console.log(`В редакторе сейчас «${edition || "непонятно что"}».`);
    console.log("Такой темы в библиотеке нет — назови тему явно:");
    console.log("  node tools/make-cover.mjs beaches");
    return [];
  }
  return [theme];
};

// ————————————————————————— номер выпуска для имени файла —————————————————————————
// Вика называет обложки как готовые видео: «11 BEACHES.jpg».
// Номер берём из папки черновика, чтобы имена совпадали.
const numberFor = (theme) => {
  if (!fs.existsSync(DRAFTS)) return "";
  const name = theme.edition.replace(/\s*EDITION\s*$/i, "").toUpperCase();
  const dir = fs
    .readdirSync(DRAFTS)
    .find((d) => d.replace(/^\d+\s*/, "").toUpperCase() === name);
  const num = dir?.match(/^(\d+)/)?.[1];
  return num ? `${num} ` : "";
};

// ————————————————————————— вызов Higgsfield —————————————————————————
// CLI приходит из npm как .cmd-обёртка, поэтому на Windows запускаем через shell.
const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

const runCli = (args) => {
  const line = ["higgsfield", ...args.map(quote)].join(" ");
  const res = spawnSync(line, { shell: true, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return {
    code: res.status,
    out: `${res.stdout ?? ""}`,
    err: `${res.stderr ?? ""}`,
  };
};

// Ответ CLI разбирать вслепую нельзя — форма меняется от модели к модели.
// Поэтому просто ищем в JSON первую ссылку на картинку, на любой глубине.
const IMG = /^https?:\/\/\S+\.(jpe?g|png|webp)(\?\S*)?$/i;

const findImageUrl = (node, depth = 0) => {
  if (depth > 8 || node == null) return null;
  if (typeof node === "string") return IMG.test(node) ? node : null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findImageUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === "object") {
    // сначала самые вероятные поля, потом всё подряд
    for (const key of ["url", "raw", "results", "result", "images", "output"]) {
      if (key in node) {
        const found = findImageUrl(node[key], depth + 1);
        if (found) return found;
      }
    }
    for (const v of Object.values(node)) {
      const found = findImageUrl(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
};

// CLI печатает JSON, но иногда вперемешку со строчками прогресса —
// вытаскиваем самый большой кусок, похожий на JSON.
const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    /* ниже */
  }
  const chunks = [];
  for (const m of text.matchAll(/[{[]/g)) {
    const slice = text.slice(m.index);
    for (let end = slice.length; end > 1; end -= 1) {
      try {
        chunks.push(JSON.parse(slice.slice(0, end)));
        break;
      } catch {
        /* пробуем короче */
      }
    }
  }
  return chunks.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0] ?? null;
};

const download = async (url, to) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`не скачалось: ${res.status}`);
  fs.writeFileSync(to, Buffer.from(await res.arrayBuffer()));
};

// ————————————————————————— основная работа —————————————————————————
const draw = async (theme) => {
  const prompt = promptFor(theme.id);
  if (!prompt) {
    console.log(`  ${theme.edition}: нет описания предметов, пропускаю`);
    return false;
  }

  if (!fs.existsSync(TEMPLATE)) {
    console.log("Не нашёл болванку заставки: quiz/_meta/cover-template.jpg");
    console.log("Без неё рамка получится каждый раз разного размера.");
    process.exit(1);
  }

  console.log(`${theme.edition} — рисую…`);

  const { code, out, err } = runCli([
    "generate",
    "create",
    MODEL,
    "--prompt",
    prompt,
    "--image-references",
    TEMPLATE,
    "--aspect_ratio",
    RATIO,
    "--resolution",
    RESOLUTION,
    "--wait",
    "--json",
  ]);

  const text = `${out}\n${err}`;

  if (/Not authenticated/i.test(text)) {
    console.log("");
    console.log("Higgsfield не подключён.");
    console.log("Открой чёрное окно и выполни один раз:");
    console.log("    higgsfield auth login");
    console.log("Откроется браузер — войди тем же аккаунтом, что и на сайте.");
    process.exit(1);
  }

  const url = findImageUrl(parseJson(text)) ?? text.match(IMG)?.[0] ?? null;

  if (!url) {
    console.log(`  не получилось (код ${code}).`);
    console.log(text.trim().split("\n").slice(-8).join("\n"));
    return false;
  }

  fs.mkdirSync(INBOX, { recursive: true });
  const name = `${numberFor(theme)}${theme.edition.replace(/\s*EDITION\s*$/i, "")}.jpg`;
  const to = path.join(INBOX, name);
  await download(url, to);
  console.log(`  готово → Обложки\\${name}`);
  return true;
};

const themes = pickThemes();
if (themes.length === 0) process.exit(0);

let done = 0;
for (const theme of themes) {
  // eslint-disable-next-line no-await-in-loop
  if (await draw(theme)) done += 1;
}

console.log("");
console.log(`Заставок нарисовано: ${done} из ${themes.length}`);

// Не нарисовалось всё, что просили — выходим с ошибкой, чтобы пакетный
// прогон не принял неудачу за успех (так уже собрался ролик без заставки).
if (done < themes.length) process.exitCode = 1;

if (done && flag("import")) {
  const res = spawnSync("node", [path.join(HERE, "import-covers.mjs")], {
    stdio: "inherit",
    cwd: QUIZ,
  });
  process.exitCode = res.status ?? 0;
} else if (done) {
  console.log("");
  console.log("Посмотри картинки в папке «Обложки».");
  console.log("Нравятся — жми кнопку 11, потом кнопку 6.");
}
