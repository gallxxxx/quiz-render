// Пульт для телефона.
//
// Поднимает на компьютере маленькую страничку. Телефон открывает её
// по адресу в той же Wi-Fi — и оттуда можно писать вопросы, кидать свои
// фотографии из галереи, менять картинки и собирать ролик. Всю тяжёлую
// работу по-прежнему делает компьютер: телефон только командует.
//
// Запуск: npm run phone

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { readRounds, readTexts, slots, writeToRoot } from "./read-rounds.mjs";
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
import { slug, findFfmpeg, PHOTO_W, PHOTO_H } from "./media.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIZ = path.join(HERE, "..");
const PUBLIC = path.join(QUIZ, "public");
const HOME = path.join(QUIZ, "..");
const VIDEOS = path.join(HOME, "Готовые видео");
const DROP = path.join(HOME, "Мои фото");
const THUMBS = path.join(QUIZ, "out", "thumbs");
// Путь к ffmpeg у каждой системы свой — спрашиваем общий поиск.
const FFMPEG = findFfmpeg();

const PORT = Number(process.env.QUIZ_PHONE_PORT ?? 3020);

// Код доступа: в одной Wi-Fi могут быть чужие. Четыре цифры, печатаются
// в окне на компьютере — без них страница ничего не покажет.
const CODE = String(Math.floor(1000 + Math.random() * 9000));

// ——— работа, которая идёт прямо сейчас ———
// Одновременно делаем только одно дело: два скрипта, пишущие в Root.tsx,
// портят данные — это проверено ещё на пакетной сборке.
const job = { name: "", running: false, lines: [], error: "", startedAt: 0 };

const startJob = (name, script, args = []) => {
  if (job.running) return false;
  job.name = name;
  job.running = true;
  job.lines = [];
  job.error = "";
  job.startedAt = Date.now();

  const child = spawn(process.execPath, [path.join(HERE, script), ...args], { cwd: QUIZ, env: { ...process.env, QUIZ_PHONE: "1" } });

  const take = (chunk) => {
    const text = chunk.toString();
    for (const line of text.split(String.fromCharCode(10))) {
      const s = line.replace(String.fromCharCode(13), "").trimEnd();
      if (s) job.lines.push(s);
    }
    while (job.lines.length > 400) job.lines.shift();
  };

  child.stdout.on("data", take);
  child.stderr.on("data", take);
  child.on("error", (e) => {
    job.error = e.message;
    job.running = false;
  });
  child.on("close", (code) => {
    if (code !== 0 && !job.error) job.error = "не получилось, код " + code;
    job.running = false;
  });
  return true;
};

// ——— мелкие помощники ———
const readBody = (req, limit = 30 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("файл слишком большой"));
        req.destroy();
        return;
      }
      parts.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });

const json = (res, data, status = 200) => {
  const body = Buffer.from(JSON.stringify(data), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": body.length,
  });
  res.end(body);
};

// Адрес компьютера в домашней сети — его и набирают на телефоне.
const lanAddress = () => {
  const nets = os.networkInterfaces();
  const found = [];
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      found.push(net.address);
    }
  }
  // домашние сети обычно 192.168.*, их и показываем первыми
  found.sort((a, b) => Number(b.startsWith("192.168.")) - Number(a.startsWith("192.168.")));
  return found;
};

// ——— картинка-превьюшка для одного места ———
// Показываем ровно то, что попадёт в кадр: квадрат по центру.
const thumbFor = async (item) => {
  const source = path.join(PUBLIC, item.image || "");
  if (!item.image || !fs.existsSync(source)) return null;

  fs.mkdirSync(THUMBS, { recursive: true });
  const target = path.join(THUMBS, item.n + "-" + slug(item.image) + ".jpg");

  try {
    const fresh =
      fs.existsSync(target) && fs.statSync(target).mtimeMs >= fs.statSync(source).mtimeMs;
    if (fresh) return fs.readFileSync(target);
  } catch {
    /* посчитаем заново */
  }

  let raw = null;
  if (item.image.toLowerCase().endsWith(".mp4")) {
    if (!FFMPEG) return null; // без ffmpeg кадр из клипа не вынуть — покажем пустое место
    const frame = path.join(THUMBS, "_кадр.png");
    spawnSync(FFMPEG, ["-y", "-ss", "2", "-i", source, "-frames:v", "1", frame], { stdio: "pipe" });
    if (!fs.existsSync(frame)) return null;
    raw = fs.readFileSync(frame);
  } else {
    raw = fs.readFileSync(source);
  }

  const buf = await sharp(raw).resize(420, 420, { fit: "cover" }).jpeg({ quality: 78 }).toBuffer();
  try {
    fs.writeFileSync(target, buf);
  } catch {
    /* не записалось — отдадим и так */
  }
  return buf;
};

// ——— что сейчас в проекте ———
const state = () => {
  const rounds = readRounds();
  const texts = readTexts();
  return {
    intro: texts.intro,
    outro: texts.outro,
    rounds: rounds.map((r) => ({
      top: { label: r.top.label, image: r.top.image ?? "" },
      bottom: { label: r.bottom.label, image: r.bottom.image ?? "" },
      topPercent: r.topPercent,
    })),
    slots: slots(rounds),
    settings: {
      mode: readMode(),
      modeName: MODE_NAMES[readMode()],
      shot: readShot(),
      voiceOn: readVoiceOn(),
      voiceName: readVoiceName(),
    },
    job: { name: job.name, running: job.running, lines: job.lines.slice(-14), error: job.error },
    videos: fs.existsSync(VIDEOS)
      ? fs
          .readdirSync(VIDEOS)
          .filter((n) => n.toLowerCase().endsWith(".mp4"))
          .map((n) => ({ name: n, size: Math.round(fs.statSync(path.join(VIDEOS, n)).size / 1048576) }))
          .reverse()
          .slice(0, 8)
      : [],
  };
};

// ——— сохранить вопросы, пришедшие с телефона ———
const saveFromPhone = (data) => {
  const rounds = readRounds();
  const next = (data.rounds ?? []).map((r, i) => {
    const was = rounds[i] ?? rounds[rounds.length - 1];
    return {
      ...was,
      top: { ...was.top, label: String(r.top?.label ?? was.top.label) },
      bottom: { ...was.bottom, label: String(r.bottom?.label ?? was.bottom.label) },
      topPercent: Math.max(1, Math.min(99, Number(r.topPercent ?? was.topPercent) || 50)),
    };
  });

  // Вопрос дописали с телефона — берём оформление у последнего и чистим
  // картинку: её подберут заново, старая тут ни при чём.
  while (next.length < (data.rounds ?? []).length) next.push(rounds[rounds.length - 1]);
  for (let i = rounds.length; i < next.length; i += 1) {
    next[i] = {
      ...next[i],
      top: { ...next[i].top, image: "" },
      bottom: { ...next[i].bottom, image: "" },
    };
  }

  writeToRoot({
    intro: data.intro ? { hook: String(data.intro.hook ?? ""), edition: String(data.intro.edition ?? "") } : undefined,
    outro: data.outro
      ? {
          title: String(data.outro.title ?? ""),
          subtitle: String(data.outro.subtitle ?? ""),
          cta: String(data.outro.cta ?? ""),
        }
      : undefined,
    rounds: next,
  });
};

// ——— своё фото с телефона ———
const acceptPhoto = async (n, fileName, base64) => {
  const rounds = readRounds();
  const list = slots(rounds);
  const item = list[n - 1];
  if (!item) throw new Error("нет такого места");

  const raw = Buffer.from(base64, "base64");
  if (raw.length < 1000) throw new Error("файл пустой");

  const ext = path.extname(String(fileName || "")).toLowerCase();
  const isVideo = [".mp4", ".mov", ".webm", ".m4v"].includes(ext);
  const name = slug(item.label) || "photo";

  fs.mkdirSync(DROP, { recursive: true });
  // Оригинал кладём к остальным своим файлам — пусть остаётся под рукой.
  fs.writeFileSync(path.join(DROP, item.label + (ext || ".jpg")), raw);

  if (isVideo) {
    const { prepareClip } = await import("./media.mjs");
    const tmp = path.join(os.tmpdir(), "phone-" + Date.now() + ext);
    fs.writeFileSync(tmp, raw);
    prepareClip(tmp, path.join(PUBLIC, name + ".mp4"));
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* Windows уберёт сам */
    }
    rounds[item.round][item.side].image = name + ".mp4";
  } else {
    const square = await sharp(raw).rotate().resize(PHOTO_W, PHOTO_H, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
    fs.writeFileSync(path.join(PUBLIC, name + ".jpg"), square);
    rounds[item.round][item.side].image = name + ".jpg";
  }

  writeToRoot({ rounds });
  return rounds[item.round][item.side].image;
};

// ——————————————————————————————————————————————————————————
//  Сам сервер
// ——————————————————————————————————————————————————————————
const PAGE = path.join(HERE, "phone.html");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const route = url.pathname;

  try {
    // Страница отдаётся всем: код спрашивается уже внутри неё.
    if (route === "/" || route === "/index.html") {
      const html = fs.readFileSync(PAGE);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(html);
      return;
    }

    // Всё остальное — только со знающих код.
    const given = url.searchParams.get("code") ?? req.headers["x-code"];
    if (given !== CODE) {
      json(res, { error: "код не подошёл" }, 403);
      return;
    }

    if (route === "/api/state") {
      json(res, state());
      return;
    }

    if (route === "/api/job") {
      json(res, { name: job.name, running: job.running, lines: job.lines.slice(-14), error: job.error });
      return;
    }

    if (route === "/api/save" && req.method === "POST") {
      const data = JSON.parse((await readBody(req)).toString("utf8"));
      saveFromPhone(data);
      json(res, { ok: true, ...state() });
      return;
    }

    if (route === "/api/settings" && req.method === "POST") {
      const data = JSON.parse((await readBody(req)).toString("utf8"));
      if (data.mode) writeMode(data.mode);
      if (data.shot) writeShot(data.shot);
      if (typeof data.voiceOn === "boolean") writeVoiceOn(data.voiceOn);
      if (data.voiceName) writeVoiceName(data.voiceName);
      json(res, { ok: true, settings: state().settings });
      return;
    }

    if (route === "/api/voices") {
      const { fetchVoices } = await import("./voice-list.mjs");
      const voices = (await fetchVoices()) ?? [];
      json(res, { voices: voices.map((v) => ({ short: v.short, name: v.name, gender: v.gender, country: v.country, tags: v.tags })) });
      return;
    }

    if (route === "/api/run" && req.method === "POST") {
      const data = JSON.parse((await readBody(req)).toString("utf8"));
      let started = false;
      if (data.what === "all") started = startJob("Делаю ролик целиком", "all.mjs");
      else if (data.what === "media") started = startJob("Подбираю картинки", "get-media.mjs");
      else if (data.what === "build") started = startJob("Собираю ролик", "build.mjs");
      else if (data.what === "replace") started = startJob("Меняю картинку", "replace-one.mjs", [String(data.n)]);
      else {
        json(res, { error: "не знаю такой команды" }, 400);
        return;
      }
      json(res, started ? { ok: true } : { error: "одно дело уже идёт, подожди" }, started ? 200 : 409);
      return;
    }

    if (route === "/api/photo" && req.method === "POST") {
      const data = JSON.parse((await readBody(req)).toString("utf8"));
      const image = await acceptPhoto(Number(data.n), data.name, data.data);
      json(res, { ok: true, image });
      return;
    }

    if (route.startsWith("/thumb/")) {
      const n = Number(route.slice("/thumb/".length).replace(".jpg", ""));
      const item = slots(readRounds())[n - 1];
      const buf = item ? await thumbFor(item) : null;
      if (!buf) {
        json(res, { error: "пусто" }, 404);
        return;
      }
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "Content-Length": buf.length });
      res.end(buf);
      return;
    }

    if (route.startsWith("/video/")) {
      const name = decodeURIComponent(route.slice("/video/".length));
      const file = path.join(VIDEOS, path.basename(name));
      if (!fs.existsSync(file)) {
        json(res, { error: "нет такого файла" }, 404);
        return;
      }
      const size = fs.statSync(file).size;
      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Length": size,
        "Content-Disposition": 'attachment; filename="video.mp4"',
      });
      fs.createReadStream(file).pipe(res);
      return;
    }

    json(res, { error: "не туда" }, 404);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, "0.0.0.0", async () => {
  const addresses = lanAddress();
  const line = (s) => console.log("   " + s);
  console.log("");
  console.log("  ==========================================================");
  console.log("   ПУЛЬТ ДЛЯ ТЕЛЕФОНА ВКЛЮЧЁН");
  console.log("  ==========================================================");
  console.log("");
  line("Открой на телефоне браузер и набери адрес:");
  console.log("");
  for (const a of addresses) line("      http://" + a + ":" + PORT);

  if (addresses.length) {
    const url = "http://" + addresses[0] + ":" + PORT + "/?code=" + CODE;
    try {
      const qr = (await import("qrcode-terminal")).default;
      console.log("");
      line("Или наведи камеру телефона сюда:");
      console.log("");
      qr.generate(url, { small: true });
    } catch {
      /* нет картинки с кодом — ничего, адрес выше */
    }
  }
  if (addresses.length === 0) line("      компьютер не в сети — включи Wi-Fi");
  console.log("");
  line("Код доступа: " + CODE);
  console.log("");
  line("Телефон и компьютер должны быть в одной Wi-Fi.");
  line("Пока это окно открыто — пульт работает.");
  line("Закрыла окно — выключился.");
  console.log("");
});
