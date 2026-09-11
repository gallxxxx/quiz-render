// Забирает фото из папки «Мои фото», приводит их в порядок и кладёт в проект.
// Если имя файла совпадает с подписью раунда — картинка встаёт на место сама.
//
// Запуск: npm run myphotos
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { prepareClip, slug, PHOTO_W, PHOTO_H } from "./media.mjs";
import { readRounds, writeRoundsToRoot } from "./read-rounds.mjs";

const DROP = path.join(process.cwd(), "..", "Мои фото");
const PUBLIC = path.join(process.cwd(), "public");
const PHOTO = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".avif"];
const VIDEO = [".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"];
const OK = [...PHOTO, ...VIDEO];

fs.mkdirSync(DROP, { recursive: true });

const files = fs
  .readdirSync(DROP, { withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => d.name)
  .filter((n) => OK.includes(path.extname(n).toLowerCase()));

if (files.length === 0) {
  console.log("В папке «Мои фото» пусто.");
  console.log("");
  console.log(`Положи туда фото и запусти снова.`);
  console.log(`Папка: ${path.resolve(DROP)}`);
  process.exit(0);
}

let rounds = null;
try {
  rounds = readRounds();
} catch {
  console.log("Раунды прочитать не удалось — фото просто скопирую, подставишь вручную.");
}

// подпись раунда -> куда её вписать
const byLabel = new Map();
if (rounds) {
  rounds.forEach((r, i) => {
    byLabel.set(slug(r.top.label), { round: i, side: "top", label: r.top.label });
    byLabel.set(slug(r.bottom.label), { round: i, side: "bottom", label: r.bottom.label });
  });
}

const placed = [];
const copied = [];
const broken = [];

for (const name of files) {
  const base = path.basename(name, path.extname(name));
  const key = slug(base);
  const isVideo = VIDEO.includes(path.extname(name).toLowerCase());
  const target = isVideo ? `${key}.mp4` : `${key}.jpg`;

  try {
    if (isVideo) {
      process.stdout.write(`${name} — готовлю клип... `);
      prepareClip(path.join(DROP, name), path.join(PUBLIC, target));
      console.log("готово");
    } else {
      // sharp не открывает файлы по путям с русскими буквами — читаем сами
      const input = fs.readFileSync(path.join(DROP, name));
      const buf = await sharp(input)
        .rotate() // фото с телефона иногда лежат набок — разворачиваем
        .resize(PHOTO_W, PHOTO_H, { fit: "cover" })
        .jpeg({ quality: 82 })
        .toBuffer();

      fs.writeFileSync(path.join(PUBLIC, target), buf);
    }

    const spot = byLabel.get(key);
    if (spot && rounds) {
      rounds[spot.round][spot.side].image = target;
      placed.push(`${name}  →  раунд ${spot.round + 1}, ${spot.side === "top" ? "верх" : "низ"} («${spot.label}»)`);
    } else {
      copied.push(`${name}  →  ${target}`);
    }
  } catch (e) {
    broken.push(`${name} — не получилось прочитать (${e.message})`);
  }
}

console.log("");

if (placed.length) {
  console.log("ВСТАЛИ НА МЕСТО САМИ:");
  placed.forEach((l) => console.log("  " + l));
  console.log("");
}

if (copied.length) {
  console.log("СКОПИРОВАНЫ, ВПИШИ ИМЯ В СТУДИИ (поле image):");
  copied.forEach((l) => console.log("  " + l));
  console.log("");
  console.log("  Подсказка: назови файл так же, как подпись раунда");
  console.log("  (например «Big Ben.jpg») — и в следующий раз он встанет сам.");
  console.log("");
}

if (broken.length) {
  console.log("НЕ ПОЛУЧИЛОСЬ:");
  broken.forEach((l) => console.log("  " + l));
  console.log("");
}

if (rounds && placed.length) {
  try {
    const written = writeRoundsToRoot(rounds);
    console.log(
      written
        ? "Раунды обновлены — открой студию и посмотри."
        : "Подставить не смог: нажми Save в студии и запусти снова.",
    );
  } catch (e) {
    console.log(`Подставить не вышло: ${e.message}`);
  }
  console.log("");
}

console.log(`Обработано файлов: ${files.length - broken.length} из ${files.length}`);
console.log("Оригиналы остались в папке «Мои фото» — можешь их удалить или оставить.");
console.log("");
