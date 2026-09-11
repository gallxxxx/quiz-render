// Приводит в порядок фото, которые положили в public/ руками:
// режет по центру под кадр ролика (широкий, 16:9) и сжимает.
// Запуск: npm run fixphotos
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { PHOTO_W, PHOTO_H } from "./media.mjs";

const PUBLIC = path.join(process.cwd(), "public");
const OK = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"];

const files = fs
  .readdirSync(PUBLIC, { withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => d.name)
  .filter((n) => OK.includes(path.extname(n).toLowerCase()));

if (files.length === 0) {
  console.log("В папке public/ нет фото для обработки.");
  console.log("Положи туда файлы и запусти снова.");
  process.exit(0);
}

let done = 0;

for (const name of files) {
  const full = path.join(PUBLIC, name);
  const base = path.basename(name, path.extname(name));
  const target = path.join(PUBLIC, `${base}.jpg`);

  try {
    // ВАЖНО: sharp не открывает файлы по путям с русскими буквами —
    // читаем файл сами и отдаём ему содержимое.
    const input = fs.readFileSync(full);

    const meta = await sharp(input).metadata();
    const already =
      meta.width === 1000 && meta.height === 1000 && path.extname(name).toLowerCase() === ".jpg";
    if (already) {
      console.log(`${name} — уже готово`);
      continue;
    }

    const buf = await sharp(input)
      .rotate() // учесть поворот из EXIF, иначе фото с телефона ложится набок
      .resize(PHOTO_W, PHOTO_H, { fit: "cover" })
      .jpeg({ quality: 82 })
      .toBuffer();

    fs.writeFileSync(target, buf);
    if (full !== target) fs.unlinkSync(full);

    const kb = Math.round(buf.length / 1024);
    console.log(`${name} → ${base}.jpg (1000×1000, ${kb} КБ)`);
    done++;
  } catch (e) {
    console.log(`${name} — не получилось: ${e.message}`);
  }
}

console.log(`\nГотово: обработано ${done}.`);
console.log("Теперь в студии в поле image пиши имя файла, например: my-photo.jpg");
