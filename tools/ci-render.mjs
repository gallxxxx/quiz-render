// Сборка ролика на чужой машине — одной командой.
//
//   node tools/ci-render.mjs путь/к/выпуску.quiz
//
// Делает то же, что дома делают три кнопки подряд, но без вопросов
// к человеку: принять выпуск → добить недостающие картинки → собрать.
//
// Почему отдельный файл, а не строчки в сценарии сборки: так весь
// порядок действий виден в одном месте и его можно прогнать дома,
// прежде чем отправлять наверх.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const HOME = path.join(QUIZ, "..");
const OUT_DIR = path.join(HOME, "Готовые видео");

const шаг = (название, script, args = []) => {
  console.log("");
  console.log("======================================================");
  console.log("  " + название);
  console.log("======================================================");
  console.log("");
  const res = spawnSync(process.execPath, [path.join(HERE, script), ...args], {
    cwd: QUIZ,
    stdio: "inherit",
  });
  return res.status ?? 1;
};

// ——— какой выпуск собираем ———
const задан = process.argv[2];
const файл = задан && fs.existsSync(задан) ? задан : null;
if (задан && !файл) {
  console.log(`Не нашла файл выпуска: ${задан}`);
  process.exit(1);
}

// ——— 1. принять выпуск ———
// Без аргумента приёмник сам возьмёт самый свежий .quiz — дома это
// удобно, здесь мы всегда передаём файл явно, чтобы не поймать чужой.
if (шаг("ПРИНИМАЮ ВЫПУСК", "import-episode.mjs", файл ? [файл] : []) !== 0) {
  console.log("Выпуск принять не вышло — дальше идти незачем.");
  process.exit(1);
}

// ——— 2. добрать картинки, если что-то осталось пустым ———
// Всё, что одобрено на сайте, приёмник уже скачал. Обычный подбор
// зовём только ради дыр: гонять его просто так — лишние запросы
// к стоку и риск подменить одобренное.
const { readRounds } = await import("./read-rounds.mjs");
const дыры = () => {
  const PUBLIC = path.join(QUIZ, "public");
  const пусто = [];
  for (const r of readRounds()) {
    for (const side of ["top", "bottom"]) {
      const имя = r[side].image;
      if (!имя || !fs.existsSync(path.join(PUBLIC, имя))) пусто.push(r[side].label);
    }
  }
  return пусто;
};

const осталось = дыры();
if (осталось.length) {
  console.log("");
  console.log(`Без картинки осталось мест: ${осталось.length} — ${осталось.join(", ")}`);
  шаг("ПОДБИРАЮ, ЧЕГО НЕ ХВАТАЕТ", "get-media.mjs");
} else {
  console.log("");
  console.log("Все картинки одобрены на сайте — подбор не нужен.");
}

// ——— 3. озвучить и собрать ———
if (шаг("СОБИРАЮ РОЛИК", "build.mjs") !== 0) {
  console.log("Сборка не удалась.");
  process.exit(1);
}

// ——— что получилось ———
// Имя файлу даёт render.mjs — оно зависит от темы и времени, поэтому
// просто берём самый свежий MP4 из папки готовых.
let готово = null;
try {
  готово = fs
    .readdirSync(OUT_DIR)
    .filter((n) => n.toLowerCase().endsWith(".mp4"))
    .map((n) => ({ n, t: fs.statSync(path.join(OUT_DIR, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0]?.n ?? null;
} catch {
  готово = null;
}

if (!готово) {
  console.log("Ролик не найден в папке готовых — что-то пошло не так.");
  process.exit(1);
}

const полный = path.join(OUT_DIR, готово);
const мегабайт = (fs.statSync(полный).size / 1024 / 1024).toFixed(1);
console.log("");
console.log("======================================================");
console.log(`  ГОТОВО: ${готово} (${мегабайт} МБ)`);
console.log("======================================================");

// Сценарию сборки нужно имя файла — отдаём его отдельной строкой
// и, если нас позвали из GitHub, кладём в переменные шага.
// Имена переменных латиницей намеренно: GitHub читает их сам, и рисковать
// на кириллице тут незачем.
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `file=${полный}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `name=${готово}\n`);
}
