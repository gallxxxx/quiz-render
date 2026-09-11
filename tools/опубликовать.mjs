// Перенести код проекта в ОТКРЫТЫЙ репозиторий сборки.
//
//   node tools/опубликовать.mjs            — показать, что изменится
//   node tools/опубликовать.mjs --правда   — перенести и отправить
//
// Зачем отдельный шаг. Сборка живёт в открытом репозитории: у GitHub
// машина для открытых вдвое мощнее, и ролик собирается 275 секунд вместо
// 550. Но в рабочей папке лежат вещи, которым в открытом доступе не место:
// «_meta/история.md» — вся переписка по проекту, «задания» — выпуски,
// внутри которых бывают фотографии из галереи телефона.
//
// Поэтому копируем НЕ всё подряд, а перечисленное ниже. Список белый,
// а не чёрный, намеренно: забытый чёрный пункт утекает наружу молча,
// забытый белый — всего лишь не доедет, и это сразу видно.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const ОТКРЫТАЯ = path.join(QUIZ, "..", "..", "Сборка открытая");

const правда = process.argv.includes("--правда");

if (!fs.existsSync(path.join(ОТКРЫТАЯ, ".git"))) {
  console.log("Не нашла рабочую копию открытого репозитория:");
  console.log("   " + ОТКРЫТАЯ);
  console.log("");
  console.log("Она должна быть клоном gallxxxx/quiz-render.");
  process.exit(1);
}

// Что переносим. Папки — целиком, файлы — поштучно.
const ПАПКИ = ["src", "tools", ".github", "public"];
const ФАЙЛЫ = [
  "package.json",
  "package-lock.json",
  "remotion.config.ts",
  "tsconfig.json",
  ".gitignore",
  "КАК-ПОЛЬЗОВАТЬСЯ.md",
];

// Что НЕ переносим даже из разрешённых папок.
const НЕ_НАДО = (относительный) => {
  const п = относительный.replace(/\\/g, "/");
  if (п.startsWith("_meta/")) return true;           // переписка по проекту
  if (п.startsWith("задания/")) return true;          // выпуски с фотографиями
  if (/^public\/.+\.(mp4|jpg|jpeg|png)$/i.test(п)) {
    // Клипы и фотографии текущего выпуска: качаются заново на сборке.
    // Заставки в public/covers — нужны, их оставляем.
    return !п.startsWith("public/covers/");
  }
  if (п.startsWith("public/voice/")) return true;     // озвучка синтезируется
  if (/^public\/_уже брали/.test(п)) return true;     // память подбора, своя у каждого
  if (/^ключ.*\.txt$/i.test(п)) return true;          // ключи — в секретах
  if (/(^|\/)_[^/]*\.mjs$/.test(п)) return true;      // одноразовые скрипты прошлых разборов
  return false;
};

const собрать = (корень, внутри = "") => {
  const список = [];
  const полный = path.join(корень, внутри);
  if (!fs.existsSync(полный)) return список;
  for (const имя of fs.readdirSync(полный)) {
    const отн = внутри ? внутри + "/" + имя : имя;
    if (НЕ_НАДО(отн)) continue;
    const это = path.join(корень, отн);
    if (fs.statSync(это).isDirectory()) список.push(...собрать(корень, отн));
    else список.push(отн);
  }
  return список;
};

const хочется = [];
for (const п of ПАПКИ) хочется.push(...собрать(QUIZ, п));
for (const ф of ФАЙЛЫ) if (fs.existsSync(path.join(QUIZ, ф)) && !НЕ_НАДО(ф)) хочется.push(ф);

// ——— что реально поменялось ———
// Текстовые файлы сравниваем, не замечая переводов строк: в рабочей
// папке Windows держит CRLF, а в репозитории лежит LF — иначе «изменилось»
// показывалось бы на каждом файле, и настоящие правки терялись бы в шуме.
const ТЕКСТ = /\.(mjs|js|ts|tsx|json|md|txt|yml|yaml|svg|html|gitignore)$/i;

const одинаковые = (a, b, отн) => {
  try {
    let x = fs.readFileSync(a);
    let y = fs.readFileSync(b);
    if (ТЕКСТ.test(отн) || отн.endsWith(".gitignore")) {
      const ровно = (буфер) => буфер.toString("utf8").split("\r\n").join("\n");
      return ровно(x) === ровно(y);
    }
    return x.length === y.length && x.equals(y);
  } catch {
    return false;
  }
};

const менять = хочется.filter((отн) => !одинаковые(path.join(QUIZ, отн), path.join(ОТКРЫТАЯ, отн), отн));

console.log("");
if (!менять.length) {
  console.log("Открытый репозиторий и так совпадает с рабочей папкой.");
  process.exit(0);
}

console.log(`Поедет файлов: ${менять.length}`);
for (const отн of менять.slice(0, 25)) console.log("   " + отн);
if (менять.length > 25) console.log(`   … и ещё ${менять.length - 25}`);

if (!правда) {
  console.log("");
  console.log("Это была примерка. Чтобы правда перенести и отправить:");
  console.log("   node tools/опубликовать.mjs --правда");
  process.exit(0);
}

for (const отн of менять) {
  const куда = path.join(ОТКРЫТАЯ, отн);
  fs.mkdirSync(path.dirname(куда), { recursive: true });
  fs.copyFileSync(path.join(QUIZ, отн), куда);
}

const git = (...args) => {
  const res = spawnSync("git", args, { cwd: ОТКРЫТАЯ, stdio: "inherit" });
  return res.status ?? 1;
};

git("add", "-A");
const код = git("commit", "-m", "Обновление кода из рабочей папки");
if (код !== 0) {
  console.log("");
  console.log("Коммитить нечего — значит, всё уже было отправлено раньше.");
  process.exit(0);
}
if (git("push") !== 0) {
  console.log("");
  console.log("Отправить не вышло. Посмотри, что написал git выше.");
  process.exit(1);
}

console.log("");
console.log("Готово: открытый репозиторий обновлён.");
