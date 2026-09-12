# -*- coding: utf-8 -*-
r"""
Показывает текст ролика Клоду и приносит список замечаний.

Запуск:  python проверить.py                  (посмотреть замечания)
         python проверить.py --править        (сразу внести правки)
         python проверить.py --кто gemini     (бесплатно, Google)
         python проверить.py --кто groq       (бесплатно, очень быстро)
         python проверить.py --модель sonnet  (Клод, но дешевле)

Что проверяет:
  1. РАСШИФРОВКУ. Whisper иногда слышит бессмыслицу: «Она зови третью
     марку» вместо «А назови третью марку». Клод читает текст целиком и
     говорит, где фраза не вяжется с соседними и на что она похожа.
  2. ПЕРЕВОД. Сверяет английский с русским строка за строкой: где смысл
     уехал, где звучит не по-английски, где марка написана неправильно.
  3. ЛОГИКУ. Верен ли ответ по факту, отвечает ли он на свой вопрос,
     не противоречат ли соседние фразы друг другу. Викторину смотрят
     тысячи людей, и ошибка в факте видна всем.
  4. ПРОИЗНОШЕНИЕ. Диктор — синтезатор речи, он читает по написанию и
     врёт на именах: «Porsche», «Hyundai», «Peugeot». Клод предлагает,
     как записать слово, чтобы оно прозвучало верно; замены попадают в
     «произношение.txt» и применяются ТОЛЬКО к озвучке — в кадре
     остаётся нормальное написание.

КТО ПРОВЕРЯЕТ. Скрипт сам берёт того, на кого есть ключ; порядок —
из списка ниже. Каждому ключу свой файл рядом со скриптами, одна
строка, сам ключ.

  ключ claude.txt   Клод. Платно (3-13 центов за ролик), зато лучше
                    всех видит, что фраза бессмысленна по смыслу.
                    console.anthropic.com -> API keys

  ключ gemini.txt   Google Gemini. БЕСПЛАТНО, карта не нужна.
                    Flash-модели: около 250 проверок в сутки, этого
                    хватает с большим запасом.
                    aistudio.google.com -> Get API key

  ключ groq.txt     Groq. БЕСПЛАТНО, отвечает за секунду-две.
                    Крутит открытые модели (gpt-oss, llama).
                    console.groq.com -> API keys

  ключ mistral.txt  Mistral. Бесплатный тариф «Experiment».
                    console.mistral.ai

  ключ openrouter.txt  OpenRouter. Есть модели с пометкой «:free».
                    openrouter.ai/keys

ПРО БЕСПЛАТНОЕ. На бесплатных тарифах твои тексты обычно уходят на
обучение модели — так они и окупаются. Для текста тиктока это не беда,
но что-то личное туда лучше не отправлять.

Сколько стоит. Ролик на полторы минуты — это около 1800 токенов на вход
(задание, русский текст, перевод) и 1000-4000 на ответ, смотря сколько
нашлось замечаний. На Опусе выходит 3-13 центов за ролик, на Соннете
1-5, на Хайку меньше трёх. Считается по факту и печатается в конце.

ЭТО НЕ ПОДПИСКА. Ключ оплачивается отдельно, по токенам; лимиты Pro
в claude.ai он не тратит, и наоборот.

Файлы:
  out\<имя>.замечания.txt   что нашлось — открывается блокнотом
  произношение.txt          замены для диктора (общие на все выпуски)
"""
import io, json, os, re, sys, time, urllib.request

import папки

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = папки.work("out")
SAY = папки.here("произношение.txt")
DICT = папки.here("словарь.txt")     # из него берём список марок
KEYS = (папки.here("ключ claude.txt"),
        os.path.join(os.path.dirname(HERE), "ключ claude.txt"))

# Цена за миллион токенов: (вход, выход). Опус умнее всех и видит
# смысловые огрехи, которые остальные пропускают; хайку берут, когда
# роликов много и нужен только грубый просмотр.
# Бесплатные провайдеры. У всех интерфейс как у OpenAI, поэтому
# запрос один и тот же — меняются только адрес, ключ и имя модели.
# Имена моделей нарочно не зашиты: они меняются каждые пару месяцев,
# поэтому список спрашивается у самого провайдера, а «хочу» — это
# подсказка, какую из них предпочесть.
FREE = {
    "gemini": {
        "имя": "Google Gemini",
        "url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "ключ": "ключ gemini.txt",
        "хочу": ["gemini-3-flash -lite -image -live -audio -tts -omni -thinking",
                "flash -lite -image -live -audio -tts -omni"],
        "где": "aistudio.google.com -> Get API key",
    },
    "groq": {
        "имя": "Groq",
        "url": "https://api.groq.com/openai/v1",
        "ключ": "ключ groq.txt",
        "хочу": ["gpt-oss-120b", "llama-3.3-70b", "gpt-oss"],
        "где": "console.groq.com -> API keys",
    },
    "mistral": {
        "имя": "Mistral",
        "url": "https://api.mistral.ai/v1",
        "ключ": "ключ mistral.txt",
        "хочу": ["mistral-large", "mistral-medium", "mistral-small"],
        "где": "console.mistral.ai",
    },
    "openrouter": {
        "имя": "OpenRouter",
        "url": "https://openrouter.ai/api/v1",
        "ключ": "ключ openrouter.txt",
        "хочу": ["gemini", "llama", "minimax", ":free"],
        "где": "openrouter.ai/keys",
    },
    "ollama": {
        "имя": "Ollama (на этом компьютере)",
        "url": "http://localhost:11434/v1",
        "ключ": None,                      # локальной модели ключ не нужен
        "хочу": ["qwen", "llama", "gemma"],
        "где": "ollama.com — качается и работает без интернета",
    },
}

MODELS = {
    "opus":   ("claude-opus-5", 5.0, 25.0),
    "sonnet": ("claude-sonnet-5", 2.0, 10.0),
    "haiku":  ("claude-haiku-4-5", 1.0, 5.0),
}
DEFAULT_MODEL = "opus"
MAX_TOKENS = 16000


def key():
    for p in KEYS:
        if os.path.exists(p):
            for raw in io.open(p, encoding="utf-8-sig"):
                line = raw.strip()
                if line and not line.startswith("#"):
                    return line
    return os.environ.get("ANTHROPIC_API_KEY")


def key_file(name):
    """Ключ из файла рядом со скриптами или в корне проекта."""
    for p in (папки.here(name), os.path.join(os.path.dirname(HERE), name)):
        if os.path.exists(p):
            for raw in io.open(p, encoding="utf-8-sig"):
                line = raw.strip()
                if line and not line.startswith("#"):
                    return line
    return None


def http(url, api_key=None, data=None, timeout=120):
    body = json.dumps(data).encode("utf-8") if data is not None else None
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def pick_model(cfg, api_key):
    """Спрашиваем у провайдера, какие модели у него сейчас есть.

    Имена моделей меняются постоянно, и зашивать их в скрипт — значит
    ломать его каждые пару месяцев. Берём список и выбираем первую,
    что похожа на желаемую.
    """
    try:
        data = http(cfg["url"] + "/models", api_key, timeout=30)
        есть = [m.get("id", "") for m in data.get("data", []) if m.get("id")]
    except Exception as e:
        sys.exit("%s не отвечает (%s).\nПроверь ключ и интернет."
                 % (cfg["имя"], e))
    if not есть:
        sys.exit("%s не показал ни одной модели." % cfg["имя"])
    # Gemini отдаёт имена как «models/gemini-3-flash», а в запрос идёт
    # короткое имя — служебный префикс снимаем
    есть = [m[len("models/"):] if m.startswith("models/") else m
            for m in есть]
    for хочу in cfg["хочу"]:
        части = хочу.split()
        нужно = части[0]
        кроме = [c[1:] for c in части[1:] if c.startswith("-")]
        подходят = sorted(m for m in есть
                          if нужно in m.lower()
                          and not any(k in m.lower() for k in кроме))
        if подходят:
            # чем новее модель, тем длиннее номер версии; берём последнюю
            return подходят[-1]
    return sorted(есть)[0]


def надёжно(запрос, попыток=3):
    """Повторяем при перегрузке сервиса. Возвращает (ответ, ошибка)."""
    последняя = ""
    for попытка in range(попыток):
        try:
            return запрос(), ""
        except Exception as e:
            текст = str(e)
            тело = ""
            try:
                тело = e.read().decode("utf-8", "replace").lower()
            except Exception:
                pass
            кончилось = ("quota" in тело or "per day" in тело
                         or "insufficient" in тело)
            последняя = "лимит на сегодня" if кончилось else текст[:70]
            if кончилось:
                break                       # ждать бесполезно
            временно = any(k in текст for k in ("429", "500", "502",
                                                "503", "504", "timed out"))
            if временно and попытка < попыток - 1:
                print("   занято, жду %d с..." % (10 * (попытка + 1)))
                time.sleep(10 * (попытка + 1))
                continue
            break
    return None, последняя


def ask_free(ru, en, provider, model_id, api_key):
    """Запрос к бесплатной модели. Формат общий, как у OpenAI."""
    cfg = FREE[provider]
    numbered_ru = "\n".join("%d. %s | %s" % (i, t, s)
                             for i, (t, s) in enumerate(ru, 1))
    numbered_en = "\n".join("%d. %s | %s" % (i, t, s)
                             for i, (t, s) in enumerate(en, 1))
    текст = ("РУССКИЙ (распознано на слух):\n%s\n\n"
             "АНГЛИЙСКИЙ (машинный перевод):\n%s"
             % (numbered_ru, numbered_en))

    print("Спрашиваю %s (%s)..." % (cfg["имя"], model_id))
    ответ, ошибка = надёжно(lambda: http(
        cfg["url"] + "/chat/completions", api_key, {
            "model": model_id,
            "temperature": 0.2,
            "messages": [{"role": "system", "content": ЗАДАНИЕ},
                         {"role": "user", "content": текст}],
        }, timeout=75), попыток=2)
    if ответ is None:
        raise RuntimeError("%s не ответил (%s)" % (cfg["имя"], ошибка))
    выбор = (ответ.get("choices") or [{}])[0]
    body = ((выбор.get("message") or {}).get("content") or "").strip()
    if not body:
        sys.exit("%s ответил пусто. Попробуй ещё раз или другого."
                 % cfg["имя"])
    m = re.search(r"\{.*\}", body, re.S)
    if not m:
        sys.exit("%s ответил не JSON-ом:\n%s" % (cfg["имя"], body[:400]))
    try:
        data = json.loads(m.group(0))
    except Exception as e:
        sys.exit("Не разобрал ответ (%s):\n%s" % (e, body[:400]))
    usage = ответ.get("usage") or {}
    return data, usage


def newest(ext):
    if not os.path.isdir(OUT_DIR):
        return None, None
    files = [f for f in os.listdir(OUT_DIR) if f.endswith(ext)]
    if not files:
        return None, None
    files.sort(key=lambda f: os.path.getmtime(os.path.join(OUT_DIR, f)),
               reverse=True)
    return files[0][:-len(ext)], os.path.join(OUT_DIR, files[0])


def read_phrases(path):
    out = []
    for raw in io.open(path, encoding="utf-8-sig"):
        line = raw.strip()
        if not line or line.startswith("#") or "|" not in line:
            continue
        left, right = line.split("|", 1)
        m = re.match(r"^\s*(\d+):(\d+(?:\.\d+)?)\s*$", left)
        if m and right.strip():
            out.append((left.strip(), right.strip()))
    return out


ЗАДАНИЕ = """Ты помогаешь собирать короткие видео-викторины для TikTok.

Русский ролик распознан на слух (Whisper), потом переведён на английский
машинным переводчиком. Английский текст будет прочитан вслух синтезатором
речи и показан субтитрами по одному слову.

Проверь четыре вещи и верни ТОЛЬКО JSON, без пояснений вокруг.

1. "расшифровка" — строки, где распознавание явно ошиблось: фраза не
   вяжется с соседними, слово выпадает из смысла, вместо названия марки
   слышится похожее слово. Для каждой: номер строки, что стоит сейчас,
   что там было сказано на самом деле (твоя догадка), почему.
   Мелкие огрехи пунктуации не трогай.

2. "перевод" — строки, где английский расходится с русским по смыслу,
   звучит не по-английски или теряет обращение к зрителю. Для каждой:
   номер строки, что стоит сейчас, как лучше, почему.
   Стиль: живая разговорная речь, короткие фразы, обращение на «ты».

3. "логика" — самое важное. Это викторина, её будут смотреть тысячи
   людей, и ошибка в факте видна всем. Проверь по смыслу:

   - ОТВЕТ ВЕРЕН? «Сколько колец на олимпийском флаге» -> пять, а не
     шесть. Если ответ фактически неправильный, скажи, какой верный;
   - ОТВЕТ ОТВЕЧАЕТ НА ВОПРОС? Бывает, что спросили про животное,
     а в ответе страна: значит распознавание склеило соседние фразы;
   - ФРАЗА ОСМЫСЛЕННА? «Она зови третью марку» — набор слов, так
     никто не говорит. Напиши, как было сказано на самом деле;
   - НЕТ ЛИ ПРОТИВОРЕЧИЙ между вопросом и ответом, между соседними
     фразами, между числом в вопросе и числом в ответе.

   Для каждой находки: номер строки, что стоит сейчас, как надо, почему.
   Если всё сходится — пустой список, это нормальный ответ.

4. "произношение" — слова, которые английский синтезатор прочитает
   НЕПРАВИЛЬНО. Это редкий случай, и МАРКИ МАШИН к нему не относятся:
   английский голос знает их все и читает сам. Разбивать «Volkswagen»
   на слоги — испортить озвучку, так делать не надо.
   Предлагай замену только там, где написание расходится с английским
   чтением — французские и китайские названия, редкие марки:
   "Peugeot" -> "Pu-zho", "Citroen" -> "Sit-ro-en", "Porsche" -> "Porsh-uh".

   Никаких марок машин. Замена уместна разве что для географических
   названий и редких имён собственных, и только если ты уверена, что
   синтезатор ошибётся. Сомневаешься — не предлагай.
   Пустой список здесь — самый обычный ответ.

Формат ответа:

{"расшифровка": [{"строка": 7, "было": "...", "надо": "...", "почему": "..."}],
 "перевод":     [{"строка": 7, "было": "...", "надо": "...", "почему": "..."}],
 "логика":      [{"строка": 7, "было": "...", "надо": "...", "почему": "..."}],
 "произношение":[{"слово": "Hyundai", "читать": "Hyun-day"}]}

Если по какому-то пункту замечаний нет — пустой список."""


def ask(ru, en, api_key, model_id, effort):
    try:
        import anthropic
    except ImportError:
        sys.exit("Нет библиотеки anthropic. Установи её командой:\n"
                 "    pip install anthropic")

    numbered_ru = "\n".join("%d. %s | %s" % (i, t, s)
                            for i, (t, s) in enumerate(ru, 1))
    numbered_en = "\n".join("%d. %s | %s" % (i, t, s)
                            for i, (t, s) in enumerate(en, 1))
    текст = ("РУССКИЙ (распознано на слух):\n%s\n\n"
             "АНГЛИЙСКИЙ (машинный перевод):\n%s" % (numbered_ru, numbered_en))

    client = anthropic.Anthropic(api_key=api_key)
    print("Спрашиваю Клода (%s, вдумчивость «%s»)..." % (model_id, effort))
    # ответ короткий, но модель думает над текстом целиком — стримим,
    # чтобы не упереться в таймаут на длинном ролике
    with client.messages.stream(
            model=model_id,
            max_tokens=MAX_TOKENS,
            output_config={"effort": effort},
            system=ЗАДАНИЕ,
            messages=[{"role": "user", "content": текст}]) as stream:
        message = stream.get_final_message()

    if message.stop_reason == "refusal":
        sys.exit("Клод отказался отвечать. Такое бывает редко;"
                 " попробуй ещё раз.")
    body = "".join(b.text for b in message.content if b.type == "text")
    m = re.search(r"\{.*\}", body, re.S)
    if not m:
        sys.exit("Клод ответил не JSON-ом:\n" + body[:400])
    try:
        return json.loads(m.group(0)), message.usage
    except Exception as e:
        sys.exit("Не разобрал ответ (%s):\n%s" % (e, body[:400]))


def report(data, ru, en, path):
    lines = ["ЗАМЕЧАНИЯ ПО ТЕКСТУ РОЛИКА",
             "=" * 60, "",
             "Это подсказки, а не приказ: где не согласна — не правь.",
             "Номера строк совпадают с порядком строк в файлах",
             "«...русский.txt» и «...английский.txt».", ""]

    def block(title, items, fields):
        lines.append(title)
        lines.append("-" * len(title))
        if not items:
            lines.append("   Замечаний нет.")
            lines.append("")
            return
        for it in items:
            n = it.get("строка")
            lines.append("   строка %s" % n if n else "   —")
            for label, field in fields:
                val = it.get(field)
                if val:
                    lines.append("     %-8s %s" % (label, val))
            lines.append("")

    block("1. РАСШИФРОВКА — что не так расслышано",
          data.get("расшифровка") or [],
          [("было:", "было"), ("надо:", "надо"), ("почему:", "почему")])
    block("2. ПЕРЕВОД — что сказано не так",
          data.get("перевод") or [],
          [("было:", "было"), ("надо:", "надо"), ("почему:", "почему")])
    block("3. ЛОГИКА — что не сходится по смыслу",
          data.get("логика") or [],
          [("было:", "было"), ("надо:", "надо"), ("почему:", "почему")])

    lines.append("4. ПРОИЗНОШЕНИЕ — что диктор прочтёт неправильно")
    lines.append("-" * 52)
    say = data.get("произношение") or []
    if not say:
        lines.append("   Замечаний нет.")
    else:
        for it in say:
            lines.append("   %-16s читать как  %s"
                         % (it.get("слово", ""), it.get("читать", "")))
        lines.append("")
        lines.append("   Эти замены уже записаны в «произношение.txt»")
        lines.append("   и применяются только к озвучке: в кадре остаётся")
        lines.append("   нормальное написание.")
    lines.append("")
    io.open(path, "w", encoding="utf-8", newline="\r\n").write(
        "\n".join(lines) + "\n")


def читается_верно():
    """Слова, которым подсказка по произношению не нужна.

    Английский голос знает названия марок и читает их сам. Подсказки
    вроде «Volkswagen = Folks-va-gen» заставляли его читать по слогам —
    получалось хуже, чем было. Поэтому берём весь левый столбец
    «словарь.txt»: что там перечислено, то диктор произносит без нас.
    """
    слова = set()
    if os.path.exists(DICT):
        for raw in io.open(DICT, encoding="utf-8-sig"):
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if re.match(r"^(?:НЕ|NOT)\s*:", line, re.I):
                continue
            слова.add(line.split("=", 1)[0].strip().lower())
    return слова


def save_pronunciation(items):
    знакомые = читается_верно()
    """Дописываем замены, не трогая то, что уже есть."""
    have = {}                       # ключ — слово в нижнем регистре,
    written = {}                    # значение — как его писать в файле
    if os.path.exists(SAY):
        for raw in io.open(SAY, encoding="utf-8-sig"):
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                left, right = line.split("=", 1)
                have[left.strip().lower()] = right.strip()
                written[left.strip().lower()] = left.strip()
    added = []
    for it in items:
        word, how = (it.get("слово") or "").strip(), (it.get("читать") or "").strip()
        if word.lower() in знакомые:
            continue                      # диктор и так справится
        if word and how and word.lower() not in have:
            have[word.lower()] = how
            written[word.lower()] = word      # «Hyundai», а не «hyundai»
            added.append((word, how))
    if not os.path.exists(SAY) or added:
        head = ["# КАК ДИКТОРУ ЧИТАТЬ СЛОВА.",
                "#",
                "# Слева — как слово написано в тексте, справа — как его",
                "# записать, чтобы синтезатор прочитал верно. Замена",
                "# работает ТОЛЬКО в озвучке: в кадре остаётся написание",
                "# из левой части.",
                "#",
                "# Строки предлагает «проверить.py», править можно руками.",
                ""]
        body = ["%s = %s" % (written.get(k, k), h)
                for k, h in sorted(have.items())]
        io.open(SAY, "w", encoding="utf-8", newline="\r\n").write(
            "\n".join(head + body) + "\n")
    return added


def кусок_строки(текст, было):
    """Где в строке лежит процитированный моделью кусок. Нет — None."""
    было = (было or "").strip()
    if not было or было == текст:
        return None
    if было in текст:
        return было
    низ = текст.lower()
    if было.lower() in низ:
        i = низ.index(было.lower())
        return текст[i:i + len(было)]
    return None


def apply_fixes(path, items, field="надо"):
    """Меняем текст в строках с указанными номерами.

    Модель часто цитирует в «было» не всю строку, а только её кусок:
    «было: если все сказал верно» при строке «Нажми кнопку «комментарий»
    и отправь «смайлик», если все сказал верно.» Если в таком случае
    заменить строку целиком, из ролика молча пропадает половина фразы —
    именно так на проверке исчезло «Нажми кнопку комментарий и отправь
    смайлик». Поэтому когда «было» — это кусок строки, меняем только его.
    """
    raw = io.open(path, encoding="utf-8-sig").read().replace("\r\n", "\n")
    lines = raw.split("\n")
    # номера строк считаются по строкам «время | текст», без шапки
    idx = [i for i, l in enumerate(lines)
           if "|" in l and not l.strip().startswith("#")]
    done = 0
    for it in items:
        n = it.get("строка")
        new = (it.get(field) or "").strip()
        if not n or not new or n > len(idx):
            continue
        i = idx[n - 1]
        left, _, текст = lines[i].partition("|")
        текст = текст.strip()
        часть = кусок_строки(текст, it.get("было"))
        стало = текст.replace(часть, new, 1) if часть else new
        lines[i] = "%s| %s" % (left, стало)
        done += 1
    io.open(path, "w", encoding="utf-8", newline="\r\n").write(
        "\n".join(lines))
    return done


def кто_есть():
    """Кого можно спросить прямо сейчас: по лежащим рядом ключам."""
    есть = []
    if key():
        есть.append("claude")
    for имя, cfg in FREE.items():
        if cfg["ключ"] and key_file(cfg["ключ"]):
            есть.append(имя)
    return есть


def подсказка_про_ключи():
    print("Не нашёл ни одного ключа. Заведи любой — бесплатных хватает:")
    print()
    print("  БЕСПЛАТНО, карта не нужна:")
    for имя in ("gemini", "groq", "mistral", "openrouter"):
        cfg = FREE[имя]
        print("     %-22s %s" % (cfg["ключ"], cfg["где"]))
    print()
    print("  ПЛАТНО, зато точнее всех:")
    print("     %-22s console.anthropic.com -> API keys" % "ключ claude.txt")
    print()
    print("  СОВСЕМ БЕЗ ИНТЕРНЕТА: поставь ollama.com и запусти")
    print("     python проверить.py --кто ollama")
    print()
    print("Файл кладётся рядом со скриптами, внутри одна строка — ключ.")


def main():
    args = sys.argv[1:]
    fix = "--править" in args or "--fix" in args

    выбор = DEFAULT_MODEL
    for flag in ("--модель", "--model"):
        if flag in args:
            выбор = args[args.index(flag) + 1].lower()

    # кого спрашиваем: явно указанного или первого, на кого есть ключ
    кто = None
    for flag in ("--кто", "--who", "--провайдер"):
        if flag in args:
            кто = args[args.index(flag) + 1].lower()
    доступные = кто_есть()
    if кто is None:
        # Клод впереди: он единственный ловит бессмыслицу по смыслу,
        # а не по грамматике. Нет его ключа — берём бесплатных.
        порядок = ["claude", "gemini", "groq", "mistral", "openrouter"]
        кто = next((k for k in порядок if k in доступные), None)
        if кто is None:
            подсказка_про_ключи()
            return
    if кто != "claude" and кто not in FREE:
        sys.exit("Не знаю такого проверяющего: «%s».\nБывают: claude, %s."
                 % (кто, ", ".join(FREE)))

    name, ru_path = newest(".русский.txt")
    if not name:
        sys.exit("Нет русского текста. Сначала распознай речь (кнопка 1).")
    en_path = os.path.join(OUT_DIR, name + ".английский.txt")
    if not os.path.exists(en_path):
        sys.exit("Нет перевода. Сначала переведи (кнопка 1б).")

    ru, en = read_phrases(ru_path), read_phrases(en_path)
    print("Ролик: %s,  строк: %d" % (name, len(ru)))

    if кто == "claude":
        api_key = key()
        if not api_key:
            sys.exit("Нет файла «ключ claude.txt».\n"
                     "Бесплатные варианты: python проверить.py --кто gemini")
        if выбор not in MODELS:
            sys.exit("Не знаю модель «%s». Бывают: %s."
                     % (выбор, ", ".join(MODELS)))
        model_id, цена_вход, цена_выход = MODELS[выбор]
        effort = "medium"
        for flag in ("--вдумчиво", "--effort"):
            if flag in args:
                effort = args[args.index(flag) + 1].lower()
        data, usage = ask(ru, en, api_key, model_id, effort)
        вход, выход = usage.input_tokens, usage.output_tokens
    else:
        # начинаем с выбранного, дальше — все остальные, у кого есть ключ
        порядок = [кто] + [k for k in доступные if k not in ("claude", кто)]
        data = usage = None
        беда = []
        for имя in порядок:
            cfg = FREE.get(имя)
            if not cfg:
                continue
            api_key = key_file(cfg["ключ"]) if cfg["ключ"] else "локально"
            if not api_key:
                continue
            try:
                model_id = pick_model(cfg, api_key)
                data, usage = ask_free(ru, en, имя, model_id, api_key)
                break
            except SystemExit as e:
                беда.append("%s: %s" % (имя, e))
            except Exception as e:
                беда.append(str(e)[:90])
                print("   %s — пробую следующего." % str(e)[:70])
        if data is None:
            sys.exit("Никто не ответил.\n   " + "\n   ".join(беда[-3:]))
        вход = (usage or {}).get("prompt_tokens") or 0
        выход = (usage or {}).get("completion_tokens") or 0
        цена_вход = цена_выход = 0.0

    расш = data.get("расшифровка") or []
    пер = data.get("перевод") or []
    логика = data.get("логика") or []
    произ = data.get("произношение") or []
    print("Замечаний: расшифровка %d, перевод %d, логика %d, произношение %d"
          % (len(расш), len(пер), len(логика), len(произ)))
    for it in логика[:5]:
        print("   логика: %s -> %s" % (str(it.get("было"))[:34],
                                       str(it.get("надо"))[:34]))

    added = save_pronunciation(произ)
    if added:
        print("В «произношение.txt» добавлено: %s"
              % ", ".join(w for w, _ in added))

    path = os.path.join(OUT_DIR, name + ".замечания.txt")
    report(data, ru, en, path)
    print("   ", os.path.basename(path))

    if fix:
        a = apply_fixes(ru_path, расш)
        # логические правки — это тот же английский текст, только по делу:
        # неверный факт, ответ мимо вопроса, бессмыслица
        b = apply_fixes(en_path, пер) + apply_fixes(en_path, логика)
        print("Внесено правок: в русский %d, в английский %d." % (a, b))
        print("Дальше — «1в Забрать правки перевода», чтобы они попали"
              " в субтитры.")
    elif расш or пер or логика:
        print("\nЭто только список. Чтобы внести правки сразу:")
        print("    python проверить.py --править")

    print()
    if цена_выход:
        цена = (вход * цена_вход + выход * цена_выход) / 1e6
        print("Потрачено: %d токенов на вход, %d на ответ — %.1f цента."
              % (вход, выход, цена * 100))
        print("Двадцать таких роликов обойдутся примерно в %.2f доллара."
              % (цена * 20))
        свободные = [k for k in доступные if k != "claude"]
        if свободные:
            print("Бесплатно то же самое: python проверить.py --кто %s"
                  % свободные[0])
        else:
            print("Дешевле: --модель sonnet (в 2.5 раза),"
                  " --модель haiku (в 5 раз). Бесплатно: --кто gemini.")
    else:
        print("Потрачено: %d токенов на вход, %d на ответ. Денег — нисколько."
              % (вход, выход))


if __name__ == "__main__":
    main()
