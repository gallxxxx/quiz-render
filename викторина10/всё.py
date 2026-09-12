# -*- coding: utf-8 -*-
r"""
Весь выпуск одной командой. Останавливается один раз — показать раскадровку.

Запуск:  python всё.py
         python всё.py --без-фона      (фон не трогать, взять что лежит)
         python всё.py --без-картинок  (картинки не перекачивать)

Выпуск без карточек: поставь в «оформление.txt» строку «КАРТОЧКИ: нет».
Тогда картинки не ищутся и в кадре их не будет — останутся заголовок,
список ответов, таймер и субтитры.
         python всё.py --сам           (совсем без меня: проверяет нейросеть)

Порядок такой же, как по кнопкам, просто без нажимания:

    вход\ролик.mp4
        -> распознать русскую речь
        -> расставить знаки препинания (их Whisper почти не ставит)
        -> ТЫ смотришь русский текст: всё ли расслышано верно
        -> перевести на английский (нормальным переводчиком)
        -> ТЫ смотришь перевод: так ли сказано
        -> найти ответы, расставить таймеры по паузам диктора
        -> раскадровка (показываю, только если что-то не нашлось)
        -> озвучить (здесь собирается всё время ролика)
        -> собрать фон под эту длину
        -> найти картинки под ответы
        -> собрать готовый файл

НЕСКОЛЬКО РОЛИКОВ СРАЗУ. Положи в «вход» хоть пять штук — каждый получит
свою папку в «выпуски» и соберётся отдельно. Сначала распознаются все,
потом ты по очереди смотришь раскадровки (по блокноту на ролик), а сборку
скрипт доделывает сам — можно уйти. Один ролик в папке — всё как раньше,
файлы лежат в корне.

Фон: собирается со стока сам, думать про него не надо. Захочешь свой —
один готовый файл кладётся прямо в «фон», снятые ролики для нарезки —
в «фон\своё». Собранный с прошлого раза не годится: он другой длины.
"""
import glob, hashlib, io, os, re, subprocess, sys, time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
IN_DIR = os.path.join(HERE, "вход")
EPISODES = os.path.join(HERE, "выпуски")
ASSEMBLED = "фон собранный.mp4"
VIDEO_EXT = (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi")


def line(text=""):
    print("\n" + "=" * 62)
    if text:
        print("  " + text)
        print("=" * 62)


def run(script, *args, what="", work=None):
    """Шаг конвейера. work — папка выпуска, если роликов несколько."""
    line(what or script)
    env = dict(os.environ)
    if work:
        env["QUIZ_EPISODE"] = work
    r = subprocess.run([sys.executable, script] + list(args),
                       cwd=HERE, env=env)
    if r.returncode != 0:
        print("\n" + "!" * 62)
        print("  Споткнулись на шаге: %s" % (what or script))
        print("  Что случилось — написано выше. Остальное не делалось.")
        print("!" * 62)
        return False
    return True


def with_cards():
    """Нужны ли выпуску карточки — строка КАРТОЧКИ в «оформление.txt»."""
    path = os.path.join(HERE, "оформление.txt")
    if not os.path.exists(path):
        return True
    for raw in io.open(path, encoding="utf-8-sig"):
        line = raw.strip()
        if line.startswith("#"):
            continue
        m = re.match(r"^(?:КАРТОЧКИ|CARDS)\s*:\s*(\S+)", line, re.I)
        if m:
            return m.group(1).lower() not in ("нет", "no", "off", "0")
    return True


def check_timers():
    """Показывать ли, где встанут таймеры — строка ПРОВЕРКА ТАЙМЕРОВ.

    По умолчанию нет: сборка идёт без остановок. «да» ставят там, где
    ролик хотят посмотреть глазами до сборки — тогда посреди работы
    откроется блокнот с русским текстом и буквами «Т».
    """
    path = os.path.join(HERE, "оформление.txt")
    if not os.path.exists(path):
        return False
    for raw in io.open(path, encoding="utf-8-sig"):
        line = raw.strip()
        if line.startswith("#"):
            continue
        m = re.match(r"^(?:ПРОВЕРКА ТАЙМЕРОВ|CHECK TIMERS)\s*:\s*(\S+)",
                     line, re.I)
        if m:
            return m.group(1).lower() in ("да", "yes", "on", "1")
    return False


def videos(folder, skip=None):
    if not os.path.isdir(folder):
        return []
    return [os.path.join(folder, f) for f in os.listdir(folder)
            if f.lower().endswith(VIDEO_EXT) and f != skip]


def open_and_wait(path, what):
    """Блокнот держит нас, пока его не закроют."""
    print("\n  Открываю: %s" % os.path.basename(path))
    print("  %s" % what)
    print("  Посмотри, сохрани (Ctrl+S) и ЗАКРОЙ блокнот — я жду.")
    subprocess.run(["notepad", path])


def folder_name(i, video):
    """Имя папки выпуска. Тиктоки скачиваются под одним именем, поэтому
    впереди номер — иначе второй ролик встанет в папку первого."""
    base = os.path.splitext(os.path.basename(video))[0]
    base = re.sub(r'[<>:"/\\|?*]', "", base).strip() or "ролик"
    return "%02d %s" % (i, base[:40])


def board_of(work):
    return os.path.join(work or HERE, "раскадровка.txt")


def recognise(video, work, title):
    """Только распознавание русского — тут вопросов к человеку нет."""
    line(title)
    if work:
        os.makedirs(work, exist_ok=True)
    if not run("subs.py", video, what="Слушаю русскую речь", work=work):
        return False
    # Whisper на быстрой речи почти не ставит точек: получается
    # «Ответ Япония Страна №2 Ответ Бразилия» одной строкой. Без точек
    # рушится всё дальше — ответы, фразы, субтитры. Знаки расставляет
    # нейросеть. Не вышло — идём как раньше, ролик из-за этого не теряем.
    run("знаки.py", what="Расставляю знаки препинания", work=work)
    return True


def отпечаток(work):
    """Слепок расшифровки — по нему видно, что текст поправили руками."""
    path = out_file(work, ".слова.json")
    if not path or not os.path.exists(path):
        return ""
    return hashlib.md5(io.open(path, "rb").read()).hexdigest()


def out_file(work, ext):
    """Свежий файл нужного вида в out этого выпуска."""
    folder = os.path.join(work or HERE, "out")
    if not os.path.isdir(folder):
        return None
    files = [os.path.join(folder, f) for f in os.listdir(folder)
             if f.endswith(ext)]
    if not files:
        return None
    files.sort(key=os.path.getmtime, reverse=True)
    return files[0]


def needs_look(work):
    """Стоит ли показывать раскадровку.

    Если все десять ответов нашлись точно, смотреть там нечего: времена
    и таймеры считаны по записи. Открываем, только когда есть «???»
    или услышанное на слух — то, что вправду надо глазами проверить.
    """
    path = board_of(work)
    if not os.path.exists(path):
        return False
    text = io.open(path, encoding="utf-8-sig").read()
    return "???" in text or "проверь" in text


def check_text(video, work, сам=False):
    """Русский текст и перевод. Смотрит их либо Вика, либо нейросеть."""
    ru = out_file(work, ".русский.txt")
    if not ru:
        print("  Не нашёл русский текст — этот ролик пропускаю.")
        return False
    if not сам:
        open_and_wait(ru, "%s: проверь, всё ли расслышано верно."
                          % os.path.basename(video))

    if not run("перевод.py", what="Перевожу на английский", work=work):
        return False
    en = out_file(work, ".английский.txt")

    if сам:
        # Нейросеть читает оба текста и правит их сама: где расшифровка
        # бессмысленна, где перевод уехал. Не получилось — идём дальше
        # с машинным переводом, ролик из-за этого терять незачем.
        run("проверить.py", "--править",
            what="Нейросеть проверяет расшифровку и перевод", work=work)
    elif en:
        open_and_wait(en, "%s: проверь перевод — это озвучат и покажут"
                          " субтитрами." % os.path.basename(video))

    if not run("перевод.py", "--собрать",
               what="Забираю правки в субтитры", work=work):
        return False

    if not (run("ответы.py", what="Ищу ответы и когда их назвали", work=work)
            and run("паузы.py", what="Ставлю таймеры по паузам диктора",
                    work=work)):
        return False

    if check_timers():
        # Единственная остановка: русский текст с «Т». Там же правится
        # расслышанное — тогда ролик надо перевести и пересчитать заново,
        # иначе перевод останется от прежних слов.
        было = отпечаток(work)
        run("таймеры.py", what="Показываю, где встанут таймеры", work=work)
        if отпечаток(work) != было:
            print()
            print("  Текст поправлен — перевожу ролик заново.")
            if not (run("перевод.py", what="Перевожу заново", work=work)
                    and run("перевод.py", "--собрать",
                            what="Забираю правки в субтитры", work=work)
                    and run("ответы.py", what="Ищу ответы заново", work=work)):
                return False
            run("таймеры.py", "--применить",
                what="Возвращаю твои таймеры на место", work=work)
        run("паузы.py", what="Пересчитываю таймеры по твоим правкам",
            work=work)
    elif сам:
        print("\n  Раскадровку не открываю — работаю без тебя.")
    elif needs_look(work):
        open_and_wait(board_of(work),
                      "%s: не всё нашлось само — посмотри строки «???»"
                      " и «проверь»." % os.path.basename(video))
        run("паузы.py", what="Пересчитываю таймеры по твоим правкам",
            work=work)
    else:
        print("\n  Ответы нашлись все и точно — раскадровку не открываю.")
    return True


def assemble(work, title, skip_bg, skip_pics, сам=False):
    """Вторая половина: озвучка, фон, картинки, сборка."""
    line(title)
    bg_dir = os.path.join(work or HERE, "фон")
    if not run("озвучка.py", what="Озвучиваю и раскладываю время", work=work):
        return False

    if skip_bg:
        print("\n  Фон не трогаю — возьмётся то, что лежит в папке.")
    else:
        # своё видео Вика кладёт в общую папку «фон» — оно годится всем
        own = videos(bg_dir, skip=ASSEMBLED) or \
            (videos(os.path.join(HERE, "фон"), skip=ASSEMBLED) if work else [])
        if own:
            print("\n  В папке «фон» лежит своё видео (%s) — беру его,"
                  % os.path.basename(own[0]))
            print("  со стока ничего качать не буду.")
        elif not run("фон.py", what="Собираю фон под длину ролика", work=work):
            return False

    if not with_cards():
        print("\n  Выпуск без карточек — картинки не нужны.")
    elif skip_pics:
        print("\n  Картинки не трогаю.")
    elif not run("картинки.py", what="Ищу картинки под ответы", work=work):
        return False
    elif сам:
        # Смотрит на каждую карточку и заменяет те, где не та марка,
        # старьё, вывеска или вообще не машина.
        run("глаза.py", "--менять",
            what="Нейросеть смотрит картинки", work=work)

    return run("overlay.py", what="Собираю готовый ролик", work=work)


def ready_files(work):
    return sorted(glob.glob(os.path.join(work or HERE, "out", "ГОТОВО_*.mp4")),
                  key=os.path.getmtime, reverse=True)


def main():
    args = sys.argv[1:]
    skip_bg = "--без-фона" in args or "--no-bg" in args
    skip_pics = "--без-картинок" in args or "--no-pics" in args
    сам = "--сам" in args or "--auto" in args

    src = videos(IN_DIR)
    if not src:
        sys.exit("В папке «вход» нет ролика. Положи туда русское видео\n"
                 "и запусти снова.")
    src.sort(key=os.path.getmtime)
    started = time.time()

    # Один ролик — работаем прямо в корне, как раньше: привычные файлы
    # на привычных местах. Несколько — каждому своя папка в «выпуски».
    single = len(src) == 1
    works = [None] if single else [os.path.join(EPISODES, folder_name(i, v))
                                   for i, v in enumerate(src, 1)]

    if single and сам:
        line("СОБИРАЮ ВЫПУСК САМ: %s" % os.path.basename(src[0]))
        print("  Останавливаться не буду. Текст, перевод и картинки")
        print("  проверит нейросеть, ответы и таймеры считаются сами.")
    elif single:
        line("СОБИРАЮ ВЫПУСК: %s" % os.path.basename(src[0]))
        print("  Остановлюсь дважды: показать русский текст и перевод.")
        print("  Таймеры и ответы считаются сами, ставить ничего не надо.")
    else:
        line("СОБИРАЮ ВЫПУСКОВ: %d" % len(src))
        for i, v in enumerate(src, 1):
            print("   %d. %s" % (i, os.path.basename(v)))
        if сам:
            print("\n  Работаю без тебя: текст, перевод и картинки проверит")
            print("  нейросеть. Можно закрыть окно и заняться своим делом.")
        else:
            print("\n  Сначала распознаю все, потом по каждому покажу русский")
            print("  текст и перевод. Дальше соберу сам, можно уйти.")

    # ---- 1. распознаём все ролики ----
    live = []
    for i, (video, work) in enumerate(zip(src, works), 1):
        title = ("РАЗБИРАЮ РОЛИК" if single else
                 "РОЛИК %d ИЗ %d: %s" % (i, len(src),
                                         os.path.basename(video)))
        if recognise(video, work, title):
            live.append((video, work))
        else:
            print("  Этот ролик пропускаю, берусь за следующий.")

    if not live:
        sys.exit("Ни один ролик не разобрался. Выше написано, что случилось.")

    # ---- 2. проверка текста и перевод, по ролику за раз ----
    line(("ПРОВЕРЯЮ САМ: роликов %d" if сам
          else "ТВОЙ ХОД — роликов на проверку: %d") % len(live))
    checked = []
    for video, work in live:
        if check_text(video, work, сам):
            checked.append((video, work))
    if not checked:
        sys.exit("Ни один ролик не дошёл до сборки. Выше написано, почему.")
    live = checked

    # ---- 3. сборка ----
    done, failed = [], []
    for i, (video, work) in enumerate(live, 1):
        title = ("СОБИРАЮ" if single else
                 "СОБИРАЮ %d ИЗ %d: %s" % (i, len(live),
                                           os.path.basename(video)))
        if assemble(work, title, skip_bg, skip_pics, сам):
            done.append((video, work))
        else:
            failed.append(video)

    mins = (time.time() - started) / 60.0
    line("ГОТОВО за %.0f мин" % mins)
    for video, work in done:
        files = ready_files(work)
        print("  %s" % (files[0] if files else os.path.basename(video)))
    if failed:
        print("\n  Не собрались: %s"
              % ", ".join(os.path.basename(v) for v in failed))
    print("\n  Посмотри целиком перед заливкой.")
    print("  В подписи не пиши «напиши в комментариях» — за такое режут показы.")

    folder = os.path.join(HERE, "out") if single else EPISODES
    if os.path.isdir(folder):
        os.startfile(folder)


if __name__ == "__main__":
    main()
