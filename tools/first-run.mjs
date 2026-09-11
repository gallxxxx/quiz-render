// Последний шаг установки: проверить, что всё на месте, и подготовить
// стартовый выпуск, чтобы редактор открылся не пустым.
//
// Запускается из кнопки «1 УСТАНОВКА» после npm install.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readPexelsKey } from "./media.mjs";
import { fillGaps } from "./gaps.mjs";
import { readRounds, writeRoundsToRoot } from "./read-rounds.mjs";
import { readMode, MODE_NAMES } from "./media-mode.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const HOME = path.join(QUIZ, "..");
const PUBLIC = path.join(QUIZ, "public");

console.log("");
console.log("ПРОВЕРЯЮ, ВСЁ ЛИ НА МЕСТЕ");
console.log("");

// ——— папки ———
for (const name of ["Мои фото", "Готовые видео"]) {
  const dir = path.join(HOME, name);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
console.log("Папки «Мои фото» и «Готовые видео» на месте.");

// ——— Remotion со своим ffmpeg ———
const cli = path.join(QUIZ, "node_modules", "@remotion", "cli", "remotion-cli.js");
if (fs.existsSync(cli)) {
  console.log("Remotion установлен.");
} else {
  console.log("");
  console.log("REMOTION НЕ УСТАНОВИЛСЯ.");
  console.log("Проверь интернет и запусти установку ещё раз.");
  console.log("");
  process.exit(1);
}

// Нумерация вопросов в редакторе — с единицы.
spawnSync(process.execPath, [path.join(HERE, "patch-studio.mjs")], { cwd: QUIZ, stdio: "ignore" });
console.log("Список вопросов в редакторе пронумерован с единицы.");

// ——— звуки ———
const sounds = ["tick.wav", "reveal.wav", "swoosh.wav"];
if (sounds.some((s) => !fs.existsSync(path.join(PUBLIC, s)))) {
  console.log("Делаю звуки таймера...");
  spawnSync(process.execPath, [path.join(HERE, "make-sounds.mjs")], { cwd: QUIZ, stdio: "inherit" });
} else {
  console.log("Звуки на месте.");
}

// ——— картинки стартового выпуска ———
try {
  const rounds = readRounds();
  const made = await fillGaps(rounds);
  if (made.length) writeRoundsToRoot(rounds);
  console.log(`Вопросов в стартовом выпуске: ${rounds.length}.`);
} catch (e) {
  console.log(`Не смог прочитать вопросы: ${e.message}`);
}

// ——— ключ Pexels ———
console.log("");
if (readPexelsKey()) {
  console.log("Ключ Pexels найден — видео и фото будут качаться сами.");
} else {
  console.log("КЛЮЧА PEXELS НЕТ.");
  console.log("");
  console.log("Без него не найдутся видеоклипы. Взять бесплатно за 2 минуты:");
  console.log("   1. открыть pexels.com/api");
  console.log("   2. зарегистрироваться и нажать Get Started");
  console.log("   3. скопировать ключ в файл «ключ pexels.txt» рядом с кнопками");
}

console.log("");
console.log(`Сейчас в кадр идёт: ${MODE_NAMES[readMode()]}`);
console.log("");
console.log("ВСЁ ГОТОВО.");
console.log("");
console.log("Дальше по порядку:");
console.log("   2 ОТКРЫТЬ РЕДАКТОР    — вписать свои вопросы");
console.log("   3 НАСТРОЙКИ           — видео или фото, план, голос диктора");
console.log("   4 ПОДОБРАТЬ КАРТИНКИ  — скрипт всё найдёт и покажет лист");
console.log("   5 СОБРАТЬ РОЛИК       — озвучит и соберёт MP4");
console.log("");
