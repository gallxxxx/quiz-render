// Плашка с названием вместо картинки, которой не нашлось.
//
// Без неё сборка ролика падает целиком: Remotion ищет файл, которого нет,
// и весь выпуск пропадает из-за одного неудачного слова.
//
// Главное здесь — ИМЯ ФАЙЛА. Оно нарочно не такое, каким назвал бы файл
// поиск картинок: иначе следующий поиск увидит «pizza.jpg», решит, что
// картинка уже скачана, и не станет искать настоящую.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makePlaceholder } from "./placeholder.mjs";
import { slug } from "./media.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");

const PREFIX = "zaglushka-";

// Стереть все плашки. Зовётся перед поиском: то, что найдётся,
// плашку заменит, а что не найдётся — получит её заново.
export const clearGaps = () => {
  let n = 0;
  try {
    for (const name of fs.readdirSync(PUBLIC)) {
      if (name.startsWith(PREFIX)) {
        try {
          fs.rmSync(path.join(PUBLIC, name), { force: true });
          n++;
        } catch {
          /* антивирус держит файл — не повод падать */
        }
      }
    }
  } catch {
    /* папки ещё нет */
  }
  return n;
};

// Закрыть дыры плашками. Возвращает список подписей, которым не хватило картинки.
export const fillGaps = async (rounds) => {
  const made = [];
  for (const r of rounds) {
    for (const side of ["top", "bottom"]) {
      const s = r[side];
      if (!s) continue;
      const have = s.image && fs.existsSync(path.join(PUBLIC, s.image));
      if (have) continue;

      const file = `${PREFIX}${slug(s.label) || "quiz"}.jpg`;
      await makePlaceholder(s.label, file, s.color);
      s.image = file;
      made.push(s.label);
    }
  }
  return made;
};
