// Лист «что сейчас стоит в ролике»: все картинки одной страницей,
// с номерами и подписями. Нужен, чтобы посмотреть глазами ДО сборки
// и сказать, какие места переделать.
//
//   node tools/preview-sheet.mjs            — сделать лист и открыть
//   node tools/preview-sheet.mjs --молча    — сделать и не открывать

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { readRounds, slots } from "./read-rounds.mjs";
import { findFfmpeg } from "./media.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const PUBLIC = path.join(QUIZ, "public");
// Путь к ffmpeg у каждой системы свой — спрашиваем общий поиск.
const FFMPEG = findFfmpeg();
const OUT = path.join(QUIZ, "..", "превью картинок.png");

const CELL = 330;
const CAPTION = 54;
const GAP = 10;
const COLS = 4;

const escape = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const caption = async (item) => {
  const kind = item.image.toLowerCase().endsWith(".mp4") ? "видео" : "фото";
  const text = escape(item.label).slice(0, 22);
  const svg = `<svg width="${CELL}" height="${CAPTION}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${CELL}" height="${CAPTION}" fill="#1B1310"/>
    <text x="14" y="34" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="#E8B65F">${item.n}</text>
    <text x="52" y="34" font-family="Arial, sans-serif" font-size="22" fill="#F7EFE4">${text}</text>
    <text x="${CELL - 14}" y="34" text-anchor="end" font-family="Arial, sans-serif" font-size="17" fill="#8a7a6a">${kind}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
};

const picture = async (item, tmp) => {
  const file = path.join(PUBLIC, item.image);
  if (!item.image || !fs.existsSync(file)) return null;

  if (item.image.toLowerCase().endsWith(".mp4")) {
    if (!FFMPEG) return null; // без ffmpeg кадр из клипа не вынуть
    const frame = path.join(tmp, `${item.n}.png`);
    spawnSync(FFMPEG, ["-y", "-ss", "2", "-i", file, "-frames:v", "1", frame], { stdio: "pipe" });
    if (!fs.existsSync(frame)) return null;
    // sharp не открывает пути с кириллицей — читаем сами и отдаём буфером
    return sharp(fs.readFileSync(frame)).resize(CELL, CELL, { fit: "cover" }).toBuffer();
  }

  return sharp(fs.readFileSync(file)).resize(CELL, CELL, { fit: "cover" }).toBuffer();
};

const rounds = readRounds();
const items = slots(rounds);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheet-"));

const rows = Math.ceil(items.length / COLS);
const W = COLS * CELL + (COLS + 1) * GAP;
const H = rows * (CELL + CAPTION) + (rows + 1) * GAP;

const layers = [];
for (const item of items) {
  const col = (item.n - 1) % COLS;
  const row = Math.floor((item.n - 1) / COLS);
  const left = GAP + col * (CELL + GAP);
  const top = GAP + row * (CELL + CAPTION + GAP);

  const pic = await picture(item, tmp);
  if (pic) {
    layers.push({ input: pic, left, top });
  } else {
    const empty = await sharp({
      create: { width: CELL, height: CELL, channels: 3, background: "#3a2a22" },
    })
      .png()
      .toBuffer();
    layers.push({ input: empty, left, top });
  }
  layers.push({ input: await caption(item), left, top: top + CELL });
}

const png = await sharp({
  create: { width: W, height: H, channels: 3, background: "#0f0b09" },
})
  .composite(layers)
  .png()
  .toBuffer();

// Картинку могли не закрыть в просмотрщике — тогда файл занят,
// и перезаписать его Windows не даёт. Пишем рядом, под соседним именем.
const save = (buf) => {
  const names = [OUT, OUT.replace(".png", " 2.png"), OUT.replace(".png", " 3.png")];
  for (const name of names) {
    try {
      fs.writeFileSync(name, buf);
      return name;
    } catch {
      /* занят — пробуем следующее имя */
    }
  }
  return null;
};

const saved = save(png);
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* Windows иногда держит файл — не страшно */
}
if (!saved) {
  console.log("");
  console.log("Не смогла обновить лист с картинками: файл занят.");
  console.log("Закрой картинку «превью картинок» и нажми кнопку ещё раз.");
  console.log("");
} else {
  console.log("");
  console.log(`Лист с картинками: ${path.basename(saved)}`);
  console.log("Номер под картинкой — им же называешь место, которое хочешь заменить.");
  console.log("");
  if (!process.argv.includes("--молча")) {
    spawnSync("cmd", ["/c", "start", "", saved], { stdio: "ignore" });
  }
}
