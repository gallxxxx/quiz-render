// Рисует картинки-заглушки для раундов (пока нет настоящих фото).
// Запуск: node tools/make-images.mjs
import fs from "fs";
import path from "path";

const OUT = path.join(process.cwd(), "public");

// slug, цвет 1, цвет 2, цвет акцента
const ITEMS = [
  ["sea",      "#0B5E6B", "#5FD3C4", "#EAF7F3"],
  ["mountain", "#5B3A2E", "#C98B62", "#F6E7D6"],
  ["coffee",   "#3B2318", "#A9663C", "#F0DCC4"],
  ["tea",      "#1F5A4A", "#8FCBA6", "#EEF7EA"],
  ["summer",   "#C4622F", "#F5C46B", "#FFF3D9"],
  ["winter",   "#284A63", "#A8D5E5", "#F2FAFD"],
  ["cat",      "#6B3B2A", "#D79A6E", "#F8E9DA"],
  ["dog",      "#7A4A22", "#E2B37A", "#FBEEDD"],
  ["pizza",    "#8E2F1E", "#E8A05A", "#FFECD2"],
  ["sushi",    "#0E6360", "#7FC9BE", "#EDF8F5"],
  ["sunrise",  "#B4482F", "#F7C978", "#FFF1DA"],
  ["sunset",   "#7A2A46", "#E58A63", "#FFE6D6"],
  ["plane",    "#125F76", "#8ED0DF", "#EFFAFC"],
  ["train",    "#4A3B2A", "#C0A277", "#F6EEE1"],
  ["city",     "#2C2A3D", "#8E8AB0", "#EFEDF7"],
  ["nature",   "#1D5637", "#86C08A", "#EDF7EC"],
  ["aurora",   "#0A2B44", "#43D6A5", "#E6FBF3"],
  ["sakura",   "#8C2B4A", "#F0A9BE", "#FFEDF2"],
];

const S = 900;

const svg = (i, [slug, c1, c2, acc]) => {
  const rot = (i * 37) % 360;
  const shapes = [
    `<circle cx="${180 + (i % 3) * 120}" cy="${200 + (i % 4) * 90}" r="${140 + (i % 3) * 40}" fill="${acc}" opacity="0.13"/>`,
    `<circle cx="${720 - (i % 3) * 90}" cy="${700 - (i % 4) * 70}" r="${190 - (i % 3) * 30}" fill="${acc}" opacity="0.10"/>`,
    `<path d="M0 ${640 + (i % 3) * 40} Q ${S / 2} ${480 + (i % 4) * 60} ${S} ${620 - (i % 3) * 30} L ${S} ${S} L 0 ${S} Z" fill="${c1}" opacity="0.55"/>`,
    `<circle cx="${S / 2}" cy="${S / 2}" r="300" fill="none" stroke="${acc}" stroke-width="3" opacity="0.22"/>`,
    `<circle cx="${S / 2}" cy="${S / 2}" r="230" fill="none" stroke="${acc}" stroke-width="2" opacity="0.16"/>`,
  ].join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" gradientTransform="rotate(${rot} 0.5 0.5)">
      <stop offset="0%" stop-color="${c2}"/>
      <stop offset="100%" stop-color="${c1}"/>
    </linearGradient>
    <radialGradient id="vig" cx="50%" cy="42%" r="72%">
      <stop offset="55%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.35"/>
    </radialGradient>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  ${shapes}
  <rect width="${S}" height="${S}" fill="url(#vig)"/>
  <text x="${S / 2}" y="${S - 46}" font-family="Arial, sans-serif" font-size="26" letter-spacing="6"
        fill="${acc}" opacity="0.55" text-anchor="middle">REPLACE PHOTO</text>
</svg>`;
};

ITEMS.forEach((it, i) => fs.writeFileSync(path.join(OUT, `${it[0]}.svg`), svg(i, it)));
console.log(`готово: ${ITEMS.length} картинок`);
