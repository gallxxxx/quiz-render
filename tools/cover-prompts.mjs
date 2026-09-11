// Промпты для нарисованных заставок.
//
// Заставка — первые две секунды ролика: пустая рамка посередине, вокруг
// предметы по теме выпуска. Наш текст ложится поверх, поэтому картинка
// рисуется БЕЗ НАДПИСЕЙ — иначе нарисованные буквы вылезут из-под нашей плашки.
//
// Рисуем НЕ с нуля, а поверх Викиной болванки `_meta/cover-template.jpg`:
// две цветные половины и пустая кремовая табличка. Нейросети остаётся только
// дорисовать предметы вокруг. Так рамка всегда на своём месте и одного
// размера — под неё уже подогнан сдвиг текста в заставке (translateY -50).

// Общая часть промпта. Меняется только список предметов.
// Картинка-образец уходит отдельным параметром --image-references.
export const buildPrompt = (items) =>
  [
    "Use the attached picture as the base and keep it exactly as it is.",
    "The terracotta upper half, the turquoise lower half, and the blank cream sign with the thick dark outline all stay unchanged: same position, same tilt, same size, same colours.",
    "Never draw anything inside the sign. It must stay completely empty — no letters, no words, no numbers, no logo, no watermark, no signature, just flat cream colour.",
    `Add flat vector cartoon illustrations around the sign: ${items}.`,
    "Place them only in the terracotta area above the sign and in the turquoise area below the sign. They must never overlap the sign or cover any part of it, so the middle of the poster stays clean.",
    "Draw everything with bold uniform dark charcoal outlines, flat cheerful colours and simple shapes: no gradients, no realistic textures, no photographic detail.",
    "Children's picture-book sticker style, clean and friendly.",
  ].join(" ");

// Что нарисовать вокруг рамки для каждой темы.
// Держимся простых узнаваемых предметов: мелкие детали в этом стиле мажутся.
export const COVER_ITEMS = {
  desserts:
    "a tall slice of layered cake, a cupcake with a cherry, a stack of macarons, a chocolate donut, an ice cream cone and a croissant",
  breakfast:
    "a fried egg on a plate, a stack of pancakes with syrup, a steaming coffee mug, a glass of orange juice, a bagel and a bowl of cereal",
  "street-food":
    "a hot dog, a slice of pizza, a paper cone of french fries, a taco, a bag of popcorn and a food truck window",
  drinks:
    "a tall glass of iced coffee, a lemonade with a straw, a cup of tea, a milkshake with whipped cream, a bottle of soda and a coconut drink",
  snacks:
    "a bowl of popcorn, a bag of potato chips, salted pretzels, a chocolate bar, nachos and a handful of nuts",
  "asian-food":
    "a bowl of ramen with chopsticks, sushi rolls on a board, a steaming bamboo basket of dumplings, a bowl of rice, a takeaway noodle box and a teapot",
  bbq: "a grill with flames, skewers of meat and vegetables, a juicy burger, barbecue ribs, a corn cob and a bottle of sauce",
  fruits:
    "a watermelon slice, a bunch of bananas, a pineapple, strawberries, an orange cut in half and a bunch of grapes",
  "dream-cities":
    "the Eiffel Tower, a red double-decker bus, a New York skyline silhouette, a Tokyo neon sign shape, a taxi and small fluffy clouds",
  beaches:
    "palm trees, a striped beach umbrella with a deck chair, a surfboard stuck in the sand, a starfish, a beach ball and gentle ocean waves",
  islands:
    "a small tropical island with two palm trees, an overwater bungalow on stilts, a sailboat, a snorkel mask, a seashell and calm ocean waves",
  "wonders-of-nature":
    "a tall waterfall between cliffs, a volcano, a canyon with layered rock, northern lights ribbons, a geyser and pine trees",
  "night-cities":
    "a skyline of tall buildings with lit windows, a crescent moon, stars, glowing street lamps, a ferris wheel and a bridge with lights",
  mountains:
    "snow-capped mountain peaks, a pine forest, a hiking backpack, a small tent, a cable car cabin and clouds",
  "lakes-waterfalls":
    "a calm lake with a wooden pier, a waterfall falling into a pool, a canoe, water lilies, tall reeds and pine trees",
  "summer-winter":
    "on top a bright sun, a beach ball and an ice cream cone; below a snowman, a snowflake and a warm knitted hat",
  luxury:
    "a diamond ring, a champagne bottle with two glasses, a designer handbag, a gold wristwatch, a private jet silhouette and a stack of gold coins",
  supercars:
    "a low sports car in side view, a racing helmet, a chequered flag, a car wheel, a speedometer and a fuel pump",
  "dream-homes":
    "a modern glass villa, a swimming pool with a diving board, a cosy wooden cabin, a palm tree, a garden lounge chair and a front door with a lamp",
  gadgets:
    "a smartphone, a laptop, wireless headphones, a smartwatch, a game controller and a camera",
  animals:
    "a lion head, a giraffe, an elephant, a zebra, a panda and a monkey",
  pets: "a dog with a wagging tail, a cat curled up, a hamster, a goldfish in a bowl, a parrot on a perch and a rabbit",
  "sea-creatures":
    "a dolphin, an octopus, a sea turtle, a jellyfish, a starfish and a school of small fish with bubbles",
  birds:
    "a parrot, an owl, a flamingo, a peacock with an open tail, a small blue bird on a branch and a swan",
  flowers:
    "a sunflower, a red rose, a tulip, a daisy, a bunch of lavender and a potted plant with green leaves",
};

// Что не должно попасть в кадр ни при каких обстоятельствах.
export const NEGATIVE =
  "text, letters, words, numbers, typography, captions, watermark, signature, logo, blurry, photorealistic, 3d render";

export const promptFor = (themeId) => {
  const items = COVER_ITEMS[themeId];
  if (!items) return null;
  return buildPrompt(items);
};
