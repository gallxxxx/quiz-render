// Показывает несколько скачанных клипов одной картинкой — до сборки ролика.
//
//   node tools/preview-clips.mjs лист.png bali seychelles zanzibar
//
// Нужен, чтобы не гонять минутную сборку ради проверки одного клипа:
// кадр вынимается прямо из mp4 в public за секунду.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { findFfmpeg } from "./media.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const PUBLIC = path.join(QUIZ, "public");
// ffmpeg лежит внутри Remotion, и у каждой системы своя папка —
// поэтому спрашиваем общий поиск, а не вписываем путь руками.
const FFMPEG = findFfmpeg();
if (!FFMPEG) {
  console.log("Не нашла ffmpeg внутри Remotion. Установи зависимости: npm install");
  process.exit(1);
}

const out = process.argv[2];
const names = process.argv.slice(3);

if (!out || names.length === 0) {
  console.log("Как звать: node tools/preview-clips.mjs лист.png имя1 имя2 …");
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "preview-"));
const W = 420;
const GAP = 8;
const COLS = Math.min(3, names.length);
const layers = [];

for (let i = 0; i < names.length; i += 1) {
  const clip = path.join(PUBLIC, `${names[i]}.mp4`);
  if (!fs.existsSync(clip)) {
    console.log(`  нет клипа: ${names[i]}.mp4`);
    continue;
  }
  const frame = path.join(tmp, `${i}.png`);
  spawnSync(FFMPEG, ["-y", "-ss", "3", "-i", clip, "-frames:v", "1", frame]);
  if (!fs.existsSync(frame)) continue;

  // Квадрат — так же, как обрезает сам ролик.
  const buf = await sharp(fs.readFileSync(frame)).resize(W, W, { fit: "cover" }).toBuffer();
  layers.push({
    input: buf,
    left: (i % COLS) * (W + GAP),
    top: Math.floor(i / COLS) * (W + GAP),
  });
}

const rows = Math.ceil(names.length / COLS);
const sheet = await sharp({
  create: {
    width: COLS * W + (COLS - 1) * GAP,
    height: rows * W + (rows - 1) * GAP,
    channels: 3,
    background: { r: 25, g: 22, b: 20 },
  },
})
  .composite(layers)
  .png()
  .toBuffer();

fs.writeFileSync(out, sheet);
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* Windows иногда держит файл — не повод падать */
}

console.log(`Лист готов: ${out} (клипов: ${layers.length})`);
