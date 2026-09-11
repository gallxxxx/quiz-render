// Черновики выпусков.
//
// Ролик собран, но без озвучки — данные складываются в папку «Черновики»,
// чтобы к выпуску можно было вернуться и наложить голос когда угодно.
//
// В каждой папке черновика:
//   данные.json    — вопросы и заставка (их и загружает кнопка 10)
//   озвучка.txt    — текст для 11 labs
//   что это.txt    — короткая памятка: что за выпуск и где лежит видео

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRounds, readTexts, writeToRoot } from "./read-rounds.mjs";
import { THEMES } from "./themes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(HERE, "..", "..");
export const DRAFTS = path.join(ROOT_DIR, "Черновики");

// В имени папки нельзя \ / : * ? " < > |
const safe = (s) =>
  String(s ?? "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// «01 DESSERTS», «02 ANIMALS» — по порядку, чтобы список не прыгал.
const nextNumber = () => {
  if (!fs.existsSync(DRAFTS)) return 1;
  let max = 0;
  for (const name of fs.readdirSync(DRAFTS)) {
    const m = name.match(/^(\d+)\s/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
};

// Тот же текст, что делает кнопка 7, но кладём его рядом с черновиком.
export const voiceText = ({ intro, rounds, outro }) => {
  const lines = [intro?.hook ?? ""];
  for (const r of rounds) {
    lines.push(`${r.top?.label ?? ""}, or ${r.bottom?.label ?? ""}?`);
  }
  // Так же, как это делает кнопка 7: между фразами концовки точки,
  // иначе нейросеть читает их одним куском без пауз.
  const tail = [outro?.title, outro?.subtitle, outro?.cta].filter(Boolean);
  if (tail.length) {
    lines.push(
      tail
        .map((t, i) => (i === 0 ? t : /[.?!]$/.test(t) ? t : t + "."))
        .join(" "),
    );
  }
  return lines.join("\n") + "\n";
};

export const saveDraft = ({ edition, hook, rounds, texts, videoFile }) => {
  const title = safe(edition).replace(/\s*EDITION\s*$/i, "").trim() || "выпуск";

  // Номер выпуска определяет ТЕМА, а не порядок сохранения. Иначе пересобранный
  // выпуск получал следующий свободный номер и уезжал в конец списка, а его
  // прежняя папка оставалась пустой — так пляжи однажды стали «27 BEACHES».
  const existing = fs.existsSync(DRAFTS)
    ? fs
        .readdirSync(DRAFTS)
        .find((name) => name.replace(/^\d+\s*/, "").toUpperCase() === title.toUpperCase())
    : null;

  const folder = existing ?? `${String(nextNumber()).padStart(2, "0")} ${title}`;
  const dir = path.join(DRAFTS, folder);
  fs.mkdirSync(dir, { recursive: true });

  const data = {
    edition,
    hook,
    // Заставку тоже храним: без неё при открытии черновика оставалась
    // заставка предыдущей темы (writeToRoot сливает intro со старым).
    cover: texts?.intro?.cover ?? "",
    outro: texts?.outro ?? null,
    video: videoFile ?? "",
    saved: (() => {
      // Местное время, а не UTC: иначе в списке черновиков стоит чужой час.
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    })(),
    rounds,
  };

  fs.writeFileSync(
    path.join(dir, "данные.json"),
    JSON.stringify(data, null, 2) + "\n",
    "utf8",
  );

  fs.writeFileSync(
    path.join(dir, "озвучка.txt"),
    voiceText({ intro: { hook }, rounds, outro: texts?.outro }).replace(/\n/g, "\r\n"),
    "utf8",
  );

  const memo = [
    `ВЫПУСК: ${edition}`,
    `Заставка: ${hook}`,
    "",
    `Готовое видео (пока без голоса):`,
    `   Готовые видео\\${videoFile}`,
    "",
    "ВОПРОСЫ:",
    ...rounds.map(
      (r, i) => `   ${i + 1}. ${r.top?.label} (${r.topPercent}%)  /  ${r.bottom?.label}`,
    ),
    "",
    "КАК НАЛОЖИТЬ ОЗВУЧКУ:",
    "   1. Открой «озвучка.txt» из этой же папки и озвучь текст в 11 labs.",
    "   2. Очисти папку «11 labs» от прошлых записей и положи туда новые.",
    "   3. Нажми кнопку «10 Открыть черновик» и выбери этот выпуск —",
    "      вопросы вернутся в редактор.",
    "   4. Кнопка 8 — разложит озвучку.",
    "   5. Кнопка 6 — соберёт готовый ролик уже с голосом.",
    "",
  ].join("\r\n");

  fs.writeFileSync(path.join(dir, "что это.txt"), memo, "utf8");

  return dir;
};

export const listDrafts = () => {
  if (!fs.existsSync(DRAFTS)) return [];
  const out = [];
  for (const name of fs.readdirSync(DRAFTS).sort()) {
    const file = path.join(DRAFTS, name, "данные.json");
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      out.push({ name, dir: path.join(DRAFTS, name), data });
    } catch {
      // битый файл — просто пропускаем, остальные черновики не должны страдать
    }
  }
  return out;
};

// Заставка выпуска: сохранённая в черновике, а если черновик старый и поля
// в нём нет — та, что лежит в public/covers под именем темы.
const coverFor = (data) => {
  if (typeof data.cover === "string") return data.cover;

  const title = String(data.edition ?? "").replace(/\s*EDITION\s*$/i, "").toUpperCase();
  const theme = THEMES.find(
    (t) => t.edition.replace(/\s*EDITION\s*$/i, "").toUpperCase() === title,
  );
  if (!theme) return "";

  const covers = path.join(HERE, "..", "public", "covers");
  for (const ext of [".jpg", ".jpeg", ".png"]) {
    if (fs.existsSync(path.join(covers, `${theme.id}${ext}`))) return `covers/${theme.id}${ext}`;
  }
  return "";
};

export const loadDraft = (draft) => {
  const { edition, hook, rounds, outro } = draft.data;
  // cover пишем ВСЕГДА и явно: иначе от прошлого выпуска остаётся чужая
  // заставка — так в острова однажды уехала пляжная.
  return writeToRoot({
    rounds,
    intro: { hook, edition, cover: coverFor(draft.data) },
    outro: outro ?? undefined,
  });
};

// Сохранить то, что прямо сейчас стоит в редакторе.
export const saveCurrent = (videoFile) => {
  const texts = readTexts();
  return saveDraft({
    edition: texts.intro.edition,
    hook: texts.intro.hook,
    rounds: readRounds(),
    texts,
    videoFile,
  });
};
