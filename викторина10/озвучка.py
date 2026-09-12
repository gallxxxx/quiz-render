# -*- coding: utf-8 -*-
r"""
Английская озвучка — и она же задаёт время всему ролику.

Запуск:  python озвучка.py             (озвучить)
         python озвучка.py --примеры   (наговорить фразу разными голосами)

Раньше речь раскладывалась по секундам русского диктора, и ролик выходил
вдвое длиннее нужного: английский текст короче, а дыры между фразами
оставались русскими. Теперь наоборот — время задаёт английская речь:

  * фразы идут подряд, между ними 0.12 с и всё
  * там, где стоит метка «т» (их ставит паузы.py), вставляется ровно
    ПАУЗА секунд — таймер начинается СРАЗУ после последнего слова
  * общая длина подгоняется под «ДЛИНА» из «голос.txt»: скрипт считает,
    сколько получилось, и ускоряет речь ровно во столько, во сколько надо

Пишет:
  out\_voice.wav          дорожку голоса
  out\<имя>.en.srt        субтитры под новый отсчёт
  раскадровка.txt         времена ответов и строку ПАУЗЫ для overlay.py

Исходные субтитры лежат рядом как <имя>.исходный.srt, и каждый запуск
считает от них — можно переозвучивать сколько угодно, сдвиги не копятся.
"""
import asyncio, io, glob, math, os, re, subprocess, sys, tempfile, wave

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import папки

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = папки.work("out")
CFG = папки.here("голос.txt")               # настройки общие
BOARD = папки.work("раскадровка.txt")
CUTS = папки.here("вырезать.txt")
SAY = папки.here("произношение.txt")   # как читать имена вслух
VOICE_WAV = os.path.join(OUT_DIR, "_voice.wav")

SR = 44100
GAP = 0.07                 # пауза между соседними фразами
STYLE = папки.here("оформление.txt")
MIN_WORD = 0.10            # короче слово в кадре не показываем
PAUSE = 2.2                # длина таймера в месте метки (см. оформление.txt)
MAX_TEMPO = 1.60           # быстрее уже слышно «бубнёж»
DEFAULT_VOICE = "en-US-GuyNeural"      # напористый, «ведущий шоу»
DEFAULT_RATE = "+18%"
DEFAULT_VOLUME = "+30%"
DEFAULT_PITCH = "+12Hz"

SAMPLES = ["en-US-AndrewNeural", "en-US-BrianNeural", "en-GB-RyanNeural",
           "en-US-AvaNeural", "en-US-EmmaNeural", "en-GB-SoniaNeural"]
SAMPLE_TEXT = ("Name the brand. The first one is BMW. "
               "And this one trips everybody up.")


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def read_pause():
    """Сколько длится таймер — строка ДЛИНА ТАЙМЕРА в «оформление.txt».

    Десять таймеров по три секунды — это полминуты ролика на одно только
    ожидание. Две секунды держат интригу и укладываются в полторы минуты.
    """
    if not os.path.exists(STYLE):
        return PAUSE
    for raw in io.open(STYLE, encoding="utf-8-sig"):
        line = raw.strip()
        if line.startswith("#"):
            continue
        m = re.match(r"^(?:ДЛИНА ТАЙМЕРА|TIMER)\s*:\s*([\d.,]+)", line, re.I)
        if m:
            return max(1.0, float(m.group(1).replace(",", ".")))
    return PAUSE


def read_cfg():
    voice, rate, target = DEFAULT_VOICE, DEFAULT_RATE, None
    volume, pitch = DEFAULT_VOLUME, DEFAULT_PITCH
    if os.path.exists(CFG):
        for raw in io.open(CFG, encoding="utf-8-sig"):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            m = re.match(r"^(?:ГОЛОС|VOICE)\s*:\s*(\S+)", line, re.I)
            if m:
                voice = m.group(1)
            m = re.match(r"^(?:СКОРОСТЬ|RATE)\s*:\s*([+-]?\d+)%?", line, re.I)
            if m:
                rate = "%+d%%" % int(m.group(1))
            m = re.match(r"^(?:ГРОМКОСТЬ|VOLUME)\s*:\s*([+-]?\d+)%?", line,
                         re.I)
            if m:
                volume = "%+d%%" % int(m.group(1))
            m = re.match(r"^(?:ТОН|PITCH)\s*:\s*([+-]?\d+)", line, re.I)
            if m:
                pitch = "%+dHz" % int(m.group(1))
            m = re.match(r"^(?:ДЛИНА|LENGTH)\s*:\s*(\d+):(\d+)", line, re.I)
            if m:
                target = int(m.group(1)) * 60 + int(m.group(2))
            elif re.match(r"^(?:ДЛИНА|LENGTH)\s*:\s*(\d+)\s*$", line, re.I):
                target = int(re.match(r"^\S+\s*:\s*(\d+)", line).group(1))
    return voice, rate, target, volume, pitch


def read_cuts():
    """Куски текста, которые не должны попасть в ролик."""
    if not os.path.exists(CUTS):
        return []
    out = []
    for raw in io.open(CUTS, encoding="utf-8-sig"):
        line = raw.strip()
        if line and not line.startswith("#"):
            out.append(flat(line))
    return out


def drop_cuts(parts, cuts):
    """Убираем только те части предложения, где сидит приманка.

    Целиком фразу выбрасывать нельзя: в одном куске часто и ответ,
    и просьба поделиться — «it is called Mitsubishi and it is also
    from Japan, before we continue to follow your phone...». Поэтому
    режем по запятым и точкам и выкидываем только виноватый кусок.
    """
    out, gone = [], []
    for a, b, text, i0 in parts:
        pieces = re.split(r"(?<=[.,;!?])\s+", text)
        keep = []
        for piece in pieces:
            if any(c in flat(piece) for c in cuts):
                gone.append(piece.strip())
            else:
                keep.append(piece)
        rest = " ".join(keep).strip()
        if rest:
            out.append((a, b, rest, i0))
        elif not keep:
            gone.append("[фраза целиком]")
    return out, gone


def flat(s):
    return re.sub(r"[^a-z0-9 ]", " ", s.lower())


def read_srt(path):
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


def srt_time(sec):
    h = int(sec // 3600)
    m = int(sec % 3600 // 60)
    s = int(sec % 60)
    ms = int(round((sec - int(sec)) * 1000))
    if ms == 1000:
        s += 1
        ms = 0
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


def for_reading(start, dur, text):
    """Фразу озвучиваем целиком, а показываем ПО ОДНОМУ СЛОВУ.

    Так ролик читается быстрее и держит внимание. Точных таймингов
    у синтезатора нет, поэтому длину фразы делим между словами по их
    длине: «Volkswagen» стоит дольше, чем «is».
    """
    words = text.split()
    if not words:
        return []
    weight = [len(w) + 2 for w in words]
    total = float(sum(weight))
    out, seen = [], 0.0
    for w, k in zip(words, weight):
        a = start + dur * seen / total
        seen += k
        b = start + dur * seen / total
        out.append((a, max(b, a + MIN_WORD), w))
    return out


def write_srt(items, path):
    with io.open(path, "w", encoding="utf-8") as f:
        for i, (a, b, t) in enumerate(items, 1):
            f.write("%d\n%s --> %s\n%s\n\n" % (i, srt_time(a), srt_time(b), t))


# ---------------------------- куски текста ----------------------------

def chunks(cues, marks, merge_gap=0.35):
    """Реплики -> куски для озвучки.

    Субтитры нарезаны по 32 символа для ЧТЕНИЯ; озвучивать такими
    кусочками нельзя — речь рвётся. Склеиваем их обратно во фразы по
    паузам, а потом разрезаем там, где стоит метка «т»: перед меткой
    фраза должна закончиться, чтобы таймер начался сразу за словом.
    """
    words = []                       # (слово, начало, конец)
    for a, b, text in cues:
        ws = text.split()
        for i, w in enumerate(ws):
            words.append((w, a + (b - a) * i / len(ws),
                          a + (b - a) * (i + 1) / len(ws)))

    cut = set(marks)
    out, cur = [], None
    for i, (w, a, b) in enumerate(words):
        start_new = cur is None or i in cut or a - cur[1] > merge_gap
        if start_new:
            if cur:
                out.append(cur)
            cur = [a, b, [w], i]
        else:
            cur[1] = b
            cur[2].append(w)
    if cur:
        out.append(cur)
    return [(a, b, " ".join(ws), i0) for a, b, ws, i0 in out]


async def say(text, voice, rate, path, volume, pitch):
    """Синтезируем и ЗАОДНО забираем тайминги каждого слова.

    По умолчанию edge-tts отдаёт границы предложений; нужно попросить
    boundary="WordBoundary" — тогда на каждое слово приходит его начало
    и длительность (в сотнях наносекунд). Без этого времена слов
    приходилось угадывать по их длине, и субтитры уезжали от голоса.
    """
    import edge_tts
    c = edge_tts.Communicate(text, voice, rate=rate, volume=volume,
                             pitch=pitch, boundary="WordBoundary")
    words = []
    with open(path, "wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append((ch["offset"] / 1e7, ch["duration"] / 1e7,
                              ch["text"]))
    return words


def say_as():
    """Пары «как написано = как читать». Пустой список, если файла нет."""
    if not os.path.exists(SAY):
        return []
    pairs = []
    for raw in io.open(SAY, encoding="utf-8-sig"):
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        left, right = line.split("=", 1)
        left, right = left.strip(), right.strip()
        if left and right:
            pairs.append((left, right))
    pairs.sort(key=lambda x: len(x[0]), reverse=True)
    return pairs


def back_to_writing(word, pairs):
    """Обратно: «Hyun-day» в субтитрах снова становится «Hyundai».

    Синтезатор отдаёт те слова, что ему дали, поэтому в субтитрах
    оказывалась подсказка по произношению. Сравниваем без дефисов и
    регистра: «Hyun-day» -> «hyunday» -> нашлась пара -> пишем «Hyundai».
    """
    голый = re.sub(r"[^a-z0-9]", "", word.lower())
    if not голый:
        return word
    for пишем, читаем in pairs:
        if голый == re.sub(r"[^a-z0-9]", "", читаем.lower()):
            # хвост вроде точки или запятой оставляем на месте
            хвост = re.sub(r"^[\w-]+", "", word)
            return пишем + хвост
    return word


def for_voice(text, pairs):
    """Текст для диктора: «Hyundai» читается как «Hyun-day».

    Меняем только то, что уходит в синтезатор. В субтитрах и в раскадровке
    остаётся нормальное написание — зритель должен видеть «Hyundai».
    """
    for word, how in pairs:
        text = re.sub(r"(?<![A-Za-z])%s(?![A-Za-z])" % re.escape(word),
                      how, text, flags=re.I)
    return text


def synth(text, voice, rate, path, volume=DEFAULT_VOLUME,
          pitch=DEFAULT_PITCH):
    return asyncio.run(say(text, voice, rate, path, volume, pitch))


def to_samples(mp3, tempo=1.0):
    """mp3 -> numpy float64, 44100 моно. Ускорение через atempo."""
    import numpy as np
    wav = mp3 + ".wav"
    af, t = [], tempo
    while t > 2.0:                    # atempo умеет максимум 2х за проход
        af.append("atempo=2.0")
        t /= 2.0
    if abs(t - 1.0) > 0.005:
        af.append("atempo=%.4f" % t)
    cmd = [ffmpeg(), "-y", "-v", "error", "-i", mp3]
    if af:
        cmd += ["-filter:a", ",".join(af)]
    cmd += ["-ac", "1", "-ar", str(SR), wav]
    subprocess.run(cmd, check=True)
    with wave.open(wav, "rb") as f:
        raw = f.readframes(f.getnframes())
    os.remove(wav)
    return np.frombuffer(raw, dtype="<i2").astype("float64") / 32768.0


def punch(path):
    """Подтягиваем тихие места к громким и прижимаем пики.

    Синтезатор говорит ровно и вежливо; для тиктока нужно, чтобы
    голос лез вперёд. Компрессор делает это честнее, чем просто
    выкрученная громкость: та упёрлась бы в клиппинг.
    """
    tmp = path + ".tmp.wav"
    subprocess.run([ffmpeg(), "-y", "-v", "error", "-i", path, "-af",
                    "acompressor=threshold=-20dB:ratio=4:attack=5:"
                    "release=120:makeup=4,alimiter=limit=0.94",
                    "-ac", "1", "-ar", str(SR), tmp], check=True)
    os.replace(tmp, path)


def write_wav(path, buf):
    import numpy as np
    peak = float(np.max(np.abs(buf))) if len(buf) else 0.0
    if peak > 1.0:
        buf = buf / peak
    with wave.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes((buf * 32000).astype("<i2").tobytes())


# ---------------------------- раскадровка ----------------------------

def parse_time(s):
    m = re.match(r"^(\d+):(\d+(?:[.,]\d+)?)$", s.strip())
    if m:
        return int(m.group(1)) * 60 + float(m.group(2).replace(",", "."))
    m = re.match(r"^(\d+(?:[.,]\d+)?)$", s.strip())
    return float(m.group(1).replace(",", ".")) if m else None


def mmss(sec):
    return "%d:%04.1f" % (int(sec // 60), sec % 60)


def board_read():
    lines = io.open(BOARD, encoding="utf-8-sig").read() \
        .replace("\r\n", "\n").split("\n")
    marks = []
    for l in lines:
        m = re.match(r"^\s*(?:МЕТКИ|MARKS)\s*:\s*(.+)$", l, re.I)
        if m:
            marks = [int(x) for x in re.findall(r"\d+", m.group(1))]
    return lines, marks


def norm(w):
    return re.sub(r"[^a-z0-9]", "", w.lower())


def find_answer(new_cues, answer, from_idx):
    """Когда в новой дорожке произносится этот ответ.

    Ищем слово в тексте, а не пересчитываем старую секунду: так
    повторный запуск озвучки ничего не портит — времена всегда берутся
    из того, что реально прозвучало.

    Ответ бывает из нескольких слов («South Korea», «Mariana Trench»,
    «Red Panda»), а реплики после озвучки — по одному слову каждая.
    Поэтому идём по сплошному потоку слов и сверяем ответ по частям:
    раньше «South Korea» не находилось никогда, и такой пункт получал
    время «сразу после таймера», то есть выскакивал не в свой момент.
    """
    части = [c for c in (norm(x) for x in answer.split()) if c]
    if not части:
        return None, from_idx

    # сплошной поток слов начиная с from_idx: (слово, конец слова, номер реплики)
    поток = []
    for ci in range(from_idx, len(new_cues)):
        a, b, text = new_cues[ci]
        words = text.split()
        for wi, w in enumerate(words):
            поток.append((norm(w), a + (b - a) * (wi + 1) / len(words), ci))

    for i in range(len(поток)):
        подошло, k = True, i
        for j, часть in enumerate(части):
            # хвост ответа ищем подряд, пропускать слова между ними нельзя
            if k >= len(поток):
                подошло = False
                break
            слово = поток[k][0]
            если_совпало = (слово == часть
                            or (len(часть) > 3 and часть in слово)
                            or (len(слово) > 3 and слово in часть))
            if not если_совпало:
                подошло = False
                break
            k += 1
        if подошло:
            конец, ci = поток[k - 1][1], поток[k - 1][2]
            return конец, ci
    return None, from_idx


def board_write(lines, new_cues, pauses):
    """Пишем времена ответов (по тому, где слово прозвучало) и паузы."""
    out, ci, ai = [], 0, 0
    for line in lines:
        s = line.strip()
        if re.match(r"^\s*(ПАУЗЫ|PAUSES)\s*:", line, re.I) or \
                line.startswith("# Таймеры стоят"):
            continue
        if s.startswith("#") or "|" not in s or \
                re.match(r"^(?:ТЕМА|TITLE)\s*:", s, re.I):
            out.append(line)
            continue
        answer = s.split("|", 1)[1].split("#", 1)[0].strip()
        t, ci = find_answer(new_cues, answer, ci)
        if t is None:
            t = pauses[ai] + PAUSE if ai < len(pauses) else 0.0
            print("   «%s» в тексте не нашлось — ставлю сразу после таймера"
                  % answer)
        ai += 1
        out.append("%s | %s" % (mmss(t), answer))
    while out and not out[-1].strip():
        out.pop()
    if pauses:
        out += ["", "# Таймеры стоят здесь (секунда начала, длина %g с)."
                % PAUSE,
                "ПАУЗЫ: " + ", ".join("%.2f" % p for p in pauses)]
    io.open(BOARD, "w", encoding="utf-8",
            newline="\r\n").write("\n".join(out) + "\n")


# ------------------------------ примеры ------------------------------

def make_samples(voice_now):
    # пишем сразу в целевую папку: temp у Windows на C:, проект на D:,
    # а os.replace через диски не работает (WinError 17)
    folder = os.path.join(OUT_DIR, "голоса")
    os.makedirs(folder, exist_ok=True)
    print("Наговариваю одну фразу разными голосами...")
    for v in SAMPLES:
        try:
            synth(SAMPLE_TEXT, v, DEFAULT_RATE,
                  os.path.join(folder, v + ".mp3"))
        except Exception as e:
            print("   %s — не получилось (%s)" % (v, e))
            continue
        print("   %s%s" % (v, "   <- сейчас выбран" if v == voice_now else ""))
    print("\nПослушай файлы в out\\голоса и впиши понравившийся"
          " в «голос.txt».")


# ------------------------------- сборка -------------------------------

def main():
    voice, rate, target, volume, pitch = read_cfg()
    global PAUSE
    PAUSE = read_pause()
    if "--примеры" in sys.argv or "--samples" in sys.argv:
        make_samples(voice)
        return

    import numpy as np
    srts = sorted(glob.glob(os.path.join(OUT_DIR, "*.исходный.srt")),
                  key=os.path.getmtime, reverse=True)
    if not srts:
        srts = sorted(glob.glob(os.path.join(OUT_DIR, "*.en.srt")),
                      key=os.path.getmtime, reverse=True)
        if not srts:
            sys.exit("Нет субтитров. Сначала «1 Распознать речь».")
        name = os.path.basename(srts[0])[:-len(".en.srt")]
        orig = os.path.join(OUT_DIR, name + ".исходный.srt")
        io.open(orig, "w", encoding="utf-8").write(
            io.open(srts[0], encoding="utf-8-sig").read())
        srts = [orig]
    name = os.path.basename(srts[0])[:-len(".исходный.srt")]
    cues = read_srt(srts[0])
    lines, marks = board_read()
    parts = chunks(cues, marks)
    cuts = read_cuts()
    if cuts:
        parts, gone = drop_cuts(parts, cuts)
        if gone:
            print("Вырезано кусков: %d" % len(gone))
            for g in gone:
                print("   — %s" % (g[:66] + ("..." if len(g) > 66 else "")))

    print("Ролик:  %s" % name)
    print("Голос:  %s,  скорость %s, громкость %s, тон %s"
          % (voice, rate, volume, pitch))
    print("Фраз: %d,  пауз: %d%s"
          % (len(parts), len(marks),
             ",  цель %s" % mmss(target) if target else ""))

    tmp = tempfile.mkdtemp()
    pairs = say_as()
    if pairs:
        print("Произношение поправлено для: %s"
              % ", ".join(w for w, _ in pairs[:8]))
    mp3s, raw, spoken, готовые = [], [], [], []
    for i, (a, b, text, i0) in enumerate(parts):
        p = os.path.join(tmp, "c%03d.mp3" % i)
        spoken.append(synth(for_voice(text, pairs), voice, rate, p,
                            volume, pitch))
        mp3s.append(p)
        # распаковываем один раз и запоминаем: длина нужна сейчас, а сам
        # звук — ниже. Раньше каждый кусок распаковывался дважды, и на
        # длинном ролике это лишние полсотни запусков ffmpeg.
        готовые.append(to_samples(p))
        raw.append(len(готовые[i]) / SR)
        sys.stdout.write("\r   наговорено %d/%d" % (i + 1, len(parts)))
        sys.stdout.flush()
    print()

    speech = sum(raw)
    fixed = GAP * max(0, len(parts) - 1) + PAUSE * len(marks)
    tempo = 1.0
    if target:
        room = target - fixed
        if room <= 1:
            print("Цель %s короче, чем одни только паузы — не тяну."
                  % mmss(target))
        else:
            tempo = min(MAX_TEMPO, max(1.0, speech / room))
    print("Речи %.1f с + пауз и промежутков %.1f с = %.1f с"
          % (speech, fixed, speech + fixed))
    if tempo > 1.005:
        print("Ускоряю речь в %.2f раза -> выйдет %.1f с"
              % (tempo, speech / tempo + fixed))
    if tempo >= MAX_TEMPO - 0.005:
        # Дальше 1.6 скрипт не разгоняет, поэтому в цель он всё равно не
        # попадёт, а диктор уже тараторит. Лучше сказать это вслух.
        нужно = speech / MAX_TEMPO + fixed
        print()
        print("ВНИМАНИЕ: речь упёрлась в предел скорости — будет тараторить.")
        print("Цель %s слишком короткая: без спешки выходит %s."
              % (mmss(target), mmss(speech + fixed)))
        print("Поставь в «голос.txt» ДЛИНА: %s или убери эту строку совсем."
              % mmss(нужно + 5))

    # раскладываем подряд: фраза, промежуток, при метке — пауза
    cut = set(marks)
    total = speech / tempo + fixed + 4.0
    buf = np.zeros(int(total * SR), dtype="float64")
    new_cues, pauses = [], []
    cursor = 0.0
    for i, (a, b, text, i0) in enumerate(parts):
        if i0 in cut and i > 0:
            pauses.append(cursor)
            cursor += PAUSE
        # без ускорения распаковывать заново нечего — звук уже лежит
        block = готовые[i] if tempo <= 1.005 else to_samples(mp3s[i], tempo)
        os.remove(mp3s[i])
        j = int(cursor * SR)
        k = min(len(buf), j + len(block))
        buf[j:k] += block[:k - j]
        dur = len(block) / SR
        # ставим слова туда, где они реально прозвучали; тайминги
        # приходят от синтезатора и делятся на ускорение
        ws = spoken[i]
        if ws:
            for k, (off, wd, txt) in enumerate(ws):
                sa = cursor + off / tempo
                nxt = ws[k + 1][0] if k + 1 < len(ws) else off + wd
                sb = min(cursor + nxt / tempo, cursor + dur)
                # в кадре — нормальное написание, не подсказка диктору
                new_cues.append((sa, max(sb, sa + MIN_WORD),
                                 back_to_writing(txt, pairs)))
        else:
            new_cues.extend(for_reading(cursor, dur, text))
        cursor += dur + GAP

    write_wav(VOICE_WAV, buf[:int((cursor + 1.0) * SR)])
    punch(VOICE_WAV)
    write_srt(new_cues, os.path.join(OUT_DIR, name + ".en.srt"))

    board_write(lines, new_cues, pauses)
    print("\nГотово. Длина ролика: %s" % mmss(cursor))
    print("Написаны _voice.wav, субтитры и времена в раскадровке.")
    if pauses:
        print("Таймеры на:", ", ".join("%.1f" % p for p in pauses))
    print("Дальше — кнопка 3.")


if __name__ == "__main__":
    main()
