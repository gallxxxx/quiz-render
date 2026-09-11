// Наводит порядок в папке «Готовые видео».
//
// Раньше имя складывалось из даты сборки, и после каждой пересборки
// выпуск уезжал в конец списка. Теперь имя совпадает с папкой черновика:
//
//   01 FOOD.mp4      02 DESSERTS.mp4      03 BREAKFAST.mp4  …
//
// Порядок в папке всегда один и тот же, независимо от того,
// что и когда пересобиралось.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listDrafts } from "./draft.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIDEOS = path.join(HERE, "..", "..", "Готовые видео");

let renamed = 0;
let missing = 0;

for (const draft of listDrafts()) {
  const data = draft.data;
  const current = data.video;
  if (!current) continue;

  const from = path.join(VIDEOS, current);
  const wanted = `${draft.name}.mp4`; // «01 FOOD.mp4»
  const to = path.join(VIDEOS, wanted);

  // Вика помечает отсмотренные ролики прямо в имени: «01 FOOD одобрено.mp4».
  // Такие файлы не трогаем — только запоминаем новое имя, иначе кнопка 10
  // потеряет видео, а пометка пропадёт.
  const marked = fs
    .readdirSync(VIDEOS)
    .find((f) => f.startsWith(draft.name) && f.endsWith(".mp4") && f !== wanted);
  if (marked) {
    if (data.video !== marked) {
      data.video = marked;
      fs.writeFileSync(
        path.join(draft.dir, "данные.json"),
        JSON.stringify(data, null, 2) + "\n",
        "utf8",
      );
      console.log(`  оставил твою пометку: ${marked}`);
    }
    continue;
  }

  if (current === wanted && fs.existsSync(to)) continue;

  if (!fs.existsSync(from)) {
    // Файл уже мог быть переименован в прошлый раз — тогда всё в порядке.
    if (fs.existsSync(to)) {
      data.video = wanted;
      fs.writeFileSync(
        path.join(draft.dir, "данные.json"),
        JSON.stringify(data, null, 2) + "\n",
        "utf8",
      );
      continue;
    }
    console.log(`  нет файла: ${current}`);
    missing += 1;
    continue;
  }

  try {
    if (fs.existsSync(to)) fs.rmSync(to, { force: true });
    fs.renameSync(from, to);
  } catch (e) {
    console.log(`  не смог переименовать ${current}: ${e.message}`);
    continue;
  }

  // Черновик должен знать новое имя, иначе кнопка 10 потеряет видео.
  data.video = wanted;
  fs.writeFileSync(
    path.join(draft.dir, "данные.json"),
    JSON.stringify(data, null, 2) + "\n",
    "utf8",
  );

  // И памятка рядом с ним.
  const memo = path.join(draft.dir, "что это.txt");
  try {
    const text = fs.readFileSync(memo, "utf8");
    fs.writeFileSync(
      memo,
      text.replace(/Готовые видео\\.*\.mp4/, `Готовые видео\\${wanted}`),
      "utf8",
    );
  } catch {
    /* памятки нет — не страшно */
  }

  console.log(`  ${current}  →  ${wanted}`);
  renamed += 1;
}

console.log("");
console.log(`переименовано: ${renamed}${missing ? `, потерялось: ${missing}` : ""}`);
