// Контактный лист: девять раундов ролика одной картинкой.
//
//   node tools/contact-sheet.mjs "Готовые видео\...mp4" out.png
//
// Кадры вынимаются из готового MP4 (это секунды), а не рендерятся заново.
// Нужен, чтобы одним взглядом проверить весь выпуск: не попал ли в кадр
// вместо еды человек, не оказалось ли главное в углу.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { findFfmpeg } from "./media.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
// ffmpeg лежит внутри Remotion, и у каждой системы своя папка —
// поэтому спрашиваем общий поиск, а не вписываем путь руками.
const FFMPEG = findFfmpeg();
if (!FFMPEG) {
  console.log("Не нашла ffmpeg внутри Remotion. Установи зависимости: npm install");
  process.exit(1);
}

const FPS = 30;
const INTRO = 60;
const TRANSITION = 15;
const ROUND = 210; // 5 сек таймер + 2 сек проценты

const source = process.argv[2];
const target = process.argv[3] ?? path.join(os.tmpdir(), "contact-sheet.png");
const count = Number(process.argv[4] ?? 9);

if (!source || !fs.existsSync(source)) {
  console.log("Не нашёл видео:", source);
  process.exit(1);
}

// Середина отсчёта в каждом раунде: картинка уже въехала, процентов ещё нет.
const momentOf = (i) => (INTRO - TRANSITION + i * (ROUND - TRANSITION) + 90) / FPS;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheet-"));
const tiles = [];

for (let i = 0; i < count; i += 1) {
  const out = path.join(tmp, `f${i}.png`);
  const res = spawnSync(
    FFMPEG,
    ["-y", "-ss", String(momentOf(i)), "-i", source, "-frames:v", "1", out],
    { encoding: "utf8" },
  );
  if (res.status === 0 && fs.existsSync(out)) tiles.push({ i, file: out });
}

if (tiles.length === 0) {
  console.log("Не удалось вынуть ни одного кадра.");
  process.exit(1);
}

// Сетка 3×3, каждый кадр ужат по ширине — читать надписи этого хватает.
const W = 380;
const H = Math.round((W * 1920) / 1080);
const COLS = 3;
const rows = Math.ceil(tiles.length / COLS);
const GAP = 6;

const layers = [];
for (const t of tiles) {
  // Кириллицу sharp не открывает по пути, поэтому читаем файл сами.
  const buf = await sharp(fs.readFileSync(t.file)).resize(W, H).toBuffer();
  layers.push({
    input: buf,
    left: (t.i % COLS) * (W + GAP),
    top: Math.floor(t.i / COLS) * (H + GAP),
  });
}

const sheet = await sharp({
  create: {
    width: COLS * W + (COLS - 1) * GAP,
    height: rows * H + (rows - 1) * GAP,
    channels: 3,
    background: { r: 20, g: 18, b: 16 },
  },
})
  .composite(layers)
  .png()
  .toBuffer();

fs.writeFileSync(target, sheet);
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  // Windows иногда держит временный файл — не повод падать
}

console.log(`Контактный лист: ${target} (кадров: ${tiles.length})`);
