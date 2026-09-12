// Забрать выпуск, собранный на сайте.
//
// Сайт отдаёт один файл — «выпуск-....quiz». Это обычный текстовый файл,
// внутри вопросы, настройки и, если клала свои, сами фотографии.
//
// Кладёшь файл в папку «Выпуски с сайта» рядом с кнопками и жмёшь кнопку.
// Скрипт берёт самый свежий файл, раскладывает всё по местам и говорит,
// что делать дальше.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { slug, safeFetch, prepareClip, PHOTO_W, PHOTO_H } from "./media.mjs";
import { readRounds, writeToRoot } from "./read-rounds.mjs";
import { writeMode, writeShot, writeVoiceName, writeVoiceOn } from "./media-mode.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const PUBLIC = path.join(QUIZ, "public");
const HOME = path.join(QUIZ, "..");
const INBOX = path.join(HOME, "Выпуски с сайта");

fs.mkdirSync(INBOX, { recursive: true });

// Файл можно просто скачать телефоном и переслать себе — поэтому ищем
// и в папке рядом с кнопками, и в «Загрузках» Windows.
const candidates = () => {
  const list = [];
  const look = (dir) => {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.toLowerCase().endsWith(".quiz")) continue;
        const file = path.join(dir, name);
        list.push({ file, time: fs.statSync(file).mtimeMs });
      }
    } catch {
      /* папки нет — не страшно */
    }
  };
  look(INBOX);
  const downloads = path.join(os_homedir(), "Downloads");
  look(downloads);
  return list.sort((a, b) => b.time - a.time);
};

function os_homedir() {
  return process.env.USERPROFILE || process.env.HOME || ".";
}

const chosen = process.argv[2] ? [{ file: process.argv[2], time: 0 }] : candidates();

if (!chosen.length) {
  console.log("");
  console.log("НЕ НАШЛА НИ ОДНОГО ВЫПУСКА.");
  console.log("");
  console.log("Скачай выпуск на сайте — получится файл с окончанием .quiz —");
  console.log("и положи его в папку:");
  console.log("   " + INBOX);
  console.log("");
  console.log("Она сейчас откроется.");
  console.log("");
  process.exit(0);
}

const file = chosen[0].file;
console.log("");
console.log("Беру выпуск: " + path.basename(file));

let data = null;
try {
  data = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  console.log("");
  console.log("Файл не читается: " + e.message);
  console.log("Скорее всего он скачался не до конца — скачай ещё раз.");
  process.exit(1);
}

if (data.формат && data.формат !== "this-or-that") {
  console.log("");
  console.log("Это выпуск другой викторины: " + data.формат);
  console.log("Эта папка собирает только «это или то».");
  process.exit(1);
}

// ——— вопросы ———
const old = readRounds();
const вопросы = Array.isArray(data.вопросы) ? data.вопросы : [];
if (!вопросы.length) {
  console.log("В файле нет ни одного вопроса.");
  process.exit(1);
}

// Страну берём только из самого выпуска. Раньше она доставалась
// от прошлого раунда по наследству — и в кадре оказывались «Суши ·
// Германия» и «Такос · Англия». Плашка страны это единственный текст
// в ролике, который может быть прямой неправдой, поэтому пустая
// строка лучше чужой страны: пустую ролик просто не рисует.
const rounds = вопросы.map((q, i) => {
  const was = old[i] ?? old[old.length - 1];
  const страна = (кто) => String(q.страны?.[кто] ?? "").trim();
  return {
    ...was,
    top: { ...was.top, label: String(q.сверху ?? ""), image: "", country: страна("сверху") },
    bottom: { ...was.bottom, label: String(q.снизу ?? ""), image: "", country: страна("снизу") },
    topPercent: Math.max(20, Math.min(80, Number(q.процент) || 50)),
  };
});

// ——— свои файлы из выпуска ———
// Человек мог приложить и фотографию, и снятое видео. Что именно —
// понимаем по имени файла: телефон отдаёт .mov или .mp4.
const этоВидео = (имя) => /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(String(имя ?? ""));

let saved = 0;
for (let i = 0; i < вопросы.length; i += 1) {
  for (const side of ["сверху", "снизу"]) {
    const свой = вопросы[i].фото?.[side];
    if (!свой?.данные) continue;
    const where = side === "сверху" ? "top" : "bottom";
    const name = slug(rounds[i][where].label) || "photo-" + (i + 1);
    try {
      const raw = Buffer.from(String(свой.данные), "base64");

      if (этоВидео(свой.имя)) {
        // Своё видео готовим тем же способом, что и сток: обрезаем до
        // длины раунда, убираем звук, ужимаем под кадр. Телефонные HEVC
        // и .mov ffmpeg внутри Remotion понимает — проверено.
        const tmp = path.join(PUBLIC, `_своё-${i}-${where}.mp4`);
        fs.writeFileSync(tmp, raw);
        prepareClip(tmp, path.join(PUBLIC, name + ".mp4"));
        try {
          fs.rmSync(tmp, { force: true });
        } catch {
          /* Windows уберёт сам */
        }
        rounds[i][where].image = name + ".mp4";
      } else {
        const кадр = await sharp(raw).rotate().resize(PHOTO_W, PHOTO_H, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
        fs.writeFileSync(path.join(PUBLIC, name + ".jpg"), кадр);
        rounds[i][where].image = name + ".jpg";
      }
      saved += 1;
    } catch (e) {
      console.log(`   свой файл для «${rounds[i][where].label}» не пригодился: ${e.message}`);
    }
  }
}

// ——— картинки, одобренные на сайте ———
// Страница показала варианты, человек выбрал и запомнила ссылку. Качаем
// ровно то, что одобрено: искать заново нельзя — приедет другое, и весь
// смысл проверки пропадёт. Не скачалось — молчим и оставляем место
// пустым, его закроет обычный подбор.
const creditLine = (file, line) => {
  try {
    fs.appendFileSync(path.join(PUBLIC, file), line + "\n", "utf8");
  } catch {
    /* без списка источников ролик всё равно соберётся */
  }
};

// Качаем ПАРАЛЛЕЛЬНО. По одному это занимало 82 секунды на восемнадцать
// клипов: почти всё время файл просто ехал по сети, а машина ждала.
// Имя временного файла теперь своё у каждого — иначе соседи затирали бы
// друг друга.
const дела = [];
for (let i = 0; i < вопросы.length; i += 1) {
  for (const side of ["сверху", "снизу"]) {
    const where = side === "сверху" ? "top" : "bottom";
    if (rounds[i][where].image) continue; // своё фото уже легло — оно главнее
    const выбор = вопросы[i].картинки?.[side];
    if (!выбор?.ссылка) continue;
    дела.push({ i, where, выбор });
  }
}

// Сколько тянем разом. Больше шести смысла нет: сток начинает придерживать,
// а готовит клипы всё равно ffmpeg по очереди.
const РАЗОМ = 6;
let взято = 0;

const заняться = async ({ i, where, выбор }) => {
  const label = rounds[i][where].label;
  const name = slug(label) || `media-${i + 1}-${where}`;
  const клип = String(выбор.вид ?? "") === "клип";
  try {
    const res = await safeFetch(String(выбор.ссылка));
    if (!res || !res.ok) throw new Error("не отдалось");
    const raw = Buffer.from(await res.arrayBuffer());
    if (!raw.length) throw new Error("пустой файл");

    if (клип) {
      const tmp = path.join(PUBLIC, `_скачано-${i}-${where}.mp4`);
      fs.writeFileSync(tmp, raw);
      prepareClip(tmp, path.join(PUBLIC, name + ".mp4"));
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* Windows уберёт сам */
      }
      rounds[i][where].image = name + ".mp4";
      creditLine("video-credits.txt", `${name}.mp4 — ${выбор.источник ?? "сток"}, автор ${выбор.автор ?? "неизвестен"} — ${выбор.страница ?? выбор.ссылка}`);
    } else {
      const кадр = await sharp(raw).rotate().resize(PHOTO_W, PHOTO_H, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
      fs.writeFileSync(path.join(PUBLIC, name + ".jpg"), кадр);
      rounds[i][where].image = name + ".jpg";
      creditLine("photo-credits.txt", `${name}.jpg — «${label}», автор ${выбор.автор ?? "неизвестен"} — ${выбор.страница ?? выбор.ссылка}`);
    }
    взято += 1;
  } catch (e) {
    console.log(`   картинку для «${label}» взять не вышло (${e.message}) — подберётся на месте`);
  }
};

for (let край = 0; край < дела.length; край += РАЗОМ) {
  await Promise.all(дела.slice(край, край + РАЗОМ).map(заняться));
}

writeToRoot({
  // «выключена» — заставки в ролике не будет вовсе, он начнётся сразу
  // с первого выбора. Фраза и тема при этом всё равно нужны: по ним
  // ищутся картинки и строится озвучка.
  intro: data.заставка
    ? {
        hook: String(data.заставка.фраза ?? ""),
        edition: String(data.заставка.тема ?? ""),
        off: Boolean(data.заставка.выключена),
        // ОБЯЗАТЕЛЬНО пишем явно, даже пустым. Данные сливаются с прежними,
        // поэтому нарисованная заставка прошлого выпуска оставалась жить:
        // у всех роликов с сайта на заставке висела табличка с машинами
        // от SUPERCARS. Пусто — заставка рисуется двумя цветными
        // половинами, как задумано.
        cover: String(data.заставка.обложка ?? ""),
      }
    : undefined,
  outro: data.концовка
    ? {
        title: String(data.концовка.заголовок ?? ""),
        subtitle: String(data.концовка.подпись ?? ""),
        cta: String(data.концовка.призыв ?? ""),
      }
    : undefined,
  rounds,
});

// ——— настройки ———
const н = data.настройки ?? {};
if (н.картинки) writeMode(String(н.картинки));
if (н.план) writeShot(String(н.план));
if (typeof н.озвучка === "boolean") writeVoiceOn(н.озвучка);
if (н.голос) writeVoiceName(String(н.голос));

console.log("");
console.log(`Вопросов принято: ${rounds.length}.`);
rounds.forEach((r, i) => console.log(`   ${i + 1}. ${r.top.label} / ${r.bottom.label}`));
if (saved) console.log(`Своих файлов принято: ${saved}.`);
if (взято) console.log(`Одобренных картинок скачано: ${взято}.`);

// Сколько мест осталось пустыми — по этому числу сборочная машина решает,
// звать ли обычный подбор. Дома это просто строчка для человека.
const пусто = rounds.filter((r) => !r.top.image || !r.bottom.image).length;
if (пусто) console.log(`Без картинки пока вопросов: ${пусто}.`);
console.log("");
console.log("Дальше:");
console.log("   кнопка «ВСТАВИТЬ МЕДИАФАЙЛЫ» — подберёт всё, чего нет");
console.log("   кнопка «СОБРАТЬ РОЛИК» — озвучит и соберёт");
console.log("");
