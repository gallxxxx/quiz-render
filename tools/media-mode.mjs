// Настройка «что ставить в ролик»: видео со стока, фотографии или свои файлы.
//
// Живёт в обычном текстовом файле «настройки.txt» рядом с кнопками —
// чтобы не лазить в код. Меняется кнопкой-переключателем.

import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "..", "настройки.txt");

// «своё» и «свое», «ВИДЕО» и «видео» — одно и то же.
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/ё/g, "е");

export const MODES = ["видео", "фото", "свое"];

export const MODE_NAMES = {
  видео: "видеоклипы со стока (Pexels) — подбираются сами",
  фото: "фотографии из интернета — подбираются сами",
  свое: "мои файлы из папки «Мои фото»",
};

const DEFAULT = [
  "НАСТРОЙКИ РОЛИКА",
  "",
  "Меняются кнопкой «3 Видео, фото или своё». Руками сюда лезть не обязательно.",
  "",
  "",
  "# Что ставить в кадр: видео / фото / своё",
  "КАРТИНКИ: видео",
  "",
  "# Каким планом искать: крупный (еда, предметы, цветы)",
  "#                     общий  (города, природа, машины, животные)",
  "ПЛАН: крупный",
  "",
  "# Озвучивать ролик голосом: да / нет",
  "ОЗВУЧКА: да",
  "",
  "# Каким голосом. Меняется той же кнопкой 3.",
  "ГОЛОС: en-US-GuyNeural",
  "",
  "# Скорость речи: 0% обычная, +15% быстрее, -10% медленнее",
  "СКОРОСТЬ: +0%",
  "",
].join("\r\n");

const read = () => {
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, DEFAULT, "utf8");
  return fs.readFileSync(FILE, "utf8");
};

const value = (text, key) => {
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const m = s.match(/^([^:]+):\s*(.*)$/);
    if (m && norm(m[1]) === norm(key)) return m[2].trim();
  }
  return "";
};

// Что выбрано сейчас. Непонятное слово в файле — считаем, что видео.
export const readMode = () => {
  const v = norm(value(read(), "КАРТИНКИ"));
  return MODES.includes(v) ? v : "видео";
};

// Крупный план или общий (для поиска видео это важнее всего остального).
export const readShot = () => (norm(value(read(), "ПЛАН")) === "общий" ? "общий" : "крупный");

const replaceLine = (text, key, val) => {
  const lines = text.split(/\r?\n/);
  let done = false;
  const out = lines.map((line) => {
    const s = line.trim();
    if (!s || s.startsWith("#")) return line;
    const m = s.match(/^([^:]+):\s*(.*)$/);
    if (m && norm(m[1]) === norm(key)) {
      done = true;
      return `${m[1].trim()}: ${val}`;
    }
    return line;
  });
  if (!done) out.push(`${key}: ${val}`);
  return out.join("\r\n");
};

export const writeMode = (mode) => {
  fs.writeFileSync(FILE, replaceLine(read(), "КАРТИНКИ", mode), "utf8");
};

export const writeShot = (shot) => {
  fs.writeFileSync(FILE, replaceLine(read(), "ПЛАН", shot), "utf8");
};

// ——— озвучка ———

// Голоса Microsoft: бесплатные, без ключа. Первый — по умолчанию.
export const VOICES = [
  ["en-US-GuyNeural", "мужской, бодрый — как ведущий шоу"],
  ["en-US-AndrewNeural", "мужской, спокойный"],
  ["en-US-AriaNeural", "женский, живой"],
  ["en-US-JennyNeural", "женский, мягкий"],
  ["en-GB-RyanNeural", "британский мужской"],
  ["en-GB-SoniaNeural", "британский женский"],
];

export const readVoiceOn = () => {
  const v = norm(value(read(), "ОЗВУЧКА"));
  return !(v === "нет" || v === "no" || v === "off");
};

export const readVoiceName = () => {
  const v = value(read(), "ГОЛОС").trim();
  return v || VOICES[0][0];
};

// «+15%», «15» или пусто — приводим к виду, который понимает синтезатор.
export const readVoiceRate = () => {
  const raw = value(read(), "СКОРОСТЬ").trim().replace("%", "").trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return "+0%";
  const i = Math.round(n);
  return (i >= 0 ? "+" : "") + i + "%";
};

export const writeVoiceOn = (on) => {
  fs.writeFileSync(FILE, replaceLine(read(), "ОЗВУЧКА", on ? "да" : "нет"), "utf8");
};

export const writeVoiceName = (name) => {
  fs.writeFileSync(FILE, replaceLine(read(), "ГОЛОС", name), "utf8");
};

export const SETTINGS_FILE = FILE;
