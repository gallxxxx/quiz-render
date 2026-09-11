// Генерирует звуки для видео прямо на месте, без скачивания.
// Запуск: node tools/make-sounds.mjs
//
// Все звуки намеренно мягкие и тихие: никаких ударов и резкого шипения.
import fs from "fs";
import path from "path";

const SR = 44100;
const OUT = path.join(process.cwd(), "public");

const wav = (s) => {
  const b = Buffer.alloc(44 + s.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + s.length * 2, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(s.length * 2, 40);
  for (let i = 0; i < s.length; i++) {
    const v = Math.max(-1, Math.min(1, s[i]));
    b.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return b;
};

const buf = (sec) => new Float32Array(Math.round(SR * sec));

const norm = (a, peak) => {
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] = (a[i] / m) * peak;
  return a;
};

// плавные края, чтобы не было щелчков
const fade = (a, inMs, outMs) => {
  const ni = Math.round((inMs / 1000) * SR);
  const no = Math.round((outMs / 1000) * SR);
  for (let i = 0; i < ni && i < a.length; i++) a[i] *= i / ni;
  for (let i = 0; i < no && i < a.length; i++) a[a.length - 1 - i] *= i / no;
  return a;
};

// ——— тик таймера: тихий деревянный «ток», без цоканья ———
const tick = () => {
  const a = buf(0.19);
  for (let i = 0; i < a.length; i++) {
    const t = i / SR;
    // мягкая синусоида + тихая октава сверху, никакого шума
    const body = Math.sin(2 * Math.PI * 620 * t) * Math.exp(-t * 26);
    const upper = Math.sin(2 * Math.PI * 1240 * t) * Math.exp(-t * 46) * 0.18;
    a[i] = body + upper;
  }
  return fade(norm(a, 0.42), 4, 30);
};

// ——— раскрытие процентов: тёплый мягкий колокольчик ———
// Без низкого удара и без «искр» — просто приятная нота с медленным затуханием.
const reveal = () => {
  const a = buf(1.8);
  for (let i = 0; i < a.length; i++) {
    const t = i / SR;
    const attack = 1 - Math.exp(-t / 0.028); // мягкая атака, не «бах»
    // мажорное трезвучие, верхние ноты тише и гаснут быстрее
    const n1 = Math.sin(2 * Math.PI * 523.25 * t) * Math.exp(-t * 2.2);
    const n2 = Math.sin(2 * Math.PI * 659.25 * t) * Math.exp(-t * 2.6) * 0.55;
    const n3 = Math.sin(2 * Math.PI * 783.99 * t) * Math.exp(-t * 3.2) * 0.3;
    const body = Math.sin(2 * Math.PI * 261.63 * t) * Math.exp(-t * 2.0) * 0.35;
    a[i] = (n1 + n2 + n3 + body) * attack;
  }
  return fade(norm(a, 0.5), 6, 120);
};

// ——— переход: очень тихий, глухой выдох воздуха ———
const swoosh = () => {
  const sec = 0.42;
  const a = buf(sec);
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / SR;
    const p = t / sec;
    // низкая частота среза = глухой звук, без шипения
    const cut = 0.006 + 0.055 * Math.sin(Math.PI * p);
    const n = Math.random() * 2 - 1;
    lp1 += cut * (n - lp1);
    lp2 += cut * (lp1 - lp2); // второй проход фильтра — ещё мягче
    const env = Math.pow(Math.sin(Math.PI * p), 2.2);
    a[i] = lp2 * env;
  }
  return fade(norm(a, 0.3), 25, 60);
};

fs.writeFileSync(path.join(OUT, "tick.wav"), wav(tick()));
fs.writeFileSync(path.join(OUT, "reveal.wav"), wav(reveal()));
fs.writeFileSync(path.join(OUT, "swoosh.wav"), wav(swoosh()));
console.log("готово: tick.wav, reveal.wav, swoosh.wav (мягкие)");
