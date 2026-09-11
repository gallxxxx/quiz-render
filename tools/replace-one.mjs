// Заменить картинку в одном месте, без вопросов и без человека.
// Этим пользуется пульт для телефона.
//
//   node tools/replace-one.mjs 7

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { slug } from "./media.mjs";
import { readMode } from "./media-mode.mjs";
import { readRounds, slots, writeRoundsToRoot } from "./read-rounds.mjs";
import { fillGaps } from "./gaps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const PUBLIC = path.join(QUIZ, "public");

const n = Number(process.argv[2]);
const rounds = readRounds();
const list = slots(rounds);
const item = list[n - 1];

if (!item) {
  console.log("Нет такого места:", process.argv[2]);
  process.exit(1);
}

const mode = readMode();
console.log(`Ищу другую картинку для «${item.label}»...`);

const run = (script, args) =>
  spawnSync(process.execPath, [path.join(HERE, script), ...args], { cwd: QUIZ, stdio: "inherit" })
    .status ?? 1;

if (mode === "видео") {
  run("get-videos.mjs", ["--force", item.label]);
} else {
  run("get-photos.mjs", ["--force", "--replace", "--pexels", item.label]);
}

// Файл называется по подписи — ставим его на место сами.
const name = slug(item.label);
const prefer = mode === "видео" ? [name + ".mp4", name + ".jpg"] : [name + ".jpg", name + ".mp4"];
for (const file of prefer) {
  if (fs.existsSync(path.join(PUBLIC, file))) {
    rounds[item.round][item.side].image = file;
    break;
  }
}

const made = await fillGaps(rounds);
writeRoundsToRoot(rounds);
if (made.length) console.log("Ничего не нашлось, поставила плашку с названием.");
console.log("Готово:", rounds[item.round][item.side].image);
