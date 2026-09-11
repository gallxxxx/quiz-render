// Показывает журнал выпусков: что уже собрано и что из этого
// сейчас снова стоит в редакторе.
//
// Кроме показа на экране кладёт то же самое в
// "Готовые видео\что уже было.txt" — чтобы можно было почитать спокойно.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRounds } from "./read-rounds.mjs";
import { findRepeats, readJournal, usedPairs } from "./journal.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "..", "Готовые видео", "что уже было.txt");

const lines = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};

const journal = readJournal();

if (journal.episodes.length === 0) {
  say("Журнал пока пустой — ни одного ролика ещё не собрано этой кнопкой.");
  say("");
  say("Он заполняется сам: каждый раз, когда жмёшь кнопку 6,");
  say("выпуск записывается сюда вместе со всеми парами.");
} else {
  say(`СОБРАНО ВЫПУСКОВ: ${journal.episodes.length}`);
  say("");

  for (const ep of journal.episodes) {
    say("─".repeat(60));
    say(`${ep.date}   ${ep.edition || "без темы"}`);
    say(`файл: ${ep.file}`);
    if (ep.account) say(`аккаунт: ${ep.account}`);
    if (ep.hook) say(`крючок: ${ep.hook}`);
    say("");
    (ep.pairs ?? []).forEach((p, i) => {
      say(`  ${i + 1}. ${p.top}  /  ${p.bottom}`);
    });
    say("");
  }

  say("─".repeat(60));
  const pairs = usedPairs(journal);
  say(`ВСЕГО РАЗНЫХ ПАР ИСПОЛЬЗОВАНО: ${pairs.size}`);
  say("");

  // Какие места примелькались сильнее всего.
  const places = new Map();
  for (const ep of journal.episodes) {
    for (const p of ep.pairs ?? []) {
      for (const label of [p.top, p.bottom]) {
        if (!label) continue;
        places.set(label, (places.get(label) ?? 0) + 1);
      }
    }
  }
  const often = [...places.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1]);
  if (often.length) {
    say("Чаще всего мелькали (стоит дать им отдохнуть):");
    for (const [label, n] of often) say(`  ${label} — ${n} раза`);
    say("");
  }
}

// Что из текущих данных уже выходило.
say("═".repeat(60));
say("ЧТО СЕЙЧАС СТОИТ В РЕДАКТОРЕ");
say("");

let rounds = [];
try {
  rounds = readRounds();
} catch {
  rounds = [];
}

if (rounds.length === 0) {
  say("Не смог прочитать текущие вопросы.");
} else {
  const repeats = findRepeats(rounds, journal);
  if (!repeats.pairs.length && !repeats.clips.length) {
    say("Повторов нет — всё новое. Можно собирать.");
  } else {
    if (repeats.pairs.length) {
      say(`Уже выходило пар: ${repeats.pairs.length} из ${rounds.length}`);
      for (const r of repeats.pairs) {
        say(`  ${r.top} / ${r.bottom}  →  ${r.where.join(", ")}`);
      }
      say("");
    }
    if (repeats.clips.length) {
      say("Пара новая, а клип старый:");
      for (const c of repeats.clips) {
        say(`  ${c.label} (${c.image})  →  ${c.where.join(", ")}`);
      }
      say("");
    }
    if (repeats.pairs.length === rounds.length) {
      say("Это ровно тот же выпуск, что уже собран. Если хочешь новый ролик —");
      say("поменяй места в редакторе (кнопка 1).");
    } else {
      say("Что с этим делать:");
      say("  - поменять места в редакторе (кнопка 1), или");
      say("  - перекачать клип другим: он возьмёт следующий по списку");
    }
  }
}

try {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join("\r\n") + "\r\n", "utf8");
  console.log("");
  console.log('То же самое лежит в "Готовые видео\\что уже было.txt"');
} catch {
  // не смогли записать файл — не беда, на экране всё уже есть
}
