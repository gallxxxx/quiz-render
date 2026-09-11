// Хранилище клипов.
//
// Зачем: Remotion при каждом рендере копирует ВСЮ папку public во временную.
// Когда там накопилось 225 клипов на 583 МБ, каждая сборка тащила эти
// полгигабайта заново — медленно и ненадёжно.
//
// Поэтому клипы живут в «архиве клипов», а в public лежат только те
// восемнадцать, что нужны текущему выпуску.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const PUBLIC = path.join(QUIZ, "public");
export const ARCHIVE = path.join(QUIZ, "архив клипов");

const MEDIA = /\.(mp4|jpg|jpeg|png)$/i;

export const slug = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const move = (from, to) => {
  try {
    fs.renameSync(from, to);
    return true;
  } catch {
    // Разные диски или файл занят антивирусом — копируем и пробуем убрать.
    try {
      fs.copyFileSync(from, to);
      try {
        fs.rmSync(from, { force: true });
      } catch {
        /* останется дубль — не беда */
      }
      return true;
    } catch {
      return false;
    }
  }
};

// Всё лишнее из public — в архив.
export const stashAll = () => {
  fs.mkdirSync(ARCHIVE, { recursive: true });
  let moved = 0;
  for (const name of fs.readdirSync(PUBLIC)) {
    if (!MEDIA.test(name)) continue; // звуки, шрифты, озвучка остаются
    const from = path.join(PUBLIC, name);
    if (!fs.statSync(from).isFile()) continue;
    const to = path.join(ARCHIVE, name);
    if (fs.existsSync(to)) {
      // В архиве уже лежит файл с таким именем. Побеждает НОВЫЙ:
      // если клип только что перекачали взамен неудачного, старый
      // из архива затёр бы всю работу.
      try {
        fs.rmSync(to, { force: true });
      } catch {
        /* занят — тогда просто оставим что было */
        continue;
      }
    }
    if (move(from, to)) moved += 1;
  }
  return moved;
};

// Вернуть в public то, что нужно этому выпуску: тогда скрипт поиска
// увидит уже скачанное и не пойдёт тратить запросы к Pexels.
export const restoreFor = (names) => {
  fs.mkdirSync(ARCHIVE, { recursive: true });
  const wanted = new Set(names.map(slug));
  let back = 0;
  for (const name of fs.readdirSync(ARCHIVE)) {
    if (!MEDIA.test(name)) continue;
    const base = name.replace(MEDIA, "");
    if (!wanted.has(base)) continue;
    const to = path.join(PUBLIC, name);
    if (fs.existsSync(to)) continue;
    if (move(path.join(ARCHIVE, name), to)) back += 1;
  }
  return back;
};

// То же самое, но по именам файлов из данных выпуска, а не по подписям.
// Нужно там, где подпись и имя файла разошлись: у NIGHT CITIES в кадре
// «Tokyo», а клип лежит как `tokyo-at-night.mp4`, и поиск по подписи
// вернул бы чужой `tokyo.mp4` из другого выпуска — или ничего.
export const restoreFiles = (files) => {
  fs.mkdirSync(ARCHIVE, { recursive: true });
  let back = 0;
  for (const name of new Set(files.filter(Boolean))) {
    const to = path.join(PUBLIC, name);
    if (fs.existsSync(to)) continue;
    const from = path.join(ARCHIVE, name);
    if (!fs.existsSync(from)) continue;
    if (move(from, to)) back += 1;
  }
  return back;
};

export const publicSizeMb = () => {
  let bytes = 0;
  for (const name of fs.readdirSync(PUBLIC)) {
    if (!MEDIA.test(name)) continue;
    try {
      bytes += fs.statSync(path.join(PUBLIC, name)).size;
    } catch {
      /* исчез — не важно */
    }
  }
  return Math.round(bytes / 1024 / 1024);
};
