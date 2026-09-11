// Подбирает ВИДЕОКЛИПЫ под каждую подпись раунда и сам подставляет их в проект.
//
// Источник — Pexels (pexels.com). Лицензия разрешает коммерческое
// использование и не требует указывать автора.
//
// Нужен бесплатный ключ. Получить: pexels.com/api → Get Started →
// скопировать ключ и вставить в файл «ключ pexels.txt» рядом с кнопками.
//
// Запуск:
//   npm run videos                     — по подписям из твоих раундов
//   npm run videos -- --force          — перекачать всё заново
//   npm run videos -- "Big Ben"        — по своим словам (без подстановки)
import fs from "fs";
import path from "path";
import sharp from "sharp";
import os from "os";
import { CLIP_SECONDS, prepareClip, readPexelsKey, safeFetch, sleep, slug, PHOTO_W, PHOTO_H } from "./media.mjs";
import { readRounds, writeRoundsToRoot } from "./read-rounds.mjs";

const PUBLIC = path.join(process.cwd(), "public");
const KEY = readPexelsKey();

if (!KEY) {
  console.log("");
  console.log("НЕТ КЛЮЧА PEXELS.");
  console.log("");
  console.log("Что сделать (один раз, бесплатно, 2 минуты):");
  console.log("  1. открыть pexels.com/api");
  console.log("  2. зарегистрироваться и нажать Get Started");
  console.log("  3. скопировать выданный ключ");
  console.log("  4. вставить его в файл «ключ pexels.txt» рядом с кнопками");
  console.log("");
  console.log("После этого запусти кнопку снова.");
  console.log("");
  process.exit(0);
}

// Если Pexels откажет из-за ключа — сразу останавливаемся и говорим об этом,
// а не молчим про «ничего не нашлось» восемнадцать раз подряд.
// Общий план вместо крупного: для машины, горы или животного «close up»
// приносит эмблему на капоте и шерсть вместо самого предмета.
const WIDE = process.argv.includes("--wide");

let authFailed = false;
// Часовой лимит Pexels (200 запросов). Упёрлись — дальше просить бесполезно.
let rateLimited = false;

const keyHelp = () => {
  console.log("");
  console.log("КЛЮЧ НЕ ПОДОШЁЛ — Pexels отказался отвечать.");
  console.log("");
  console.log("Открой файл «ключ pexels.txt» и проверь:");
  console.log("  • ключ скопирован целиком, без пробелов и кавычек");
  console.log("  • он стоит отдельной строкой, не после решётки");
  console.log("  • взят на pexels.com/api → Get Started");
  console.log("");
};

const ask = async (params) => {
  const res = await safeFetch(
    "https://api.pexels.com/videos/search?" + new URLSearchParams(params),
    { headers: { Authorization: KEY }, retries: 1 },
  );
  if (!res) return null;
  if (res.status === 429) {
    rateLimited = true;
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    authFailed = true;
    return null;
  }
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
};

// ——— Поиск клипа ———
// Сначала просим горизонтальные: картинка в кадре широкая, 16:9, и при
// обрезке из них теряется меньше всего. Раньше первыми шли вертикальные —
// это было верно, пока картинка была квадратной.
const search = async (query) => {
  const attempts = WIDE
    ? [
        { query, per_page: "12", orientation: "landscape", size: "medium" },
        { query, per_page: "12", orientation: "square" },
        { query, per_page: "12" },
      ]
    : [
        // «close up» первым: у стока это снятый крупно предмет, а не общий
        // план, где еда лежит где-то в углу кадра.
        { query: `${query} close up`, per_page: "12", orientation: "landscape" },
        { query, per_page: "12", orientation: "landscape", size: "medium" },
        { query, per_page: "12", orientation: "square" },
        { query, per_page: "12" },
      ];

  // Собираем варианты из ВСЕХ запросов, а не останавливаемся на первом удачном:
  // подходящих по ориентации клипов у места может быть один-два, а всего —
  // десяток, и лишнее всё равно обрежется.
  const found = new Map();
  for (const params of attempts) {
    // Каждый запрос — это доля часового лимита. Набрали достаточно
    // подходящих клипов — дальше не спрашиваем.
    const enough = [...found.values()].filter(
      (v) => relevance(query, v.url ?? "") > 0,
    ).length;
    if (enough >= 3) break;

    const json = await ask(params);
    if (authFailed || rateLimited) return [];
    for (const v of json?.videos ?? []) {
      if (!found.has(v.id)) found.set(v.id, v);
    }
  }
  return [...found.values()];
};

// Из всех вариантов файла выбираем разумный: короткая сторона от 1000 px,
// но без гигантских 4K — они качаются вечно и всё равно ужмутся.
const pickFile = (video) => {
  const files = (video.video_files ?? [])
    .filter((f) => f.file_type === "video/mp4" && f.width && f.height)
    .map((f) => ({ ...f, short: Math.min(f.width, f.height) }))
    .sort((a, b) => a.short - b.short);

  return files.find((f) => f.short >= 1000) ?? files[files.length - 1] ?? null;
};

const force = process.argv.includes("--force");
// Флаги вроде --force и --wide — это настройки, а не названия мест.
const words = process.argv.slice(2).filter((w) => w && !w.startsWith("--"));

let rounds = null;
if (!words.length) {
  try {
    rounds = readRounds();
  } catch (e) {
    console.log(`Не смог прочитать раунды: ${e.message}`);
    process.exit(1);
  }
}

// --as <имя>: искать по одному запросу, а файл назвать по-другому.
// Нужно, когда подпись в кадре короткая («Watermelon»), а искать надо
// точнее («watermelon slice»), иначе Pexels приносит жёлтые дыни.
const asIndex = process.argv.indexOf("--as");
const asName = asIndex !== -1 ? process.argv[asIndex + 1] : null;
const searchWords = asName ? words.filter((w) => w !== asName) : words;

const targets = searchWords.length
  ? searchWords.map((w) => ({ query: w, name: asName ? slug(asName) : slug(w) }))
  : rounds.flatMap((r, i) => [
      { query: r.top.label, name: slug(r.top.label), round: i, side: "top" },
      { query: r.bottom.label, name: slug(r.bottom.label), round: i, side: "bottom" },
    ]);

// Слова, которые ничего не говорят о месте
const STOP = new Set(["mount","the","and","of","city","museum","house","tower","falls","canyon","bay"]);

// Сколько значимых слов из подписи встретилось в адресе клипа на Pexels
function relevance(query, url) {
  const slug = url.toLowerCase();
  const words = query.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !STOP.has(w));
  const base = words.length
    ? words.filter((w) => slug.includes(w)).length
    : 1; // подпись из одних общих слов — не привередничаем
  if (base === 0) return 0; // не по теме — никакие бонусы не спасают

  // Надбавка за крупный план — только там, где предмет мелкий.
  // Для машины крупный план означает эмблему, а не машину, поэтому
  // в режиме общего плана такие клипы наоборот отодвигаем.
  const isCloseUp = /close-?up|macro|detail/.test(slug);
  if (!isCloseUp) return base;
  return WIDE ? base - 0.5 : base + 0.5;
}

// Что уже было скачано раньше: имя файла -> ссылка на клип.
// Нужно, чтобы при повторной попытке взять ДРУГОЙ клип, а не тот же самый.
const previous = new Map();
try {
  const credits = fs.readFileSync(path.join(PUBLIC, "video-credits.txt"), "utf8");
  for (const line of credits.split(/\r?\n/)) {
    const m = line.match(/^(\S+\.mp4) .* — (https?:\/\/\S+)/);
    if (m) previous.set(m[1], m[2].trim());
  }
} catch {
  /* файла ещё нет — не страшно */
}

// ——— память: какие клипы уже показывали ———
// В video-credits.txt хранится только ПОСЛЕДНИЙ клип каждого места,
// поэтому перекачка ходила по кругу из двух вариантов. Здесь помним все.
const CLIP_MEMORY = path.join(PUBLIC, "_уже брали клипы.txt");
const NL_MEM = String.fromCharCode(10);

const usedClips = new Map();
try {
  for (const line of fs.readFileSync(CLIP_MEMORY, "utf8").split(NL_MEM)) {
    const at = line.indexOf("|");
    if (at === -1) continue;
    const name = line.slice(0, at).trim();
    const url = line.slice(at + 1).trim();
    if (!name || !url) continue;
    if (!usedClips.has(name)) usedClips.set(name, new Set());
    usedClips.get(name).add(url);
  }
} catch {
  /* памяти ещё нет */
}

const rememberClip = (name, url) => {
  if (!url) return;
  if (!usedClips.has(name)) usedClips.set(name, new Set());
  usedClips.get(name).add(url);
  try {
    fs.appendFileSync(CLIP_MEMORY, name + "|" + url + NL_MEM, "utf8");
  } catch {
    /* не записалось — в худшем случае повторится */
  }
};

const noClip = [];
const credits = [];
const failed = [];
let ok = 0;
let skipped = 0;

console.log("");

for (const t of targets) {
  process.stdout.write(`${t.query} ... `);

  try {
    const target = path.join(PUBLIC, `${t.name}.mp4`);
    if (!force && fs.existsSync(target)) {
      if (t.round !== undefined) rounds[t.round][t.side].image = `${t.name}.mp4`;
      console.log("клип уже есть, пропускаю");
      skipped++;
      continue;
    }

    const videos = await search(t.query);

    if (authFailed || rateLimited) {
      console.log("");
      break;
    }

    if (!videos.length) {
      console.log("ничего не нашлось");
      failed.push(t.query);
      continue;
    }

    // Оставляем только те клипы, где название места есть в описании.
    // Иначе Pexels подсовывает «просто похожую гору» вместо нужной.
    const wasUsed = previous.get(`${t.name}.mp4`);
    let scored = videos
      .map((v) => ({ v, score: relevance(t.query, v.url ?? "") }))
      .filter((x) => x.score > 0)
      .filter((x) => !(force && wasUsed && x.v.url === wasUsed)) // при перекачке — другой клип
      // и вообще всё, что для этого места уже показывали
      .filter((x) => !(force && usedClips.get(t.name)?.has(x.v.url)))
      .sort((a, b) => b.score - a.score);

    // Перекачиваем, а какой клип стоял — неизвестно (запись потерялась):
    // тогда просто берём следующий по списку, лишь бы не тот же самый.
    if (force && !wasUsed && scored.length > 1) scored = scored.slice(1);

    // Все варианты уже были — лучше вернуть проверенный клип, чем ничего.
    if (force && scored.length === 0) {
      console.log("новых клипов нет, беру из тех, что уже были... ");
      scored = videos
        .map((v) => ({ v, score: relevance(t.query, v.url ?? "") }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
    }

    if (!scored.length) {
      console.log("нет подходящего клипа");
      noClip.push(t);
      continue;
    }

    let saved = false;
    for (const { v: video } of scored.slice(0, 5)) {
      const file = pickFile(video);
      if (!file) continue;

      const res = await safeFetch(file.link, { timeout: 90000, retries: 1 });
      if (!res || !res.ok) continue;

      const raw = Buffer.from(await res.arrayBuffer());
      if (raw.length < 100000) continue;

      // ffmpeg не любит длинные временные пути — кладём во временную папку
      const tmp = path.join(os.tmpdir(), `quiz-${t.name}-${raw.length}-${process.pid}.mp4`);
      fs.writeFileSync(tmp, raw);

      try {
        prepareClip(tmp, target);
      } finally {
        // антивирус иногда держит файл занятым — это не повод падать
        try {
          fs.rmSync(tmp, { force: true });
        } catch {
          /* останется во временной папке, Windows уберёт сам */
        }
      }

      if (t.round !== undefined) rounds[t.round][t.side].image = `${t.name}.mp4`;

      rememberClip(t.name, video.url ?? "");
      credits.push(
        `${t.name}.mp4 — Pexels, автор ${video.user?.name ?? "неизвестен"} — ${video.url ?? ""}`,
      );
      console.log(`ок → ${t.name}.mp4 (${video.duration ?? "?"} сек, ${file.width}×${file.height})`);
      saved = true;
      ok++;
      break;
    }

    if (!saved) {
      console.log("не удалось скачать, оставил как было");
      failed.push(t.query);
    }
  } catch (e) {
    console.log(`сбой (${e.message}), иду дальше`);
    failed.push(t.query);
  }

  await sleep(700);
}

if (rateLimited) {
  console.log("");
  console.log("PEXELS: кончился часовой лимит запросов (429 Too Many Requests).");
  console.log("");
  console.log("Это не поломка. Бесплатный ключ пускает 200 запросов в час,");
  console.log("а один выпуск съедает около сорока. Подожди примерно час");
  console.log("и нажми кнопку ещё раз — уже скачанное пропустится.");
  console.log("");
  process.exitCode = 2;
} else if (authFailed) {
  keyHelp();
} else {
  // Для мест без клипа берём фотографию с того же Pexels — она почти всегда
  // лучше того, что до этого нашлось в Википедии.
  const fellBack = [];
  for (const t of noClip) {
    if (t.round === undefined) continue;
    const jpg = `${t.name}.jpg`;
    process.stdout.write(`${t.query}: клипа нет, ищу фото... `);

    let got = false;
    try {
      const res = await safeFetch(
        "https://api.pexels.com/v1/search?" +
          new URLSearchParams({ query: t.query, per_page: "12", orientation: "portrait" }),
        { headers: { Authorization: KEY }, retries: 1 },
      );
      const json = res && res.ok ? await res.json() : null;
      const best = (json?.photos ?? [])
        .map((p) => ({ p, score: relevance(t.query, (p.url ?? "") + " " + (p.alt ?? "")) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)[0];

      if (best) {
        const img = await safeFetch(best.p.src?.large2x ?? best.p.src?.large, { timeout: 60000 });
        if (img && img.ok) {
          const raw = Buffer.from(await img.arrayBuffer());
          const кадр = await sharp(raw).rotate().resize(PHOTO_W, PHOTO_H, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
          fs.writeFileSync(path.join(PUBLIC, jpg), кадр);
          credits.push(`${jpg} — Pexels (фото), автор ${best.p.photographer ?? "неизвестен"} — ${best.p.url ?? ""}`);
          got = true;
        }
      }
    } catch {
      /* ничего страшного, оставим что было */
    }

    if (fs.existsSync(path.join(PUBLIC, jpg))) {
      rounds[t.round][t.side].image = jpg;
      fellBack.push(`${t.query} → фото ${jpg}${got ? " (новое, с Pexels)" : " (прежнее)"}`);
      console.log(got ? "нашёл новое" : "оставил прежнее");
    } else {
      console.log("не нашлось");
    }
  }

  // ——— итоги ———
  if (credits.length) {
    try {
      // Дополняем список, а не затираем: иначе теряется память о том,
      // какие клипы уже брали, и при замене приедет тот же самый.
      const file = path.join(PUBLIC, "video-credits.txt");
      const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
      const fresh = new Set(credits.map((c) => c.split(" ")[0]));
      const keep = old.filter((l) => l.includes(" — ") && !fresh.has(l.split(" ")[0]));
      fs.writeFileSync(
        file,
        "Источники видео (Pexels, свободная лицензия):\n\n" +
          [...credits, ...keep].join("\n") +
          "\n",
        "utf8",
      );
    } catch {
      // не критично
    }
  }

  console.log("");
  console.log(`Скачано клипов: ${ok}`);
  if (skipped) console.log(`Было уже готово: ${skipped}`);
  console.log(`Длина каждого клипа: ${CLIP_SECONDS} сек`);

  if (rounds) {
    try {
      const written = writeRoundsToRoot(rounds);
      console.log(
        written
          ? "Клипы подставлены в раунды автоматически — открой студию и посмотри."
          : "Клипы лежат в public/, но подставить не смог: нажми Save в студии и запусти снова.",
      );
    } catch (e) {
      console.log(`Клипы скачаны, но подставить не вышло: ${e.message}`);
    }
  }

  if (fellBack.length) {
    console.log("");
    console.log("КЛИПА НЕТ, ОСТАВЛЕНО ФОТО:");
    fellBack.forEach((l) => console.log("  " + l));
  }

  if (failed.length) {
    console.log("");
    console.log(`НЕ ПОЛУЧИЛОСЬ: ${failed.join(", ")}`);
    console.log("Попробуй запустить ещё раз — часто это просто сбой интернета.");
    console.log("Если для места нет клипов — оставь для него фотографию, это нормально.");
  }

  console.log("");

}
