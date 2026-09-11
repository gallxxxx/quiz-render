// Сборка ролика. Каждое видео сохраняется под своим именем,
// поэтому прошлые выпуски больше не затираются.
//
// Имя файла: "2026-08-24 22-12 WORLD LANDMARKS.mp4"
// Дата в начале — чтобы папка сама сортировалась от старых к новым.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readRounds, readTexts } from "./read-rounds.mjs";
import { addEpisode, findRepeats } from "./journal.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const OUT_DIR = path.join(QUIZ, "..", "Готовые видео");

// "WORLD LANDMARKS EDITION" → "WORLD LANDMARKS"
const editionName = () => {
  let name = "";
  try {
    name = (readTexts()?.intro?.edition ?? "").trim();
  } catch {
    name = "";
  }
  name = name.replace(/\s*EDITION\s*$/i, "").trim();
  // в имени файла нельзя \ / : * ? " < > |
  name = name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return name || "quiz";
};

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}-${p(d.getMinutes())}`
  );
};

// Если за одну минуту собрать дважды — не затираем, а добавляем номер.
const freeName = (base) => {
  let file = path.join(OUT_DIR, `${base}.mp4`);
  let n = 2;
  while (fs.existsSync(file)) {
    file = path.join(OUT_DIR, `${base} (${n}).mp4`);
    n += 1;
  }
  return file;
};

fs.mkdirSync(OUT_DIR, { recursive: true });

const texts = (() => {
  try {
    return readTexts();
  } catch {
    return null;
  }
})();

const rounds = (() => {
  try {
    return readRounds();
  } catch {
    return [];
  }
})();

// Предупреждаем ДО сборки: минуту рендерить, а потом обнаружить повтор — обидно.
const repeats = findRepeats(rounds);
if (repeats.pairs.length || repeats.clips.length) {
  console.log("");
  console.log("ВНИМАНИЕ: кое-что уже было в прошлых роликах.");
  if (repeats.pairs.length) {
    console.log(`  уже выходило пар: ${repeats.pairs.length} из ${rounds.length}`);
    for (const r of repeats.pairs) {
      console.log(`    ${r.top} / ${r.bottom}`);
    }
  }
  for (const c of repeats.clips) {
    console.log(`  клип для "${c.label}" уже был в прошлом ролике`);
  }
  console.log("");
  console.log("Собираю всё равно. Если не хотела повтора — останови (Ctrl+C),");
  console.log("поменяй вопросы и нажми кнопку 6 заново.");
  console.log("");
}

const target = freeName(`${stamp()} ${editionName()}`);

// Зовём remotion напрямую через node: путь с пробелами и кириллицей
// не переживает npx и shell:true.
const cli = path.join(QUIZ, "node_modules", "@remotion", "cli", "remotion-cli.js");

// Сколько кадров рисуем одновременно — ОБЫЧНО НЕ ТРОГАЕМ.
//
// Пробовал задавать по числу ядер и сделал хуже: на сборочной машине
// с двумя ядрами два потока дали 556 секунд против 475 у одного.
// Remotion не зря выбирает 1x на двух ядрах — второе ядро нужно
// кодировщику, который работает одновременно с рисованием.
//
// Поэтому по умолчанию не вмешиваемся, а переменная QUIZ_ПОТОКИ
// оставлена, чтобы можно было померить на другой машине.
const потоки = (() => {
  const задано = Number(process.env.QUIZ_ПОТОКИ);
  return Number.isFinite(задано) && задано >= 1 ? Math.floor(задано) : null;
})();

if (потоки) console.log(`Рисую в ${потоки} потока (ядер: ${os.cpus()?.length ?? "?"}).`);

const res = spawnSync(
  process.execPath,
  [cli, "render", "ThisOrThat", target, ...(потоки ? [`--concurrency=${потоки}`] : [])],
  { cwd: QUIZ, stdio: "inherit" },
);

if (res.status !== 0) {
  console.error("\nСобрать ролик не получилось.");
  process.exitCode = res.status ?? 1;
} else {
  console.log(`\nГотово: Готовые видео\\${path.basename(target)}`);
  console.log("Прошлые ролики остались на месте — ничего не затёрлось.");
  try {
    addEpisode({
      file: path.basename(target),
      edition: texts?.intro?.edition ?? "",
      hook: texts?.intro?.hook ?? "",
      rounds,
    });
    console.log("Записал выпуск в журнал — если вопрос повторится, скажу заранее.");
  } catch (e) {
    console.log("Ролик готов, но записать его в журнал не вышло:", e.message);
  }
}
