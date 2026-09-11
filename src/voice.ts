// Озвучка. Этот файл пишет кнопка сборки — руками его трогать не нужно.
//
// null означает «для этого места записи нет» — тогда просто ничего не звучит.

export type Voice = {
  intro: string | null;
  rounds: (string | null)[];
  outro: string | null;
};

export const VOICE: Voice = {
  "intro": "voice/intro.mp3",
  "rounds": [
    "voice/round-1.mp3",
    "voice/round-2.mp3",
    "voice/round-3.mp3",
    "voice/round-4.mp3",
    "voice/round-5.mp3",
    "voice/round-6.mp3",
    "voice/round-7.mp3",
    "voice/round-8.mp3",
    "voice/round-9.mp3"
  ],
  "outro": "voice/outro.mp3"
};

// Сколько секунд длится каждая запись — по ним фразы расставляются так,
// чтобы не звучать одновременно.
export const VOICE_SECONDS = {
  "intro": 3.79,
  "rounds": [
    2.62,
    2.76,
    2.54,
    2.59,
    2.98,
    2.9,
    2.5,
    2.3,
    3.12
  ],
  "outro": 6.1
};

// Громкость, задержка и подрезка — в файле voice-settings.ts,
// он специально отдельный, чтобы кнопка их не затирала.
