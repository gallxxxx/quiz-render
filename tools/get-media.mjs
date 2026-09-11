// Кнопка «ПОДОБРАТЬ КАРТИНКИ» — одна на все случаи.
//
// Что она сделает, решает настройка «КАРТИНКИ» в файле «настройки.txt»
// (её меняет кнопка-переключатель):
//
//     видео — качает видеоклипы с Pexels
//     фото  — качает фотографии (сток, Википедия, Openverse)
//     своё  — забирает файлы из папки «Мои фото»
//
// В конце дыры закрываются плашкой с названием: без этого сборка ролика
// падает целиком из-за одного места, которому ничего не нашлось.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readMode, readShot, MODE_NAMES } from "./media-mode.mjs";
import { clearGaps, fillGaps } from "./gaps.mjs";
import { readRounds, writeRoundsToRoot } from "./read-rounds.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const PUBLIC = path.join(QUIZ, "public");

const mode = readMode();
const shot = readShot();

// Плашки прошлого захода стираем ДО поиска: пусть ищется заново.
clearGaps();

console.log("");
console.log(`Сейчас выбрано: ${MODE_NAMES[mode]}`);
if (mode === "видео") console.log(`План: ${shot}`);
console.log("");

const run = (script, args = []) => {
  const res = spawnSync(process.execPath, [path.join(HERE, script), ...args], {
    cwd: QUIZ,
    stdio: "inherit",
  });
  return res.status ?? 1;
};

let code = 0;
if (mode === "видео") {
  code = run("get-videos.mjs", shot === "общий" ? ["--wide"] : []);
} else if (mode === "фото") {
  code = run("get-photos.mjs", ["--replace", "--pexels"]);
} else {
  code = run("import-photos.mjs");
}

// ——— чем закончилось ———
let rounds = null;
try {
  rounds = readRounds();
} catch {
  rounds = null;
}

if (rounds) {
  const made = await fillGaps(rounds);
  writeRoundsToRoot(rounds);

  const empty = [];
  for (const r of rounds) {
    for (const side of ["top", "bottom"]) {
      const f = path.join(PUBLIC, r[side].image);
      if (!fs.existsSync(f)) empty.push(r[side].label);
    }
  }

  if (made.length) {
    console.log("");
    console.log("НИЧЕГО НЕ НАШЛОСЬ, ПОСТАВИЛА ПЛАШКУ С НАЗВАНИЕМ:");
    console.log("   " + made.join(", "));
    console.log("");
    console.log("Ролик соберётся и так, но лучше положить своё фото в «Мои фото»");
    console.log("и назвать его как подпись вопроса.");
  }
  if (empty.length) {
    console.log("");
    console.log(`ВНИМАНИЕ: без картинки остались — ${empty.join(", ")}`);
  }
}

// Лист «что получилось» — по нему выбирают, что заменить.
run("preview-sheet.mjs", process.env.QUIZ_PHONE === "1" ? ["--молча"] : []);

console.log("");
console.log("Посмотри лист «превью картинок» — он только что открылся.");
console.log("Что-то не понравилось — кнопка «4б ЗАМЕНИТЬ КАРТИНКУ».");
console.log("Всё хорошо — кнопка «5 СОБРАТЬ РОЛИК».");
console.log("");
process.exitCode = code;
