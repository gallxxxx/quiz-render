// Заглушка для места, которому не нашлось ни клипа, ни фото.
//
// Без неё ролик падает целиком: Remotion ищет файл, которого нет,
// и весь выпуск пропадает из-за одного неудачного слова.
// Лучше однотонная плашка с названием, чем ничего.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");

const escape = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export const makePlaceholder = async (label, file, color = "#C1613C") => {
  const size = 1000;
  const text = escape(label).toUpperCase();
  // Длинное название не влезает — уменьшаем кегль по числу букв.
  const fontSize = text.length > 16 ? 70 : text.length > 11 ? 90 : 110;

  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="${color}"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
          font-family="Arial, Helvetica, sans-serif" font-weight="bold"
          font-size="${fontSize}" fill="#F7EFE4">${text}</text>
  </svg>`;

  const out = path.join(PUBLIC, file);
  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
  // sharp не открывает пути с кириллицей — пишем файл сами.
  fs.writeFileSync(out, buf);
  return out;
};

// Проверяет весь выпуск и закрывает дыры. Возвращает список подставленных.
export const fillMissing = async (rounds) => {
  const made = [];
  for (const r of rounds) {
    for (const side of ["top", "bottom"]) {
      const s = r[side];
      if (!s?.image) continue;
      if (fs.existsSync(path.join(PUBLIC, s.image))) continue;

      // Файла нет — значит поиск ничего не нашёл. Рисуем плашку.
      const jpg = s.image.replace(/\.(mp4|png|jpeg)$/i, ".jpg");
      await makePlaceholder(s.label, jpg, s.color);
      s.image = jpg;
      made.push(s.label);
    }
  }
  return made;
};
