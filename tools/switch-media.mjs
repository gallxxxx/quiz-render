// Кнопка «НАСТРОЙКИ» — всё, что можно выбрать, в одном месте.
//
// Пункты можно называть сразу несколько через пробел: «2 4 5».

import readline from "node:readline";
import {
  MODE_NAMES,
  readMode,
  readShot,
  readVoiceName,
  readVoiceOn,
  writeMode,
  writeShot,
  writeVoiceName,
  writeVoiceOn,
} from "./media-mode.mjs";
import { makeSample, openFolder, pickVoice, SAMPLES } from "./voice-list.mjs";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));

const mode = readMode();
const shot = readShot();
const voiceOn = readVoiceOn();
const voiceName = readVoiceName();

console.log("");
console.log("КАК СЕЙЧАС НАСТРОЕНО");
console.log("");
console.log(`   в кадре: ${MODE_NAMES[mode]}`);
console.log(
  `   план:    ${shot} (${shot === "крупный" ? "еда, предметы, цветы" : "города, природа, машины, животные"})`,
);
console.log(`   голос:   ${voiceOn ? voiceName : "выключен, ролик без голоса"}`);
console.log("");
console.log("ЧТО ПОМЕНЯТЬ:");
console.log("");
console.log("   1 — видеоклипы со стока. Живое видео, ролик выглядит дороже");
console.log("   2 — фотографии из интернета. Быстрее и почти всегда по теме");
console.log("   3 — мои файлы. Кладёшь их в папку «Мои фото» сама");
console.log("");
console.log("   4 — план съёмки: крупный или общий");
console.log(`   5 — озвучка: сейчас ${voiceOn ? "включена" : "выключена"}`);
console.log("   6 — выбрать голос диктора");
console.log("   7 — послушать нынешний голос");
console.log("");
console.log("Можно сразу несколько через пробел: «2 4 6».");
console.log("Enter — ничего не менять.");
console.log("");

const answer = await ask("Твой выбор: ");
const picked = answer.split(" ").map((s) => s.trim()).filter(Boolean);

const SAMPLE_TEXT = "Pizza, or Burger? How many matched? Tell me in the comments.";

const sample = async (short) => {
  console.log("");
  console.log("Записываю пробную фразу...");
  try {
    const file = await makeSample(short, SAMPLE_TEXT);
    if (!file) throw new Error("файл не получился");
    console.log("");
    console.log(`Готово: папка «Голоса», файл ${short}.mp3`);
    console.log("Сейчас её открою — послушай двойным щелчком.");
    openFolder(SAMPLES);
  } catch (e) {
    console.log("");
    console.log(`Не вышло записать пробу: ${e.message}`);
    console.log("Чаще всего это интернет — попробуй позже.");
  }
};

if (picked.length === 0) {
  console.log("");
  console.log("Ничего не поменяла.");
}

let shotNow = shot;
let voiceNow = voiceName;
let modeChanged = false;

for (const choice of picked) {
  if (choice === "1" || choice === "2" || choice === "3") {
    const chosen = { 1: "видео", 2: "фото", 3: "свое" }[choice];
    writeMode(chosen);
    modeChanged = true;
    console.log("");
    console.log(`Теперь в кадр идёт: ${MODE_NAMES[chosen]}`);
    if (chosen === "свое") {
      console.log("Файлы кладутся в папку «Мои фото» и называются как подпись вопроса.");
    }
  } else if (choice === "4") {
    shotNow = shotNow === "крупный" ? "общий" : "крупный";
    writeShot(shotNow);
    console.log("");
    console.log(`План теперь: ${shotNow}.`);
    console.log(
      shotNow === "крупный"
        ? "Так ищут еду, напитки, цветы и мелкие предметы — предмет во весь кадр."
        : "Так ищут города, природу, машины и животных — иначе приходит эмблема вместо машины.",
    );
  } else if (choice === "5") {
    writeVoiceOn(!voiceOn);
    console.log("");
    console.log(
      voiceOn
        ? "Озвучка выключена — ролик соберётся без голоса."
        : "Озвучка включена. Голос появится сам при сборке ролика.",
    );
  } else if (choice === "6") {
    const chosen = await pickVoice(ask, voiceNow);
    if (chosen) {
      writeVoiceName(chosen.short);
      voiceNow = chosen.short;
      console.log("");
      console.log(`Голос теперь: ${chosen.name}, ${chosen.gender}, ${chosen.country}.`);
      console.log("");
      const listen = await ask("Послушать его? Enter — да, «н» — нет: ");
      if (listen === "") await sample(chosen.short);
    } else {
      console.log("");
      console.log("Оставила прежний голос.");
    }
  } else if (choice === "7") {
    await sample(voiceNow);
  } else {
    console.log("");
    console.log(`Не поняла пункт «${choice}» — пропускаю.`);
  }
}

if (modeChanged) {
  console.log("");
  console.log("Дальше жми кнопку «4 ПОДОБРАТЬ КАРТИНКИ».");
}

console.log("");
rl.close();
