// Локальный Montserrat: файлы лежат в public/fonts, интернет не нужен.
import { staticFile } from "remotion";

export const FONT_FAMILY = "Montserrat, Arial, sans-serif";

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const CYRILLIC = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116";

const WEIGHTS = ["700", "800", "900"] as const;

let started: Promise<void> | null = null;

export const loadMontserrat = (): Promise<void> => {
  if (started) return started;

  const faces: FontFace[] = [];
  for (const w of WEIGHTS) {
    faces.push(
      new FontFace("Montserrat", `url(${staticFile(`fonts/mont-latin-${w}.woff2`)})`, {
        weight: w,
        style: "normal",
        unicodeRange: LATIN,
      }),
    );
    faces.push(
      new FontFace("Montserrat", `url(${staticFile(`fonts/mont-cyr-${w}.woff2`)})`, {
        weight: w,
        style: "normal",
        unicodeRange: CYRILLIC,
      }),
    );
  }

  started = Promise.all(
    faces.map((f) =>
      f.load().then((loaded) => {
        document.fonts.add(loaded);
      }),
    ),
  ).then(() => undefined);

  return started;
};
