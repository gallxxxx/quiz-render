// База голосов: берётся у самой Microsoft, а не зашита в скрипт.
// Английских там под полсотни — американские, британские, австралийские
// и другие. Ключ не нужен.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
export const SAMPLES = path.join(QUIZ, "..", "Голоса");

const RU_GENDER = { Male: "мужской", Female: "женский" };

// «en-US-AvaMultilingualNeural» → «Ava»
const shortName = (v) => {
  const tail = String(v.ShortName).split("-").slice(2).join("-");
  return tail.replace("MultilingualNeural", "").replace("Neural", "");
};

const LOCALE_RU = {
  "en-US": "США",
  "en-GB": "Британия",
  "en-AU": "Австралия",
  "en-CA": "Канада",
  "en-IE": "Ирландия",
  "en-IN": "Индия",
  "en-NZ": "Новая Зеландия",
  "en-ZA": "ЮАР",
  "en-SG": "Сингапур",
  "en-HK": "Гонконг",
  "en-PH": "Филиппины",
  "en-NG": "Нигерия",
  "en-KE": "Кения",
  "en-TZ": "Танзания",
};

// Сначала США и Британия — их слушает наша аудитория, остальные следом.
const ORDER = ["en-US", "en-GB"];

export const fetchVoices = async () => {
  const tts = new MsEdgeTTS();
  let all = [];
  try {
    all = await tts.getVoices();
  } catch {
    return null; // нет интернета — вернём null, спрашивающий разберётся
  }

  const en = all
    .filter((v) => String(v.Locale).startsWith("en-"))
    .map((v) => ({
      short: v.ShortName,
      name: shortName(v),
      gender: RU_GENDER[v.Gender] ?? v.Gender,
      locale: v.Locale,
      country: LOCALE_RU[v.Locale] ?? v.LocaleName ?? v.Locale,
      tags: (v.VoiceTag?.VoicePersonalities ?? []).join(", "),
    }));

  const rank = (v) => {
    const i = ORDER.indexOf(v.locale);
    return i === -1 ? ORDER.length : i;
  };
  en.sort((a, b) => rank(a) - rank(b) || a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name));
  return en;
};

// Печатает список и возвращает выбранный голос (или null).
export const pickVoice = async (ask, current) => {
  const voices = await fetchVoices();
  if (!voices || voices.length === 0) {
    console.log("");
    console.log("Не смогла получить список голосов — похоже, нет интернета.");
    console.log("Попробуй позже, а пока останется прежний голос.");
    return null;
  }

  const main = voices.filter((v) => ORDER.includes(v.locale));
  const rest = voices.filter((v) => !ORDER.includes(v.locale));

  const show = (items) => {
    let country = "";
    for (const v of items) {
      if (v.country !== country) {
        country = v.country;
        console.log("");
        console.log(`   ${country}`);
      }
      const n = String(voices.indexOf(v) + 1).padStart(3);
      const now = v.short === current ? "  ← сейчас" : "";
      const tags = v.tags ? `  ${v.tags}` : "";
      console.log(`${n}  ${v.name.padEnd(14)} ${v.gender.padEnd(8)}${tags}${now}`);
    }
  };

  console.log("");
  console.log("ГОЛОСА — американские и британские");
  show(main);
  console.log("");
  console.log("     0 — показать остальные: Австралия, Канада, Индия и другие");
  console.log("     Enter — оставить прежний");
  console.log("");

  let answer = await ask("Номер голоса: ");
  if (answer === "0") {
    show(rest);
    console.log("");
    answer = await ask("Номер голоса: ");
  }

  const pick = Number(answer);
  if (!Number.isInteger(pick) || pick < 1 || pick > voices.length) return null;
  return voices[pick - 1];
};

// Пробная запись: чтобы услышать голос, не собирая ролик.
export const makeSample = async (short, text) => {
  fs.mkdirSync(SAMPLES, { recursive: true });
  const tts = new MsEdgeTTS();
  await tts.setMetadata(short, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const res = await tts.toFile(SAMPLES, text);
  try {
    tts.close();
  } catch {
    /* уже закрыто */
  }
  const from = res?.audioFilePath;
  if (!from || !fs.existsSync(from)) return null;
  const to = path.join(SAMPLES, `${short}.mp3`);
  try {
    fs.rmSync(to, { force: true });
  } catch {
    /* занят */
  }
  fs.renameSync(from, to);
  return to;
};

export const openFolder = (dir) => {
  spawnSync("cmd", ["/c", "start", "", dir], { stdio: "ignore" });
};
