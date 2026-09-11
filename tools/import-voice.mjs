// Раскладывает озвучку из папки «11 labs» по местам в ролике.
//
// Порядок файлов = порядок в ролике:
//   первый     — заставка
//   следующие  — вопросы, по одному на раунд
//   последний  — концовка
//
// Точные дубли (один и тот же файл, скачанный дважды) отбрасываются сами.
//
// Запуск: npm run voiceimport
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { audioDuration } from "./media.mjs";
import { readRounds } from "./read-rounds.mjs";

const DROP = path.join(process.cwd(), "..", "11 labs");
const OUT = path.join(process.cwd(), "public", "voice");
const VOICE_TS = path.join(process.cwd(), "src", "voice.ts");
const OK = [".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac"];

if (!fs.existsSync(DROP)) {
  console.log("");
  console.log(`Нет папки с озвучкой: ${path.resolve(DROP)}`);
  console.log("Создай её и положи туда файлы.");
  console.log("");
  process.exit(0);
}

// ——— собираем файлы ———
let files = fs
  .readdirSync(DROP, { withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => d.name)
  .filter((n) => OK.includes(path.extname(n).toLowerCase()));

if (files.length === 0) {
  console.log("");
  console.log("В папке «11 labs» нет звуковых файлов.");
  console.log("");
  process.exit(0);
}

// ——— порядок ———
// У ElevenLabs / Higgsfield в имени стоит время создания — сортируем по нему.
// Если такого нет, сортируем по имени по-человечески (2 идёт перед 10).
const stamp = (name) => {
  const m = name.match(/(\d{8})[_-](\d{6})/);
  return m ? m[1] + m[2] : null;
};

const allStamped = files.every((f) => stamp(f));

files.sort((a, b) => {
  if (allStamped) return stamp(a).localeCompare(stamp(b));
  return a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" });
});

// ——— выбрасываем точные дубли ———
const seen = new Set();
const unique = [];
const dupes = [];

for (const name of files) {
  const hash = crypto.createHash("md5").update(fs.readFileSync(path.join(DROP, name))).digest("hex");
  if (seen.has(hash)) {
    dupes.push(name);
    continue;
  }
  seen.add(hash);
  unique.push(name);
}

// ——— раскладываем ———
let rounds;
try {
  rounds = readRounds();
} catch (e) {
  console.log(`Не смог прочитать раунды: ${e.message}`);
  process.exit(1);
}

const n = rounds.length;
console.log("");
console.log(`Файлов: ${unique.length}${dupes.length ? ` (плюс ${dupes.length} дубл. — пропущены)` : ""}`);
console.log(`Раундов в ролике: ${n}`);
console.log("");

let intro = null;
let outro = null;
let questions = [];

if (unique.length === n + 2) {
  intro = unique[0];
  questions = unique.slice(1, 1 + n);
  outro = unique[unique.length - 1];
  console.log("Разложил как: заставка + вопросы + концовка");
} else if (unique.length === n + 1) {
  intro = unique[0];
  questions = unique.slice(1);
  console.log("Разложил как: заставка + вопросы (концовки нет)");
} else if (unique.length === n) {
  questions = unique;
  console.log("Разложил как: только вопросы (заставки и концовки нет)");
} else {
  // Файлов не столько, сколько нужно — раскладываем по порядку, что есть
  questions = unique.slice(0, n);
  console.log("ВНИМАНИЕ: файлов не совпало с числом раундов.");
  console.log(`Взял первые ${questions.length} как вопросы, остальное не тронул.`);
  console.log("Проверь результат в редакторе.");
}

// ——— копируем ———
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const copy = (name, as) => {
  const ext = path.extname(name).toLowerCase();
  const target = `${as}${ext}`;
  fs.copyFileSync(path.join(DROP, name), path.join(OUT, target));
  return `voice/${target}`;
};

const result = {
  intro: intro ? copy(intro, "intro") : null,
  rounds: questions.map((f, i) => (f ? copy(f, `round-${i + 1}`) : null)),
  outro: outro ? copy(outro, "outro") : null,
};

// Длительности нужны, чтобы фразы не наезжали друг на друга.
const seconds = (rel) => (rel ? Math.round((audioDuration(path.join(process.cwd(), "public", rel)) ?? 0) * 100) / 100 : 0);
const durations = {
  intro: seconds(result.intro),
  rounds: result.rounds.map(seconds),
  outro: seconds(result.outro),
};

while (result.rounds.length < n) result.rounds.push(null);

// ——— записываем в проект ———
const body = `// Озвучка. Этот файл переписывает кнопка «8 Добавить озвучку» —
// руками его трогать не нужно.
//
// null означает «для этого места записи нет» — тогда просто ничего не звучит.

export type Voice = {
  intro: string | null;
  rounds: (string | null)[];
  outro: string | null;
};

export const VOICE: Voice = ${JSON.stringify(result, null, 2)};

// Сколько секунд длится каждая запись — по ним фразы расставляются так,
// чтобы не звучать одновременно.
export const VOICE_SECONDS = ${JSON.stringify(durations, null, 2)};

// Громкость, задержка и подрезка начала — в файле voice-settings.ts,
// он специально отдельный, чтобы кнопка их не затирала.
`;

fs.writeFileSync(VOICE_TS, body, "utf8");

// ——— отчёт ———
console.log("");
if (result.intro) console.log(`заставка   ← ${intro}`);
questions.forEach((f, i) => {
  const r = rounds[i];
  console.log(`раунд ${String(i + 1).padStart(2)}   ← ${f}`);
  console.log(`             (${r.top.label} / ${r.bottom.label})`);
});
if (result.outro) console.log(`концовка   ← ${outro}`);

console.log("");
console.log("Готово. Открой редактор и послушай, потом собери ролик.");
console.log("");
