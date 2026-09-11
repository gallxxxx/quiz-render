// Кнопка «СОБРАТЬ РОЛИК»: сначала озвучка, потом сборка.
//
// Озвучка включается строкой ОЗВУЧКА в «настройки.txt». Если текст
// вопросов с прошлого раза не менялся, синтезатор не тревожится —
// голос уже лежит в папке.

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readVoiceOn } from "./media-mode.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");

const run = (script, args = []) =>
  spawnSync(process.execPath, [path.join(HERE, script), ...args], {
    cwd: QUIZ,
    stdio: "inherit",
  }).status ?? 1;

if (readVoiceOn()) {
  const code = run("voice-make.mjs");
  if (code !== 0) {
    console.log("");
    console.log("Озвучить не вышло — собираю ролик без голоса.");
    console.log("");
  }
} else {
  run("voice-make.mjs", ["--выключить"]);
}

process.exitCode = run("render.mjs");
