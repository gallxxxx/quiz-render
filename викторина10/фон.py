# -*- coding: utf-8 -*-
r"""
Собирает фон нужной длины из вертикальных видео Pexels.

Так и работает по умолчанию: ничего искать и класть не надо, клипы
качаются сами, каждый раз новые — скрипт помнит, что уже брал.

Если когда-нибудь захочется поставить своё снятое видео, для него есть
папка «фон\своё»: лежащие там ролики режутся так же, по СМЕНЕ ФОНА, и
показанные отрезки запоминаются. Пока папка пуста — качаем со стока.

Запуск:  python фон.py                  (длину берёт из готовой озвучки)
         python фон.py --сток           (не брать своё, качать со стока)
         python фон.py --длина 1:25
         python фон.py --кусок 15        (по сколько секунд каждый вид)
         python фон.py --запросы "aerial coastline, foggy forest road"

Что делает: ищет красивые вертикальные клипы — дороги, горы, побережья, —
берёт по несколько секунд из каждого (сколько именно — строка
СМЕНА ФОНА в «оформление.txt», сейчас 10), склеивает плавными переходами и кладёт
готовый файл в «фон». Скрипт помнит, что уже брал, и в следующий раз
подберёт другое.

ВАЖНО про оригинальность. Первому выпуску TikTok ограничил показы за
стоковый клип, стоявший в кадре без изменений. Здесь каждый кусок
обрезается, отражается через один, получает свою цветокоррекцию,
и всё это склеено переходами — это уже монтаж, а не чужой файл целиком.
Но самый надёжный фон — снятый самой: один ролик с прогулки закрывает
десяток выпусков.
"""
import concurrent.futures
import io, json, math, os, random, re, subprocess, sys, urllib.parse
import urllib.request, wave

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import папки

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = папки.work("out")
BG_DIR = папки.work("фон")                  # собранный фон — свой у выпуска
PIECES = папки.here("фон", "куски")         # скачанные клипы общие: не качать дважды
USED = папки.here("фон", "_уже брали.txt")
OWN = папки.here("фон", "своё")             # снятое Викой — общее на все выпуски
OWN_USED = папки.here("фон", "_уже брали своё.txt")
VIDEO_EXT = (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi")
BOARD = папки.work("раскадровка.txt")
STYLE = папки.here("оформление.txt")

W, H = 1080, 1920
PIECE = 10.0            # сколько секунд показываем один вид
FADE = 0.6              # переход между видами
TAIL = 3.0              # запас в конце
UA = "TikTokQuiz/1.0 (personal project)"
КАЧАЕМ_СРАЗУ = 5        # сколько клипов тянем одновременно

# Собранный фон — не готовый ролик, а заготовка: поверх него overlay.py
# кладёт надписи и жмёт всё заново. Поэтому здесь важно не «поменьше
# мегабайт», а «побыстрее и без потерь»: crf 18 глазу не отличить от
# исходника, а быстрый пресет экономит минуты. Раньше стояло
# «medium/crf 20», и одна эта склейка занимала пять минут из шести.
ПРЕСЕТ, CRF = "veryfast", "18"

# Спокойные залипательные виды. Порядок перемешивается при каждом запуске.
QUERIES = [
    "drone road mountains", "aerial coastline sunset", "forest road driving",
    "mountain fog aerial", "ocean waves aerial", "waterfall jungle",
    "desert road drone", "lake reflection mountains", "snow road winter",
    "palm trees road", "river canyon aerial", "green hills drone",
    "city night driving", "rain on window", "sunset field drone",
    "tropical beach aerial", "autumn forest road", "cliff ocean drone",
]


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def pexels_key():
    """Ключ ищем и рядом со скриптом, и в корне проекта — чтобы папку
    можно было унести на другой компьютер целиком."""
    for p in (os.path.join(HERE, "ключ pexels.txt"),
              os.path.join(os.path.dirname(HERE), "ключ pexels.txt")):
        if os.path.exists(p):
            for raw in io.open(p, encoding="utf-8-sig"):
                line = raw.strip()
                if line and not line.startswith("#"):
                    return line
    return None


def get_json(url, key):
    req = urllib.request.Request(url, headers={"Authorization": key,
                                               "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode("utf-8"))


def parse_len(s):
    m = re.match(r"^(\d+):(\d+(?:[.,]\d+)?)$", s.strip())
    if m:
        return int(m.group(1)) * 60 + float(m.group(2).replace(",", "."))
    return float(s.replace(",", "."))


def need_length(arg):
    """Сколько секунд фона нужно."""
    if arg:
        return parse_len(arg)
    voice = os.path.join(OUT_DIR, "_voice.wav")
    if os.path.exists(voice):
        with wave.open(voice, "rb") as f:
            return f.getnframes() / float(f.getframerate()) + TAIL
    if os.path.exists(BOARD):
        last = 0.0
        for raw in io.open(BOARD, encoding="utf-8-sig"):
            line = raw.strip()
            if line.startswith("#") or "|" not in line:
                continue
            m = re.match(r"^(\d+):(\d+(?:[.,]\d+)?)", line)
            if m:
                last = max(last, int(m.group(1)) * 60
                           + float(m.group(2).replace(",", ".")))
        if last:
            return last + TAIL
    sys.exit("Не понял, какой длины нужен фон. Озвучь ролик (кнопка 2г)"
             " или задай: python фон.py --длина 1:25")


def used_ids():
    if not os.path.exists(USED):
        return set()
    return {int(x) for x in re.findall(r"\d+",
                                       io.open(USED, encoding="utf-8").read())}


def remember(ids):
    old = used_ids() | set(ids)
    io.open(USED, "w", encoding="utf-8", newline="\n").write(
        "# Клипы, которые уже брали. Удали файл, если хочешь\n"
        "# разрешить их снова.\n" + "\n".join(str(i) for i in sorted(old))
        + "\n")


def pick_file(v):
    """Из вариантов качества берём вертикальный 1080×1920 или ближайший."""
    good = [f for f in v.get("video_files", [])
            if (f.get("height") or 0) >= 1600
            and (f.get("width") or 0) * 1.0 / max(f.get("height") or 1, 1) < 0.75]
    if not good:
        return None
    good.sort(key=lambda f: abs((f.get("height") or 0) - H))
    return good[0].get("link")


def own_clips():
    """Что Вика сняла сама. Пусто — значит собираем со стока."""
    if not os.path.isdir(OWN):
        return []
    return sorted(os.path.join(OWN, f) for f in os.listdir(OWN)
                  if f.lower().endswith(VIDEO_EXT))


def clip_length(path):
    """Длина клипа в секундах. Спрашиваем ffmpeg, отдельного ffprobe нет."""
    r = subprocess.run([ffmpeg(), "-hide_banner", "-i", path],
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace")
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr or "")
    if not m:
        return 0.0
    return (int(m.group(1)) * 3600 + int(m.group(2)) * 60
            + float(m.group(3)))


def own_taken():
    """Отрезки, которые уже были в кадре: «имя файла|секунда начала»."""
    if not os.path.exists(OWN_USED):
        return set()
    out = set()
    for line in io.open(OWN_USED, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#"):
            out.add(line)
    return out


def own_remember(marks):
    first = not os.path.exists(OWN_USED)
    with io.open(OWN_USED, "a", encoding="utf-8") as f:
        if first:
            f.write("# Отрезки своих клипов, которые уже были в кадре.\n"
                    "# Удали файл, если не жалко повторов.\n")
        for m in marks:
            f.write(m + "\n")


def own_pieces(clips, count, piece):
    """Разные отрезки из своих клипов: (файл, старт, метка).

    Идём по файлам по очереди — так соседние куски точно из разных мест.
    Отрезки, показанные в прошлых выпусках, пропускаем; если новых не
    осталось совсем, начинаем круг заново.
    """
    taken = own_taken()
    spots = []
    for path in clips:
        dur = clip_length(path)
        if dur < piece + 1.0:
            print("   %s короче куска (%.0f с) — пропускаю"
                  % (os.path.basename(path), dur))
            continue
        start = 0.5
        while start + piece <= dur - 0.3:
            spots.append((path, start,
                          "%s|%.1f" % (os.path.basename(path), start)))
            start += piece + 0.5        # соседние куски не должны совпадать
    if not spots:
        return []

    # раскладываем по файлам, чтобы вид менялся, а не тянулся один и тот же
    by_file = {}
    for sp in spots:
        by_file.setdefault(sp[0], []).append(sp)
    for lst in by_file.values():
        random.shuffle(lst)
    order, files = [], list(by_file)
    while any(by_file[f] for f in files):
        for f in files:
            if by_file[f]:
                order.append(by_file[f].pop())
    fresh = [sp for sp in order if sp[2] not in taken]
    if len(fresh) < count:
        print("   Новых отрезков %d, нужно %d — часть повторится."
              % (len(fresh), count))
        fresh += [sp for sp in order if sp[2] in taken]
    return fresh[:count]


def search(queries, count, piece, key, seen):
    found, tried = [], set()
    order = list(queries)
    random.shuffle(order)
    for q in order:
        if len(found) >= count:
            break
        for page in (1, 2):
            url = ("https://api.pexels.com/videos/search?query=%s"
                   "&orientation=portrait&size=medium&per_page=15&page=%d"
                   % (urllib.parse.quote(q), page))
            try:
                data = get_json(url, key)
            except Exception as e:
                print("   поиск «%s» не удался (%s)" % (q, e))
                break
            for v in data.get("videos", []):
                vid = v["id"]
                if vid in seen or vid in tried:
                    continue
                tried.add(vid)
                if (v.get("duration") or 0) < piece * 0.8:
                    continue          # слишком короткий, резать нечего
                link = pick_file(v)
                if not link:
                    continue
                found.append((vid, link, q, v["duration"]))
                print("   %-26s id %-9s %2d сек" % (q, vid, v["duration"]))
                break                 # по одному клипу на запрос — виды разные
            if len(found) >= count or found and found[-1][2] == q:
                break
    return found[:count]


def download(link, dst):
    # пишем во временный файл и только потом переименовываем: оборвалась
    # закачка — в «кусках» не останется обрубка, который в следующий раз
    # сойдёт за готовый клип
    tmp = dst + ".part"
    req = urllib.request.Request(link, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r, \
            open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, dst)
    return dst


def where_to_cut(index, seconds, source_len):
    """С какой секунды берём кусок, если место не выбрано заранее."""
    if source_len < seconds + 3:
        return 1.0
    return min(2.0 + index * 1.5, source_len - seconds - 0.5)


def look(index, own):
    """Как перекраивается один кусок.

    Стоковый клип через один отражаем, цвет у каждого свой: TikTok режет
    показы за чужой файл, стоящий в кадре как есть. Со своим материалом
    этого не нужно, он и так свой: только лёгкий цвет, чтобы куски не
    отличались друг от друга.
    """
    if own:
        grade = "eq=contrast=1.03:saturation=1.05"
        flip = ""
    else:
        grade = "eq=contrast=%.2f:saturation=%.2f:gamma=%.2f" % (
            1.04 + 0.03 * (index % 3), 1.08 + 0.05 * (index % 2),
            0.99 + 0.02 * (index % 2))
        flip = "hflip," if index % 2 else ""
    # fps стоит ПЕРВЫМ: половина клипов со стока снята на 60 кадрах, и
    # каждый второй кадр всё равно уйдёт в корзину — незачем гнать его
    # через масштаб и цвет. setpts до fps, иначе ffmpeg теряет частоту
    # кадров и xfade отказывается («current rate of 1/0 is invalid»).
    return ("setpts=PTS-STARTPTS,fps=30,"
            "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,"
            "%s%s,setsar=1,format=yuv420p"
            % (W, H, W, H, flip, grade))


def build(pieces, dst):
    """Нарезать, перекроить и склеить — ОДНОЙ командой ffmpeg.

    Раньше это делалось в два захода: каждый кусок сначала кодировался
    в свой файл, потом все десять распаковывались обратно и кодировались
    снова уже склейкой. Видео проходило через кодек дважды, и вторая
    ходка занимала пять минут из шести. Теперь ffmpeg держит все куски
    открытыми сам: обрезка, цвет, переходы и сжатие — за один проход.
    Заодно ушла целая ступень пережатия, картинка от этого только чище.

    pieces: (файл, с какой секунды, сколько секунд, номер, своё ли)
    """
    cmd = [ffmpeg(), "-y", "-hide_banner", "-v", "error", "-stats"]
    for src, start, seconds, _, _ in pieces:
        cmd += ["-ss", "%.2f" % start, "-t", "%.2f" % seconds, "-i", src]

    parts = ["[%d:v]%s[p%d]" % (i, look(index, own), i)
             for i, (_, _, _, index, own) in enumerate(pieces)]
    prev, acc = "p0", pieces[0][2]
    for i in range(1, len(pieces)):
        out = "x%d" % i
        parts.append("[%s][p%d]xfade=transition=fade:duration=%.2f"
                     ":offset=%.2f[%s]" % (prev, i, FADE, acc - FADE, out))
        acc += pieces[i][2] - FADE
        prev = out

    cmd += ["-filter_complex", ";".join(parts), "-map", "[%s]" % prev, "-an",
            "-c:v", "libx264", "-preset", ПРЕСЕТ, "-crf", CRF,
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst]
    subprocess.run(cmd, check=True)


def read_piece():
    """Сколько секунд держится один вид — строка СМЕНА ФОНА в оформлении.

    Меньше шести секунд не берём: фон начинает мельтешить и перетягивает
    внимание с карточек, ради которых всё и снимается.
    """
    if not os.path.exists(STYLE):
        return PIECE
    for raw in io.open(STYLE, encoding="utf-8-sig"):
        line = raw.strip()
        if line.startswith("#"):
            continue
        m = re.match(r"^(?:СМЕНА ФОНА|SWITCH)\s*:\s*([\d.]+)", line, re.I)
        if m:
            return max(6.0, float(m.group(1)))
    return PIECE


def mmss(sec):
    return "%d:%04.1f" % (int(sec // 60), sec % 60)


def finish(pieces):
    """Сборка фона — одна на оба пути, свой и стоковый."""
    lengths = [p[2] for p in pieces]
    total = sum(lengths) - FADE * (len(lengths) - 1)
    dst = os.path.join(BG_DIR, "фон собранный.mp4")
    os.makedirs(BG_DIR, exist_ok=True)
    if os.path.exists(dst):
        os.remove(dst)
    print("\nСклеиваю %d куска, выйдет %.0f сек..." % (len(pieces), total))
    build(pieces, dst)

    print("\nГОТОВО ->", dst)
    others = [f for f in os.listdir(BG_DIR)
              if f.lower().endswith((".mp4", ".mov")) and
              f != os.path.basename(dst)]
    if others:
        print("В папке «фон» лежит ещё: %s." % ", ".join(others))
        print("Возьмётся самый свежий — то есть наш. Лишнее можно убрать.")
    print("Дальше — кнопка 3.")
    return dst


def main():
    args = sys.argv[1:]

    def opt(*names):
        for n in names:
            if n in args:
                return args[args.index(n) + 1]
        return None

    piece = float(opt("--кусок", "--piece") or read_piece())
    length = need_length(opt("--длина", "--length"))
    qs = opt("--запросы", "--queries")
    queries = [q.strip() for q in qs.split(",")] if qs else QUERIES

    n = max(2, int(math.ceil((length + FADE * 3) / (piece - FADE))))
    print("Нужно фона: %.0f сек -> %d куска по %.0f сек" % (length, n, piece))
    os.makedirs(PIECES, exist_ok=True)

    # Обычный путь — сток. Но если в «фон\своё» что-то лежит, значит
    # это положили нарочно, и своё видео важнее: качать в таком случае
    # нечего, да и оригинальность у него заведомо своя.
    mine = own_clips()
    if mine and "--сток" not in args and "--stock" not in args:
        print("Беру своё видео из «фон\\своё» (%d файл(ов)):" % len(mine))
        for f in mine:
            print("   %s" % os.path.basename(f))
        spots = own_pieces(mine, n, piece)
        if not spots:
            sys.exit("Клипы в «фон\\своё» короче %.0f секунд — резать нечего.\n"
                     "Сними подлиннее или уменьши СМЕНУ ФОНА в оформлении."
                     % piece)
        if len(spots) < n:
            piece = (length + FADE * (len(spots) - 1)) / len(spots)
            print("   Отрезков %d — куски будут по %.0f сек."
                  % (len(spots), piece))
        pieces, lengths, marks = [], [], []
        for i, (src, start, mark) in enumerate(spots):
            want = piece if i < len(spots) - 1 else \
                max(4.0, length - (sum(l - FADE for l in lengths) + FADE)
                    + FADE)
            pieces.append((src, start, want, i, True))
            lengths.append(want)
            marks.append(mark)
            print("   кусок %2d: %s с %s" % (i + 1, os.path.basename(src),
                                             mmss(start)))
        finish(pieces)
        own_remember(marks)
        return

    key = pexels_key()
    if not key:
        sys.exit("Нет файла «ключ pexels.txt» — без него искать нечем.\n"
                 "Или положи своё видео в папку «фон\\своё».")

    print("Ищу виды:")
    clips = search(queries, n, piece, key, used_ids())
    if len(clips) < 2:
        sys.exit("Нашлось всего %d клипов. Попробуй другие запросы"
                 " (--запросы) или удали «фон/_уже брали.txt»." % len(clips))
    if len(clips) < n:
        print("Нашлось %d вместо %d — куски будут длиннее." % (len(clips), n))
        piece = (length + FADE * (len(clips) - 1)) / len(clips)

    # Качаем все клипы разом: файлы большие, а канал один и тот же —
    # по очереди это просто ожидание. Порядок кусков от этого не меняется,
    # он задан списком clips.
    надо = [(vid, link) for vid, link, q, dur in clips
            if not os.path.exists(os.path.join(PIECES, "%d.mp4" % vid))]
    if надо:
        print("Качаю %d клип(ов) разом..." % len(надо))
        with concurrent.futures.ThreadPoolExecutor(
                max_workers=min(КАЧАЕМ_СРАЗУ, len(надо))) as pool:
            list(pool.map(
                lambda p: download(p[1],
                                   os.path.join(PIECES, "%d.mp4" % p[0])),
                надо))

    pieces, lengths = [], []
    for i, (vid, link, q, dur) in enumerate(clips):
        raw = os.path.join(PIECES, "%d.mp4" % vid)
        # последний кусок укорачиваем, чтобы попасть в нужную длину
        done = sum(l - FADE for l in lengths) + FADE
        want = piece if i < len(clips) - 1 else \
            max(4.0, length - done + FADE)
        want = min(want, dur - 1.5)
        pieces.append((raw, where_to_cut(i, want, dur), want, i, False))
        lengths.append(want)

    finish(pieces)
    remember([c[0] for c in clips])


if __name__ == "__main__":
    main()
