// Кнопка «10 Открыть черновик»: показывает список сохранённых выпусков
// и возвращает выбранный обратно в редактор.

import readline from "node:readline";
import { listDrafts, loadDraft } from "./draft.mjs";
import { restoreFiles, stashAll } from "./media-store.mjs";

const drafts = listDrafts();

if (drafts.length === 0) {
  console.log("Черновиков пока нет.");
  console.log("");
  console.log("Они появляются сами, когда собирается ролик:");
  console.log("папка «Черновики» лежит рядом с кнопками.");
  process.exitCode = 0;
} else {
  console.log("СОХРАНЁННЫЕ ВЫПУСКИ");
  console.log("");
  drafts.forEach((d, i) => {
    const rounds = d.data.rounds?.length ?? 0;
    console.log(`  ${i + 1}. ${d.data.edition}  (${rounds} вопросов, ${d.data.saved})`);
  });
  console.log("");

  const pick = (answer) => {
    const n = Number(String(answer).trim());
    if (!Number.isInteger(n) || n < 1 || n > drafts.length) {
      console.log("Такого номера нет. Запусти кнопку ещё раз.");
      return;
    }
    const draft = drafts[n - 1];
    if (loadDraft(draft)) {
      // Клипы выпуска лежат в архиве — возвращаем их на место,
      // иначе ролик не найдёт свои картинки.
      stashAll();
      // По именам файлов, а не по подписям: они могут не совпадать.
      const files = (draft.data.rounds ?? []).flatMap((r) => [
        r.top?.image,
        r.bottom?.image,
      ]);
      const back = restoreFiles(files.filter(Boolean));
      console.log("");
      console.log(`Вернул клипы этого выпуска на место: ${back} шт.`);
      console.log(`Загружено: ${draft.data.edition}`);
      console.log("");
      console.log("Что дальше:");
      console.log("  - текст для 11 labs лежит в папке черновика: озвучка.txt");
      console.log("  - записала голос → положи файлы в «11 labs» → кнопка 8");
      console.log("  - потом кнопка 6 соберёт ролик уже с голосом");
    } else {
      console.log("Не получилось загрузить черновик.");
    }
  };

  const fromArg = process.argv[2];
  if (fromArg) {
    pick(fromArg);
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Введи номер выпуска: ", (answer) => {
      pick(answer);
      rl.close();
    });
  }
}
