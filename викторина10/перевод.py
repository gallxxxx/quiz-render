# -*- coding: utf-8 -*-
r"""
Переводит проверенный русский текст на английский — нормальным переводчиком.

Запуск:  python перевод.py            (перевести русский -> английский)
         python перевод.py --собрать  (только пересобрать после твоих правок)

Почему отдельным шагом. Раньше переводил сам Whisper на ходу, и на именах
собственных он врал: «Ауди» превратилась в «Saudi Arabia» и в таком виде
попала и в субтитры, и в озвучку. Здесь текст сначала показывается тебе,
потом уходит переводчику, а марки подставляются латиницей ЗАРАНЕЕ — по
«словарь.txt». Переводчик не трогает то, что уже написано по-английски.

Кто переводит, по порядку:
  1. DeepL      — если рядом лежит «ключ deepl.txt». Заметно лучше
                  остальных на разговорной речи. Ключ бесплатный:
                  план Developer, разовый кредит на 1 000 000 знаков
                  (не в месяц — всего). Выпуск съедает около тысячи,
                  так что хватит надолго. Остаток виден на
                  deepl.com/your-account/usage.
  2. Нейросеть  — на тех же бесплатных ключах, что и проверка текста
                  (gemini, groq, mistral, openrouter). Видит весь ролик
                  разом, поэтому короткие подписи переводит с оглядкой
                  на соседние строки. Работает, пока ключа DeepL нет.
  3. Google     — запасной, без ключа и без регистрации.
  4. MyMemory   — если не отозвался и он.

Этой же очередью переводит «ответы.py» — подписи ответов в кадре.
За переводом проверяет нейросеть: кнопка «1г Проверить текст нейросетью»
(«проверить.py»), раздел «перевод» — сверяет английский с русским
строка за строкой и правит по флагу --править.

Файлы:
  <имя>.русский.txt     что распознали (правишь ты)
        |
  <имя>.английский.txt  перевод (тоже правишь ты)
        |
  <имя>.en.srt          из него собираются субтитры и озвучка
"""
import io, json, os, re, sys, time
import urllib.error, urllib.parse, urllib.request

import папки

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = папки.work("out")
DICT = папки.here("словарь.txt")
DEEPL_KEYS = (папки.here("ключ deepl.txt"),
              os.path.join(os.path.dirname(HERE), "ключ deepl.txt"))

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
PAUSE = 0.25            # между запросами, чтобы не долбить переводчик
DEEPL_BATCH = 40        # DeepL берёт до 50 текстов за запрос — с запасом


# ----------------------------- файлы -----------------------------

def newest(ext):
    files = [f for f in os.listdir(OUT_DIR) if f.endswith(ext)] \
        if os.path.isdir(OUT_DIR) else []
    if not files:
        return None, None
    files.sort(key=lambda f: os.path.getmtime(os.path.join(OUT_DIR, f)),
               reverse=True)
    return files[0][:-len(ext)], os.path.join(OUT_DIR, files[0])


def read_phrases(path):
    """Строки «время | текст». Пустые и с решёткой пропускаем."""
    out = []
    for raw in io.open(path, encoding="utf-8-sig"):
        line = raw.strip()
        if not line or line.startswith("#") or "|" not in line:
            continue
        left, right = line.split("|", 1)
        m = re.match(r"^\s*(\d+):(\d+(?:\.\d+)?)\s*$", left)
        if not m:
            continue
        text = right.strip()
        if text:
            out.append((int(m.group(1)) * 60 + float(m.group(2)), text))
    return out


def write_phrases(items, path, head):
    lines = list(head) + [""]
    for t, text in items:
        lines.append("%d:%04.1f | %s" % (int(t // 60), t % 60, text))
    io.open(path, "w", encoding="utf-8", newline="\r\n").write(
        "\n".join(lines) + "\n")


def srt_time(sec):
    sec = max(0.0, sec)
    ms = int(round((sec - int(sec)) * 1000))
    s = int(sec)
    if ms == 1000:
        s, ms = s + 1, 0
    return "%02d:%02d:%02d,%03d" % (s // 3600, s % 3600 // 60, s % 60, ms)


def write_srt(items, path, tail=2.0):
    """Каждая фраза — реплика. Конец берём от начала следующей."""
    with io.open(path, "w", encoding="utf-8") as f:
        for i, (a, text) in enumerate(items, 1):
            b = items[i][0] if i < len(items) else a + tail
            f.write("%d\n%s --> %s\n%s\n\n"
                    % (i, srt_time(a), srt_time(max(b, a + 0.4)), text))


# --------------------------- марки латиницей ---------------------------

def brands():
    """«ауди» -> «Audi». Берём из словаря — там уже все написания."""
    if not os.path.exists(DICT):
        return []
    pairs = []
    for raw in io.open(DICT, encoding="utf-8-sig"):
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if re.match(r"^(?:НЕ|NOT)\s*:", line, re.I):
            continue
        eng, rus = line.split("=", 1)
        eng = eng.strip()
        for v in rus.split(","):
            v = v.strip()
            if v:
                pairs.append((v, eng))
    # длинные варианты первыми: «мерседес бенц» раньше, чем «мерседес»
    pairs.sort(key=lambda p: len(p[0]), reverse=True)
    return pairs


def fix_caps(text, keep):
    """Убираем лишние заглавные внутри фразы.

    Whisper любит писать «Марка» с большой буквы, а переводчик принимает
    это за имя и выдаёт «First Mark» вместо «First brand». Слова после
    точки и сами марки не трогаем.
    """
    words = text.split()
    out = []
    start = True
    for w in words:
        core = w.strip(".,!?—–-«»\"'()")
        if (not start and core and core[:1].isupper() and core.upper() != core
                and core.lower() not in keep):
            w = w[:1].lower() + w[1:]
        start = w.endswith((".", "!", "?", "…"))
        out.append(w)
    return " ".join(out)


def latinize(text, pairs):
    """Марки пишем латиницей ДО перевода — иначе «Ауди» станет «Saudi Arabia»."""
    hits = []
    for rus, eng in pairs:
        pattern = r"(?<![а-яёa-z])%s(?![а-яёa-z])" % re.escape(rus)
        new, n = re.subn(pattern, eng, text, flags=re.I)
        if n:
            hits.append(eng)
            text = new
    return text, hits


# ----------------------------- переводчики -----------------------------

def get(url, headers=None, data=None, timeout=25):
    req = urllib.request.Request(
        url, data=data, headers=dict({"User-Agent": UA}, **(headers or {})))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def deepl_key():
    for p in DEEPL_KEYS:
        if os.path.exists(p):
            for raw in io.open(p, encoding="utf-8-sig"):
                line = raw.strip()
                if line and not line.startswith("#"):
                    return line
    return None


def deepl_why(e):
    """Понятная причина вместо «HTTP Error 456»."""
    code = getattr(e, "code", None)
    ответ = {403: "ключ не принят — проверь «ключ deepl.txt»",
             404: "неверный адрес: ключ на :fx идёт на api-free, остальные на api",
             429: "слишком часто — DeepL просит подождать",
             456: "кончился месячный лимит DeepL (500 000 знаков)",
             400: "DeepL не понял запрос"}.get(code)
    if not ответ:
        return str(e)
    тело = ""
    try:
        тело = e.read().decode("utf-8", "replace").strip()[:160]
    except Exception:
        pass
    return ответ + ((" [%s]" % тело) if тело else "")


def deepl_call(texts, key, context=None):
    """Ключ идёт заголовком, а не полем «auth_key» в теле.

    Раньше DeepL принимал и то и другое, теперь только заголовок:
    на поле в теле он отвечает «Missing Authorization header», и по коду
    ответа это неотличимо от неверного ключа.
    """
    body = [("source_lang", "RU"), ("target_lang", "EN"),
            ("preserve_formatting", "1")]
    if context:
        body.append(("context", context))
    body += [("text", t) for t in texts]
    host = ("https://api.deepl.com/v2/translate" if not key.endswith(":fx")
            else "https://api-free.deepl.com/v2/translate")
    raw = get(host, {"Content-Type": "application/x-www-form-urlencoded",
                     "Authorization": "DeepL-Auth-Key " + key},
              urllib.parse.urlencode(body).encode("utf-8"), timeout=60)
    return [t["text"] for t in json.loads(raw)["translations"]]


def deepl(texts, key, context=None):
    """Весь ролик пачками: за один запрос DeepL берёт не больше пятидесяти.

    Раньше уходил один запрос на всё — на длинном ролике он молча
    обрывался. Теперь по сорок штук.

    «context» — соседние фразы: DeepL их не переводит и денег за них не
    берёт, но учитывает. Нужен коротким подписям — «Юпитер» отдельной
    строкой двусмыслен, а рядом с вопросом про планеты уже нет.
    """
    out = []
    for i in range(0, len(texts), DEEPL_BATCH):
        часть = texts[i:i + DEEPL_BATCH]
        try:
            got = deepl_call(часть, key, context)
        except urllib.error.HTTPError as e:
            # «context» у DeepL из новых: если ключ его не знает — без него
            if context and e.code == 400:
                got = deepl_call(часть, key)
            else:
                raise
        if len(got) != len(часть):
            raise RuntimeError("DeepL вернул %d строк вместо %d"
                               % (len(got), len(часть)))
        out += got
        if i + DEEPL_BATCH < len(texts):
            time.sleep(PAUSE)
    return out


def google(text):
    url = ("https://translate.googleapis.com/translate_a/single"
           "?client=gtx&sl=ru&tl=en&dt=t&q=" + urllib.parse.quote(text))
    d = json.loads(get(url))
    return "".join(p[0] for p in d[0] if p and p[0]).strip()


def mymemory(text):
    url = ("https://api.mymemory.translated.net/get?langpair=ru|en&q="
           + urllib.parse.quote(text[:480]))
    d = json.loads(get(url))
    return (d.get("responseData") or {}).get("translatedText", "").strip()


AI_ЗАДАНИЕ = """Ты переводишь короткую видео-викторину для TikTok с русского
на английский. Русский текст распознан на слух, поэтому местами исковеркан.

Правила:
  - живая разговорная речь, короткие фразы, обращение к зрителю на «ты»;
  - строки пронумерованы. Верни РОВНО столько же строк с теми же номерами.
    Не объединяй две в одну и не разбивай одну на две: каждая строка идёт
    в кадр в своё время, и лишняя склейка сдвинет все субтитры;
  - что уже написано латиницей — марки машин, имена, названия — оставь
    как есть, не переводи и не переставляй буквы;
  - если строка явно искажена распознаванием, переведи то, что было
    сказано на самом деле, по смыслу соседних строк;
  - никаких пояснений и примечаний, только перевод.

Ответ — ТОЛЬКО JSON, без текста вокруг:

{"перевод": [{"n": 1, "en": "..."}, {"n": 2, "en": "..."}]}"""


def разобрать_перевод(ответ, сколько):
    """Из ответа модели — ровно столько строк, сколько послали.

    Модель легко склеивает две короткие фразы в одну. Тогда текст
    разъедется с временами, и субтитры поедут до конца ролика. Поэтому
    строки пронумерованы и собираются по номеру, а если хоть одной не
    хватает — ответ целиком считается негодным, и переводит следующий.
    """
    выбор = (ответ.get("choices") or [{}])[0]
    body = ((выбор.get("message") or {}).get("content") or "").strip()
    m = re.search(r"\{.*\}", body, re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except Exception:
        return None
    по_номеру = {}
    for item in (data.get("перевод") or data.get("translation") or []):
        if not isinstance(item, dict):
            continue
        try:
            n = int(item.get("n"))
        except Exception:
            continue
        en = (item.get("en") or "").strip()
        if 1 <= n <= сколько and en:
            по_номеру[n] = en
    if len(по_номеру) != сколько:
        return None
    return [по_номеру[i] for i in range(1, сколько + 1)]


def ai_translate(texts, context=None, тихо=False):
    """Перевод нейросетью — на тех же бесплатных ключах, что и проверка.

    Зачем он вообще. DeepL в России не зарегистрировать: страны нет в
    списке. А Google переводит строку в вакууме — «Юпитер» отдельной
    подписью он видит без вопроса, к которому та относится. Нейросеть
    получает весь ролик разом и переводит с оглядкой на соседние строки.

    Ключи и список провайдеров берём из «проверить.py», чтобы ключ
    лежал в одном экземпляре и не расходился между скриптами.
    """
    def скажи(s):
        if not тихо:
            print(s)

    try:
        sys.path.insert(0, HERE)
        import проверить as пров
    except Exception:
        return None, ""

    нумерованный = "\n".join("%d. %s" % (i, t) for i, t in enumerate(texts, 1))
    вопрос = нумерованный
    if context:
        вопрос = ("О ЧЁМ РОЛИК (не переводить, это для понимания):\n%s\n\n"
                  "ПЕРЕВЕСТИ:\n%s" % (context, нумерованный))

    for cfg in пров.FREE.values():
        ключ = пров.key_file(cfg["ключ"]) if cfg["ключ"] else None
        if cfg["ключ"] and not ключ:
            continue
        try:
            # pick_model при неудаче выходит из программы — здесь это
            # означало бы «нет ключа Gemini, ролик не собираем»
            модель = пров.pick_model(cfg, ключ)
        except (Exception, SystemExit):
            continue
        скажи("Перевожу через %s (%s)..." % (cfg["имя"], модель))
        ответ, ошибка = пров.надёжно(lambda: пров.http(
            cfg["url"] + "/chat/completions", ключ, {
                "model": модель,
                "temperature": 0.2,
                "messages": [{"role": "system", "content": AI_ЗАДАНИЕ},
                             {"role": "user", "content": вопрос}],
            }, timeout=120), попыток=2)
        if ответ is None:
            скажи("   %s не ответил (%s) — беру следующего."
                  % (cfg["имя"], ошибка))
            continue
        got = разобрать_перевод(ответ, len(texts))
        if got:
            return got, cfg["имя"]
        скажи("   %s ответил не по формату — беру следующего." % cfg["имя"])
    return None, ""


def strip_marks(text):
    """Выбрасывает метку таймера «Т», если она попала в текст.

    «Т» ставится в файле «ПРОВЕРЬ ТАЙМЕРЫ.txt» перед словом-ответом и
    означает только место таймера. Переводчику её отдавать нельзя:
    DeepL делает из одиночной «Т» то «T», то «Th», нейросеть пытается
    осмыслить, а диктор потом это читает вслух. Убираем до отправки —
    места таймеров всё равно хранятся отдельно, в раскадровке.
    """
    очищено = re.sub(r"(?<![^\s])[ТT](?![^\s.,!?;:])[.,!?;:]?\s*", " ", text)
    return re.sub(r"\s{2,}", " ", очищено).strip() or text


def ответы_из_кавычек():
    """Что человек отметил кавычками как ответ — список строк."""
    путь = папки.work(os.path.join("out", "_ответы из кавычек.json"))
    if not os.path.exists(путь):
        return []
    try:
        данные = json.load(io.open(путь, encoding="utf-8"))
    except Exception:
        return []
    # длинные вперёд: «Африканский слон» должен найтись раньше, чем «слон»
    слова = [str(x.get("rus") or "").strip() for x in данные]
    return sorted([с for с in слова if с], key=len, reverse=True)


def в_кавычки(text, ответы):
    """Ставит ответ в кавычки перед отправкой переводчику.

    Без них переводчик читает ответ как обычное слово: «Лев» становится
    зверем, «Орёл» птицей, «Победа» — существительным, хотя в кадре это
    названия. В кавычках и DeepL, и нейросеть обращаются с ним как с
    именем собственным. Кавычки потом снимаются: диктор их не читает,
    и в субтитрах они не нужны.
    """
    for ответ in ответы:
        if not ответ:
            continue
        было = re.search(r"(?<!\w)" + re.escape(ответ) + r"(?!\w)", text,
                         flags=re.IGNORECASE)
        if не_в_кавычках(text, было):
            text = (text[:было.start()] + "«" + было.group(0) + "»"
                    + text[было.end():])
    return text


def не_в_кавычках(text, найдено):
    """Нашлось и ещё не обёрнуто — тогда оборачиваем."""
    if not найдено:
        return False
    до = text[:найдено.start()]
    return до.count("«") == до.count("»")


def снять_кавычки(text, было=None):
    """Убирает из перевода кавычки, которые поставили МЫ.

    Переводчик отдаёт их по-своему: ёлочки «Банкок» приезжают как
    "Bangkok" или “Bangkok”. Снимаем любые — но только если в исходной
    строке кавычек не было вовсе. Если человек сам взял что-то в
    кавычки, это его текст, и трогать его нельзя.
    """
    свои = re.sub(r"[«»\"“”„]", "", text)
    if было is None:
        return re.sub(r"[«»]", "", text)
    исходные = re.sub(r"[«»]", "", было)
    if re.search(r"[\"“”„]", исходные):
        return re.sub(r"[«»]", "", text)     # кавычки были не наши — оставляем
    return свои


ПОДПИСИ = "_ответы англ.json"     # русский ответ -> английская подпись
ЛЮБЫЕ_КАВЫЧКИ = re.compile(r"[«\"“„](.+?)[»\"”“]")


def запомнить_подписи(русские, английские):
    """Что стояло в кавычках по-русски — и что от этого осталось в переводе.

    Ровно это слово зритель увидит в кадре. Раньше подпись переводилась
    ВТОРЫМ, отдельным запросом, и приезжала другой: «кожа» на строке
    стала «Correct answer.» (слово потерялось), а подпись отдельно —
    «leather». В кадр ушло вообще третье слово, потому что «ответы.py»
    искал подпись в английском тексте и не нашёл.

    Теперь берём подпись оттуда же, откуда её услышит зритель: из самого
    перевода, из тех кавычек, которые мы сами и поставили. Совпадение
    с озвучкой получается не проверкой, а по построению.
    """
    пары = {}
    for ru, en in zip(русские, английские):
        было = re.findall(r"«(.+?)»", ru or "")
        стало = ЛЮБЫЕ_КАВЫЧКИ.findall(en or "")
        # Строку, где переводчик потерял или размножил кавычки, пропускаем
        # целиком: пара «не тот ответ» хуже, чем её отсутствие.
        if not было or len(было) != len(стало):
            continue
        for а, б in zip(было, стало):
            б = б.strip(" .,!?;:")
            if а.strip() and б:
                пары[а.strip().lower()] = б
    if not пары:
        return
    try:
        os.makedirs(OUT_DIR, exist_ok=True)
        io.open(os.path.join(OUT_DIR, ПОДПИСИ), "w", encoding="utf-8").write(
            json.dumps(пары, ensure_ascii=False, indent=1))
    except Exception:
        pass                       # подписи — помощь, а не условие сборки


def translate_all(texts, context=None, тихо=False):
    """Возвращает (переводы, чем переводили). DeepL -> Google -> MyMemory.

    Кавычки вокруг ответа ставятся здесь же и здесь же снимаются:
    они нужны переводчику, но не нужны ни диктору, ни субтитрам.
    Одно место на все пути перевода — иначе кавычки доезжают до
    кадра тем путём, который забыли обработать (так и вышло
    на первом прогоне: DeepL вернул «Bangkok» в кавычках).

    Перед тем как снять, кавычки прочитываются: то, что внутри них, —
    это и есть подпись для кадра (см. «запомнить_подписи»).
    """
    исходные = list(texts)
    готово, кто, отправлено = _translate_all(texts, context=context, тихо=тихо)
    if готово:
        запомнить_подписи(отправлено, готово)
        готово = [снять_кавычки(t, исходные[i] if i < len(исходные) else None)
                  for i, t in enumerate(готово)]
    return готово, кто


def _translate_all(texts, context=None, тихо=False):
    """Сам перевод. Возвращает ещё и то, что ушло переводчику, — по нему
    видно, где в переводе стоят НАШИ кавычки с ответом."""
    def скажи(s):
        if not тихо:
            print(s)

    texts = [strip_marks(t) for t in texts]
    ответы = ответы_из_кавычек()
    # Кавычки вокруг ответа помогают тем, кто понимает контекст — DeepL и
    # нейросети: они видят название, а не обычное слово. Google контекста
    # не понимает вовсе, и от кавычек ему только хуже: «Россия» в них он
    # вернул как «RU RUSSIAN». Поэтому ему отдаём текст как есть.
    с_кавычками = ([в_кавычки(t, ответы) for t in texts] if ответы else texts)

    key = deepl_key()
    if key:
        try:
            скажи("Перевожу через DeepL...")
            return deepl(с_кавычками, key, context), "DeepL", с_кавычками
        except Exception as e:
            скажи("   DeepL не ответил: %s" % deepl_why(e))
            скажи("   Пробую нейросеть.")

    got, кто = ai_translate(с_кавычками, context, тихо)
    if got:
        return got, кто, с_кавычками

    скажи("Перевожу через Google — запасной вариант.")
    if not key:
        скажи("   Положишь «ключ deepl.txt» рядом со скриптом —"
              " переводить будет DeepL.")

    out, bad = [], 0
    for i, t in enumerate(texts, 1):
        got = ""
        try:
            got = google(t)
        except Exception:
            try:
                got = mymemory(t)
            except Exception:
                got = ""
        if not got:
            got = t
            bad += 1
        out.append(got)
        if not тихо:
            sys.stdout.write("\r   переведено %d/%d" % (i, len(texts)))
            sys.stdout.flush()
        time.sleep(PAUSE)
    скажи("")
    if bad:
        скажи("   %d фраз перевести не удалось — остались по-русски,"
              " поправь руками." % bad)
    # Google ходил по тексту БЕЗ наших кавычек — искать в его переводе
    # нечего, поэтому третьим отдаём исходные строки: пар не найдётся,
    # и подписи будут переведены по-старому, отдельным запросом.
    return out, "Google", texts


def перевести(texts, context=None, тихо=False):
    """Единая точка входа для остальных скриптов.

    Ею пользуется «ответы.py»: подписи в кадре должен переводить тот же
    переводчик, что и весь текст. Раньше он ходил прямо в Google в обход
    очереди — и десять слов, которые зритель реально читает, оставались
    без DeepL, даже когда ключ лежал рядом.
    """
    return translate_all(texts, context=context, тихо=тихо)


# ------------------------------- сборка -------------------------------

def build(name, items):
    """Из английских фраз — субтитры, рабочая копия и плоский текст."""
    en_srt = os.path.join(OUT_DIR, name + ".en.srt")
    write_srt(items, en_srt)
    write_srt(items, os.path.join(OUT_DIR, name + ".исходный.srt"))
    io.open(os.path.join(OUT_DIR, name + ".en.txt"), "w",
            encoding="utf-8").write(" ".join(t for _, t in items))
    print("   ", os.path.basename(en_srt), " реплик: %d" % len(items))


def main():
    args = sys.argv[1:]
    only_build = "--собрать" in args or "--build" in args

    name, ru_path = newest(".русский.txt")
    if not name:
        sys.exit("Нет файла «...русский.txt». Сначала распознай речь"
                 " (кнопка 1).")
    en_path = os.path.join(OUT_DIR, name + ".английский.txt")

    if only_build:
        if not os.path.exists(en_path):
            sys.exit("Нет файла «%s» — сначала переведи."
                     % os.path.basename(en_path))
        items = read_phrases(en_path)
        if not items:
            sys.exit("В английском файле не осталось ни одной строки.")
        print("Собираю субтитры из твоего английского текста.")
        build(name, items)
        print("\nДальше — кнопка 2 (найти ответы).")
        return

    ru = read_phrases(ru_path)
    if not ru:
        sys.exit("В «%s» нет ни одной строки «время | текст»."
                 % os.path.basename(ru_path))

    pairs = brands()
    keep = {r.lower() for r, _ in pairs} | {e.lower() for _, e in pairs}
    prepared, marks = [], set()
    for t, text in ru:
        text2, hits = latinize(text, pairs)
        text2 = fix_caps(text2, keep)
        marks.update(hits)
        prepared.append(text2)
    if marks:
        print("Марки записал латиницей до перевода: %s"
              % ", ".join(sorted(marks)))

    got, who = translate_all(prepared)
    items = [(ru[i][0], got[i]) for i in range(len(ru))]

    write_phrases(items, en_path, [
        "# АНГЛИЙСКИЙ ТЕКСТ — проверь перевод.",
        "#",
        "# Переводил: %s. Правь смело — именно это озвучивается" % who,
        "# и показывается субтитрами.",
        "# Время в начале строки не трогай.",
    ])
    print("   ", os.path.basename(en_path), " фраз: %d" % len(items))
    build(name, items)
    print("\nПосмотри перевод, поправь что не нравится, и запусти")
    print("«python перевод.py --собрать», чтобы правки попали в ролик.")


if __name__ == "__main__":
    main()
