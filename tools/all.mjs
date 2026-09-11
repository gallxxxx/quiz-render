// Всё сразу: подобрать картинки, озвучить, собрать ролик.
// Одна кнопка вместо трёх — этим пользуется пульт для телефона.

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");

const run = (script) =>
  spawnSync(process.execPath, [path.join(HERE, script)], { cwd: QUIZ, stdio: "inherit" }).status ?? 1;

console.log("");
console.log("ШАГ 1 из 2 — картинки");
const media = run("get-media.mjs");
if (media !== 0) {
  console.log("");
  console.log("На картинках споткнулись — ролик не собираю.");
  process.exit(media);
}

console.log("");
console.log("ШАГ 2 из 2 — озвучка и сборка");
const build = run("build.mjs");
process.exitCode = build;
