import { Composition } from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { ThisOrThatVideo, totalDuration } from "./ThisOrThatVideo";
import { ROUNDS, FPS, INTRO, OUTRO } from "./thisorthat-data";

// Схема нужна, чтобы Remotion Studio показал удобную форму справа:
// подписи, проценты, цвета и тексты заставки можно менять прямо в браузере.
const sideSchema = z.object({
  label: z.string(),
  image: z.string(),
  color: zColor(),
  // страна — маленькой плашкой в углу кадра, можно оставить пустым
  country: z.string().optional(),
});

const roundSchema = z.object({
  top: sideSchema,
  bottom: sideSchema,
  // Процент только у верхней половины. Нижняя считается сама: 100 минус это число.
  topPercent: z.number().min(0).max(100),
  countdown: z.number().min(1).max(30).optional(),
});

export const thisOrThatSchema = z.object({
  // Заставка: крупный вопрос-крючок и строчка с темой выпуска
  intro: z.object({
    hook: z.string(),
    edition: z.string(),
    // Картинка с предметами по теме: «covers/food.jpg». Пусто — заставка
    // рисуется как раньше, двумя цветными половинами.
    cover: z.string().optional(),
    // Заставку можно выключить — ролик начнётся сразу с первого выбора.
    off: z.boolean().optional(),
  }),
  rounds: z.array(roundSchema),
  // Концовка
  outro: z.object({
    title: z.string(),
    subtitle: z.string(),
    cta: z.string(),
  }),
});

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ThisOrThat"
      component={ThisOrThatVideo}
      schema={thisOrThatSchema}
      defaultProps={{"intro":{"hook":"THE KEYS ARE YOURS. WHICH CAR?","edition":"SUPERCARS EDITION","cover":"covers/supercars.jpg"},"rounds":[{"top":{"label":"Ferrari","image":"ferrari.mp4","color":"#C1613C","country":"Italy"},"bottom":{"label":"Lamborghini","image":"lamborghini.mp4","color":"#12888A","country":"Italy"},"topPercent":47},{"top":{"label":"Porsche","image":"porsche.mp4","color":"#C1613C","country":"Germany"},"bottom":{"label":"Aston Martin","image":"aston-martin.mp4","color":"#12888A","country":"England"},"topPercent":60},{"top":{"label":"Supra","image":"supra.mp4","color":"#C1613C","country":"Japan"},"bottom":{"label":"McLaren","image":"mclaren.mp4","color":"#12888A","country":"England"},"topPercent":39},{"top":{"label":"Mustang","image":"mustang.mp4","color":"#C1613C","country":"USA"},"bottom":{"label":"Corvette","image":"corvette.mp4","color":"#12888A","country":"USA"},"topPercent":56},{"top":{"label":"Rolls Royce","image":"rolls-royce.mp4","color":"#C1613C","country":"England"},"bottom":{"label":"Dodge Charger","image":"dodge-charger.mp4","color":"#12888A","country":"USA"},"topPercent":58},{"top":{"label":"Mercedes","image":"mercedes.mp4","color":"#C1613C","country":"Germany"},"bottom":{"label":"BMW","image":"bmw.mp4","color":"#12888A","country":"Germany"},"topPercent":51},{"top":{"label":"Jeep","image":"jeep.mp4","color":"#C1613C","country":"USA"},"bottom":{"label":"Land Rover","image":"land-rover.mp4","color":"#12888A","country":"England"},"topPercent":46},{"top":{"label":"Tesla","image":"tesla.mp4","color":"#C1613C","country":"USA"},"bottom":{"label":"Audi","image":"audi.mp4","color":"#12888A","country":"Germany"},"topPercent":55},{"top":{"label":"Nissan GT-R","image":"nissan-gt-r.mp4","color":"#C1613C","country":"Japan"},"bottom":{"label":"Cadillac","image":"cadillac.mp4","color":"#12888A","country":"USA"},"topPercent":45}],"outro":{"title":"WHAT ARE YOU DRIVING?","subtitle":"comment your dream car","cta":"follow for more"}}}
      durationInFrames={totalDuration(ROUNDS)}
      fps={FPS}
      width={1080}
      height={1920}
      calculateMetadata={({ props }) => ({
        durationInFrames: totalDuration(props.rounds, props.intro?.off),
      })}
    />
  );
};
