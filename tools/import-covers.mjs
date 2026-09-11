// Забирает нарисованные заставки из папки «Обложки» в проект.
//
// Вика кладёт туда картинки, названные как выпуск: «11 BEACHES.jpg».
// Скрипт раскладывает их в public/covers под именем темы, и дальше
// сборка подставляет их сама.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES } from "./themes.mjs";
import { readTexts, writeToRoot } from "./read-rounds.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const INBOX = path.join(QUIZ, "..", "Обложки");
const COVERS = path.join(QUIZ, "public", "covers");

fs.mkdirSync(INBOX, { recursive: true });
fs.mkdirSync(COVERS, { recursive: true });

const IMAGE = /\.(jpe?g|png)$/i;

// «11 BEACHES.jpg» → beaches, «еда.jpg» → ничего
const themeOf = (fileName) => {
  const base = fileName.replace(IMAGE, "").trim().toUpperCase();
  const withoutNumber = base.replace(/^\d+\s*/, "");
  return THEMES.find(
    (t) =>
      t.edition.replace(/\s*EDITION\s*$/i, "").toUpperCase() === withoutNumber ||
      t.id.toUpperCase() === withoutNumber.replace(/\s+/g, "-"),
  );
};

const files = fs.readdirSync(INBOX).filter((f) => IMAGE.test(f));

if (files.length === 0) {
  console.log("В папке «Обложки» пусто.");
  console.log("");
  console.log("Положи туда картинки, названные как выпуск:");
  console.log("   11 BEACHES.jpg      12 ISLANDS.jpg      13 WONDERS OF NATURE.jpg");
  console.log("");
  console.log("Названия можно просто скопировать из папки «Готовые видео».");
  process.exit(0);
}

let ok = 0;
const unknown = [];
const taken = [];

for (const file of files) {
  const theme = themeOf(file);
  if (!theme) {
    unknown.push(file);
    continue;
  }
  const ext = path.extname(file).toLowerCase() === ".png" ? ".png" : ".jpg";
  const to = path.join(COVERS, `${theme.id}${ext}`);

  // Старую заставку этой темы убираем, иначе останутся две с разным расширением.
  for (const other of [".jpg", ".jpeg", ".png"]) {
    const stale = path.join(COVERS, `${theme.id}${other}`);
    if (stale !== to && fs.existsSync(stale)) {
      try {
        fs.rmSync(stale, { force: true });
      } catch {
        /* занят — не страшно */
      }
    }
  }

  fs.copyFileSync(path.join(INBOX, file), to);
  console.log(`  ${file}  →  ${theme.edition}`);
  taken.push({ theme, cover: `covers/${theme.id}${ext}` });
  ok += 1;
}

// Скопировать файл мало: в самом ролике заставка не появится, пока
// её имя не прописано в данных. Если выпуск, который сейчас открыт
// в редакторе, — из числа принятых, прописываем сразу.
let applied = null;
try {
  const edition = (readTexts()?.intro?.edition ?? "").trim().toUpperCase();
  const mine = taken.find((t) => t.theme.edition.toUpperCase() === edition);
  if (mine && writeToRoot({ intro: { cover: mine.cover } })) applied = mine;
} catch {
  // редактор мог быть с чужими данными — не страшно, просто не подставим
}

console.log("");
console.log(`Заставок принято: ${ok}`);

if (unknown.length) {
  console.log("");
  console.log("НЕ ПОНЯЛ, К КАКОМУ ВЫПУСКУ:");
  for (const f of unknown) console.log(`  ${f}`);
  console.log("");
  console.log("Назови файл так же, как выпуск: «11 BEACHES.jpg».");
}

console.log("");
if (applied) {
  console.log(`В открытом сейчас выпуске «${applied.theme.edition}» заставка уже стоит.`);
  console.log("Собери ролик кнопкой 6 — она будет в первых двух секундах.");
} else {
  console.log("Открой нужный выпуск кнопкой 10 и запусти эту кнопку ещё раз,");
  console.log("тогда заставка встанет в ролик. Потом кнопка 6.");
}
