// Журнал выпусков: что уже собрано, с какими парами и какими клипами.
// Нужен, чтобы не повторяться в следующих роликах.
//
// Сам файл — quiz/_meta/журнал.json. Руками его открывать не нужно:
// кнопка «9 Что уже было» показывает всё по-человечески.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, "..", "_meta", "журнал.json");

// «Big Ben» + «Sydney Opera House» и «Sydney Opera House» + «Big Ben» —
// одна и та же пара. Приводим к общему виду, чтобы сравнивать.
export const pairKey = (a, b) => {
  const clean = (s) =>
    String(s ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  return [clean(a), clean(b)].sort().join(" | ");
};

export const readJournal = () => {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(data.episodes) ? data : { episodes: [] };
  } catch {
    return { episodes: [] };
  }
};

const write = (data) => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
};

// Все пары, которые уже выходили: ключ пары → список выпусков, где она была.
export const usedPairs = (journal = readJournal()) => {
  const map = new Map();
  for (const ep of journal.episodes) {
    for (const p of ep.pairs ?? []) {
      const key = pairKey(p.top, p.bottom);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ep);
    }
  }
  return map;
};

// Все клипы, которые уже были в деле: имя файла → список выпусков.
export const usedClips = (journal = readJournal()) => {
  const map = new Map();
  for (const ep of journal.episodes) {
    for (const p of ep.pairs ?? []) {
      for (const clip of [p.topImage, p.bottomImage]) {
        if (!clip) continue;
        if (!map.has(clip)) map.set(clip, []);
        map.get(clip).push(ep);
      }
    }
  }
  return map;
};

// Что из текущего набора уже выходило раньше.
export const findRepeats = (rounds, journal = readJournal()) => {
  const pairs = usedPairs(journal);
  const clips = usedClips(journal);
  const repeats = { pairs: [], clips: [] };

  for (const r of rounds) {
    const key = pairKey(r.top?.label, r.bottom?.label);
    const seen = pairs.get(key);
    if (seen?.length) {
      repeats.pairs.push({
        top: r.top?.label,
        bottom: r.bottom?.label,
        where: seen.map((e) => e.file),
      });
      // Про клипы такой пары молчим: и так ясно, что весь раунд старый.
      continue;
    }
    for (const [label, image] of [
      [r.top?.label, r.top?.image],
      [r.bottom?.label, r.bottom?.image],
    ]) {
      const seenClip = image ? clips.get(image) : null;
      if (seenClip?.length) {
        repeats.clips.push({ label, image, where: seenClip.map((e) => e.file) });
      }
    }
  }
  return repeats;
};

export const addEpisode = ({ file, edition, hook, account = "", rounds }) => {
  const data = readJournal();
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");

  data.episodes.push({
    file,
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
    edition,
    hook,
    account,
    pairs: rounds.map((r) => ({
      top: r.top?.label ?? "",
      bottom: r.bottom?.label ?? "",
      topImage: r.top?.image ?? "",
      bottomImage: r.bottom?.image ?? "",
      topPercent: r.topPercent ?? null,
    })),
  });

  write(data);
  return data;
};
