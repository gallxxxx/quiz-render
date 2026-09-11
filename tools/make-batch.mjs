// Пакетная сборка выпусков.
//
//   npm run batch -- desserts animals        собрать эти темы
//   npm run batch -- --all                   собрать все, кроме уже собранных
//   npm run batch -- --list                  просто показать список тем
//
// Каждый выпуск идёт полным кругом: данные → клипы → MP4 → черновик.
// Ролик сохраняется СРАЗУ, поэтому обрыв на пятой теме не отменяет
// первые четыре.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { THEMES, roundsOf } from "./themes.mjs";
import { readRounds, readTexts, writeToRoot } from "./read-rounds.mjs";
import { saveDraft } from "./draft.mjs";
import { addEpisode } from "./journal.mjs";
import { restoreFor, stashAll, publicSizeMb } from "./media-store.mjs";
import { fillMissing } from "./placeholder.mjs";
import { listDrafts } from "./draft.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const OUT_DIR = path.join(QUIZ, "..", "Готовые видео");
const CLI = path.join(QUIZ, "node_modules", "@remotion", "cli", "remotion-cli.js");

const args = process.argv.slice(2);

if (args.includes("--list")) {
  console.log("ТЕМЫ В БИБЛИОТЕКЕ:");
  THEMES.forEach((t, i) => console.log(`  ${i + 1}. ${t.id} — ${t.edition}`));
  process.exit(0);
}

const done = new Set(
  listDrafts().map((d) => String(d.data.edition ?? "").toUpperCase()),
);

let chosen;
if (args.includes("--all")) {
  chosen = THEMES.filter((t) => !done.has(t.edition.toUpperCase()));
} else {
  const ids = args.filter((a) => !a.startsWith("--"));
  chosen = ids.map((id) => THEMES.find((t) => t.id === id)).filter(Boolean);
  const missing = ids.filter((id) => !THEMES.some((t) => t.id === id));
  if (missing.length) console.log("Нет таких тем:", missing.join(", "));
}

if (chosen.length === 0) {
  console.log("Собирать нечего.");
  process.exit(0);
}

console.log(`К сборке: ${chosen.length} выпуск(ов)`);
console.log("");

const run = (script, extra = []) => {
  const res = spawnSync(process.execPath, [path.join(HERE, script), ...extra], {
    cwd: QUIZ,
    encoding: "utf8",
  });
  return { ok: res.status === 0, out: (res.stdout ?? "") + (res.stderr ?? "") };
};

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}-${p(d.getMinutes())}`
  );
};

const freeName = (base) => {
  let file = path.join(OUT_DIR, `${base}.mp4`);
  let n = 2;
  while (fs.existsSync(file)) {
    file = path.join(OUT_DIR, `${base} (${n}).mp4`);
    n += 1;
  }
  return file;
};

// Pexels пускает 200 запросов в час. Одна тема съедает около сорока,
// поэтому на длинном прогоне лимит кончается. Это не ошибка — просто
// нужно подождать, пока час истечёт.
const RATE_WAIT_MIN = 20;
const MAX_WAITS = 12; // суммарно до четырёх часов ожидания

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let waits = 0;

for (const theme of chosen) {
  const started = Date.now();
  console.log("─".repeat(60));
  console.log(`${theme.edition}`);

  let limitHit = false;

  // 1. данные
  // Нарисованная заставка, если она уже лежит в public/covers.
  // Имя файла — id темы: covers/food.jpg, covers/beaches.jpg.
  const coverFile = [".jpg", ".jpeg", ".png"]
    .map((ext) => `covers/${theme.id}${ext}`)
    .find((rel) => fs.existsSync(path.join(QUIZ, "public", rel)));

  writeToRoot({
    rounds: roundsOf(theme),
    intro: { hook: theme.hook, edition: theme.edition, cover: coverFile ?? "" },
    outro: theme.outro,
  });
  if (coverFile) console.log(`  заставка: ${coverFile}`);

  // Готовим public: в нём должны лежать только клипы этого выпуска.
  // Иначе Remotion копирует сотни мегабайт чужих файлов на каждый рендер.
  stashAll();
  const names = theme.pairs.flatMap((pair) => [pair[0], pair[2]]);
  restoreFor(names);

  // 2. клипы
  const videos = run("get-videos.mjs", theme.shot === "wide" ? ["--wide"] : []);
  const noClip = [...videos.out.matchAll(/^(.+?) \.\.\. фото/gm)].map(
    (m) => m[1],
  );
  const failed = [...videos.out.matchAll(/^(.+?) \.\.\. (?:не |ошиб)/gm)].map(
    (m) => m[1],
  );
  limitHit = /лимит|429|Too Many/i.test(videos.out);

  if (limitHit && waits < MAX_WAITS) {
    waits += 1;
    console.log(
      `  Pexels: кончился часовой лимит запросов. Жду ${RATE_WAIT_MIN} мин ` +
        `и берусь за эту же тему снова (пауза ${waits} из ${MAX_WAITS}).`,
    );
    await sleep(RATE_WAIT_MIN * 60 * 1000);
    chosen.push(theme); // вернём в конец очереди
    continue;
  }

  if (!videos.ok) {
    console.log("  клипы: сорвалось, пропускаю выпуск");
    // Без причины отладка превращается в гадание — печатаем, что сказал скрипт.
    const tail = videos.out.trim().split(/\r?\n/).slice(-6).join("\n      ");
    if (tail) console.log("      " + tail);
    results.push({ theme: theme.edition, ok: false, why: "клипы" });
    continue;
  }
  console.log(
    `  клипы: готово${noClip.length ? `, фото вместо видео: ${noClip.join(", ")}` : ""}` +
      `${failed.length ? `, не нашлось: ${failed.join(", ")}` : ""}`,
  );

  // Места, которым не нашлось ничего, закрываем плашкой: один неудачный
  // запрос не должен ронять весь выпуск.
  const rounds = readRounds();
  const patched = await fillMissing(rounds);
  if (patched.length) {
    writeToRoot({ rounds });
    console.log(`  заглушки: ${patched.join(", ")}`);
  }
  console.log(`  в public: ${publicSizeMb()} МБ`);

  // 3. сборка
  const title = theme.edition.replace(/\s*EDITION\s*$/i, "").trim();
  const target = freeName(`${stamp()} ${title}`);
  const render = spawnSync(process.execPath, [CLI, "render", "ThisOrThat", target], {
    cwd: QUIZ,
    encoding: "utf8",
  });
  if (render.status !== 0 || !fs.existsSync(target)) {
    console.log("  сборка: не получилась, пропускаю выпуск");
    const err = ((render.stderr ?? "") + (render.stdout ?? "")).trim();
    const tail = err.split(/\r?\n/).slice(-6).join("\n      ");
    if (tail) console.log("      " + tail);
    results.push({ theme: theme.edition, ok: false, why: "сборка" });
    continue;
  }
  const mb = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
  console.log(`  видео: ${path.basename(target)} (${mb} МБ)`);

  // 4. черновик — сразу, чтобы выпуск не потерялся
  const texts = readTexts();
  const dir = saveDraft({
    edition: theme.edition,
    hook: theme.hook,
    rounds: readRounds(),
    texts,
    videoFile: path.basename(target),
  });
  console.log(`  черновик: ${path.basename(dir)}`);

  // В журнал — чтобы кнопка 9 знала, какие пары уже выходили.
  try {
    addEpisode({
      file: path.basename(target),
      edition: theme.edition,
      hook: theme.hook,
      rounds: readRounds(),
    });
  } catch (e) {
    console.log("  журнал: записать не вышло —", e.message);
  }

  const sec = Math.round((Date.now() - started) / 1000);
  console.log(`  время: ${sec} сек`);
  results.push({
    theme: theme.edition,
    ok: true,
    video: path.basename(target),
    draft: path.basename(dir),
    noClip,
  });
}

console.log("");
console.log("═".repeat(60));
console.log("ИТОГ");
for (const r of results) {
  console.log(
    r.ok
      ? `  готово: ${r.theme}${r.noClip?.length ? `  (фото: ${r.noClip.join(", ")})` : ""}`
      : `  НЕ ВЫШЛО: ${r.theme} — ${r.why}`,
  );
}
console.log("");
console.log(`Собрано: ${results.filter((r) => r.ok).length} из ${results.length}`);
