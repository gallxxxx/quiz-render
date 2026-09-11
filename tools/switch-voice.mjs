// Кнопка «Голос диктора» для основной папки: только озвучка,
// картинки здесь подбираются отдельными кнопками.

import readline from "node:readline";
import { readVoiceName, readVoiceOn, writeVoiceName, writeVoiceOn } from "./media-mode.mjs";
import { makeSample, openFolder, pickVoice, SAMPLES } from "./voice-list.mjs";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));

const on = readVoiceOn();
const name = readVoiceName();

console.log("");
console.log("ГОЛОС ДИКТОРА");
console.log("");
console.log(`   сейчас: ${on ? name : "выключен, ролик собирается без голоса"}`);
console.log("");
console.log("Голос читает фразу с заставки, каждый вопрос и концовку.");
console.log("Бесплатно, ключ не нужен, записывается сам при сборке ролика.");
console.log("");
console.log(`   1 — ${on ? "выключить озвучку" : "включить озвучку"}`);
console.log("   2 — выбрать другой голос");
console.log("   3 — послушать, как звучит нынешний голос");
console.log("");
console.log("Можно сразу несколько через пробел: «1 2».");
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

let voiceNow = name;

for (const choice of picked) {
  if (choice === "1") {
    writeVoiceOn(!on);
    console.log("");
    console.log(
      on
        ? "Готово: озвучка выключена, ролик соберётся без голоса."
        : "Готово: озвучка включена. Голос появится сам при сборке ролика.",
    );
  } else if (choice === "2") {
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
  } else if (choice === "3") {
    await sample(voiceNow);
  } else {
    console.log("");
    console.log(`Не поняла пункт «${choice}» — пропускаю.`);
  }
}

console.log("");
rl.close();
