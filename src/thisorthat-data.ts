// ============================================================
//  ДАННЫЕ ВИДЕО
//  Обычно сюда лезть не нужно — раунды правятся в студии.
// ============================================================

export const FPS = 30;

// ——— Тайминги (в секундах / кадрах) ———
export const COUNTDOWN_SECONDS = 5;   // сколько тикает таймер
export const REVEAL_SECONDS = 2;      // сколько висят проценты после нуля
export const INTRO_FRAMES = 60;       // заставка, 2 сек
export const OUTRO_FRAMES = 150;      // концовка, 5 сек
export const TRANSITION_FRAMES = 15;  // переход между раундами, 0.5 сек

// ——— Фирменные цвета ———
export const PALETTE = {
  terracotta: "#C1613C",
  terracottaDeep: "#A44E2E",
  turquoise: "#12888A",
  turquoiseDeep: "#0C6E70",
  cream: "#F7EFE4",
  ink: "#1B1310",
  gold: "#E8B65F",
};

export type Side = {
  label: string;    // подпись
  image: string;    // имя файла из папки public/
  color: string;    // фон половины
  country?: string; // страна, маленькой плашкой в углу кадра
};

export type Round = {
  top: Side;
  bottom: Side;
  topPercent: number;  // процент ВЕРХНЕЙ половины. Нижняя = 100 минус это число.
  countdown?: number;  // секунд на таймере, по умолчанию COUNTDOWN_SECONDS
};

const T = PALETTE.terracotta;
const TD = PALETTE.terracottaDeep;
const Q = PALETTE.turquoise;
const QD = PALETTE.turquoiseDeep;

// 9 раундов = ровно 1:05 вместе с заставкой и концовкой.
export const ROUNDS: Round[] = [
  {
    top:    { label: "Big Ben", image: "big-ben.jpg", color: T },
    bottom: { label: "Sydney Opera House", image: "sydney-opera-house.jpg", color: Q },
    topPercent: 43,
  },
  {
    top:    { label: "Taj Mahal", image: "taj-mahal.jpg", color: TD },
    bottom: { label: "Colosseum", image: "colosseum.jpg", color: QD },
    topPercent: 58,
  },
  {
    top:    { label: "Grand Canyon", image: "grand-canyon.jpg", color: T },
    bottom: { label: "Niagara Falls", image: "niagara-falls.jpg", color: Q },
    topPercent: 63,
  },
  {
    top:    { label: "Mount Fuji", image: "mount-fuji.jpg", color: TD },
    bottom: { label: "Machu Picchu", image: "machu-picchu.jpg", color: QD },
    topPercent: 52,
  },
  {
    top:    { label: "Pamukkale", image: "pamukkale.jpg", color: T },
    bottom: { label: "Santorini", image: "santorini.jpg", color: Q },
    topPercent: 46,
  },
  {
    top:    { label: "Mount Kilimanjaro", image: "mount-kilimanjaro.jpg", color: TD },
    bottom: { label: "Bora Bora", image: "bora-bora.jpg", color: QD },
    topPercent: 39,
  },
  {
    top:    { label: "Phuket", image: "phuket.jpg", color: T },
    bottom: { label: "Burj Khalifa", image: "burj-khalifa.jpg", color: Q },
    topPercent: 66,
  },
  {
    top:    { label: "Sagrada Familia", image: "sagrada-familia.jpg", color: TD },
    bottom: { label: "Petra", image: "petra.jpg", color: QD },
    topPercent: 44,
  },
  {
    top:    { label: "Louvre Museum", image: "louvre-museum.jpg", color: T },
    bottom: { label: "Marina Bay Sands", image: "marina-bay-sands.jpg", color: Q },
    topPercent: 58,
  },
];

// ——— Тексты заставки и концовки ———
// Их же можно менять в студии под каждый ролик.
// cover — имя картинки в public (например «covers/food.jpg»).
// Это нарисованная заставка с предметами по теме; текст ложится поверх.
// off: заставку не показываем вовсе — ролик начинается сразу с выбора.
export type IntroText = { hook: string; edition: string; cover?: string; off?: boolean };
export type OutroText = { title: string; subtitle: string; cta: string };

export const INTRO: IntroText = {
  hook: "IF IT WAS FREE, WHAT WOULD YOU PICK?",
  edition: "WORLD LANDMARKS EDITION",
};

export const OUTRO: OutroText = {
  title: "HOW MANY MATCHED?",
  subtitle: "tell me in the comments",
  cta: "all my best quizzes are on my profile",
};
