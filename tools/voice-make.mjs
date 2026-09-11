// Озвучка голосом Microsoft — бесплатно, без ключей и без регистрации.
//
// Берёт те же фразы, что кнопка «текст для озвучки»: заставку, по одной
// фразе на вопрос и концовку, — синтезирует их и раскладывает по ролику,
// то есть делает то же, что раньше делалось руками через 11 labs.
//
// Запуск:
//   node tools/voice-make.mjs            — озвучить, если текст поменялся
//   node tools/voice-make.mjs --force    — озвучить заново в любом случае

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { audioDuration } from "./media.mjs";
import { readRounds, readTexts } from "./read-rounds.mjs";
import { readVoiceName, readVoiceRate } from "./media-mode.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const OUT = path.join(QUIZ, "public", "voice");
const VOICE_TS = path.join(QUIZ, "src", "voice.ts");
const MEMO = path.join(OUT, "_что озвучено.json");

const force = process.argv.includes("--force");
// Озвучку выключили — стираем голос из ролика, а файлы не трогаем:
// включит обратно — озвучивать заново не придётся.
const off = process.argv.includes("--выключить");

let rounds;
let texts;
try {
  rounds = readRounds();
  texts = readTexts();
} catch (e) {
  console.log(`Не смог прочитать вопросы: ${e.message}`);
  process.exit(1);
}

// ——— что говорим ———
// Ровно то же, что уходило в 11 labs: крючок, «то или это?» и концовка.
const phrases = [
  { key: "intro", text: texts.intro.hook },
  ...rounds.map((r, i) => ({
    key: `round-${i + 1}`,
    text: `${r.top.label}, or ${r.bottom.label}?`,
  })),
  { key: "outro", text: `${texts.outro.title} ${texts.outro.subtitle}. ${texts.outro.cta}.` },
];

const voice = readVoiceName();
const rate = readVoiceRate();

const writeVoiceTs = (result, durations) => {
  const body = `// Озвучка. Этот файл пишет кнопка сборки — руками его трогать не нужно.
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

// Громкость, задержка и подрезка — в файле voice-settings.ts,
// он специально отдельный, чтобы кнопка их не затирала.
`;
  fs.writeFileSync(VOICE_TS, body, "utf8");
};

if (off) {
  const empty = rounds.map(() => null);
  writeVoiceTs(
    { intro: null, rounds: empty, outro: null },
    { intro: 0, rounds: rounds.map(() => 0), outro: 0 },
  );
  try {
    fs.rmSync(MEMO, { force: true });
  } catch {
    /* памятки могло и не быть */
  }
  console.log("");
  console.log("Озвучка выключена — ролик соберётся без голоса.");
  console.log("");
  process.exit(0);
}

// ——— заново или можно не трогать ———
const memoNow = JSON.stringify({ voice, rate, phrases });
const allFilesThere = () =>
  phrases.every((p) => fs.existsSync(path.join(OUT, `${p.key}.mp3`)));

if (!force && fs.existsSync(MEMO) && allFilesThere()) {
  try {
    if (fs.readFileSync(MEMO, "utf8") === memoNow) {
      console.log("");
      console.log("Озвучка уже готова и текст не менялся — оставляю как есть.");
      console.log("");
      process.exit(0);
    }
  } catch {
    /* памятка битая — озвучим заново */
  }
}


console.log("");
console.log(`Озвучиваю голосом ${voice}${rate === "+0%" ? "" : `, скорость ${rate}`}`);
console.log("");

fs.mkdirSync(OUT, { recursive: true });

const tts = new MsEdgeTTS();
try {
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
} catch (e) {
  console.log("");
  console.log("НЕ ВЫШЛО ПОДКЛЮЧИТЬСЯ К ГОЛОСУ.");
  console.log(`Причина: ${e.message}`);
  console.log("");
  console.log("Чаще всего это интернет. Ролик соберётся и без голоса —");
  console.log("просто нажми кнопку сборки ещё раз, когда связь появится.");
  console.log("");
  process.exit(1);
}

// Синтезатор кладёт файл всегда под одним именем — сразу переименовываем.
const say = async (text, target) => {
  const res = await tts.toFile(OUT, text, { rate });
  const from = res?.audioFilePath;
  if (!from || !fs.existsSync(from)) throw new Error("синтезатор не отдал файл");
  const to = path.join(OUT, target);
  try {
    fs.rmSync(to, { force: true });
  } catch {
    /* занят антивирусом — попробуем перезаписать */
  }
  fs.renameSync(from, to);
  return to;
};

const done = {};
let failed = 0;

for (const p of phrases) {
  const short = p.text.length > 42 ? p.text.slice(0, 42) + "…" : p.text;
  process.stdout.write(`${p.key.padEnd(9)} «${short}» ... `);

  let saved = null;
  for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    try {
      saved = await say(p.text, `${p.key}.mp3`);
    } catch (e) {
      if (attempt === 2) {
        console.log(`не вышло (${e.message})`);
        failed++;
      } else {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }

  if (saved) {
    const sec = audioDuration(saved);
    done[p.key] = { file: `voice/${p.key}.mp3`, sec: Math.round((sec ?? 0) * 100) / 100 };
    console.log(`ок, ${done[p.key].sec} сек`);
  }
}

try {
  tts.close();
} catch {
  /* соединение уже закрыто */
}

// ——— записываем в проект ———
const result = {
  intro: done.intro?.file ?? null,
  rounds: rounds.map((_, i) => done[`round-${i + 1}`]?.file ?? null),
  outro: done.outro?.file ?? null,
};
const durations = {
  intro: done.intro?.sec ?? 0,
  rounds: rounds.map((_, i) => done[`round-${i + 1}`]?.sec ?? 0),
  outro: done.outro?.sec ?? 0,
};

writeVoiceTs(result, durations);
if (!failed) fs.writeFileSync(MEMO, memoNow, "utf8");

console.log("");
if (failed) {
  console.log(`НЕ ОЗВУЧЕНО ФРАЗ: ${failed}. Остальные на месте, ролик соберётся.`);
} else {
  console.log(`Озвучено фраз: ${phrases.length}. Голос ляжет в ролик при сборке.`);
}
console.log("");
