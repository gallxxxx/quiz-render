// Откуда ещё берутся фотографии, кроме Википедии и Openverse.
//
// Порядок и состав подобраны так же, как во втором формате проекта:
// сток первым, энциклопедии следом. Каждому источнику нужен либо ключ,
// либо ничего; нет ключа — источник молча пропускается.
//
// Каждая функция возвращает список карточек одного вида:
//   { url, title, creator, license, license_version, foreign_landing_url }

import { readKey, safeJson } from "./media.mjs";

// Слова подписи, по которым проверяем, что снимок вообще про то самое.
// Короткие («of», «the») ничего не значат, их не берём.
const keywords = (q) =>
  String(q)
    .toLowerCase()
    .split(" ")
    .map((w) => w.replace(",", "").replace(".", "").trim())
    .filter((w) => w.length >= 4);

// Сначала те, где слово из подписи есть в описании: сток на «Opel» умеет
// отдать Chevrolet, и такое лучше пробовать последним, а не первым.
const byHit = (items, q, haystack) => {
  const words = keywords(q);
  const hit = (item) => {
    if (words.length === 0) return true;
    const hay = String(haystack(item) ?? "").toLowerCase();
    return words.some((w) => hay.includes(w));
  };
  return [...items].sort((a, b) => Number(hit(b)) - Number(hit(a)));
};

// ————————————————————————————————————————————————————————————
//  Unsplash — нужен бесплатный ключ (Access Key)
// ————————————————————————————————————————————————————————————
export const fromUnsplash = async (q) => {
  const key = readKey("ключ unsplash.txt");
  if (!key) return [];

  const json = await safeJson(
    "https://api.unsplash.com/search/photos?" +
      new URLSearchParams({ query: q, per_page: "12", orientation: "squarish" }),
    { headers: { Authorization: "Client-ID " + key }, retries: 1 },
  );

  const items = json?.results ?? [];
  const hay = (p) =>
    [p.description, p.alt_description, ...(p.tags ?? []).map((t) => t.title)].join(" ");

  return byHit(items, q, hay).map((p) => ({
    url: p.urls?.regular ?? p.urls?.full ?? p.urls?.small,
    title: p.alt_description || p.description || q,
    creator: p.user?.name ?? "неизвестен",
    license: "Unsplash",
    license_version: "",
    foreign_landing_url: p.links?.html ?? "",
  }));
};

// ————————————————————————————————————————————————————————————
//  Викисклад — без ключа
// ————————————————————————————————————————————————————————————
// Имена файлов там честные, поэтому фильтр по слову в имени работает.
// Отдельно отсеиваем то, что фотографией не является.
const JUNK = [
  "logo", "icon", "flag", "coat_of_arms", "seal", "map", "plan",
  "diagram", "drawing", "signature", "blank", "chart", "symbol",
];

export const fromCommons = async (q) => {
  const json = await safeJson(
    "https://commons.wikimedia.org/w/api.php?" +
      new URLSearchParams({
        action: "query",
        generator: "search",
        gsrsearch: q + " filetype:bitmap",
        gsrnamespace: "6",
        gsrlimit: "40",
        prop: "imageinfo",
        iiprop: "url|extmetadata",
        iiurlwidth: "1600",
        format: "json",
      }),
    { retries: 1 },
  );

  const pages = Object.values(json?.query?.pages ?? {});
  const words = keywords(q);

  const good = pages.filter((p) => {
    const name = String(p.title ?? "").toLowerCase();
    const isPhoto = name.endsWith(".jpg") || name.endsWith(".jpeg");
    if (!isPhoto) return false;
    if (JUNK.some((bad) => name.includes(bad))) return false;
    // Название файла должно говорить о том же, что и подпись.
    return words.length === 0 || words.some((w) => name.includes(w));
  });

  return good
    .map((p) => {
      const info = p.imageinfo?.[0] ?? {};
      const meta = info.extmetadata ?? {};
      return {
        url: info.thumburl ?? info.url,
        title: String(p.title ?? "").replace("File:", ""),
        creator: String(meta.Artist?.value ?? "Wikimedia Commons").replace(/<[^>]*>/g, ""),
        license: meta.LicenseShortName?.value ?? "см. страницу файла",
        license_version: "",
        foreign_landing_url: info.descriptionurl ?? "",
      };
    })
    .filter((c) => c.url);
};

// ————————————————————————————————————————————————————————————
//  Pixabay — нужен бесплатный ключ
// ————————————————————————————————————————————————————————————
export const fromPixabay = async (q) => {
  const key = readKey("ключ pixabay.txt");
  if (!key) return [];

  const json = await safeJson(
    "https://pixabay.com/api/?" +
      new URLSearchParams({
        key,
        q,
        image_type: "photo",
        per_page: "12",
        safesearch: "true",
      }),
    { retries: 1 },
  );

  const items = json?.hits ?? [];
  return byHit(items, q, (h) => h.tags).map((h) => ({
    url: h.largeImageURL ?? h.webformatURL,
    title: h.tags ?? q,
    creator: h.user ?? "неизвестен",
    license: "Pixabay",
    license_version: "",
    foreign_landing_url: h.pageURL ?? "",
  }));
};
