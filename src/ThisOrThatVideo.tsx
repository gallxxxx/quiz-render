import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  interpolateColors,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { punch, splitReveal } from "./transitions";
import { VOICE, VOICE_SECONDS } from "./voice";
import {
  VOICE_DELAY_FRAMES,
  VOICE_TRIM_END,
  VOICE_TRIM_START,
  VOICE_VOLUME,
} from "./voice-settings";
import { FONT_FAMILY, loadMontserrat } from "./font";
import {
  COUNTDOWN_SECONDS,
  FPS,
  INTRO,
  INTRO_FRAMES,
  IntroText,
  OUTRO,
  OUTRO_FRAMES,
  OutroText,
  PALETTE as P,
  REVEAL_SECONDS,
  ROUNDS,
  Round,
  Side,
  TRANSITION_FRAMES,
} from "./thisorthat-data";

const FONT = FONT_FAMILY;

// ————————————— Раскладка половины под интерфейс TikTok —————————————
// Сверху кадр закрывает шторка телефона, снизу — описание ролика.
// Поэтому подписи уведены к середине, а картинки — к краям, но с отступом,
// чтобы не были приклеены к границе кадра.
//
// Бюджет половины — 960 px (1920 / 2):
//   MEDIA_EDGE + MEDIA_H + рамка(12) + LABEL_GAP + LABEL_BOX  должно
//   оставлять хотя бы ~30 px до таймера, который начинается на 860-м пикселе.
const MEDIA_EDGE = 140; // отступ картинки от верхнего / нижнего края кадра
// Картинка широкая, 16:9. Была квадратная 610×610 — Вика попросила крупнее
// и горизонтально. Площадь выросла примерно в полтора раза, а по высоте
// стало свободнее: 140 + 540 + 12 + 18 + 108 = 818, до полосы-таймера
// на 860-м пикселе остаётся запас.
const MEDIA_W = 960;    // ширина картинки (по бокам остаётся по 60 px)
const MEDIA_H = 540;    // высота картинки
const LABEL_GAP = 18;   // просвет между картинкой и подписью
const LABEL_BOX = 108;  // высота строки подписи
const BAR_H = 64;       // высота центральной полосы-таймера
// Проценты живут внутри картинки, а нижняя картинка уходит под описание ролика.
// Поэтому плашку с процентом сдвигаем от центра картинки к середине кадра:
// у верхней половины вниз, у нижней вверх. Обе половины остаются зеркальными.
const PERCENT_SHIFT = 80;

// В поле image может лежать и картинка, и видеоклип — различаем по расширению
export const isVideoFile = (name: string) => /\.(mp4|webm|mov|m4v)$/i.test(name);

// Толстая подпись с обводкой — читается на любом фоне
const stroked = (px: number, color: string = P.cream): React.CSSProperties => ({
  fontFamily: FONT,
  color,
  WebkitTextStroke: `${px}px ${P.ink}`,
  paintOrder: "stroke",
  textShadow: "0 10px 28px rgba(0,0,0,0.35)",
});

// ————————————————————————— Корона победителя —————————————————————————
const Crown: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size * 0.72} viewBox="0 0 100 72" fill="none">
    <path
      d="M8 60 L2 16 L26 34 L50 6 L74 34 L98 16 L92 60 Z"
      fill={P.gold}
      stroke={P.ink}
      strokeWidth="5"
      strokeLinejoin="round"
    />
    <rect x="8" y="60" width="84" height="10" rx="5" fill={P.gold} stroke={P.ink} strokeWidth="5" />
  </svg>
);

// ————————————————————————— Полоса-таймер по центру —————————————————————————
// Круглый таймер занимал 200 px посреди кадра и раздвигал половины к краям,
// под шторку и описание TikTok. Полоса делает то же самое в 64 px и заодно
// работает линией стыка — отдельная полоска между половинами больше не нужна.
//
// Заливка не ползёт слева направо, а СЖИМАЕТСЯ к середине: последний остаток
// цвета оказывается прямо под цифрой, к нулю всё сходится в точку.
const CenterBar: React.FC<{
  seconds: number;
  frame: number;
  fps: number;
  index: number;
  total: number;
  fade: number; // 1 пока идёт таймер, 0 после показа процентов
}> = ({ seconds, frame, fps, index, total, fade }) => {
  const totalFrames = seconds * fps;
  const progress = interpolate(frame, [0, totalFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const secondsLeft = Math.max(0, Math.ceil(seconds - frame / fps));

  // лёгкий «удар» цифры в начале каждой секунды
  const intoSecond = frame % fps;
  const pulse = interpolate(intoSecond, [0, 8], [1.16, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // в последние секунды заливка теплеет от золота до терракоты
  const fillColor = interpolateColors(secondsLeft, [1, 3], [P.terracotta, P.gold]);

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: 0,
        right: 0,
        height: BAR_H,
        marginTop: -BAR_H / 2,
        boxSizing: "border-box",
        background: P.ink,
        borderTop: `5px solid ${P.cream}`,
        borderBottom: `5px solid ${P.cream}`,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 0 40px rgba(0,0,0,0.45)",
        zIndex: 12,
      }}
    >
      {/* заливка: сжимается к середине */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "50%",
          width: `${progress * 100}%`,
          transform: "translateX(-50%)",
          background: fillColor,
          opacity: fade,
        }}
      />

      {/*
        Цифра и счётчик едут по заливке, а кремовый текст на золоте мылится.
        Поэтому оба сидят на тёмной подложке цвета самой полосы: пока под ними
        заливка — подложка видна тёмной плашкой, ушла заливка — сливается
        с полосой и её попросту нет.
      */}
      <div
        style={{
          position: "absolute",
          left: 24,
          height: 44,
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          borderRadius: 999,
          background: P.ink,
          color: P.cream,
          fontFamily: FONT,
          fontSize: 30,
          fontWeight: 800,
          letterSpacing: 1,
        }}
      >
        {index + 1} / {total}
      </div>

      <div
        style={{
          position: "relative",
          minWidth: 46,
          height: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 22px",
          borderRadius: 999,
          background: P.ink,
          color: P.cream,
          fontFamily: FONT,
          fontSize: 46,
          fontWeight: 900,
          letterSpacing: -1,
          transform: `scale(${pulse})`,
          opacity: fade,
        }}
      >
        {secondsLeft}
      </div>
    </div>
  );
};

// ————————————————————————— Половина экрана —————————————————————————
const Half: React.FC<{
  side: Side;
  percent: number;
  isTop: boolean;
  revealFrame: number; // < 0 пока идёт таймер
  isWinner: boolean;
}> = ({ side, percent, isTop, revealFrame, isWinner }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const revealed = revealFrame >= 0;

  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 });
  const enterShift = interpolate(enter, [0, 1], [isTop ? -40 : 40, 0]);

  const pop = revealed
    ? spring({ frame: revealFrame, fps, config: { damping: 11, mass: 0.55 } })
    : 0;

  const shownPercent = revealed
    ? Math.round(
        interpolate(revealFrame, [0, 26], [0, percent], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        }),
      )
    : 0;

  // Плавный наезд (или отъезд) камеры на фото — верх и низ в разные стороны,
  // чтобы кадр не выглядел статичной картинкой.
  const kenBurns = isTop
    ? 1 + frame * 0.00045
    : 1.095 - frame * 0.00045;

  const scale = revealed ? interpolate(pop, [0, 1], [1, isWinner ? 1.04 : 0.955]) : 1;
  const dim = revealed && !isWinner ? interpolate(pop, [0, 1], [0, 1]) : 0;

  return (
    <div
      style={{
        flex: 1,
        position: "relative",
        overflow: "hidden",
        background: `radial-gradient(125% 95% at 50% ${
          isTop ? "26%" : "74%"
        }, rgba(255,255,255,0.17), rgba(0,0,0,0.20) 78%), ${side.color}`,
      }}
    >
      {/*
        Порядок внутри половины: КАРТИНКА у внешнего края, ПОДПИСЬ у середины.
        В TikTok верх кадра закрывает шторка, низ — описание ролика, поэтому
        текст уведён к центру, где ничего не перекрывается. Картинка терпит
        частичное перекрытие, текст — нет.
        MEDIA_EDGE — отступ от края кадра: картинка не приклеена к нему.
      */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: isTop ? "column" : "column-reverse",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: LABEL_GAP,
          paddingTop: isTop ? MEDIA_EDGE : 0,
          paddingBottom: isTop ? 0 : MEDIA_EDGE,
          transform: `translateY(${enterShift}px) scale(${scale})`,
          opacity: enter,
        }}
      >
        <div
          style={{
            position: "relative",
            width: MEDIA_W,
            height: MEDIA_H,
            borderRadius: 34,
            overflow: "hidden",
            border: "6px solid rgba(247,239,228,0.92)",
            boxShadow: "0 26px 64px rgba(0,0,0,0.38)",
          }}
        >
          {isVideoFile(side.image) ? (
            <OffthreadVideo
              src={staticFile(side.image)}
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: `grayscale(${dim * 0.75}) brightness(${1 - dim * 0.3})`,
              }}
            />
          ) : (
            <Img
              src={staticFile(side.image)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                // медленный наезд камеры: фото перестаёт быть «мёртвым»
                transform: `scale(${kenBurns})`,
                filter: `grayscale(${dim * 0.75}) brightness(${1 - dim * 0.3})`,
              }}
            />
          )}

          {/*
            Страна — маленькой плашкой в углу, как подпись на открытке.
            Угол берём со стороны середины кадра (у верхней половины — нижний,
            у нижней — верхний): у краёв её съедает интерфейс TikTok.
          */}
          {side.country ? (
            <div
              style={{
                position: "absolute",
                left: 22,
                top: isTop ? undefined : 22,
                bottom: isTop ? 22 : undefined,
                background: "rgba(20,14,11,0.62)",
                border: "2px solid rgba(247,239,228,0.35)",
                borderRadius: 999,
                padding: "9px 20px",
                fontFamily: FONT,
                fontWeight: 700,
                fontSize: 27,
                letterSpacing: 2.5,
                textTransform: "uppercase",
                color: "rgba(247,239,228,0.94)",
                opacity: interpolate(enter, [0.4, 1], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              {side.country}
            </div>
          ) : null}

          {/* Плашка с процентом поверх картинки */}
          {revealed ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                transform: `translateY(${
                  isTop ? PERCENT_SHIFT : -PERCENT_SHIFT
                }px) scale(${interpolate(pop, [0, 1], [0.55, 1])})`,
                opacity: interpolate(pop, [0, 0.35], [0, 1], { extrapolateRight: "clamp" }),
              }}
            >
              {isWinner ? (
                <div style={{ marginBottom: 4 }}>
                  <Crown size={110} />
                </div>
              ) : null}
              <div
                style={{
                  ...stroked(7, isWinner ? P.cream : "rgba(247,239,228,0.85)"),
                  fontSize: isWinner ? 148 : 128,
                  fontWeight: 900,
                  lineHeight: 1,
                  letterSpacing: -4,
                }}
              >
                {shownPercent}%
              </div>
              <div
                style={{
                  width: 300,
                  height: 14,
                  borderRadius: 999,
                  background: "rgba(27,19,16,0.45)",
                  border: "2px solid rgba(247,239,228,0.35)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${shownPercent}%`,
                    height: "100%",
                    background: isWinner ? P.gold : "rgba(247,239,228,0.7)",
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div
          style={{
            ...stroked(5),
            height: LABEL_BOX,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 58,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -0.5,
            textAlign: "center",
            maxWidth: 940,
            padding: "0 40px",
          }}
        >
          {side.label}
        </div>
      </div>

      {/* Затемнение проигравшей половины */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#0F0A08",
          opacity: dim * 0.42,
          pointerEvents: "none",
        }}
      />
    </div>
  );
};

// ————————————————————————— Один раунд —————————————————————————
export const RoundScene: React.FC<{ data: Round; index: number; total: number }> = ({
  data,
  index,
  total,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cdSeconds = data.countdown ?? COUNTDOWN_SECONDS;
  const cdFrames = cdSeconds * fps;
  const revealFrame = frame - cdFrames;
  const revealed = revealFrame >= 0;

  // процент задаётся только для верхней половины, нижняя считается сама
  const topPercent = Math.max(0, Math.min(100, Math.round(data.topPercent)));
  const bottomPercent = 100 - topPercent;
  const topWins = topPercent > bottomPercent;
  const bottomWins = bottomPercent > topPercent;

  // таймер не исчезает резко, а сжимается и гаснет
  const timerOut = revealed
    ? interpolate(revealFrame, [0, 9], [1, 0], { extrapolateRight: "clamp" })
    : 1;

  return (
    <AbsoluteFill style={{ flexDirection: "column", background: P.ink }}>
      <Half
        side={data.top}
        percent={topPercent}
        isTop
        revealFrame={revealFrame}
        isWinner={topWins}
      />
      <Half
        side={data.bottom}
        percent={bottomPercent}
        isTop={false}
        revealFrame={revealFrame}
        isWinner={bottomWins}
      />

      {/*
        Полоса-таймер. Она же линия стыка половин и она же счётчик раундов —
        всё служебное собрано в одном месте посреди кадра, где ничего
        не перекрывает интерфейс TikTok.
      */}
      <CenterBar
        seconds={cdSeconds}
        frame={frame}
        fps={fps}
        index={index}
        total={total}
        fade={timerOut}
      />

      {/* ——— звук ——— */}
      <Audio src={staticFile("swoosh.wav")} volume={0.12} />
      {Array.from({ length: cdSeconds }).map((_, i) => (
        <Sequence key={i} from={i * fps} durationInFrames={fps}>
          <Audio
            src={staticFile("tick.wav")}
            volume={i === cdSeconds - 1 ? 0.34 : 0.22}
            playbackRate={i === cdSeconds - 1 ? 1.25 : 1}
          />
        </Sequence>
      ))}
      <Sequence from={cdFrames}>
        <Audio src={staticFile("reveal.wav")} volume={0.3} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ————————————————————————— Заставка —————————————————————————
// Короткая: главное — крупный вопрос-крючок, чтобы человек залип за секунду.
const Intro: React.FC<{ text: IntroText }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 13, mass: 0.5 } });
  const s2 = spring({ frame: frame - 5, fps, config: { damping: 14, mass: 0.5 } });

  // Медленный наезд — тот же приём, что и на фотографиях в раундах,
  // иначе нарисованная заставка выглядит застывшей картинкой.
  const coverZoom = interpolate(frame, [0, INTRO_FRAMES], [1, 1.06], {
    extrapolateRight: "clamp",
  });

  // На нарисованной заставке рамка под текст уже есть — свою не рисуем.
  const onCover = Boolean(text.cover);
  // Текст просто проявляется: никаких подрастаний, иначе он «ездит»
  // относительно нарисованной рамки, которая стоит неподвижно.
  const fade = interpolate(frame, [2, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ flexDirection: "column" }}>
      <div style={{ flex: 1, background: P.terracotta }} />
      <div style={{ flex: 1, background: P.turquoise }} />
      {text.cover ? (
        <AbsoluteFill>
          <Img
            src={staticFile(text.cover)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${coverZoom})`,
            }}
          />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
        <div
          style={{
            background: onCover ? "transparent" : P.cream,
            borderRadius: 40,
            // Своя рамка была почти впритык к краям кадра — ужали её,
            // чтобы по бокам оставалась видимая полоса фона.
            // Нарисованную заставку (onCover) не трогаем: там ширину
            // задаёт сама картинка, и текст под неё уже подогнан.
            padding: onCover ? "0 70px" : "48px 52px",
            margin: onCover ? "0 50px" : "0 90px",
            textAlign: "center",
            // Появление у текста прежнее — с пружинкой. Меняется только то,
            // что своей рамки под ним нет: она уже нарисована на картинке.
            // На нарисованной заставке рамка стоит чуть выше центра кадра,
            // поэтому текст приподнимаем — иначе он лежит на её нижнем крае.
            transform: `translateY(${onCover ? -50 : 0}px) scale(${interpolate(
              s,
              [0, 1],
              [0.82, 1],
            )}) rotate(${interpolate(s, [0, 1], [-4, -2])}deg)`,
            boxShadow: onCover ? "none" : "0 30px 80px rgba(0,0,0,0.4)",
            border: onCover ? "none" : `8px solid ${P.ink}`,
          }}
        >
          <div
            style={{
              fontFamily: FONT,
              fontWeight: 900,
              fontSize: 86,
              lineHeight: 1.02,
              letterSpacing: -2.5,
              color: P.terracottaDeep,
              maxWidth: onCover ? 840 : 750,
              textTransform: "uppercase",
            }}
          >
            {text.hook}
          </div>
        </div>

        <div
          style={{
            background: P.ink,
            color: P.cream,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 36,
            letterSpacing: 2,
            padding: "16px 36px",
            borderRadius: 999,
            textTransform: "uppercase",
            // Под нарисованной рамкой, а не внутри неё: рамка на картинке
            // кончается примерно на 59% высоты кадра.
            position: onCover ? "absolute" : "static",
            top: onCover ? "62%" : undefined,
            opacity: onCover ? fade : s2,
            transform: onCover
              ? "none"
              : `translateY(${interpolate(s2, [0, 1], [22, 0])}px)`,
            boxShadow: "0 16px 40px rgba(0,0,0,0.3)",
          }}
        >
          {text.edition}
        </div>
      </AbsoluteFill>
      <Audio src={staticFile("swoosh.wav")} volume={0.14} />
    </AbsoluteFill>
  );
};

// ————————————————————————— Концовка —————————————————————————
const Outro: React.FC<{ text: OutroText }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14 } });
  const s2 = spring({ frame: frame - 10, fps, config: { damping: 14 } });

  return (
    <AbsoluteFill
      style={{
        background: P.cream,
        alignItems: "center",
        justifyContent: "center",
        gap: 34,
        padding: 80,
      }}
    >
      <div style={{ display: "flex", gap: 18, marginBottom: 10 }}>
        <div style={{ width: 140, height: 16, borderRadius: 999, background: P.terracotta }} />
        <div style={{ width: 140, height: 16, borderRadius: 999, background: P.turquoise }} />
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 900,
          fontSize: 104,
          lineHeight: 1.03,
          letterSpacing: -3,
          textAlign: "center",
          color: P.terracottaDeep,
          transform: `scale(${interpolate(s, [0, 1], [0.86, 1])})`,
        }}
      >
        {text.title}
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 52,
          color: P.ink,
          opacity: s2,
          transform: `translateY(${interpolate(s2, [0, 1], [26, 0])}px)`,
        }}
      >
        {text.subtitle}
      </div>
      <div
        style={{
          marginTop: 8,
          background: P.turquoiseDeep,
          color: P.cream,
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 36,
          padding: "20px 44px",
          borderRadius: 999,
          opacity: s2,
          boxShadow: "0 18px 44px rgba(0,0,0,0.25)",
          textAlign: "center",
        }}
      >
        {text.cta}
      </div>
      <Audio src={staticFile("reveal.wav")} volume={0.22} />
    </AbsoluteFill>
  );
};

// ————————————————————————— Сборка всего видео —————————————————————————
const roundFrames = (r: Round) => (r.countdown ?? COUNTDOWN_SECONDS) * FPS + REVEAL_SECONDS * FPS;

// Если озвучка концовки длиннее самой концовки — растягиваем её,
// иначе последняя фраза обрывалась бы на полуслове.
const outroFrames = () =>
  Math.max(OUTRO_FRAMES, Math.ceil((VOICE_SECONDS.outro + 0.5) * FPS) + VOICE_DELAY_FRAMES);

// Без заставки из ролика уходит и её сцена, и переход после неё —
// иначе Remotion считал бы длительность по сценам, которых нет,
// и в конце оставался бы пустой хвост.
export const totalDuration = (rounds: Round[], introOff = false) => {
  const list = rounds && rounds.length ? rounds : ROUNDS;
  const sequences =
    (introOff ? 0 : INTRO_FRAMES) + list.reduce((s, r) => s + roundFrames(r), 0) + outroFrames();
  const transitions = (list.length + (introOff ? 0 : 1)) * TRANSITION_FRAMES;
  return sequences - transitions;
};

const timing = linearTiming({
  durationInFrames: TRANSITION_FRAMES,
  easing: Easing.inOut(Easing.cubic),
});

export const ThisOrThatVideo: React.FC<{
  rounds: Round[];
  intro?: IntroText;
  outro?: OutroText;
}> = ({ rounds, intro, outro }) => {
  const [handle] = useState(() => delayRender("Загрузка шрифта"));
  useEffect(() => {
    loadMontserrat()
      .then(() => continueRender(handle))
      .catch(() => continueRender(handle));
  }, [handle]);

  const list = rounds && rounds.length ? rounds : ROUNDS;
  const introText = intro ?? INTRO;
  const outroText = outro ?? OUTRO;
  const children: React.ReactElement[] = [];

  // Заставку можно выключить — тогда ролик начинается сразу с первого выбора.
  const introOff = Boolean(introText.off);

  if (!introOff) {
    children.push(
      <TransitionSeries.Sequence key="intro" durationInFrames={INTRO_FRAMES}>
        <Intro text={introText} />
      </TransitionSeries.Sequence>,
    );
    children.push(<TransitionSeries.Transition key="t-intro" presentation={punch()} timing={timing} />);
  }

  list.forEach((r, i) => {
    children.push(
      <TransitionSeries.Sequence key={`r${i}`} durationInFrames={roundFrames(r)}>
        <RoundScene data={r} index={i} total={list.length} />
      </TransitionSeries.Sequence>,
    );
    const last = i === list.length - 1;
    children.push(
      <TransitionSeries.Transition
        key={`t${i}`}
        presentation={last ? punch() : splitReveal()}
        timing={timing}
      />,
    );
  });

  children.push(
    <TransitionSeries.Sequence key="outro" durationInFrames={outroFrames()}>
      <Outro text={outroText} />
    </TransitionSeries.Sequence>,
  );

  // ——— Озвучка ———
  // Кладём её не внутрь сцен, а поверх всего ролика на точных кадрах:
  // иначе фраза обрывалась бы на границе сцены.
  let cursor = introOff ? 0 : INTRO_FRAMES - TRANSITION_FRAMES;
  const roundStarts = list.map((r) => {
    const start = cursor;
    cursor += roundFrames(r) - TRANSITION_FRAMES;
    return start;
  });
  const outroStart = cursor;

  const voiceTrack: React.ReactElement[] = [];

  // Фраза не должна начинаться, пока не договорила предыдущая:
  // заставка длиннее своей сцены, и её голос иначе перебивал бы первый вопрос.
  const GAP = 5;
  let freeFrom = 0;

  const speak = (
    key: string,
    clip: string | null,
    desiredStart: number,
    seconds: number,
    trimSeconds = 0,
    trimEndSeconds = 0,
  ) => {
    if (!clip) return;
    const total = Math.max(0, Math.ceil((seconds || 0) * FPS));
    const trim = Math.max(0, Math.round((trimSeconds || 0) * FPS));
    const cut = Math.max(0, Math.round((trimEndSeconds || 0) * FPS));
    // до какого кадра записи играем. Хотя бы один кадр всё равно остаётся,
    // даже если подрезать попросили больше, чем длится сама фраза
    const stop = Math.max(trim + 1, total - cut);
    const start = Math.max(desiredStart, freeFrom);
    // из длины вычитаем подрезанное с обеих сторон, иначе следующая фраза ждёт зря
    freeFrom = start + (stop - trim) + GAP;
    voiceTrack.push(
      <Sequence key={key} from={start}>
        <Audio
          src={staticFile(clip)}
          volume={VOICE_VOLUME}
          trimBefore={trim || undefined}
          trimAfter={cut ? stop : undefined}
        />
      </Sequence>,
    );
  };

  // Нет заставки — нет и её фразы: иначе голос про тему выпуска звучал бы
  // поверх первого вопроса.
  if (!introOff) {
    speak(
      "v-intro",
      VOICE.intro,
      0,
      VOICE_SECONDS.intro,
      VOICE_TRIM_START.intro,
      VOICE_TRIM_END.intro,
    );
  }

  roundStarts.forEach((start, i) => {
    speak(
      `v-${i}`,
      VOICE.rounds[i] ?? null,
      start + VOICE_DELAY_FRAMES,
      VOICE_SECONDS.rounds[i] ?? 0,
      VOICE_TRIM_START.rounds[i] ?? 0,
      VOICE_TRIM_END.rounds[i] ?? 0,
    );
  });

  speak(
    "v-outro",
    VOICE.outro,
    outroStart + VOICE_DELAY_FRAMES,
    VOICE_SECONDS.outro,
    VOICE_TRIM_START.outro,
    VOICE_TRIM_END.outro,
  );

  return (
    <AbsoluteFill style={{ background: P.ink }}>
      <TransitionSeries>{children}</TransitionSeries>
      {voiceTrack}
    </AbsoluteFill>
  );
};
