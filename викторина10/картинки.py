r"""
Ищет картинку под каждый пункт и приводит их всех к одному виду.

Запуск:  python картинки.py
         python картинки.py --только 3,7   (перекачать только эти пункты)
         python картинки.py --логотипы     (логотипы вместо фотографий)

По умолчанию ищутся ФОТОГРАФИИ: в викторине «назови марку» логотип
в кадре сразу выдаёт ответ, угадывать становится нечего.

Куда смотрит, по порядку:
  1. картинки\своё\   — свой файл с именем ответа («Audi.jpg») или с
                        номером пункта («3.jpg»). Лежит — берётся он
  2. Unsplash        — по ключу «ключ unsplash.txt». Красивые снимки,
                        сотни на каждую марку
  3. Pexels          — по ключу «ключ pexels.txt»
  4. Википедия       — фотография конкретной МОДЕЛИ машины. Подпись там
                        точная, но снимки скучнее стоковых
  5. Викисклад       — по запросу из «оформление.txt» (строка ПОИСК)
  6. Openverse       — сборник свободных фото, ключ не нужен
  7. Pixabay         — если появится «ключ pixabay.txt»

Стоки иногда промахиваются мимо марки: на «Mitsubishi» Pexels отдавал
вокзал в Токио. Это ловит «глаза.py» — он смотрит на готовую карточку
и перекачивает её, если на ней не то.

С «--логотипы» первым звеном идёт Wikidata, свойство P154: Викимедиа
отдаёт SVG уже отрендеренным в PNG с прозрачностью.

Все картинки складываются в одинаковую карточку 480×360: кремовый
скруглённый прямоугольник с золотой рамкой. Фотография обрезается
по центру во всю карточку, логотип вписывается целиком — обрезать
его нельзя, марка перестанет читаться.

Готовые лежат в картинки\готовые\NN.png — их подхватывает overlay.py.
"""
import io, json, os, re, sys, urllib.parse, urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import папки

HERE = os.path.dirname(os.path.abspath(__file__))
BOARD = папки.work("раскадровка.txt")
PICS = папки.here("картинки")
MINE = папки.here("картинки", "своё")       # свои файлы общие
READY = папки.work("картинки", "готовые")   # готовые карточки — свои у выпуска
USED = папки.here("картинки", "_уже брали.txt")
# ключ ищем и рядом со скриптом, и в корне проекта — чтобы папку
# можно было унести на другой компьютер целиком
PEXELS_KEYS = (os.path.join(HERE, "ключ pexels.txt"),
               os.path.join(os.path.dirname(HERE), "ключ pexels.txt"))

CARD_W, CARD_H = 480, 360    # карточка 4:3 — машина не обрезается по бокам
PAD = 40            # поля вокруг логотипа
RADIUS = 40
CREAM = (247, 239, 228, 255)     # #F7EFE4 — кремовый из палитры профиля
GOLD = (232, 182, 95, 255)       # #E8B65F — золото оттуда же
BORDER = 5

# Только латиница: HTTP-заголовки кодируются в latin-1, кириллица
# в User-Agent роняет любой запрос ещё до отправки
UA = "TikTokQuiz/1.0 (personal project; kanakovsasha@gmail.com)"
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp")


def get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers=dict(
        {"User-Agent": UA}, **(headers or {})))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def get_json(url, headers=None):
    return json.loads(get(url, headers).decode("utf-8"))


def used_urls():
    """Снимки из прошлых выпусков.

    Марки повторяются от ролика к ролику, а Википедия на «Toyota» всегда
    отдаёт одну и ту же модель — и зритель видит те же самые машины.
    Поэтому помним, что уже показывали, и берём следующий вариант.
    """
    if not os.path.exists(USED):
        return set()
    return {l.strip() for l in io.open(USED, encoding="utf-8")
            if l.strip() and not l.startswith("#")}


def remember_url(url):
    first = not os.path.exists(USED)
    with io.open(USED, "a", encoding="utf-8") as f:
        if first:
            f.write("# Снимки, которые уже были в кадре. Удали файл,\n"
                    "# если хочешь разрешить повторы.\n")
        f.write(url + "\n")


def read_board():
    if not os.path.exists(BOARD):
        sys.exit("Нет «раскадровка.txt». Сначала кнопки 1 и 2.")
    items = []
    for raw in io.open(BOARD, encoding="utf-8-sig"):
        line = raw.strip()
        if not line or line.startswith("#") or "|" not in line:
            continue
        if re.match(r"^(?:ТЕМА|TITLE)\s*:", line, re.I):
            continue
        # хвост после «#» — пометка от ответы.py для Вики, не часть имени
        items.append(line.split("|", 1)[1].split("#", 1)[0].strip())
    if not items:
        sys.exit("В раскадровке нет ответов.")
    return items


def read_mode():
    """Откуда брать картинки: «модели» — статьи Википедии про конкретные
    модели (для марок машин единственное, что работает), «сток» — Pexels
    (для стран, еды, городов он как раз лучше)."""
    f = папки.here("оформление.txt")
    if os.path.exists(f):
        for raw in io.open(f, encoding="utf-8-sig"):
            line = raw.strip()
            if line.startswith("#") or not line:
                continue
            m = re.match(r"^(?:КАРТИНКИ|PICTURES)\s*:\s*(\S+)", line, re.I)
            if m:
                return m.group(1).lower()
    return "модели"


def known_brands():
    """Марки из «словарь.txt» — по ним понятно, про машины ли выпуск."""
    p = папки.here("словарь.txt")
    если_есть = set()
    if os.path.exists(p):
        for raw in io.open(p, encoding="utf-8-sig"):
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                если_есть.add(line.split("=", 1)[0].strip().lower())
    return если_есть


def query_for(name, query_tpl, brands):
    """Запрос под конкретный пункт.

    Шаблон «%s car» хорош, пока в списке марки машин. Но выпуск бывает
    про страны, животных и даты: «Italy car» и «Giraffe car» ищут ерунду.
    Если ответа нет среди марок — ищем просто по названию.
    """
    if name.lower() in brands:
        return query_tpl
    return "%s"


def read_query():
    """Шаблон запроса из «оформление.txt». %s — сам ответ.
    Для машин «%s car», для стран «%s landscape», и так далее."""
    f = папки.here("оформление.txt")
    if os.path.exists(f):
        for raw in io.open(f, encoding="utf-8-sig"):
            line = raw.strip()
            if line.startswith("#") or not line:
                continue
            m = re.match(r"^(?:ПОИСК|SEARCH)\s*:\s*(.+)$", line, re.I)
            if m:
                return m.group(1).strip()
    return "%s"


def pexels_key():
    for p in PEXELS_KEYS:
        if not os.path.exists(p):
            continue
        for raw in io.open(p, encoding="utf-8-sig"):
            line = raw.strip()
            if line and not line.startswith("#"):
                return line
    return None


# ------------------------------- поиск -------------------------------

def wiki_entity(name):
    """Название -> код в Wikidata. Через Википедию, а не через поиск
    по Wikidata: тот на «Audi» уверенно отдаёт музыкальный альбом."""
    url = ("https://en.wikipedia.org/w/api.php?action=query&prop=pageprops"
           "&titles=%s&redirects=1&format=json" % urllib.parse.quote(name))
    try:
        pages = get_json(url)["query"]["pages"]
    except Exception:
        return None
    p = list(pages.values())[0]
    return p.get("pageprops", {}).get("wikibase_item")


def wikidata_logo(qid):
    url = ("https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=%s"
           "&property=P154&format=json" % qid)
    try:
        claims = get_json(url).get("claims", {}).get("P154")
    except Exception:
        return None
    if not claims:
        return None
    fname = claims[0]["mainsnak"]["datavalue"]["value"]
    return ("https://commons.wikimedia.org/wiki/Special:FilePath/%s?width=900"
            % urllib.parse.quote(fname))


def wiki_image(name):
    url = ("https://en.wikipedia.org/api/rest_v1/page/summary/%s"
           % urllib.parse.quote(name))
    try:
        d = get_json(url)
    except Exception:
        return None
    src = (d.get("originalimage") or d.get("thumbnail") or {}).get("source")
    return src


def pexels_photo(name, key, query_tpl="%s"):
    if not key:
        return None
    q = query_tpl % name if "%s" in query_tpl else name
    url = ("https://api.pexels.com/v1/search?query=%s&per_page=1&orientation="
           "landscape" % urllib.parse.quote(q))
    try:
        d = get_json(url, {"Authorization": key})
    except Exception:
        return None
    ph = d.get("photos") or []
    return ph[0]["src"]["large"] if ph else None


def wiki_search(name, limit=3):
    """Статья не всегда называется как ответ: «Mercedes» — это страница
    про имя, логотип лежит у «Mercedes-Benz». Спрашиваем поиск."""
    url = ("https://en.wikipedia.org/w/api.php?action=query&list=search"
           "&srsearch=%s&srlimit=%d&format=json"
           % (urllib.parse.quote(name), limit))
    try:
        return [r["title"] for r in get_json(url)["query"]["search"]]
    except Exception:
        return []


def find_logo(name):
    seen = set()
    for title in [name] + wiki_search(name):
        if title in seen:
            continue
        seen.add(title)
        qid = wiki_entity(title)
        if not qid:
            continue
        u = wikidata_logo(qid)
        if u:
            return u
    return None


# Что на Викискладе точно НЕ то, что нам нужно: логотипы, эмблемы,
# заводы, музеи, вывески. Фильтруем по имени файла.
BAD_WORDS = ("logo", "emblem", "badge", "wordmark", "headquarters", "museum",
             "factory", "plant", "dealership", "building", "tower", "station",
             "sign", "map", "chart", "diagram", "poster", "stamp", "coin",
             "advertis", "brochure", "engine", "interior", "wheel", "icon")


def model_photo(name, variant=1):
    """Лучший источник для марок: статья Википедии про КОНКРЕТНУЮ МОДЕЛЬ.
    Там лежит чистое студийное фото машины, а не вывеска проката.

    Через Wikidata: у модели свойство P176 (изготовитель) указывает на
    марку, а тип — «модель автомобиля» (Q3231690). Сортируем по числу
    языковых версий: у известных моделей их больше, а без сортировки
    выпадают одни концепт-кары.
    """
    # Перебираем кандидатов, пока у кого-то не найдутся модели. Останавливаться
    # на первой попавшейся сущности нельзя: «Mercedes» в Википедии — статья
    # про имя, код у неё есть, а машин по нему ноль.
    titles = []
    for cand in [name] + wiki_search(name, 3):
        qid = wiki_entity(cand)
        if not qid:
            continue
        q = ("SELECT ?a ?sl WHERE { ?m wdt:P176 wd:%s . "
             "?m wdt:P31/wdt:P279* wd:Q3231690 . ?m wikibase:sitelinks ?sl . "
             "?ar schema:about ?m ; schema:isPartOf <https://en.wikipedia.org/>"
             " ; schema:name ?a . } ORDER BY DESC(?sl) LIMIT 10" % qid)
        url = ("https://query.wikidata.org/sparql?format=json&query=%s"
               % urllib.parse.quote(q))
        try:
            rows = get_json(url, {"Accept": "application/sparql-results+json"})
            titles = [r["a"]["value"] for r in rows["results"]["bindings"]]
        except Exception:
            titles = []
        if titles:
            break
    if not titles:
        return None
    want = re.sub(r"[^a-z0-9]", "", name.lower())
    skip = variant - 1
    for t in titles:
        # «Toyota Starlet» приезжает в выдаче Suzuki — там была общая
        # платформа. Марка должна стоять в названии модели
        if want and not re.sub(r"[^a-z0-9]", "", t.lower()).startswith(want):
            continue
        u = wiki_image(t)
        if u and not u.lower().endswith(".svg"):
            if skip > 0:
                skip -= 1
                continue
            return u
    return None


def openverse_photo(name, query_tpl, variant=1):
    """Openverse: свободные снимки со всего интернета, ключ не нужен.

    Берём только те, где марка стоит в названии снимка, — так же, как на
    Викискладе: подпись там честная, и по ней видно, что на фото.
    """
    q = query_tpl % name if "%s" in query_tpl else name
    rows = []
    # три страницы по двадцать: одной мало, когда снимки этой марки
    # в прошлых выпусках уже разобраны
    for page in (1, 2, 3):
        url = ("https://api.openverse.org/v1/images/?q=%s&page_size=20"
               "&page=%d&mature=false" % (urllib.parse.quote(q), page))
        try:
            got = get_json(url).get("results") or []
        except Exception:
            break
        rows += got
        if len(got) < 20:
            break
    want = re.sub(r"[^a-z0-9]", "", name.lower())
    good = []
    for r in rows:
        title = (r.get("title") or "").lower()
        if want and want not in re.sub(r"[^a-z0-9]", "", title):
            continue
        if any(w in title for w in BAD_WORDS):
            continue
        w, h = r.get("width") or 0, r.get("height") or 0
        if w < 800 or h < 500:
            continue
        link = r.get("url")
        if link:
            good.append((abs(w / max(h, 1) - 1.5), link))
    good.sort(key=lambda x: x[0])          # ближе к альбомной пропорции
    return good[variant - 1][1] if len(good) >= variant else None


def unsplash_photo(name, query_tpl, variant=1):
    """Unsplash — по ключу с unsplash.com/developers (бесплатный)."""
    key = None
    for p in (папки.here("ключ unsplash.txt"),
              os.path.join(os.path.dirname(HERE), "ключ unsplash.txt")):
        if os.path.exists(p):
            for raw in io.open(p, encoding="utf-8-sig"):
                line = raw.strip()
                if line and not line.startswith("#"):
                    key = line
                    break
    if not key:
        return None
    q = query_tpl % name if "%s" in query_tpl else name
    url = ("https://api.unsplash.com/search/photos?query=%s&per_page=20"
           "&orientation=landscape" % urllib.parse.quote(q))
    try:
        rows = get_json(url, {"Authorization": "Client-ID " + key}).get("results") or []
    except Exception:
        return None
    want = re.sub(r"[^a-z0-9]", "", name.lower())
    good = []
    for r in rows:
        подпись = ((r.get("description") or "") + " "
                   + (r.get("alt_description") or "")).lower()
        if want and want not in re.sub(r"[^a-z0-9]", "", подпись):
            continue
        link = ((r.get("urls") or {}).get("regular")
                or (r.get("urls") or {}).get("full"))
        if link:
            good.append(link)
    return good[variant - 1] if len(good) >= variant else None


def pixabay_key():
    for p in (папки.here("ключ pixabay.txt"),
              os.path.join(os.path.dirname(HERE), "ключ pixabay.txt")):
        if os.path.exists(p):
            for raw in io.open(p, encoding="utf-8-sig"):
                line = raw.strip()
                if line and not line.startswith("#"):
                    return line
    return None


def pixabay_photo(name, query_tpl, variant=1):
    """Pixabay — по бесплатному ключу с pixabay.com/api/docs."""
    key = pixabay_key()
    if not key:
        return None
    q = query_tpl % name if "%s" in query_tpl else name
    url = ("https://pixabay.com/api/?key=%s&q=%s&image_type=photo"
           "&orientation=horizontal&per_page=20&safesearch=true"
           % (key, urllib.parse.quote(q)))
    try:
        rows = get_json(url).get("hits") or []
    except Exception:
        return None
    want = re.sub(r"[^a-z0-9]", "", name.lower())
    good = []
    for r in rows:
        tags = (r.get("tags") or "").lower()
        if want and want not in re.sub(r"[^a-z0-9]", "", tags):
            continue
        link = r.get("largeImageURL") or r.get("webformatURL")
        if link:
            good.append(link)
    return good[variant - 1] if len(good) >= variant else None


def commons_photo(name, query_tpl, variant=1):
    """Фотография с Викисклада. Pexels для марок не годится: на Mitsubishi
    он отдаёт вокзал в Токио, на Opel — Chevrolet, на Suzuki — мотоциклы.
    На Викискладе имя файла честно называет, что на снимке."""
    q = query_tpl % name if "%s" in query_tpl else name
    url = ("https://commons.wikimedia.org/w/api.php?action=query"
           "&generator=search&gsrnamespace=6&gsrsearch=%s&gsrlimit=20"
           "&prop=imageinfo&iiprop=url|size&iiurlwidth=1200&format=json"
           % urllib.parse.quote(q))
    try:
        pages = get_json(url).get("query", {}).get("pages", {})
    except Exception:
        return None
    want = re.sub(r"[^a-z0-9]", "", name.lower())
    good = []
    for p in pages.values():
        title = p.get("title", "")[5:]                 # снимаем «File:»
        low = title.lower()
        if not low.endswith((".jpg", ".jpeg", ".png")):
            continue                                   # svg — это логотип
        if want and want not in re.sub(r"[^a-z0-9]", "", low):
            continue                                   # марка должна быть в имени
        if any(w in low for w in BAD_WORDS):
            continue
        ii = (p.get("imageinfo") or [{}])[0]
        w, h = ii.get("width") or 0, ii.get("height") or 0
        if w < 800 or h < 500:
            continue
        good.append(((p.get("index", 99), abs(w / max(h, 1) - 1.6)),
                     ii.get("thumburl") or ii.get("url")))
    good.sort(key=lambda x: x[0])
    return good[variant - 1][1] if len(good) >= variant else None


def fetch(name, key, prefer_photo, query_tpl, variant=1,
          mode="модели", seen=()):
    """Возвращает (байты, это_логотип, откуда, ссылка).

    Пока снимок уже был в прошлых выпусках — берём следующий вариант:
    у марки моделей много, и повторять одну и ту же машину незачем.
    Если нового не нашлось совсем, возвращаем что есть — лучше повтор,
    чем дырка в кадре.
    """
    fallback = None
    for v in range(variant, variant + 4):
        for source, is_logo, what in sources(name, key, prefer_photo,
                                             query_tpl, v, mode):
            try:
                url = source()
            except Exception:
                url = None
            if not url:
                continue
            if url in seen:
                fallback = fallback or (url, is_logo, what)
                continue
            try:
                data = get(url, timeout=45)
            except Exception:
                continue
            if len(data) > 800:
                return data, is_logo, what, url
    if fallback:
        url, is_logo, what = fallback
        try:
            data = get(url, timeout=45)
            if len(data) > 800:
                return data, is_logo, what + " (повтор)", url
        except Exception:
            pass
    return None, None, None, None


def sources(name, key, prefer_photo, query_tpl, variant, mode):
    """Откуда пробуем взять снимок, по порядку."""
    if prefer_photo:
        # Порядок выбран Викой: сначала стоки — там фотографии красивее
        # и разнообразнее, — потом энциклопедии, где подпись точнее, но
        # снимки скучнее. Промах стока ловит «глаза.py»: он смотрит на
        # готовую карточку и заменяет её, если марка не та.
        tries = [(lambda: unsplash_photo(name, query_tpl, variant), False,
                  "фото Unsplash"),
                 (lambda: pexels_photo(name, key, query_tpl), False,
                  "фото Pexels"),
                 (lambda: model_photo(name, variant), False, "фото модели"),
                 (lambda: commons_photo(name, query_tpl, variant), False,
                  "фото Викисклада"),
                 (lambda: openverse_photo(name, query_tpl, variant), False,
                  "фото Openverse"),
                 (lambda: pixabay_photo(name, query_tpl, variant), False,
                  "фото Pixabay"),
                 (lambda: wiki_image(name), False, "картинка Википедии")]
    else:
        tries = [(lambda: find_logo(name), True, "логотип Wikidata"),
                 (lambda: wiki_image(name), False, "картинка Википедии"),
                 (lambda: pexels_photo(name, key), False, "фото Pexels")]
    return tries


# ------------------------------ карточка ------------------------------

def make_card(data, is_logo, dst):
    from PIL import Image, ImageDraw
    src = Image.open(io.BytesIO(data))
    src = src.convert("RGBA") if src.mode in ("RGBA", "LA", "P") \
        else src.convert("RGB").convert("RGBA")

    card = Image.new("RGBA", (CARD_W, CARD_H), (0, 0, 0, 0))
    mask = Image.new("L", (CARD_W, CARD_H), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, CARD_W - 1, CARD_H - 1), RADIUS, fill=255)
    card.paste(Image.new("RGBA", (CARD_W, CARD_H), CREAM), (0, 0), mask)

    if is_logo:
        # логотип вписываем целиком: обрезать его нельзя
        src.thumbnail((CARD_W - 2 * PAD, CARD_H - 2 * PAD), Image.LANCZOS)
        card.alpha_composite(src, ((CARD_W - src.width) // 2,
                                   (CARD_H - src.height) // 2))
    else:
        # фотографию обрезаем по центру во всю карточку
        k = max(CARD_W / src.width, CARD_H / src.height)
        src = src.resize((max(1, round(src.width * k)),
                          max(1, round(src.height * k))), Image.LANCZOS)
        x = (src.width - CARD_W) // 2
        y = (src.height - CARD_H) // 2
        inner = Image.new("RGBA", (CARD_W, CARD_H), (0, 0, 0, 0))
        inner.paste(src.crop((x, y, x + CARD_W, y + CARD_H)), (0, 0))
        card.paste(inner, (0, 0), mask)

    ImageDraw.Draw(card).rounded_rectangle(
        (BORDER // 2, BORDER // 2, CARD_W - 1 - BORDER // 2,
         CARD_H - 1 - BORDER // 2), RADIUS, outline=GOLD, width=BORDER)
    card.save(dst)


def mine_for(name, number=None):
    """Свой файл под этот пункт. Два способа назвать, оба работают:

        Audi.jpg      — как называется ответ
        3.jpg         — номер пункта в списке
        3 audi.jpg    — номер, а дальше что угодно для памяти

    Номер удобнее: он не сломается, если ответ переименовать, и по нему
    прямо в папке видно порядок. Имя ответа удобнее, когда файлы копятся
    впрок и переезжают из выпуска в выпуск.
    """
    if not os.path.isdir(MINE):
        return None
    want = re.sub(r"[^a-z0-9]", "", name.lower())
    by_name, by_number = None, None
    for f in sorted(os.listdir(MINE)):
        stem, ext = os.path.splitext(f)
        if ext.lower() not in IMG_EXT:
            continue
        if re.sub(r"[^a-z0-9]", "", stem.lower()) == want:
            by_name = os.path.join(MINE, f)
        if number is not None and by_number is None:
            m = re.match(r"^\s*0*(\d{1,2})(?:\D|$)", stem)
            if m and int(m.group(1)) == number:
                by_number = os.path.join(MINE, f)
    # имя ответа важнее: оно точнее говорит, что на картинке
    return by_name or by_number


def main():
    args = list(sys.argv[1:])
    prefer_photo = True          # по умолчанию фотографии: логотип выдаёт ответ
    only = None
    for flag in ("--логотипы", "--logos"):
        if flag in args:
            prefer_photo = False
            args.remove(flag)
    for flag in ("--фото", "--photo"):
        if flag in args:
            args.remove(flag)
    variant = 1
    for flag in ("--вариант", "--variant"):
        if flag in args:
            i = args.index(flag)
            variant = max(1, int(args[i + 1]))
            del args[i:i + 2]
    query_tpl = read_query()
    mode = read_mode()
    for flag in ("--только", "--only"):
        if flag in args:
            i = args.index(flag)
            only = {int(x) for x in re.findall(r"\d+", args[i + 1])}
            del args[i:i + 2]

    items = read_board()
    if "--список" in args or "--list" in args:
        os.makedirs(MINE, exist_ok=True)
        print("Как называть свои файлы — папка картинки\\своё.")
        print("Годится любой из двух вариантов, расширение jpg или png:")
        print()
        for i, name in enumerate(items, 1):
            есть = mine_for(name, i)
            print("  %2d. %-18s или %-7s %s"
                  % (i, name + ".jpg", "%d.jpg" % i,
                     "— лежит: " + os.path.basename(есть) if есть else ""))
        print()
        print("Номер — это место в списке: «3.jpg» встанет третьим пунктом.")
        print("После номера можно дописать что угодно: «3 моя ауди.jpg».")
        return
    key = pexels_key()
    os.makedirs(MINE, exist_ok=True)
    os.makedirs(READY, exist_ok=True)
    print("Пунктов: %d.  Ищу %s, запрос «%s»."
          % (len(items), "фотографии" if prefer_photo else "логотипы",
             query_tpl))

    brands = known_brands()
    seen = used_urls()
    if "--можно-повтор" in args or "--repeat" in args:
        # Иногда запрет повторов вреден: хорошие снимки кончились, и
        # подбор скатывается к плохим. Тогда лучше вернуть проверенную
        # картинку из прошлого выпуска, чем оставить негодную.
        args = [a for a in args if a not in ("--можно-повтор", "--repeat")]
        seen = set()
        print("Повторы разрешены — беру лучшее, даже если уже показывали.")
    elif seen:
        print("Помню %d снимков из прошлых выпусков — повторять не буду."
              % len(seen))
    # Сборка может идти в ОТКРЫТОМ репозитории, а его журнал читает кто
    # угодно и хранится он вечно. Подписи карточек — это ответы
    # викторины, то есть весь выпуск. Печатаем тогда только номер.
    тихо = bool(os.environ.get("QUIZ_TIHO"))

    def строка(i, name, что):
        print("%2d. %-14s %s" % (i, "···" if тихо else name, что))

    ok, bad = 0, []
    for i, name in enumerate(items, 1):
        dst = os.path.join(READY, "%02d.png" % i)
        if only and i not in only:
            continue
        own = mine_for(name, i)
        if own:
            make_card(io.open(own, "rb").read(),
                      own.lower().endswith(".png"), dst)
            строка(i, name, "свой файл (%s)" % os.path.basename(own))
            ok += 1
            continue
        data, is_logo, what, url = fetch(name, key, prefer_photo,
                                         query_for(name, query_tpl, brands),
                                         variant, mode, seen)
        if not data:
            строка(i, name, "НЕ НАШЁЛСЯ")
            bad.append((i, name))
            continue
        # прежний файл сохраняем: вариант может оказаться хуже нынешнего
        if os.path.exists(dst):
            bak = dst[:-4] + ".прежний.png"
            if os.path.exists(bak):
                os.remove(bak)
            os.replace(dst, bak)
        try:
            make_card(data, is_logo, dst)
        except Exception as e:
            строка(i, name, "картинка битая (%s)" % e)
            bad.append((i, name))
            continue
        строка(i, name, what)
        if url:
            remember_url(url)
            seen.add(url)
        ok += 1

    print("\nГотово: %d из %d.  Лежат в картинки\\готовые" % (ok, len(items)))
    if bad:
        if тихо:
            print("Не нашлись пункты: %s"
                  % ", ".join(str(i) for i, _ in bad))
        else:
            print("Не нашлись: %s" % ", ".join(n for _, n in bad))
            print("Положи свои файлы в картинки\\своё и назови их как ответ —"
                  " «%s.png» — и запусти снова." % bad[0][1])


if __name__ == "__main__":
    main()
