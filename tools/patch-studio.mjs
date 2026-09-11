// Нумерация вопросов в редакторе с ЕДИНИЦЫ, а не с нуля.
//
// Список раундов рисует сам Remotion и подписывает элементы номером
// в массиве: 0, 1, 2... Для программиста это привычно, для Вики — нет:
// «третий вопрос» и «2:» в форме не сходятся, и правится не то место.
//
// Своей ручки для этого у Remotion нет, поэтому меняем подпись прямо
// в его файлах. Правка косметическая: сами данные и порядок не меняются,
// трогается только текст ярлыка.
//
// Скрипт безопасно запускать сколько угодно раз: уже исправленные файлы
// он пропускает. Запускается сам при открытии редактора — поэтому
// переустановка Remotion ничего не ломает, патч просто ляжет заново.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUDIO = path.join(HERE, "..", "node_modules", "@remotion", "studio", "dist");

const ANCHOR = "const lastKey = jsonPath[jsonPath.length - 1]";
const OLD = "${lastKey}";
const NEW = "${lastKey + 1}";

// Где искать: сам модуль и собранные для браузера файлы.
const candidates = () => {
  const list = [
    path.join(STUDIO, "components", "RenderModal", "SchemaEditor", "get-schema-label.js"),
  ];
  const esm = path.join(STUDIO, "esm");
  if (fs.existsSync(esm)) {
    for (const name of fs.readdirSync(esm)) {
      if (name.endsWith(".js") || name.endsWith(".mjs")) list.push(path.join(esm, name));
    }
  }
  return list.filter((f) => fs.existsSync(f));
};

// В функции три места с номером. Первые два — ветка «ключ это число»,
// их и правим. Третье — обычные поля вроде intro, туда лезть нельзя.
const patchOnce = (text) => {
  const at = text.indexOf(ANCHOR);
  if (at === -1) return null;

  const end = text.indexOf("};", at);
  if (end === -1) return null;

  const block = text.slice(at, end);
  if (block.includes(NEW)) return null; // уже поправлено

  let done = 0;
  let fixed = block;
  while (done < 2) {
    const i = fixed.indexOf(OLD);
    if (i === -1) break;
    fixed = fixed.slice(0, i) + NEW + fixed.slice(i + OLD.length);
    done++;
  }
  if (done === 0) return null;

  return text.slice(0, at) + fixed + text.slice(end);
};

let changed = 0;
let already = 0;

for (const file of candidates()) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!text.includes(ANCHOR)) continue;

  const fixed = patchOnce(text);
  if (!fixed) {
    already++;
    continue;
  }

  try {
    fs.writeFileSync(file, fixed, "utf8");
    changed++;
  } catch {
    /* файл занят — не повод падать, редактор всё равно откроется */
  }
}

// Интерфейс редактора собирается вебпаком и лежит в кэше. Если кэш не
// стереть, студия покажет старую сборку и правка будет не видна —
// на этом я и попался, пока проверял.
//
// Метка нужна, чтобы стереть кэш ровно один раз: и когда правку внесли
// только что, и когда файлы уже были поправлены раньше, а кэш остался.
const CACHE = path.join(HERE, "..", "node_modules", ".cache");
const MARK = path.join(CACHE, "нумерация с единицы.txt");

if ((changed > 0 || already > 0) && !fs.existsSync(MARK)) {
  try {
    fs.rmSync(path.join(CACHE, "webpack"), { recursive: true, force: true });
  } catch {
    /* занят — студия пересоберёт сама при следующем запуске */
  }
  try {
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(MARK, "кэш очищен после правки нумерации", "utf8");
  } catch {
    /* не записалось — в следующий раз почистим ещё раз, вреда нет */
  }
}

if (process.argv.includes("--вслух")) {
  console.log(`нумерация в редакторе: поправлено файлов ${changed}, уже было ${already}`);
}
