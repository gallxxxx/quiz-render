// Заменить картинки, которые не понравились.
//
// Показывает всё, что сейчас стоит в ролике, по номерам. Говоришь номера —
// и либо ищем другую картинку в интернете, либо ставим твой файл.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { slug } from "./media.mjs";
import { readMode, MODE_NAMES } from "./media-mode.mjs";
import { readRounds, slots, writeRoundsToRoot } from "./read-rounds.mjs";
import { fillGaps } from "./gaps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const PUBLIC = path.join(QUIZ, "public");
const DROP = path.join(QUIZ, "..", "Мои фото");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));

const run = (script, args) =>
  spawnSync(process.execPath, [path.join(HERE, script), ...args], { cwd: QUIZ, stdio: "inherit" })
    .status ?? 1;

let rounds;
try {
  rounds = readRounds();
} catch (e) {
  console.log(`Не смог прочитать вопросы: ${e.message}`);
  process.exit(1);
}

const list = slots(rounds);

console.log("");
console.log("ЧТО СЕЙЧАС СТОИТ В РОЛИКЕ");
console.log("");
rounds.forEach((r, i) => {
  console.log(`   Вопрос ${i + 1}`);
  for (const item of list.filter((s) => s.round === i)) {
    const where = item.side === "top" ? "сверху" : "снизу";
    const file = item.image || "ничего";
    console.log(`     ${String(item.n).padStart(2)}  ${item.label.padEnd(18)} ${where}   ${file}`);
  }
});

console.log("");
console.log("Рядом с кнопками лежит «превью картинок.png» — там всё это видно");
console.log("глазами, с теми же номерами. Сделать его заново и открыть? Enter — да.");
const wantSheet = await ask("   ");
if (wantSheet === "") {
  run("preview-sheet.mjs", []);
}

console.log("");
const answer = await ask("Номера, которые не понравились (через пробел): ");
const numbers = answer
  .split(" ")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n >= 1 && n <= list.length);

if (numbers.length === 0) {
  console.log("");
  console.log("Не поняла номера — ничего не меняю.");
  console.log("");
  rl.close();
  process.exit(0);
}

const chosen = numbers.map((n) => list[n - 1]);

console.log("");
console.log("Заменяем:");
chosen.forEach((c) => console.log(`   ${c.n}  ${c.label}`));
console.log("");
console.log("   1 — поискать другую картинку в интернете");
console.log("   2 — поставлю свои файлы");
console.log("");
const how = await ask("Как поступим: ");

// ——— вариант 1: ищем заново ———
if (how === "1") {
  const mode = readMode();
  console.log("");
  console.log(`Ищу заново. Сейчас выбрано: ${MODE_NAMES[mode]}`);
  console.log("Скрипт помнит, что уже брал, и возьмёт следующий вариант.");
  console.log("");

  for (const c of chosen) {
    const name = slug(c.label);
    if (mode === "фото" || mode === "свое") {
      run("get-photos.mjs", ["--force", "--replace", "--pexels", c.label]);
    } else {
      run("get-videos.mjs", ["--force", c.label]);
    }

    // Файл называется по подписи — ставим его на место сами:
    // при смене вида (видео на фото) имя меняется, и раунд надо поправить.
    const mp4 = `${name}.mp4`;
    const jpg = `${name}.jpg`;
    const prefer = mode === "видео" ? [mp4, jpg] : [jpg, mp4];
    for (const file of prefer) {
      if (fs.existsSync(path.join(PUBLIC, file))) {
        rounds[c.round][c.side].image = file;
        break;
      }
    }
  }
}

// ——— вариант 2: свои файлы ———
else if (how === "2") {
  fs.mkdirSync(DROP, { recursive: true });

  console.log("");
  console.log("НАЗОВИ ФАЙЛЫ ТАК:");
  console.log("");
  chosen.forEach((c) => {
    console.log(`   ${c.n}  ${c.label}  →  «${c.label}.jpg»   или просто «${c.n}.jpg»`);
  });
  console.log("");
  console.log("Подойдут jpg, png, а из видео mp4 и mov.");
  console.log("Сейчас открою папку «Мои фото». Положи туда файлы и вернись сюда.");
  console.log("");
  spawnSync("cmd", ["/c", "start", "", DROP], { stdio: "ignore" });
  await ask("Положила? Нажми Enter: ");

  // Файл, названный номером, переименовываем в подпись — дальше его
  // подхватит обычная кнопка «свои файлы».
  const byNumber = [];
  for (const c of chosen) {
    const files = fs.readdirSync(DROP).filter((n) => {
      const base = path.basename(n, path.extname(n)).trim();
      return base === String(c.n) || base.startsWith(`${c.n} `);
    });
    for (const f of files) {
      const ext = path.extname(f);
      const target = path.join(DROP, `${c.label}${ext}`);
      try {
        fs.renameSync(path.join(DROP, f), target);
        byNumber.push(`${f} → ${c.label}${ext}`);
      } catch {
        /* файл занят — оставим как есть, ниже скажем */
      }
    }
  }
  if (byNumber.length) {
    console.log("");
    console.log("Переименовала по номерам:");
    byNumber.forEach((l) => console.log("   " + l));
  }

  run("import-photos.mjs", []);
  rounds = readRounds(); // кнопка «свои файлы» уже расставила, читаем заново
}

else {
  console.log("");
  console.log("Не поняла ответ — ничего не меняю.");
  console.log("");
  rl.close();
  process.exit(0);
}

// ——— дыры закрываем, данные пишем, лист обновляем ———
const made = await fillGaps(rounds);
writeRoundsToRoot(rounds);

if (made.length) {
  console.log("");
  console.log(`Не нашлось картинки для: ${made.join(", ")} — поставила плашку с названием.`);
}

console.log("");
console.log("Готово. Делаю лист заново, чтобы посмотреть.");
run("preview-sheet.mjs", []);

console.log("Если что-то опять не то — нажми эту кнопку ещё раз.");
console.log("");
rl.close();
