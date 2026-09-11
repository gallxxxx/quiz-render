// Качает фото под каждую подпись и САМ подставляет их в раунды.
//
// Источники (оба бесплатные, регистрация не нужна):
//   1. Википедия — главный. Для достопримечательностей самый точный:
//      берём фотографии со страницы статьи, отсеивая логотипы и схемы.
//   2. Openverse — запасной. Поиск по фото со свободными лицензиями.
//
// Запуск:
//   npm run photos                  — по подписям из твоих раундов
//   npm run photos -- --force       — перекачать всё заново
//   npm run photos -- "Big Ben"     — по своим словам (без подстановки)
//
// Два флага для переключателя «видео или фото» (кнопки Вики их не ставят):
//   --replace   ставить фото и туда, где уже лежит видеоклип
//   --pexels    сначала спрашивать сток Pexels, потом Википедию
//
// Скрипт устойчив к сбоям сети: если что-то не ответило, он пропускает
// это фото и идёт дальше, а в конце показывает список пропущенных.
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { readRounds, writeRoundsToRoot } from "./read-rounds.mjs";
import { readPexelsKey, safeFetch as netFetch, PHOTO_W, PHOTO_H } from "./media.mjs";
import { fromCommons, fromPixabay, fromUnsplash } from "./photo-sources.mjs";

const PUBLIC = path.join(process.cwd(), "public");
const UA = "thisorthat-quiz/1.0 (personal project)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// ————————————————————————————————————————————————————————————
//  Сеть: никогда не бросает ошибку, максимум возвращает null
// ————————————————————————————————————————————————————————————
const safeFetch = async (url, { timeout = 20000, retries = 2 } = {}) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      });
      // 429 = «слишком часто просишь», подождём подольше
      if (res.status === 429) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      return res;
    } catch {
      await sleep(1500 * (attempt + 1)); // таймаут или обрыв — пробуем ещё раз
    }
  }
  return null;
};

const safeJson = async (url, opts) => {
  const res = await safeFetch(url, opts);
  if (!res || !res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
};

// ————————————————————————————————————————————————————————————
//  Источник 1: Википедия
// ————————————————————————————————————————————————————————————
const fromWikipedia = async (title) => {
  const summary = (name) =>
    safeJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`);

  let page = await summary(title);

  // прямой страницы нет или на ней нет фото — ищем ближайшую по названию
  if (!page || page.type === "disambiguation" || !(page.originalimage || page.thumbnail)) {
    const found = await safeJson(
      "https://en.wikipedia.org/w/api.php?" +
        new URLSearchParams({
          action: "query",
          list: "search",
          srsearch: title,
          srlimit: "1",
          format: "json",
        }),
    );
    const best = found?.query?.search?.[0]?.title;
    if (best && best !== title) {
      const alt = await summary(best);
      if (alt) page = alt;
    }
  }

  if (!page?.title) return [];

  const card = (url) => ({
    url,
    title: page.title,
    creator: "Wikimedia Commons",
    license: "см. страницу файла",
    license_version: "",
    foreign_landing_url: page.content_urls?.desktop?.page ?? "",
  });

  const lead = page.originalimage?.source ?? page.thumbnail?.source ?? "";
  // Настоящие фото почти всегда .jpg. Другой формат — это логотип,
  // схема или карта, а не фотография.
  const leadIsPhoto = /\.jpe?g(\?|$)/i.test(lead);

  // остальные картинки статьи, только фотографии
  const gallery = [];
  const images = await safeJson(
    "https://en.wikipedia.org/w/api.php?" +
      new URLSearchParams({
        action: "query",
        generator: "images",
        titles: page.title,
        gimlimit: "40",
        prop: "imageinfo",
        iiprop: "url",
        iiurlwidth: "1600",
        format: "json",
      }),
  );

  const junk = /(logo|icon|flag|coat_of_arms|seal|map|plan|diagram|drawing|signature|blank|commons)/i;
  for (const p of Object.values(images?.query?.pages ?? {})) {
    const name = p.title ?? "";
    if (!/\.jpe?g$/i.test(name) || junk.test(name)) continue;
    const u = p.imageinfo?.[0]?.thumburl ?? p.imageinfo?.[0]?.url;
    if (u) gallery.push(u);
  }

  const list = leadIsPhoto ? [lead, ...gallery] : [...gallery, lead].filter(Boolean);
  return list.slice(0, 6).map(card);
};

// ————————————————————————————————————————————————————————————
//  Источник 2: Openverse
// ————————————————————————————————————————————————————————————
const fromOpenverse = async (q) => {
  const attempts = [
    { q, license_type: "commercial", aspect_ratio: "wide", size: "large", page_size: "10" },
    { q, license_type: "commercial", size: "large", page_size: "10" },
    { q, license_type: "commercial", page_size: "10" },
  ];

  for (const params of attempts) {
    const json = await safeJson(
      "https://api.openverse.org/v1/images/?" + new URLSearchParams({ ...params, mature: "false" }),
      { retries: 1 },
    );
    if (json?.results?.length) return json.results;
  }
  return [];
};

// ————————————————————————————————————————————————————————————
//  Источник 3: Pexels — только по флагу --pexels
// ————————————————————————————————————————————————————————————
//  Для еды, городов и предметов сток точнее Википедии: там про слово
//  написана статья, а фотографии самого блюда может и не быть.
//  Ключ тот же, что у поиска видео.
const fromPexels = async (q) => {
  const key = readPexelsKey();
  if (!key) return [];

  const attempts = [
    { query: q, per_page: "12", orientation: "landscape" },
    { query: q, per_page: "12" },
  ];

  const photos = new Map();
  for (const params of attempts) {
    const res = await netFetch(
      "https://api.pexels.com/v1/search?" + new URLSearchParams(params),
      { headers: { Authorization: key }, retries: 1 },
    );
    if (!res || !res.ok) break; // ключ не принят или кончился лимит — не мучаем
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    for (const p of json?.photos ?? []) if (!photos.has(p.id)) photos.set(p.id, p);
    if (photos.size >= 6) break;
  }

  // Сначала те, где слово из подписи есть в адресе или описании: сток
  // на «Opel» умеет отдать Chevrolet, и такое лучше пробовать последним.
  const wanted = q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const hit = (p) => {
    const hay = `${p.url ?? ""} ${p.alt ?? ""}`.toLowerCase();
    return wanted.length === 0 || wanted.some((w) => hay.includes(w));
  };

  return [...photos.values()]
    .sort((a, b) => Number(hit(b)) - Number(hit(a)))
    .map((p) => ({
      url: p.src?.large2x ?? p.src?.large ?? p.src?.original,
      title: p.alt || q,
      creator: p.photographer ?? "неизвестен",
      license: "Pexels",
      license_version: "",
      foreign_landing_url: p.url ?? "",
    }));
};
// ————————————————————————————————————————————————————————————
//  Скачивание и обрезка
// ————————————————————————————————————————————————————————————
const download = async (url) => {
  const res = await safeFetch(url, { timeout: 40000, retries: 2 });
  if (!res || !res.ok) return null;
  if (!(res.headers.get("content-type") ?? "").startsWith("image/")) return null;

  try {
    const raw = Buffer.from(await res.arrayBuffer());
    if (raw.length < 20000) return null; // слишком мелкое, наверняка мусор
    // режем в квадрат по центру и сжимаем, иначе студия будет тормозить
    return await sharp(raw)
      .rotate()
      .resize(PHOTO_W, PHOTO_H, { fit: "cover" })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
};

// ————————————————————————————————————————————————————————————
//  Основная работа
// ————————————————————————————————————————————————————————————
// ——— память: какие снимки уже показывали ———
// Без неё повторный поиск приносит ту же самую картинку, и кнопка
// «заменить» ничего не меняет. У клипов такая память есть с самого
// начала (по video-credits.txt), у фотографий её не было.
const MEMORY = path.join(PUBLIC, "_уже брали фото.txt");
const NL = String.fromCharCode(10);

const usedUrls = new Map();
try {
  for (const line of fs.readFileSync(MEMORY, "utf8").split(NL)) {
    const at = line.indexOf("|");
    if (at === -1) continue;
    const name = line.slice(0, at).trim();
    const url = line.slice(at + 1).trim();
    if (!name || !url) continue;
    if (!usedUrls.has(name)) usedUrls.set(name, new Set());
    usedUrls.get(name).add(url);
  }
} catch {
  /* памяти ещё нет — значит ничего и не показывали */
}

const remember = (name, url) => {
  if (!usedUrls.has(name)) usedUrls.set(name, new Set());
  usedUrls.get(name).add(url);
  try {
    fs.appendFileSync(MEMORY, name + "|" + url + NL, "utf8");
  } catch {
    /* не записалось — не страшно, в худшем случае повторится */
  }
};

const force = process.argv.includes("--force");
// Выбрала «фото» — значит фото везде, даже там, где раньше стоял клип.
const replace = process.argv.includes("--replace");
const usePexels = process.argv.includes("--pexels");
const words = process.argv.slice(2).filter((w) => w && !w.startsWith("--"));

let rounds = null;
try {
  rounds = words.length ? null : readRounds();
} catch (e) {
  console.log(`Не смог прочитать раунды: ${e.message}`);
  process.exit(1);
}

const targets = words.length
  ? words.map((w) => ({ query: w, name: slug(w) }))
  : rounds.flatMap((r, i) => [
      { query: r.top.label, name: slug(r.top.label), round: i, side: "top" },
      { query: r.bottom.label, name: slug(r.bottom.label), round: i, side: "bottom" },
    ]);

// Кнопка «найти фото» не должна затирать видеоклипы, которые поставила
// кнопка «найти видео». Меняем картинку только если клипа там нет.
const keepsVideo = (target) => {
  if (replace || target.round === undefined || !rounds) return false;
  const current = rounds[target.round][target.side].image ?? "";
  return current === `${target.name}.mp4` && fs.existsSync(path.join(PUBLIC, current));
};

const keptVideo = [];
const credits = [];
const failed = [];
let ok = 0;
let skipped = 0;

for (const t of targets) {
  process.stdout.write(`${t.query} ... `);

  try {
    // уже скачано раньше — не трогаем (перекачать: npm run photos -- --force)
    const existing = path.join(PUBLIC, `${t.name}.jpg`);
    if (!force && fs.existsSync(existing)) {
      if (keepsVideo(t)) {
        console.log("там уже стоит клип, не трогаю");
        keptVideo.push(t.query);
      } else if (t.round !== undefined) {
        rounds[t.round][t.side].image = `${t.name}.jpg`;
      }
      skipped++;
      continue;
    }

    // Источники пробуем по очереди и останавливаемся на первом, который
    // действительно отдал картинку: на удачном слове не тратим ни время,
    // ни лимиты остальных.
    const sources = usePexels
      ? [
          ["Unsplash", fromUnsplash],
          ["Pexels", fromPexels],
          ["Википедия", fromWikipedia],
          ["Викисклад", fromCommons],
          ["Openverse", fromOpenverse],
          ["Pixabay", fromPixabay],
        ]
      : [
          ["Википедия", fromWikipedia],
          ["Openverse", fromOpenverse],
        ];

    // Один заход по всем источникам. skipUsed — пропускать то, что уже
    // показывали: так «заменить» приносит ДРУГУЮ картинку, а не ту же.
    const lookOnce = async (skipUsed) => {
      let saved = false;
      let looked = 0;
      let skipped = 0;
      // Картинка уже стоит, а чем именно — мы не записывали (память
      // завели позже). Тогда просто пропускаем первый вариант выдачи:
      // тот самый, который сейчас и лежит в ролике.
      let dropFirst = skipUsed && !usedUrls.has(t.name);

      for (const [where, ask] of sources) {
        if (saved) break;

        let items = [];
        try {
          items = await ask(t.query);
        } catch {
          items = [];
        }
        looked += items.length;

        for (const item of items) {
          if (dropFirst) {
            dropFirst = false;
            skipped += 1;
            continue;
          }

          if (skipUsed && usedUrls.get(t.name)?.has(item.url)) {
            skipped += 1;
            continue;
          }

          const buf = await download(item.url);
          if (!buf) continue;

          const filename = `${t.name}.jpg`;
          fs.writeFileSync(path.join(PUBLIC, filename), buf);
          if (t.round !== undefined && !keepsVideo(t)) rounds[t.round][t.side].image = filename;
          remember(t.name, item.url);

          credits.push(
            `${filename} — «${item.title ?? "без названия"}», автор ${item.creator ?? "неизвестен"}, ` +
              `источник ${where}, лицензия ${String(item.license ?? "?").toUpperCase()} ` +
              `${item.license_version ?? ""} — ${item.foreign_landing_url ?? ""}`,
          );
          console.log(`ок → ${filename}  (${where})`);
          saved = true;
          ok++;
          break;
        }
      }

      return { saved, looked, skipped };
    };

    // При замене сначала ищем то, чего ещё не показывали.
    let result = await lookOnce(force);

    // Всё уже было — лучше вернуть проверенную картинку, чем ничего.
    if (!result.saved && force && result.skipped > 0) {
      console.log("новых вариантов нет, беру из тех, что уже были...");
      result = await lookOnce(false);
    }

    if (!result.saved) {
      console.log(result.looked === 0 ? "ничего не нашлось" : "не удалось скачать, оставил как было");
      failed.push(t.query);
    }
  } catch (e) {
    // ни одна ошибка не должна останавливать остальные фото
    console.log(`сбой (${e.message}), иду дальше`);
    failed.push(t.query);
  }

  await sleep(900); // не долбим сервера слишком часто, иначе банят
}

// ——— итоги ———
if (credits.length) {
  try {
    const file = path.join(PUBLIC, "photo-credits.txt");
    const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const keep = old
      .split("\n")
      .filter((l) => l.includes(" — ") && !credits.some((c) => c.startsWith(l.split(" — ")[0])));
    fs.writeFileSync(
      file,
      "Источники фото (Википедия и Openverse, свободные лицензии):\n\n" +
        [...credits, ...keep].join("\n") +
        "\n",
      "utf8",
    );
  } catch {
    // не критично
  }
}

console.log("");
console.log(`Скачано новых: ${ok}`);
if (skipped) console.log(`Было уже готово: ${skipped}`);

if (rounds) {
  try {
    const written = writeRoundsToRoot(rounds);
    console.log(
      written
        ? "Фото подставлены в раунды автоматически — открой студию и посмотри."
        : "Фото лежат в public/, но подставить не смог: нажми Save в студии и запусти снова.",
    );
  } catch (e) {
    console.log(`Фото скачаны, но подставить не вышло: ${e.message}`);
  }
}

if (keptVideo.length) {
  console.log("");
  console.log("ОСТАВЛЕНЫ КЛИПЫ (фото скачано про запас):");
  console.log("  " + keptVideo.join(", "));
}

if (failed.length) {
  console.log("");
  console.log(`НЕ ПОЛУЧИЛОСЬ: ${failed.join(", ")}`);
  console.log("Попробуй запустить ещё раз — часто это просто сбой интернета.");
  console.log("Если не помогает — положи своё фото в public и впиши имя в поле image.");
}

console.log("");
