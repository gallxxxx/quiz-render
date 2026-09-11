// Собирает текст озвучки на английском из текущих данных.
// Только реплики, без таймингов и без объявления процентов.
// Запуск: npm run voice
// Результат: «Готовые видео\озвучка.txt»
import fs from "fs";
import path from "path";
import { readRounds, readTexts } from "./read-rounds.mjs";

const OUT_DIR = path.join(process.cwd(), "..", "Готовые видео");

let rounds;
let texts;
try {
  rounds = readRounds();
  texts = readTexts();
} catch (e) {
  console.log(`Не смог прочитать данные: ${e.message}`);
  process.exit(1);
}

const lines = [];

lines.push(texts.intro.hook);
rounds.forEach((r) => lines.push(`${r.top.label}, or ${r.bottom.label}?`));
lines.push(`${texts.outro.title} ${texts.outro.subtitle}. ${texts.outro.cta}.`);

fs.mkdirSync(OUT_DIR, { recursive: true });
const file = path.join(OUT_DIR, "озвучка.txt");
fs.writeFileSync(file, lines.join("\r\n") + "\r\n", "utf8");

console.log("");
console.log(lines.join("\n"));
console.log("");
console.log(`Сохранено: ${file}`);
