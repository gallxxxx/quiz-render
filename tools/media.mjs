// Общие инструменты для работы с картинками и видео.
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

export const UA = "thisorthat-quiz/1.0 (personal project)";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Русские названия переводим в латиницу: имена файлов внутри проекта
// должны быть простыми, иначе бывают проблемы с кодировкой.
const RU = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .split("")
    .map((ch) => (ch in RU ? RU[ch] : ch))
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// ——— Сеть: никогда не бросает ошибку, максимум возвращает null ———
export const safeFetch = async (url, { timeout = 25000, retries = 2, headers = {} } = {}) => {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, ...headers },
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      });
      if (res.status === 429) {
        last = res; // «слишком часто просишь»
        await sleep(4000 * (attempt + 1));
        continue;
      }
      return res;
    } catch {
      await sleep(1500 * (attempt + 1));
    }
  }
  // Возвращаем последний ответ, а не пустоту: по нему видно, что упёрлись
  // в часовой лимит, а не просто не достучались.
  return last;
};

export const safeJson = async (url, opts) => {
  const res = await safeFetch(url, opts);
  if (!res || !res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
};

// ——— ffmpeg лежит внутри Remotion ———
// Зовём его напрямую, а НЕ через npx с shell:true — иначе путь
// с пробелами и русскими буквами разваливается на куски.
// Ищем от самого файла, а не только от текущей папки: на сборочной
// машине скрипты зовут из любого места, и там process.cwd() указывает
// не на quiz. Дома оба пути совпадают, поведение не меняется.
const QUIZ_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const findBinary = (exeNames) => {
  const packages = [
    "@remotion/compositor-win32-x64-msvc",
    "@remotion/compositor-darwin-x64",
    "@remotion/compositor-darwin-aarch64",
    "@remotion/compositor-linux-x64-gnu",
    "@remotion/compositor-linux-arm64-gnu",
  ];
  for (const root of [QUIZ_DIR, process.cwd()]) {
    for (const pkg of packages) {
      for (const exe of exeNames) {
        const p = path.join(root, "node_modules", pkg, exe);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
};

// Длительность звукового файла в секундах
export const audioDuration = (file) => {
  const probe = findBinary(["ffprobe.exe", "ffprobe"]);
  if (!probe) return null;
  try {
    const out = execFileSync(
      probe,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { stdio: ["ignore", "pipe", "ignore"] },
    ).toString().trim();
    const n = Number(out);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

export const findFfmpeg = () => findBinary(["ffmpeg.exe", "ffmpeg"]);

// Сколько секунд длится один раунд — под это подгоняем клипы.
export const CLIP_SECONDS = 8;

// Размер картинки под кадр. Была квадратная 1000×1000, стала широкая 16:9 —
// ровно так она теперь и лежит в ролике. Держим числа в одном месте: иначе
// при следующей смене раскладки половина файлов останется с прежним кропом,
// и часть картинок будет обрезана не так, как остальные.
export const PHOTO_W = 1280;
export const PHOTO_H = 720;

// Под какое окошко готовится КЛИП. Картинка в ролике занимает 960×540:
// горизонтальному хватает высоты 560, вертикальный должен быть не уже 980 —
// его обрежет по бокам.
const CLIP_W = 980;
const CLIP_H = 560;

// Готовит видеоклип: обрезает (или зацикливает) до нужной длины,
// убирает звук, ужимает. Обрезку в квадрат делает уже само видео при показе.
export const prepareClip = (from, to) => {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("не нашёл ffmpeg внутри Remotion");
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-stream_loop", "-1",          // если клип короче — повторить
      "-i", from,
      "-t", String(CLIP_SECONDS),    // и обрезать до нужной длины
      "-an",                         // звук не нужен, он свой в ролике
      // Масштабируем ровно под окошко в кадре. Раньше короткая сторона
      // приводилась к 1000 px: у горизонтального клипа выходило 1778×1000,
      // а показывается он в 960×540 — то есть на КАЖДОМ кадре ролика
      // разжималось втрое больше точек, чем нужно. Отсюда двенадцать минут
      // рендера на выпуск с клипами.
      "-vf", `scale=w=if(gt(a\\,1)\\,-2\\,${CLIP_W}):h=if(gt(a\\,1)\\,${CLIP_H}\\,-2)`,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-r", "30",
      "-preset", "veryfast",
      "-crf", "24",
      "-movflags", "+faststart",
      to,
    ],
    { stdio: "pipe" },
  );
};

// ——— Ключи от сервисов ———
// Лежат в обычных текстовых файлах рядом с кнопками: «ключ pexels.txt»,
// «ключ unsplash.txt», «ключ pixabay.txt». Ищем и рядом с quiz, и внутри —
// так папку можно унести целиком и ничего не переписывать.
export const readKey = (fileName) => {
  const places = [
    path.join(process.cwd(), "..", fileName),
    path.join(process.cwd(), fileName),
  ];
  for (const file of places) {
    if (!fs.existsSync(file)) continue;
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(String.fromCharCode(10))) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      // Ключ — это длинная строка без пробелов. Всё остальное в файле
      // объяснения для человека, их пропускаем.
      if (/^[A-Za-z0-9_-]{15,}$/.test(s)) return s;
    }
  }
  return null;
};

// ——— Ключ Pexels ———
// Лежит в обычном текстовом файле рядом с кнопками, чтобы не возиться
// с переменными окружения.
export const readPexelsKey = () => {
  if (process.env.PEXELS_API_KEY) return process.env.PEXELS_API_KEY.trim();

  const file = path.join(process.cwd(), "..", "ключ pexels.txt");
  if (!fs.existsSync(file)) return null;

  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    if (/^[A-Za-z0-9]{20,}$/.test(s)) return s; // похоже на ключ
  }
  return null;
};
