# -*- coding: utf-8 -*-
r"""
Смотрит на готовые карточки и проверяет, то ли на них, что должно быть.

Запуск:  python глаза.py            (посмотреть и доложить)
         python глаза.py --менять   (что не то — перекачать другое)
         python глаза.py --модель X (взять другую модель)

Зачем. Картинки подбираются автоматически, и иногда вместо машины
приезжает вокзал, логотип или вообще другая марка: сток на «Mitsubishi»
отдаёт Токийский вокзал, а Википедия на редкой марке — герб города.
Раньше это ловилось только глазами при просмотре ролика.

Здесь каждая карточка показывается модели с картинками, и та отвечает,
что на ней. Не совпало — карточка перекачивается другим вариантом
(картинки.py --вариант), и так до трёх попыток.

Свои файлы из «картинки\своё» не трогаются никогда: раз положила
руками — значит так и надо, скрипт только доложит, если засомневается.

Ключ берётся из «ключ openrouter.txt» (бесплатно, openrouter.ai/keys).
"""
import base64, io, json, os, re, shutil, subprocess, sys, time

import папки
import проверить as пров

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
BOARD = папки.work("раскадровка.txt")
READY = папки.work("картинки", "готовые")
MINE = папки.here("картинки", "своё")
OUT_DIR = папки.work("out")

# Кто смотрит. Gemini впереди, если положен его ключ: он бесплатный
# (aistudio.google.com -> Get API key) и разбирает фотографии точнее.
СМОТРЯЩИЕ = [
    {"имя": "Gemini",
     "ключ": "ключ gemini.txt",
     "url": "https://generativelanguage.googleapis.com/v1beta/openai",
     "хочу": ["gemini-3-flash -lite -image -live -audio -tts -omni -thinking",
                "flash -lite -image -live -audio -tts -omni"],
     "пауза": 6.5},          # бесплатный тариф: 10 запросов в минуту
    {"имя": "OpenRouter",
     "ключ": "ключ openrouter.txt",
     "url": "https://openrouter.ai/api/v1",
     # «-batch» обязателен. У minimax бесплатного варианта больше нет,
     # осталось «minimax-m3:batch» — это асинхронный дешёвый режим
     # OpenRouter, и на бесплатном ключе он просто висит по три минуты
     # на карточку. Без исключения именно его и выбирало.
     "хочу": ["gemma-4 -batch", "minimax -batch", ":free"],
     "пауза": 2.0},
    {"имя": "Mistral",
     "ключ": "ключ mistral.txt",
     "url": "https://api.mistral.ai/v1",
     "хочу": ["pixtral", "small-latest", "medium"],
     "пауза": 2.0},
]
URL = "https://openrouter.ai/api/v1/chat/completions"   # запасной адрес
# Проверено на наших карточках: узнаёт Toyota Yaris, Hyundai Tucson,
# BMW M3 и честно говорит «не она», когда марка другая. Остальные
# бесплатные с картинками — про запас, если эта упрётся в лимит.
МОДЕЛИ = ["google/gemma-4-31b-it:free",
          "google/gemma-4-26b-a4b-it:free",
          "dots-studio/dots-3-note-preview:free"]
ПОПЫТОК = 3            # сколько раз перекачиваем одну карточку
ПАУЗА = 2.0            # между запросами через OpenRouter
ПАУЗА_GEMINI = 6.5     # у бесплатного Gemini лимит 10 запросов в минуту

ВОПРОС = """На картинке должен быть: %s.

Это карточка из видео-викторины: зритель видит фото и должен узнать по
нему марку.

ВАЖНО ПРО ФОРМАТ. Карточка — обрезанный под прямоугольник кусок
фотографии. Машина почти всегда выходит за края: видно перед и бок,
а бампер или корма срезаны. ЭТО НОРМАЛЬНО и браковать за это нельзя.
Единственное, что важно: понятно ли по кадру, что это за марка.

Ответь ТОЛЬКО JSON, без пояснений:

{"что_вижу": "коротко, что на картинке",
 "марка_на_машине": "какая марка на шильдике и решётке, одним словом;
                     если не разобрать — пустая строка",
 "машина_крупно": true, если машина занимает половину кадра и больше,
 "то_что_нужно": true или false,
 "почему": "одной фразой, если не то"}

Поле "марка_на_машине" заполняй по тому, что ВИДНО на самой машине —
логотип, надпись, форма решётки, — а не по тому, чьей дочкой считается
производитель.

Ставь false, если:
  - на картинке другая марка;
  - на машине логотип «дочки» нужной марки, а не её самой: Acura — не
    Honda, Lexus — не Toyota, Genesis — не Hyundai, Cupra — не Seat,
    Polestar — не Volvo. Зритель их не свяжет;
  - это вообще не легковая машина: вывеска, салон дилера, завод,
    логотип на белом фоне, коллаж, чертёж, интерьер, деталь крупным планом;
  - машина старинная, военная или настолько редкая, что обычный зритель
    не поймёт, какая это марка;
  - в кадре только корма или одна деталь, и марку не угадать;
  - темно, размыто, машина не читается;
  - МАШИНА МЕЛКАЯ: вид улицы, двора, дома или парковки, где машина
    где-то вдали. Она должна занимать хотя бы половину кадра по ширине —
    ролик смотрят с телефона, мелкую машину там не разглядеть.

Ставь true, если марка узнаётся: видно логотип, решётку, фары или
характерную форму. Обрезанные края, мокрый асфальт, люди и дома на
заднем плане — не помеха.

"""


ВОПРОС_ОБЩИЙ = """На картинке должно быть: %s.

Это карточка из видео-викторины: зритель слышит вопрос, думает, а потом
видит фото с ответом.

ВАЖНО ПРО ФОРМАТ. Карточка — обрезанный под прямоугольник кусок
фотографии, края срезаны. Это нормально и браковать за это нельзя.

Ответь ТОЛЬКО JSON, без пояснений:

{"что_вижу": "коротко, что на картинке",
 "то_что_нужно": true или false,
 "почему": "одной фразой, если не то"}

Ставь false, если:
  - на картинке не то, что нужно, или связь слишком далёкая;
  - это текст, схема, коллаж, скриншот, инфографика или карта с
    подписями — зритель должен УВИДЕТЬ ответ, а не прочитать;
  - главный предмет мелкий или теряется среди прочего;
  - темно, размыто, не разобрать.

Ставь true, если по картинке понятно, о чём речь, и она годится
как иллюстрация ответа."""


def brands_list():
    """Марки из «словарь.txt» — по ним понятно, автомобильный ли выпуск."""
    p = папки.here("словарь.txt")
    out = set()
    if os.path.exists(p):
        for raw in io.open(p, encoding="utf-8-sig"):
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                out.add(line.split("=", 1)[0].strip().lower())
    return out


def ask_image(path, want, key, model, url=URL, вопрос=None):
    b64 = base64.b64encode(io.open(path, "rb").read()).decode("ascii")
    r = пров.http(url, key, {
        "model": model,
        "temperature": 0,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": (вопрос or ВОПРОС) % want},
            {"type": "image_url",
             "image_url": {"url": "data:image/png;base64," + b64}},
        ]}],
    }, timeout=180)
    body = ((r.get("choices") or [{}])[0].get("message") or {}).get("content")
    m = re.search(r"\{.*\}", body or "", re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def кто_смотрит():
    """Все, на чей ключ наткнулись. Карточки раздадим им по кругу."""
    готовы = []
    for cfg in СМОТРЯЩИЕ:
        key = пров.key_file(cfg["ключ"])
        if not key:
            continue
        try:
            model = пров.pick_model(
                {"имя": cfg["имя"], "url": cfg["url"], "хочу": cfg["хочу"]}, key)
        except SystemExit:
            continue                      # сервис не отозвался — пропускаем
        готовы.append({
            "имя": cfg["имя"],
            "url": cfg["url"] + "/chat/completions",
            "ключ": key,
            "модели": [model],
            "пауза": cfg.get("пауза", 2.0),
            "когда": 0.0,                 # время последнего запроса
        })
    # OpenRouter умеет много моделей — пусть будет запасной для всех
    for who in готовы:
        if who["имя"] == "OpenRouter":
            who["модели"] += [m for m in МОДЕЛИ if m not in who["модели"]]
    return готовы


def спросить_по_кругу(очередь, номер, path, want, вопрос=None):
    """Берём следующего по кругу и ждём только его собственный лимит."""
    живые = [w for w in очередь if not w.get("выдохся")]
    if not живые:
        return None, None, "никто"
    порядок = [живые[(номер + k) % len(живые)] for k in range(len(живые))]
    for who in порядок:
        ждать = who["пауза"] - (time.time() - who["когда"])
        if ждать > 0:
            time.sleep(ждать)
        got, model = look(path, want, who["ключ"], who["модели"],
                          who["url"], вопрос)
        who["когда"] = time.time()
        if КВОТА_КОНЧИЛАСЬ:
            who["выдохся"] = True
            print("      %s на сегодня всё — дальше без него" % who["имя"])
            continue
        if got is not None:
            return got, model, who["имя"]
    return None, None, порядок[-1]["имя"]


ПОСЛЕДНЯЯ_ОШИБКА = ""
КВОТА_КОНЧИЛАСЬ = False        # 429 бывает «часто» и «на сегодня хватит»


def читать_ошибку(e):
    """У 429 в теле ответа написано, что именно кончилось."""
    тело = ""
    try:
        тело = e.read().decode("utf-8", "replace")
    except Exception:
        pass
    низ = (тело + " " + str(e)).lower()
    кончилась = ("quota" in низ or "per day" in низ or "billing" in низ
                 or "insufficient" in низ)
    return тело[:200], кончилась


def look(path, want, key, models, url=URL, вопрос=None):
    """Спрашиваем модели по очереди: первая, что ответит, и решает."""
    global ПОСЛЕДНЯЯ_ОШИБКА, КВОТА_КОНЧИЛАСЬ
    ПОСЛЕДНЯЯ_ОШИБКА = ""
    КВОТА_КОНЧИЛАСЬ = False
    for model in models:
        for попытка in range(3):
            try:
                got = ask_image(path, want, key, model, url, вопрос)
                if got:
                    return got, model
                ПОСЛЕДНЯЯ_ОШИБКА = "ответила не по форме"
                break                      # ответила ерундой — к следующей
            except Exception as e:
                ПОСЛЕДНЯЯ_ОШИБКА = str(e)[:70]
                if "429" in str(e):
                    тело, кончилась = читать_ошибку(e)
                    if кончилась:
                        КВОТА_КОНЧИЛАСЬ = True
                        ПОСЛЕДНЯЯ_ОШИБКА = "квота на сегодня исчерпана"
                        return None, None      # ждать нечего
                    time.sleep(8 * (попытка + 1))
                    continue
                break
    return None, None


# «Дочки», которые модель охотно засчитывает за материнскую марку.
# Для зрителя это разные марки: на машине чужой логотип.
ЧУЖИЕ = {
    "honda": {"acura"}, "toyota": {"lexus", "daihatsu"},
    "hyundai": {"genesis", "kia"}, "seat": {"cupra"},
    "volvo": {"polestar"}, "nissan": {"infiniti", "datsun"},
    "volkswagen": {"audi", "skoda", "seat", "porsche"},
    "ford": {"lincoln"}, "gm": {"chevrolet"},
}


def brand_matches(got, want):
    """Совпадает ли марка на шильдике с той, что должна быть.

    Пустое поле — не придираемся: не всякий ракурс показывает логотип,
    и отбраковывать по нему хорошие фото не за что.
    """
    видно = re.sub(r"[^a-zа-я ]", "", str(got.get("марка_на_машине", "")).lower())
    видно = видно.strip()
    if not видно:
        return True
    нужно = want.lower()
    if нужно in видно or видно in нужно:
        return True
    # «Acura/Honda NSX» — если нужная марка вообще упомянута, считаем спорным
    # и смотрим, не чужая ли это дочка
    for чужая in ЧУЖИЕ.get(нужно, ()):
        if чужая in видно and нужно not in видно.replace(чужая, ""):
            return False
    return нужно in видно


def board_items():
    """Ответы из раскадровки по порядку — им соответствуют NN.png."""
    items = []
    for raw in io.open(BOARD, encoding="utf-8-sig"):
        line = raw.strip()
        if not line or line.startswith("#") or "|" not in line:
            continue
        if re.match(r"^(?:ТЕМА|TITLE)\s*:", line, re.I):
            continue
        name = line.split("|", 1)[1].split("#", 1)[0].strip()
        if name:
            items.append(name)
    return items


def theme():
    for raw in io.open(BOARD, encoding="utf-8-sig"):
        m = re.match(r"^\s*(?:ТЕМА|TITLE)\s*:\s*(.+)$", raw.strip(), re.I)
        if m:
            return m.group(1).strip()
    return ""


def is_mine(name, number):
    import картинки
    return картинки.mine_for(name, number) is not None


def refetch(number, variant, можно_повтор=False):
    """Перекачать одну карточку другим вариантом."""
    cmd = [sys.executable, "картинки.py",
           "--только", str(number), "--вариант", str(variant)]
    if можно_повтор:
        cmd.append("--можно-повтор")
    r = subprocess.run(cmd, cwd=HERE, env=dict(os.environ),
                       capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return r.returncode == 0


def main():
    args = sys.argv[1:]
    менять = "--менять" in args or "--fix" in args
    models = list(МОДЕЛИ)
    for flag in ("--модель", "--model"):
        if flag in args:
            models = [args[args.index(flag) + 1]] + models

    очередь = кто_смотрит()
    if not очередь:
        sys.exit("Нет ключа — смотреть нечем. Любой подойдёт, все бесплатные:\n"
                 "   ключ gemini.txt      aistudio.google.com -> Get API key\n"
                 "   ключ openrouter.txt  openrouter.ai/keys\n"
                 "   ключ mistral.txt     console.mistral.ai")
    if "--модель" in args or "--model" in args:
        очередь = [dict(очередь[0], модели=models)]
    print("Смотрят по очереди: %s"
          % ", ".join("%s (%s)" % (w["имя"], w["модели"][0]) for w in очередь))
    if len(очередь) == 1:
        print("   Один сервис — придётся ждать его лимит. Заведи ещё ключ,")
        print("   и карточки разойдутся между сервисами без пауз.")
    if not os.path.exists(BOARD):
        sys.exit("Нет раскадровки. Сначала кнопки 1 и 2.")

    items = board_items()
    тема = theme()
    марки = brands_list()
    print("Смотрю карточки: %d штук%s"
          % (len(items), (",  тема «%s»" % тема) if тема else ""))

    плохие, отчёт = [], []
    for i, name in enumerate(items, 1):
        path = os.path.join(READY, "%02d.png" % i)
        if not os.path.exists(path):
            print("  %2d. %-14s нет файла" % (i, name))
            continue
        свой = is_mine(name, i)
        нужно = "%s (%s)" % (name, тема) if тема else name
        # про машину спрашиваем строго (логотип, «дочки», крупный план),
        # про всё остальное — по-человечески
        вопрос = ВОПРОС if name.lower() in марки else ВОПРОС_ОБЩИЙ

        got, model, чей = спросить_по_кругу(очередь, i - 1, path,
                                            нужно, вопрос)
        if got is None:
            print("  %2d. %-14s не смог посмотреть (%s)"
                  % (i, name, ПОСЛЕДНЯЯ_ОШИБКА or "нет ответа"))
            continue

        # «машина_крупно» смотрим отдельно: модель иногда ставит общий
        # плюс, хотя сама пишет «дом, а перед ним небольшой автомобиль»
        крупно = got.get("машина_крупно")
        авто = name.lower() in марки
        ок = (bool(got.get("то_что_нужно"))
              and (brand_matches(got, name) if авто else True)
              and (крупно is not False if авто else True))
        вижу = str(got.get("что_вижу", ""))[:46]
        if ок:
            print("  %2d. %-14s ок — %s  [%s]" % (i, name, вижу, чей))
            отчёт.append((i, name, True, вижу, ""))
            continue

        почему = str(got.get("почему", ""))[:60]
        шильдик = str(got.get("марка_на_машине", "")).strip()
        if крупно is False and not почему:
            почему = "машина мелко в кадре"
        if шильдик and not почему:
            почему = "на машине логотип: %s" % шильдик
        if свой:
            print("  %2d. %-14s ТВОЙ ФАЙЛ, но вижу: %s" % (i, name, вижу))
            отчёт.append((i, name, False, вижу, "твой файл — не трогаю"))
            continue

        print("  %2d. %-14s НЕ ТО — %s (%s)" % (i, name, вижу, почему))
        плохие.append((i, name, вижу, почему))
        отчёт.append((i, name, False, вижу, почему))

    # ------------------------ перекачиваем ------------------------
    исправлено = []
    if менять and плохие:
        print("\nПерекачиваю то, что не подошло:")
        for i, name, вижу, почему in плохие:
            для_отчёта = None
            path = os.path.join(READY, "%02d.png" % i)
            было = path + ".было"
            if os.path.exists(path):
                shutil.copy(path, было)      # вернём, если замена хуже
            for вариант in range(2, 3 + ПОПЫТОК):
                # последний заход — со снятым запретом на повторы:
                # проверенная старая картинка лучше негодной новой
                последний = вариант == 2 + ПОПЫТОК
                print("   %2d. %-14s пробую вариант %d%s..."
                      % (i, name, вариант,
                         ", разрешив повтор" if последний else ""))
                if not refetch(i, вариант, можно_повтор=последний):
                    break
                path = os.path.join(READY, "%02d.png" % i)
                нужно = "%s (%s)" % (name, тема) if тема else name
                got, _, _ = спросить_по_кругу(очередь, i, path, нужно,
                                              вопрос)
                if got and got.get("то_что_нужно"):
                    для_отчёта = str(got.get("что_вижу", ""))[:46]
                    print("       стало: %s" % для_отчёта)
                    break
            if для_отчёта:
                исправлено.append((i, name, для_отчёта))
                if os.path.exists(было):
                    os.remove(было)
            else:
                # Ни один вариант не подошёл. Возвращаем первый: его хотя
                # бы выбирали по названию модели, а последний может быть
                # совсем случайным.
                if os.path.exists(было):
                    os.replace(было, path)
                print("       лучше не нашлось — вернул прежнюю картинку")

    # -------------------------- отчёт --------------------------
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "картинки.проверка.txt")
    lines = ["ЧТО НА КАРТОЧКАХ", "=" * 60, ""]
    for i, name, ок, вижу, почему in отчёт:
        lines.append("%2d. %-14s %s" % (i, name, "ок" if ок else "НЕ ТО"))
        lines.append("      вижу: %s" % вижу)
        if почему:
            lines.append("      %s" % почему)
    if исправлено:
        lines += ["", "ПЕРЕКАЧАНО:"]
        for i, name, вижу in исправлено:
            lines.append("   %2d. %-14s теперь %s" % (i, name, вижу))
    io.open(path, "w", encoding="utf-8", newline="\r\n").write(
        "\n".join(lines) + "\n")

    print("\nГотово. Не подошло: %d, перекачано: %d."
          % (len(плохие), len(исправлено)))
    print("   ", os.path.relpath(path, HERE))
    if плохие and not менять:
        print("Чтобы заменить неподходящие: python глаза.py --менять")


if __name__ == "__main__":
    main()
