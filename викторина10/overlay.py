# -*- coding: utf-8 -*-
r"""
Собирает готовый выпуск: фон + вопрос + 10 пунктов + таймер + субтитры.

Запуск:  python overlay.py            (всё по умолчанию)
         python overlay.py --голос    (оставить русскую озвучку под звуками)
         python overlay.py --фон "лес.mp4"

Что берётся:
  фон\             видео Вики. Кадрируется в 9:16, зацикливается если короче
  раскадровка.txt  заголовок и десять «время | ответ» — их делает ответы.py
  out\<имя>.en.srt английские субтитры от subs.py

Звук: русская озвучка ВЫБРАСЫВАЕТСЯ, вместо неё дорожка таймера —
тиканье внутри каждого вопроса и щелчок в момент ответа. Дорожка
считается здесь же (numpy + wave), внешних файлов не нужно.

Таймер — на КАЖДЫЙ вопрос, а не на весь ролик: полоса заполняется
от предыдущего ответа до текущего и сбрасывается. Цвет полосы — цвет
того пункта, который сейчас отгадывают.
"""
import io, math, os, re, sys, glob, wave, struct, subprocess

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import папки

HERE = os.path.dirname(os.path.abspath(__file__))
BG_DIR = папки.work("фон")
OUT_DIR = папки.work("out")
FONTS = папки.here("_fonts")                # шрифты общие
BOARD = папки.work("раскадровка.txt")
VIDEO_EXT = (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi")

W, H = 1080, 1920

# Раскладка снята с референса (скриншот 1177×2560) и пересчитана в 1080×1920
TITLE_Y = 430
TITLE_SIZE = 86       # весь текст подрос: на телефоне читается лучше
LIST_X = 110
LIST_Y = 620       # выше: крупному субтитру нужно место снизу
LIST_STEP = 80        # строки разъехались вслед за кеглем
LIST_SIZE = 66
BAR = (264, 1600, 834, 1642)
SUB_MARGIN_V = 380
SUB_SIZE = 118        # одно слово в кадре — можно и нужно крупно
SUB_MIN_SIZE = 58     # ниже уже не читается на телефоне
SUB_SIDE = 60         # поля слева и справа

FONT_TITLE = "Quiz Sans Black"
FONT_ITEM = "Quiz Sans"

# Две палитры. «Фирменная» — отсылка к цветам профиля (терракота, бирюза,
# золото, кремовый); бирюза и терракота взяты чуть светлее оригинала,
# иначе на видео тонут. «Светофор» — прямолинейная, зелёный-жёлтый-красный.
STYLES = {
    "фирменный": {
        "tiers": ((3, "#1FB5AE"),    # 1-3  бирюза
                  (6, "#E8B65F"),    # 4-6  золото
                  (9, "#C1613C"),    # 7-9  терракота
                  (10, "#7E3520")),  # 10   тёмная терракота
        "title": "#1FB5AE",
        "bar_bg": "#F7EFE4",         # кремовый
    },
    "светофор": {
        "tiers": ((3, "#2BE84F"), (6, "#FFD93B"),
                  (9, "#FF4438"), (10, "#A01A2E")),
        "title": "#2BE84F",
        "bar_bg": "#FFFFFF",
    },
}
STYLE_FILE = папки.here("оформление.txt")

# всплывающая карточка с картинкой
PICS_READY = папки.work("картинки", "готовые")
CARD_W_PX, CARD_H_PX = 440, 330   # карточка 4:3, машина не режется
CARD_X = 560                  # левый край карточки
CARD_Y = 830                  # верхний край
CARD_IN = 0.40                # сколько выплывает, сек
CARD_HOLD = 0.60              # сколько висит после ответа, сек

# Чем жмём готовый ролик. Раньше стоял пресет «medium», и одно только
# сжатие занимало две трети сборки. «veryfast» кодирует вчетверо быстрее,
# но при том же числе КАЧЕСТВО отдаёт картинку чуть слабее — поэтому
# число мы для него на единицу опускаем, и выходит то же самое.
# Замерено на живом выпуске: тот же кадр записан без потерь и с ним
# сравнивается всё остальное (КАЧЕСТВО 23, как на сборочной машине):
#   medium   crf 23 — SSIM 0.9700, 116 МБ, 65 с
#   veryfast crf 22 — SSIM 0.9685, 120 МБ, 32 с
#   veryfast crf 23 — SSIM 0.9641, 104 МБ, 32 с   (вот так уже заметно)
# Разница с «medium» в третьем знаке — глазом не видно, а времени вдвое
# меньше. Захочешь вернуть как было — ПРЕСЕТ = "medium", ПОПРАВКА = 0.
ПРЕСЕТ = "veryfast"
ПОПРАВКА = 1                  # на столько опускаем crf под быстрый пресет

SR = 44100                    # частота дорожки таймера
TICK_EVERY = 0.5              # шаг тиканья, сек
HURRY_AT = 1.6                # за сколько секунд до ответа тик становится выше
TAIL = 2.5                    # сколько секунд держим кадр после последнего ответа


def read_style():
    """Стиль и длина таймера из «оформление.txt»."""
    name, timer, sound, bg = "фирменный", None, "маримба", "обработать"
    cards = True                  # показывать ли карточки с картинками
    # timer=None — таймер тянется по речи
    if os.path.exists(STYLE_FILE):
        for raw in io.open(STYLE_FILE, encoding="utf-8-sig"):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            m = re.match(r"^(?:СТИЛЬ|STYLE)\s*:\s*(\S+)", line, re.I)
            if m and m.group(1).lower() in STYLES:
                name = m.group(1).lower()
            m = re.match(r"^(?:ТАЙМЕР|TIMER)\s*:\s*(\S+)", line, re.I)
            if m:
                v = m.group(1).replace(",", ".")
                timer = float(v) if re.match(r"^\d+(\.\d+)?$", v) else None
            m = re.match(r"^(?:ЗВУК|SOUND)\s*:\s*(\S+)", line, re.I)
            if m:
                sound = m.group(1).lower()
            m = re.match(r"^(?:ФОН|BACKGROUND)\s*:\s*(\S+)", line, re.I)
            if m:
                bg = m.group(1).lower()
            m = re.match(r"^(?:КАРТОЧКИ|CARDS)\s*:\s*(\S+)", line, re.I)
            if m:
                cards = m.group(1).lower() not in ("нет", "no", "off", "0")
    return name, STYLES[name], timer, sound, bg, cards


def качество():
    """Насколько сильно жать готовый ролик (crf ffmpeg).

    Меньше число — лучше картинка и тяжелее файл. Дома 20: место не
    жалко, а пересобрать проще, чем переснять. При сборке на стороне
    ролик потом качают на телефон по мобильному интернету, и полтораста
    мегабайт там чувствуются — туда ставится 23. Разницы на глаз в
    TikTok нет: он всё равно пережимает по-своему.
    """
    if os.path.exists(STYLE_FILE):
        for raw in io.open(STYLE_FILE, encoding="utf-8-sig"):
            m = re.match(r"^(?:КАЧЕСТВО|QUALITY)\s*:\s*(\d+)",
                         raw.strip(), re.I)
            if m:
                return max(16, min(30, int(m.group(1))))
    return 20


STYLE_NAME, STYLE, TIMER_SEC, SOUND, BG_MODE, CARDS = read_style()
TIERS = STYLE["tiers"]
TITLE_COLOR = STYLE["title"]
BAR_BG = STYLE["bar_bg"]


def tier_color(n):
    for upto, col in TIERS:
        if n <= upto:
            return col
    return TIERS[-1][1]


def ass_color(hexrgb):
    """#RRGGBB -> &HBBGGRR& (в ASS байты идут задом наперёд)"""
    h = hexrgb.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return "&H%02X%02X%02X&" % (b, g, r)


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def pick(folder, arg=None, what="видео"):
    if arg:
        p = arg if os.path.isabs(arg) else os.path.join(folder, arg)
        if not os.path.exists(p):
            sys.exit("Не нашёл файл: %s" % p)
        return p
    files = [f for f in glob.glob(os.path.join(folder, "*"))
             if f.lower().endswith(VIDEO_EXT)]
    if not files:
        sys.exit("В папке «%s» нет %s. Положи туда файл и запусти снова."
                 % (os.path.basename(folder), what))
    files.sort(key=os.path.getmtime, reverse=True)
    return files[0]


def probe(path):
    r = subprocess.run([ffmpeg(), "-hide_banner", "-i", path],
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace")
    return r.stderr or ""


def duration(info, path):
    """ffprobe в комплекте imageio-ffmpeg нет, поэтому читаем шапку ffmpeg."""
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", info)
    if not m:
        sys.exit("Не смог прочитать длину файла: %s" % path)
    h, mi, s = m.groups()
    return int(h) * 3600 + int(mi) * 60 + float(s)


# ------------------------------- данные -------------------------------

def parse_time(s):
    s = s.strip()
    m = re.match(r"^(\d+):(\d+(?:[.,]\d+)?)$", s)
    if m:
        return int(m.group(1)) * 60 + float(m.group(2).replace(",", "."))
    m = re.match(r"^(\d+(?:[.,]\d+)?)$", s)
    return float(m.group(1).replace(",", ".")) if m else None


def videos_in(folder):
    if not os.path.isdir(folder):
        return []
    return [os.path.join(folder, f) for f in os.listdir(folder)
            if f.lower().endswith(VIDEO_EXT)]


def read_board():
    if not os.path.exists(BOARD):
        sys.exit("Нет файла «раскадровка.txt».\n"
                 "Сначала кнопки 1 (распознать речь) и 2 (найти ответы).")
    title, items, holes, pauses = "", [], 0, []
    for raw in io.open(BOARD, encoding="utf-8-sig"):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            if "???" in line:
                holes += 1
            continue
        m = re.match(r"^(?:ТЕМА|TITLE)\s*:\s*(.+)$", line, re.I)
        if m:
            title = m.group(1).strip()
            continue
        m = re.match(r"^(?:ПАУЗЫ|PAUSES)\s*:\s*(.+)$", line, re.I)
        if m:
            pauses = [float(x) for x in re.findall(r"[\d.]+", m.group(1))]
            continue
        if "|" not in line:
            continue
        left, right = line.split("|", 1)
        t = parse_time(left)
        text = right.split("#", 1)[0].strip()   # пометка «проверь» — не текст
        if t is None or not text:
            continue
        items.append([t, text])
    if not items:
        sys.exit("В «раскадровка.txt» нет ни одной строки «время | ответ».")
    items.sort(key=lambda it: it[0])
    return title, items, holes, sorted(pauses)


def read_srt(path):
    if not os.path.exists(path):
        return []
    txt = io.open(path, encoding="utf-8-sig").read().replace("\r\n", "\n")
    cues = []
    for block in re.split(r"\n\s*\n", txt.strip()):
        lines = [l for l in block.split("\n") if l.strip()]
        if len(lines) < 2:
            continue
        m = re.search(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*"
                      r"(\d+):(\d+):(\d+)[,.](\d+)", block)
        if not m:
            continue
        g = [int(x) for x in m.groups()]
        a = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000.0
        b = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000.0
        body = lines[2:] if re.match(r"^\d+$", lines[0]) else lines[1:]
        body = " ".join(body).strip()
        if body:
            cues.append((a, b, body))
    return cues


# ------------------------------- звук -------------------------------

def read_wav(path):
    """Читает 16-битный моно wav в numpy. Ничего сложнее нам не нужно."""
    import numpy as np
    with wave.open(path, "rb") as f:
        if f.getsampwidth() != 2 or f.getnchannels() != 1:
            return None
        raw = f.readframes(f.getnframes())
        rate = f.getframerate()
    a = np.frombuffer(raw, dtype="<i2").astype("float64") / 32768.0
    if rate != SR:                      # на всякий: линейная растяжка
        idx = np.linspace(0, len(a) - 1, int(len(a) * SR / rate))
        a = np.interp(idx, np.arange(len(a)), a)
    return a


# Наборы звуков. Каждый умеет две вещи: удар отсчёта (k-й из n)
# и звук ответа. Что играет — задаёт строка ЗВУК в «оформление.txt».

def _env(np, t, decay, attack=0.006):
    """Затухание с короткой атакой — без атаки любой тон даёт щелчок."""
    return np.minimum(1.0, t / attack) * np.exp(-t * decay)


def pack_marimba(np):
    scale = (523.25, 587.33, 659.25, 698.46, 783.99, 880.0)

    def beat(k, n):
        t = np.arange(int(SR * 0.9)) / SR
        f = scale[min(k, len(scale) - 1)]
        w = (np.sin(2 * math.pi * f * t) + 0.35 * np.sin(4 * math.pi * f * t)
             + 0.12 * np.sin(6 * math.pi * f * t))
        return 0.22 * w * _env(np, t, 3.2)

    def reveal():
        t = np.arange(int(SR * 1.4)) / SR
        return (0.24 * np.sin(2 * math.pi * 783.99 * t) * _env(np, t, 1.8)
                + 0.16 * np.sin(2 * math.pi * 1046.5 * t) * _env(np, t, 2.0))
    return beat, reveal, 1.0


def pack_clock(np):
    """Тиканье настенных часов: спокойное «тик-так», раз в секунду.

    Было два резких щелчка в секунду на 2100 Гц с шумом — в наушниках
    это било по ушам и лезло вперёд голоса. У настоящих часов звук
    низкий и короткий: деревянный стук, а не писк. Тик и так чуть
    разной высоты, как у маятника.
    """
    def beat(k, n):
        t = np.arange(int(SR * 0.09)) / SR
        f = 1150.0 if k % 2 == 0 else 880.0        # тик выше, так ниже
        noise = np.random.RandomState(k).normal(0, 0.08, len(t))
        w = (0.55 * np.sin(2 * math.pi * f * t)
             + 0.45 * np.sin(2 * math.pi * (f / 2.4) * t)   # тело стука
             + noise)
        return 0.30 * w * _env(np, t, 42.0, 0.002)

    def reveal():
        t = np.arange(int(SR * 1.5)) / SR
        return (0.30 * np.sin(2 * math.pi * 880.0 * t) * _env(np, t, 1.7)
                + 0.16 * np.sin(2 * math.pi * 1174.7 * t) * _env(np, t, 2.0))
    return beat, reveal, 1.0


def pack_drops(np):
    """Капли: тон съезжает вниз, как булькнуло. Самый мягкий вариант."""
    def beat(k, n):
        t = np.arange(int(SR * 0.30)) / SR
        f = (620.0 + 90.0 * k) * np.exp(-t * 5.0) + 260.0
        phase = 2 * math.pi * np.cumsum(f) / SR
        return 0.26 * np.sin(phase) * _env(np, t, 9.0, 0.004)

    def reveal():
        t = np.arange(int(SR * 1.2)) / SR
        f = 1200.0 * np.exp(-t * 4.0) + 520.0
        phase = 2 * math.pi * np.cumsum(f) / SR
        return (0.26 * np.sin(phase) * _env(np, t, 3.0, 0.004)
                + 0.10 * np.sin(2 * math.pi * 1046.5 * t) * _env(np, t, 2.2))
    return beat, reveal, 1.0


def pack_pulse(np):
    """Глухой удар сердца — низко и без звона. Тревожнее остальных."""
    def beat(k, n):
        t = np.arange(int(SR * 0.55)) / SR
        f = (118.0 + 8.0 * k) * np.exp(-t * 9.0) + 62.0
        phase = 2 * math.pi * np.cumsum(f) / SR
        body = np.sin(phase) * _env(np, t, 7.5, 0.003)
        tick = 0.10 * np.sin(2 * math.pi * 880 * t) * _env(np, t, 60.0, 0.001)
        return 0.42 * body + tick

    def reveal():
        t = np.arange(int(SR * 1.5)) / SR
        return (0.24 * np.sin(2 * math.pi * 659.25 * t) * _env(np, t, 1.7)
                + 0.16 * np.sin(2 * math.pi * 987.77 * t) * _env(np, t, 2.0)
                + 0.10 * np.sin(2 * math.pi * 1318.5 * t) * _env(np, t, 2.4))
    return beat, reveal, 1.0


def pack_bell(np):
    """Колокольчик: чистый звон, как у гонга в конце раунда.

    Светлее маримбы и заметнее капель — хорошо слышно поверх фона,
    но не давит: обертоны затухают быстро, звенит только основной тон.
    """
    ступени = (659.25, 739.99, 830.61, 880.0, 987.77, 1108.73)

    def beat(k, n):
        t = np.arange(int(SR * 1.1)) / SR
        f = ступени[min(k, len(ступени) - 1)]
        w = (np.sin(2 * math.pi * f * t) * _env(np, t, 2.6)
             + 0.30 * np.sin(2 * math.pi * f * 2.76 * t) * _env(np, t, 5.5)
             + 0.14 * np.sin(2 * math.pi * f * 5.4 * t) * _env(np, t, 9.0))
        return 0.20 * w

    def reveal():
        t = np.arange(int(SR * 1.8)) / SR
        return (0.22 * np.sin(2 * math.pi * 1046.5 * t) * _env(np, t, 1.5)
                + 0.14 * np.sin(2 * math.pi * 1567.98 * t) * _env(np, t, 2.0)
                + 0.08 * np.sin(2 * math.pi * 2093.0 * t) * _env(np, t, 3.0))
    return beat, reveal, 1.0


def pack_wood(np):
    """Деревянная коробочка: сухой короткий стук без единого звона.

    Самый ненавязчивый набор. Годится, когда в кадре и так много
    всего, а отсчёт нужен только чтобы держать ритм.
    """
    def beat(k, n):
        t = np.arange(int(SR * 0.12)) / SR
        f = 420.0 + 30.0 * k
        шум = np.random.RandomState(100 + k).normal(0, 0.12, len(t))
        w = (np.sin(2 * math.pi * f * t)
             + 0.5 * np.sin(2 * math.pi * f * 1.6 * t) + шум)
        return 0.30 * w * _env(np, t, 30.0, 0.002)

    def reveal():
        t = np.arange(int(SR * 0.9)) / SR
        f = 700.0 + 260.0 * np.minimum(1.0, t * 6)
        phase = 2 * math.pi * np.cumsum(f) / SR
        return 0.26 * np.sin(phase) * _env(np, t, 4.0, 0.003)
    return beat, reveal, 1.0


def pack_water(np):
    """Вода: мягкий всплеск с шелестом. Спокойнее всех, почти фон."""
    def beat(k, n):
        t = np.arange(int(SR * 0.35)) / SR
        f = (480.0 + 70.0 * k) * np.exp(-t * 7.0) + 210.0
        phase = 2 * math.pi * np.cumsum(f) / SR
        шелест = np.random.RandomState(7 + k).normal(0, 1, len(t))
        шелест = np.convolve(шелест, np.ones(40) / 40, mode="same")
        return (0.22 * np.sin(phase) * _env(np, t, 8.0, 0.006)
                + 0.07 * шелест * _env(np, t, 16.0, 0.004))

    def reveal():
        t = np.arange(int(SR * 1.4)) / SR
        f = 900.0 * np.exp(-t * 3.0) + 440.0
        phase = 2 * math.pi * np.cumsum(f) / SR
        return (0.24 * np.sin(phase) * _env(np, t, 2.4, 0.006)
                + 0.10 * np.sin(2 * math.pi * 880.0 * t) * _env(np, t, 2.0))
    return beat, reveal, 1.0


def pack_arcade(np):
    """Аркада: бодрый восьмибитный писк. Для быстрых весёлых выпусков."""
    def beat(k, n):
        t = np.arange(int(SR * 0.13)) / SR
        f = 520.0 + 80.0 * k
        квадрат = np.sign(np.sin(2 * math.pi * f * t))
        return 0.15 * квадрат * _env(np, t, 26.0, 0.002)

    def reveal():
        t = np.arange(int(SR * 0.55)) / SR
        # короткая восходящая трель — «получилось!»
        f = 520.0 * (2.0 ** (np.floor(t * 12) / 6.0))
        phase = 2 * math.pi * np.cumsum(f) / SR
        return 0.16 * np.sign(np.sin(phase)) * _env(np, t, 4.0, 0.002)
    return beat, reveal, 1.0


def pack_none(np):
    """Совсем без звука отсчёта — только голос диктора."""
    def beat(k, n):
        return np.zeros(int(SR * 0.05))

    def reveal():
        return np.zeros(int(SR * 0.05))
    return beat, reveal, 1.0


PACKS = {"маримба": pack_marimba, "часы": pack_clock,
         "капли": pack_drops, "пульс": pack_pulse,
         "колокольчик": pack_bell, "дерево": pack_wood,
         "вода": pack_water, "аркада": pack_arcade,
         "тишина": pack_none}


def make_timer_track(path, rounds, dur, voice_path=None, pack="маримба"):
    """Отсчёт внутри каждой паузы и звук в момент ответа.

    Если рядом лежит наговоренный _voice.wav — подмешиваем его,
    а отсчёт приглушаем, чтобы не спорил с голосом.
    """
    import numpy as np
    n = int((dur + 1.0) * SR)
    buf = np.zeros(n, dtype=np.float64)
    voice = read_wav(voice_path) if voice_path and         os.path.exists(voice_path) else None
    # таймер должен быть слышен на фоне голоса, а голос теперь
    # прогнан через компрессор и заметно громче прежнего
    gain = 0.90 if voice is not None else 1.0
    beat, reveal, per_sec = PACKS.get(pack, pack_marimba)(np)

    def put(t, w):
        i = int(t * SR)
        if i >= n or i < 0:
            return
        j = min(n, i + len(w))
        buf[i:j] += w[:j - i]

    ticks = 0
    for a, b in rounds:
        length = b - a
        count = max(1, int(round(length * per_sec)))
        for k in range(count):
            t = a + k * length / count
            if t >= b - 0.04:
                break
            put(t, beat(k, count) * gain)
            ticks += 1
        put(b, reveal() * gain)

    if voice is not None:
        k = min(n, len(voice))
        buf[:k] += voice[:k]

    peak = float(np.max(np.abs(buf))) if len(buf) else 0.0
    if peak > 1.0:
        buf /= peak
    pcm = (buf[:int(dur * SR)] * 32000).astype("<i2").tobytes()
    with wave.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm)
    return ticks


# --------------------------------- ass ---------------------------------

def ts(sec):
    sec = max(0.0, sec)
    return "%d:%02d:%05.2f" % (int(sec // 3600), int(sec % 3600 // 60), sec % 60)


def esc(t):
    return t.replace("\\", "").replace("{", "(").replace("}", ")")


def pill(x0, y0, x1, y1):
    """Скруглённая полоса рисованием .ass: прямые + четыре безье по углам."""
    r = (y1 - y0) / 2.0
    k = r * 0.5523
    return (
        "m %.0f %.0f l %.0f %.0f "
        "b %.0f %.0f %.0f %.0f %.0f %.0f "
        "b %.0f %.0f %.0f %.0f %.0f %.0f "
        "l %.0f %.0f "
        "b %.0f %.0f %.0f %.0f %.0f %.0f "
        "b %.0f %.0f %.0f %.0f %.0f %.0f"
        % (x0 + r, y0, x1 - r, y0,
           x1 - r + k, y0, x1, y0 + r - k, x1, y0 + r,
           x1, y0 + r + k, x1 - r + k, y1, x1 - r, y1,
           x0 + r, y1,
           x0 + r - k, y1, x0, y0 + r + k, x0, y0 + r,
           x0, y0 + r - k, x0 + r - k, y0, x0 + r, y0))


def header():
    return """[Script Info]
ScriptType: v4.00+
PlayResX: %d
PlayResY: %d
WrapStyle: 2      # переносы только там, где мы их поставим сами
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,%s,%d,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,7,3,8,60,60,60,1
Style: Item,%s,%d,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,6,3,7,0,0,0,1
Style: Sub,%s,%d,&H00FFFFFF,&H00FFFFFF,&H00000000,&H8C000000,-1,0,0,0,100,100,0,0,1,8,4,2,60,60,%d,1
Style: Bar,%s,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""" % (W, H, FONT_TITLE, TITLE_SIZE, FONT_ITEM, LIST_SIZE, FONT_TITLE,
       SUB_SIZE, SUB_MARGIN_V, FONT_ITEM)


def dlg(a, b, style, text, layer=0):
    return "Dialogue: %d,%s,%s,%s,,0,0,0,,%s\n" % (layer, ts(a), ts(b),
                                                   style, text)


def fit_size(text):
    """Размер шрифта, при котором строка влезает по ширине кадра.

    «VOLKSWAGEN» при 104 не помещался в 960 точек и уезжал на вторую
    строку — слово прыгало вверх, а следующее возвращалось вниз. Считаем
    по средней ширине заглавной буквы: точность не нужна, нужен запас.
    Для одного слова меряем его целиком, для фразы — самое длинное слово,
    остальное разложит перенос.
    """
    parts = text.split()
    n = max(1, max((len(w) for w in parts), default=1))
    size = int(min(SUB_SIZE, (W - 2 * SUB_SIDE) / (0.66 * n)))
    return max(SUB_MIN_SIZE, size)


def save_script(name, title, points, cues):
    """Кладём рядом с роликом текст, который в нём звучит.

    Нужен для подписи к посту, для повторной озвучки и просто чтобы
    видеть, что ушло в кадр. Берём проверенный английский текст, а если
    его нет — собираем из субтитров.
    """
    строки = []
    англ = os.path.join(OUT_DIR, name + ".английский.txt")
    if os.path.exists(англ):
        for raw in io.open(англ, encoding="utf-8-sig"):
            line = raw.strip()
            if line and not line.startswith("#") and "|" in line:
                строки.append(line.split("|", 1)[1].strip())
    if not строки:
        # субтитры идут по одному слову — склеиваем обратно во фразы
        куски = []
        for a, b, t in cues:
            куски.append(t)
        текст = " ".join(куски)
        строки = [x.strip() for x in re.split(r"(?<=[.!?])\s+", текст)
                  if x.strip()]

    out = ["ТЕКСТ РОЛИКА — то, что читает диктор", "=" * 46, ""]
    if title:
        out += ["Заголовок в кадре: %s" % title, ""]
    if points:
        out.append("Ответы по порядку:")
        for i, (t, ответ) in enumerate(points, 1):
            out.append("  %2d. %-22s %d:%04.1f" % (i, ответ, t // 60, t % 60))
        out.append("")
    out += ["-" * 46, ""] + строки + [""]
    path = os.path.join(OUT_DIR, "ГОТОВО_%s.текст.txt" % name)
    io.open(path, "w", encoding="utf-8", newline="\r\n").write(
        "\n".join(out) + "\n")
    return path


def build_ass(title, points, rounds, cues, dur):
    out = [header()]

    if title:
        out.append(dlg(0, dur, "Title",
                       "{\\pos(%d,%d)\\1c%s}%s"
                       % (W // 2, TITLE_Y, ass_color(TITLE_COLOR), esc(title)),
                       1))

    for i, (t, text) in enumerate(points):
        num, y = i + 1, LIST_Y + i * LIST_STEP
        col = ass_color(tier_color(num))
        # номер стоит в кадре с самого начала, ответ приезжает в свой момент
        out.append(dlg(0, t, "Item",
                       "{\\pos(%d,%d)\\1c%s}%d." % (LIST_X, y, col, num), 1))
        out.append(dlg(t, dur, "Item",
                       "{\\pos(%d,%d)\\1c%s\\fad(160,0)}%d. %s"
                       % (LIST_X, y, col, num, esc(text)), 1))

    x0, y0, x1, y1 = BAR
    path = pill(x0, y0, x1, y1)
    out.append(dlg(0, dur, "Bar",
                   "{\\an7\\pos(0,0)\\1c%s\\1a&H50&\\bord0\\shad0\\p1}"
                   "%s{\\p0}" % (ass_color(BAR_BG), path), 1))
    # свой таймер на каждый вопрос: полоса бежит от прошлого ответа к текущему
    for i, (a, b) in enumerate(rounds):
        if b - a < 0.15:
            continue
        out.append(dlg(a, b, "Bar",
                       "{\\an7\\pos(0,0)\\1c%s\\1a&H00&\\bord0\\shad0"
                       "\\clip(%d,%d,%d,%d)\\t(0,%d,\\clip(%d,%d,%d,%d))\\p1}"
                       "%s{\\p0}"
                       % (ass_color(tier_color(i + 1)), x0, y0, x0, y1,
                          int((b - a) * 1000), x0, y0, x1, y1, path), 2))

    # после последнего ответа полоса остаётся полной, а не гаснет
    last = points[-1][0]
    if dur - last > 0.2:
        out.append(dlg(last, dur, "Bar",
                       "{\\an7\\pos(0,0)\\1c%s\\1a&H00&\\bord0\\shad0\\p1}"
                       "%s{\\p0}" % (ass_color(tier_color(len(points))), path),
                       2))

    # Слово выскакивает чуть увеличенным и за 70 мс садится в размер —
    # от этого лента слов читается как удары, а не как бегущая строка.
    # Держим его строго на одном месте: \an5 и точка привязки, иначе
    # длинное слово переносится на вторую строку и текст скачет вверх.
    for a, b, t in cues:
        if a >= dur:
            break
        word = esc(t.upper())
        wrap = 2 if len(word.split()) == 1 else 0
        out.append(dlg(a, min(b, dur), "Sub",
                       r"{\an5\pos(%d,%d)\q%d\fs%d"
                       r"\fscx116\fscy116\t(0,70,\fscx100\fscy100)}%s"
                       % (W // 2, H - SUB_MARGIN_V, wrap,
                          fit_size(word), word), 3))
    return "".join(out)


# -------------------------------- сборка --------------------------------

def preview_sounds():
    """Каждый набор — трёхсекундный отсчёт и ответ, чтобы выбрать на слух."""
    folder = os.path.join(OUT_DIR, "звуки")
    os.makedirs(folder, exist_ok=True)
    for name in PACKS:
        f = os.path.join(folder, name + ".wav")
        make_timer_track(f, [(0.4, 3.4), (4.4, 7.4)], 8.5, None, name)
        print("   ", name)
    print("Файлы в out\\звуки. Понравившийся впиши"
          " в «оформление.txt» строкой ЗВУК.")


def main():
    args = list(sys.argv[1:])
    if "--звуки" in args or "--sounds" in args:
        print("Делаю образцы звуков...")
        preview_sounds()
        return
    keep_voice, bg_arg = False, None
    for flag in ("--голос", "--voice"):
        if flag in args:
            keep_voice = True
            args.remove(flag)
    for flag in ("--фон", "--bg"):
        if flag in args:
            i = args.index(flag)
            bg_arg = args[i + 1]
            del args[i:i + 2]

    title, points, holes, pauses = read_board()
    if holes:
        print("В раскадровке %d незаполненных пунктов «???» — они пропущены."
              % holes)
    bg_dir = BG_DIR
    if not bg_arg and not videos_in(BG_DIR) and videos_in(папки.here("фон")):
        bg_dir = папки.here("фон")      # своё видео лежит в общей папке
    bg = pick(bg_dir, bg_arg, "фонового видео")

    # длина выпуска = последний ответ + хвост, либо длина исходника, если он есть
    src = None
    note = папки.work("исходник.txt")
    if os.path.exists(note):
        p = io.open(note, encoding="utf-8").read().strip()
        if os.path.exists(p):
            src = p
    if src is None:
        vids = videos_in(os.path.join(HERE, "вход"))
        if vids:
            vids.sort(key=os.path.getmtime, reverse=True)
            src = vids[0]
    # Длина выпуска = длина НАШЕЙ озвучки, а не русского исходника.
    # Раньше брали исходник, и если английская речь выходила длиннее,
    # конец срезался — последнее слово («Subaru») пропадало.
    dur = 0.0
    voice = os.path.join(OUT_DIR, "_voice.wav")
    if os.path.exists(voice):
        with wave.open(voice, "rb") as f:
            dur = f.getnframes() / float(f.getframerate())
    if not dur and src:
        dur = duration(probe(src), src)
    # хвост после последнего ответа: десятую марку часто называют на
    # самой последней секунде, и без запаса она мелькает и пропадает
    dur = max(dur + TAIL, points[-1][0] + TAIL)
    name = os.path.splitext(os.path.basename(src or bg))[0]

    cues = read_srt(os.path.join(OUT_DIR, name + ".en.srt"))
    if not cues:
        # Имя выпуска берётся из ИСХОДНИКА, а на сборочной машине его
        # уже нет: следующему шагу отдают только папку выпуска, ролик в
        # неё не кладут. Тогда «name» становится «фон собранный», и
        # субтитры, лежащие рядом под своим именем, не находятся —
        # в живом выпуске Александра так и вышло, «реплик: 0».
        # Ищем единственный «...en.srt» в папке: перепутать не с чем,
        # у каждого выпуска своя папка.
        свои = sorted(
            (f for f in os.listdir(OUT_DIR) if f.endswith(".en.srt"))
            if os.path.isdir(OUT_DIR) else [],
            key=lambda f: os.path.getmtime(os.path.join(OUT_DIR, f)),
            reverse=True)
        if свои:
            cues = read_srt(os.path.join(OUT_DIR, свои[0]))
            if cues:
                print("Субтитры нашлись рядом: %s" % свои[0])
    if not cues:
        print("Субтитров нет — соберу без них.")

    # Окна карточек: картинка висит от прошлого ответа до текущего —
    # это и есть «вопрос», её нельзя привязывать к таймеру
    spans, prev = [], 0.0
    for t, _ in points:
        spans.append((prev, t))
        prev = t

    # Окна таймера. Если паузы.py вставил дыры под буквы «т» — таймер
    # стоит ровно в них. Иначе либо фиксированные N секунд перед ответом,
    # либо весь промежуток между ответами.
    length = TIMER_SEC or 3.0
    if pauses:
        rounds = [(p, min(p + length, dur)) for p in pauses]
    else:
        rounds = []
        prev = 0.0
        for t, _ in points:
            a = prev if TIMER_SEC is None else max(prev, t - TIMER_SEC)
            rounds.append((a, min(t, dur)))
            prev = t

    print("Фон:       %s" % os.path.basename(bg))
    print("Заголовок: %s" % (title or "— нет, впиши «ТЕМА:» в раскадровку"))
    print("Пунктов: %d,  реплик: %d,  длина: %.1f сек"
          % (len(points), len(cues), dur))
    print("Стиль: %s,  таймер: %s"
          % (STYLE_NAME,
             "%g сек в паузах (%d шт.)" % (TIMER_SEC or 3.0, len(pauses))
             if pauses else ("по речи" if TIMER_SEC is None
                             else "%g сек на вопрос" % TIMER_SEC)))
    if keep_voice:
        print("Русская озвучка: остаётся под звуками")

    os.makedirs(OUT_DIR, exist_ok=True)
    io.open(os.path.join(OUT_DIR, "_overlay.ass"), "w",
            encoding="utf-8", newline="\n").write(
        build_ass(title, points, rounds, cues, dur))
    timer = os.path.join(OUT_DIR, "_timer.wav")
    voice_wav = os.path.join(OUT_DIR, "_voice.wav")
    has_voice = os.path.exists(voice_wav)
    ticks = make_timer_track(timer, rounds, dur,
                             voice_wav if has_voice else None, SOUND)
    print("Звук «%s»: %d ударов + %d ответов%s"
          % (SOUND, ticks, len(rounds),
             " + английская озвучка" if has_voice
             else " (озвучки нет — кнопка 2г)"))

    # карточки с картинками: выплывают справа к началу своего вопроса
    # и висят, пока ответ не назван
    # Карточка выезжает ВМЕСТЕ с таймером: три секунды на то, чтобы
    # угадать. Раньше она висела весь вопрос и подсказывала заранее.
    cards = []
    for i, (a, _) in enumerate(spans if CARDS else []):
        p = os.path.join(PICS_READY, "%02d.png" % (i + 1))
        if not os.path.exists(p):
            continue
        start = pauses[i] if i < len(pauses) else a
        cards.append((p, start, min(points[i][0] + CARD_HOLD, dur)))
    if not CARDS:
        # «КАРТОЧКИ: нет» в оформлении — выпуск без картинок вовсе:
        # в кадре остаются заголовок, список ответов, таймер и субтитры
        print("Карточки выключены — собираю без картинок.")
    elif cards:
        print("Картинок: %d из %d" % (len(cards), len(points)))
    else:
        print("Картинок нет — запусти «2д Найти картинки».")

    dst = os.path.join(OUT_DIR, "ГОТОВО_%s.mp4" % name)
    cmd = [ffmpeg(), "-y", "-hide_banner", "-v", "error", "-stats",
           "-stream_loop", "-1", "-i", bg, "-i", timer]
    n_audio_inputs = 2
    if keep_voice and src:
        cmd += ["-i", src]
        n_audio_inputs = 3
    for p, _, _ in cards:
        cmd += ["-i", p]

    # Стоковый клип, вставленный кадр в кадр, TikTok считает
    # «импортированным без творческой обработки» — за это и прилетело
    # ограничение показов. Поэтому фон не берём как есть: отражаем,
    # подтягиваем цвет и медленно ведём камеру внутри кадра.
    if BG_MODE.startswith("обработ") or BG_MODE.startswith("edit"):
        bgf = ("[0:v]scale=%d:%d:force_original_aspect_ratio=increase,"
               "crop=%d:%d:x='(iw-ow)/2+(iw-ow)/2*sin(t/13)'"
               ":y='(ih-oh)/2+(ih-oh)/2*sin(t/19)',"
               "hflip,eq=contrast=1.07:saturation=1.14:gamma=1.02,"
               "setsar=1,fps=30[bg]"
               % (int(W * 1.14), int(H * 1.14), W, H))
    else:
        bgf = ("[0:v]scale=%d:%d:force_original_aspect_ratio=increase,"
               "crop=%d:%d,setsar=1,fps=30[bg]" % (W, H, W, H))
    parts = [bgf]
    last = "bg"
    for k, (p, t0, t1) in enumerate(cards):
        idx = n_audio_inputs + k
        parts.append("[%d:v]scale=%d:%d[c%d]"
                     % (idx, CARD_W_PX, CARD_H_PX, k))
        # первые CARD_IN секунд едет от правого края к своему месту,
        # дальше стоит. pow(...,0.5) — чтобы притормаживала в конце
        x = ("if(lt(t-%.2f,%.2f), %d-(%d-%d)*pow((t-%.2f)/%.2f,0.5), %d)"
             % (t0, CARD_IN, W, W, CARD_X, t0, CARD_IN, CARD_X))
        parts.append("[%s][c%d]overlay=x='%s':y=%d:enable='between(t,%.2f,"
                     "%.2f)'[o%d]" % (last, k, x, CARD_Y, t0, t1, k))
        last = "o%d" % k
    parts.append("[%s]ass=_overlay.ass:fontsdir=../_fonts[v]" % last)
    vf = ";".join(parts)

    if keep_voice and src:
        vf += ";[1:a][2:a]amix=inputs=2:duration=first:weights=1 0.7[a]"
        amap = ["-map", "[a]"]
    else:
        amap = ["-map", "1:a"]
    cmd += ["-filter_complex", vf, "-map", "[v]"] + amap
    cmd += ["-c:a", "aac", "-b:a", "192k",
            "-t", "%.3f" % dur, "-c:v", "libx264", "-preset", ПРЕСЕТ,
            "-crf", str(max(14, качество() - ПОПРАВКА)), "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", dst]

    print("\nСобираю...")
    # ffmpeg запускаем из out: относительный путь к .ass избавляет от
    # экранирования «C:\» внутри filtergraph — на Windows это вечные грабли
    subprocess.run(cmd, cwd=OUT_DIR, check=True)
    текст = save_script(name, title, points, cues)
    print("\nГОТОВО ->", dst)
    print("Текст  ->", os.path.basename(текст))


if __name__ == "__main__":
    main()
