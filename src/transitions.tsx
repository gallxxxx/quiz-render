import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import type {
  TransitionPresentation,
  TransitionPresentationComponentProps,
} from "@remotion/transitions";
import { PALETTE as P } from "./thisorthat-data";

type SplitProps = Record<string, never>;

// ————————————————————————————————————————————————————————————————
//  Фирменный переход «створки»
//  Следующий раунд раскрывается из линии стыка — узкая полоса
//  посередине разъезжается вверх и вниз, пока не займёт весь экран.
//  Уходящий кадр в это время чуть наезжает и темнеет.
// ————————————————————————————————————————————————————————————————
const SplitRevealComponent: React.FC<TransitionPresentationComponentProps<SplitProps>> = ({
  children,
  presentationProgress,
  presentationDirection,
}) => {
  const p = interpolate(presentationProgress, [0, 1], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
  });

  if (presentationDirection === "exiting") {
    return (
      <AbsoluteFill
        style={{
          transform: `scale(${1 + 0.06 * p})`,
          filter: `brightness(${1 - 0.25 * p})`,
        }}
      >
        {children}
      </AbsoluteFill>
    );
  }

  // Входящий кадр: полоса от центра, растущая к краям
  const inset = (1 - p) * 50;

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: `inset(${inset}% 0% ${inset}% 0%)` }}>
        {children}
      </AbsoluteFill>

      {/* светлые кромки по краям раскрытия — как будто створки разъезжаются */}
      {p < 0.97 ? (
        <>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${inset}%`,
              height: 8,
              marginTop: -4,
              background: P.cream,
              opacity: interpolate(p, [0, 0.2, 1], [0, 1, 0.2]),
              boxShadow: `0 0 34px 8px rgba(247,239,228,0.5)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: `${inset}%`,
              height: 8,
              marginBottom: -4,
              background: P.cream,
              opacity: interpolate(p, [0, 0.2, 1], [0, 1, 0.2]),
              boxShadow: `0 0 34px 8px rgba(247,239,228,0.5)`,
            }}
          />
        </>
      ) : null}
    </AbsoluteFill>
  );
};

export const splitReveal = (): TransitionPresentation<SplitProps> => ({
  component: SplitRevealComponent,
  props: {},
});

// ————————————————————————————————————————————————————————————————
//  Переход «толчок» — для заставки и концовки
//  Кадр коротко наезжает и уходит, следующий влетает с лёгким зумом.
// ————————————————————————————————————————————————————————————————
const PunchComponent: React.FC<TransitionPresentationComponentProps<SplitProps>> = ({
  children,
  presentationProgress,
  presentationDirection,
}) => {
  const p = interpolate(presentationProgress, [0, 1], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
  });

  if (presentationDirection === "exiting") {
    return (
      <AbsoluteFill style={{ transform: `scale(${1 + 0.12 * p})`, opacity: 1 - p }}>
        {children}
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill
      style={{
        transform: `scale(${interpolate(p, [0, 1], [1.14, 1])})`,
        opacity: interpolate(p, [0, 0.55], [0, 1], { extrapolateRight: "clamp" }),
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const punch = (): TransitionPresentation<SplitProps> => ({
  component: PunchComponent,
  props: {},
});
