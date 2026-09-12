# -*- coding: utf-8 -*-
"""
Распознаёт русскую речь ролика: фразы с временами и каждое слово отдельно.

Запуск:  python subs.py                  (берёт свежий файл из папки «вход»)
         python subs.py "мой ролик.mp4"
         python subs.py --model medium    (точнее, но втрое дольше)

Пишет:
  <имя>.русский.txt   фразы с временами — ЭТО ТЕКСТ ДЛЯ ПРОВЕРКИ.
                      Правится руками: именно он потом переводится.
  <имя>.слова.json    каждое слово со своей секундой — по ним ищутся
                      ответы и паузы, которые диктор сделал сам.

Переводом занимается отдельный шаг (перевод.py): Whisper переводит на
ходу и врёт на именах собственных — «Ауди» у него превратилась в «Saudi
Arabia», — а нормальный переводчик получает уже проверенный текст.

Фразы режутся по паузам в речи и по знакам препинания: так строка в
файле совпадает с тем, как диктор говорит, и переводить её можно целиком.
"""
import io, json, os, sys, glob, subprocess

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import папки

HERE = os.path.dirname(os.path.abspath(__file__))
IN_DIR = os.path.join(HERE, "вход")
OUT_DIR = папки.work("out")
VIDEO_EXT = (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi")

# длина строки субтитра: короткие куски читаются в вертикальном видео,
# длинные — нет. Режем по словам, а не по фразам Whisper (те бывают по 20 сек).
MAX_CHARS = 32
MAX_SEC = 2.6
GAP = 0.55


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def pick_video(arg=None):
    if arg:
        p = arg if os.path.isabs(arg) else os.path.join(IN_DIR, arg)
        if not os.path.exists(p):
            sys.exit("Не нашёл файл: %s" % p)
        return p
    files = [f for f in glob.glob(os.path.join(IN_DIR, "*"))
             if f.lower().endswith(VIDEO_EXT)]
    if not files:
        sys.exit("В папке «вход» нет видео. Положи туда ролик и запусти снова.")
    files.sort(key=os.path.getmtime, reverse=True)
    if len(files) > 1:
        print("В папке несколько роликов, беру самый свежий:")
        for f in files:
            print("   %s %s" % ("->" if f == files[0] else "  ",
                                os.path.basename(f)))
    return files[0]


def to_wav(src, dst):
    """Whisper хочет 16 кГц моно. Заодно отсекаем видеодорожку."""
    subprocess.run([ffmpeg(), "-y", "-v", "error", "-i", src,
                    "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", dst],
                   check=True)
    return dst


def ts(sec):
    h = int(sec // 3600)
    m = int(sec % 3600 // 60)
    s = int(sec % 60)
    ms = int(round((sec - int(sec)) * 1000))
    if ms == 1000:
        s += 1
        ms = 0
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


PHRASE_GAP = 0.35        # пауза, по которой рвём фразу
PHRASE_MAX = 160         # предохранитель на случай речи совсем без пауз


def phrases(words):
    """Слова -> фразы: режем по паузам и по концу предложения.

    Строка такой длины читается целиком, переводится целиком и остаётся
    на одной строке в блокноте — Вике её проверять.
    """
    out, cur = [], None
    for i, w in enumerate(words):
        txt = w["w"].strip()
        if not txt:
            continue
        if cur is None:
            cur = [w["a"], w["b"], [txt]]
            continue
        gap = w["a"] - cur[1]
        ended = cur[2][-1].endswith((".", "!", "?", "…"))
        # по длине рвём только когда речь идёт совсем без знаков и пауз,
        # иначе от фразы отваливается хвост вроде «этим.» отдельной строкой
        too_long = len(" ".join(cur[2])) > PHRASE_MAX
        if gap > PHRASE_GAP or ended or too_long:
            out.append((cur[0], cur[1], " ".join(cur[2])))
            cur = [w["a"], w["b"], [txt]]
        else:
            cur[1] = w["b"]
            cur[2].append(txt)
    if cur:
        out.append((cur[0], cur[1], " ".join(cur[2])))
    return out


def write_phrases(items, path):
    lines = ["# РУССКИЙ ТЕКСТ РОЛИКА — проверь, всё ли расслышано верно.",
             "#",
             "# Правь смело: именно этот текст переводится и озвучивается.",
             "# Время в начале строки не трогай — по нему всё расставляется.",
             "# Строку целиком можно удалить, если её не надо в ролике.",
             ""]
    for a, b, t in items:
        lines.append("%d:%04.1f | %s" % (int(a // 60), a % 60, t))
    io.open(path, "w", encoding="utf-8", newline="\r\n").write(
        "\n".join(lines) + "\n")
    print("   ", os.path.basename(path), " фраз: %d" % len(items))


def regroup(segments):
    """Слова -> короткие реплики по MAX_CHARS / MAX_SEC / паузе."""
    cues, cur = [], None
    for seg in segments:
        words = seg.words or []
        if not words:
            if cur:
                cues.append(tuple(cur))
                cur = None
            cues.append((seg.start, seg.end, seg.text.strip()))
            continue
        for w in words:
            txt = w.word.strip()
            if not txt:
                continue
            if cur is None:
                cur = [w.start, w.end, txt]
                continue
            too_long = len(cur[2]) + 1 + len(txt) > MAX_CHARS
            too_slow = w.end - cur[0] > MAX_SEC
            pause = w.start - cur[1] > GAP
            if too_long or too_slow or pause:
                cues.append(tuple(cur))
                cur = [w.start, w.end, txt]
            else:
                cur[1] = w.end
                cur[2] += " " + txt
    if cur:
        cues.append(tuple(cur))
    return [c for c in cues if c[2]]


def flat_words(segments):
    out = []
    for seg in segments:
        for w in (seg.words or []):
            t = w.word.strip()
            if t:
                out.append({"w": t, "a": round(w.start, 3),
                            "b": round(w.end, 3)})
    return out


def write_srt(cues, path):
    with io.open(path, "w", encoding="utf-8") as f:
        for i, (a, b, t) in enumerate(cues, 1):
            f.write("%d\n%s --> %s\n%s\n\n" % (i, ts(a), ts(b), t))
    print("   ", os.path.relpath(path, HERE))


def write_txt(text, path):
    io.open(path, "w", encoding="utf-8").write(text)
    print("   ", os.path.relpath(path, HERE))


def run(model, wav, task):
    segs, _ = model.transcribe(
        wav, task=task, language="ru", word_timestamps=True,
        vad_filter=True, vad_parameters={"min_silence_duration_ms": 400},
        beam_size=5, condition_on_previous_text=False)
    return list(segs)


def main():
    args = list(sys.argv[1:])
    size = "small"
    if "--model" in args:
        i = args.index("--model")
        size = args[i + 1]
        del args[i:i + 2]
    src = pick_video(args[0] if args else None)
    name = os.path.splitext(os.path.basename(src))[0]

    os.makedirs(OUT_DIR, exist_ok=True)
    io.open(папки.work("исходник.txt"), "w",
            encoding="utf-8").write(os.path.abspath(src))
    wav = os.path.join(OUT_DIR, "_audio.wav")
    print("Ролик:", os.path.basename(src))
    print("Достаю звук...")
    to_wav(src, wav)

    from faster_whisper import WhisperModel
    print("Гружу модель «%s» (первый раз качается ~0.5 ГБ, потом из кэша)..."
          % size)
    model = WhisperModel(size, device="cpu", compute_type="int8")

    print("Слушаю по-русски (слова и времена)...")
    ru = run(model, wav, "transcribe")
    words = flat_words(ru)
    if not words:
        os.remove(wav)
        sys.exit("Whisper ничего не услышал. Проверь, есть ли в ролике звук.")
    io.open(os.path.join(OUT_DIR, name + ".слова.json"), "w",
            encoding="utf-8").write(
        json.dumps(words, ensure_ascii=False, indent=1))
    print("   ", name + ".слова.json  (слов: %d)" % len(words))
    write_txt(" ".join(w["w"] for w in words),
              os.path.join(OUT_DIR, name + ".ru.txt"))

    # Файлы прошлого выпуска убираем сразу: тиктоки скачиваются под одним
    # именем, и старый перевод молча достался бы следующему шагу.
    for ext in (".английский.txt", ".en.srt", ".исходный.srt", ".en.txt"):
        old_file = os.path.join(OUT_DIR, name + ext)
        if os.path.exists(old_file):
            os.remove(old_file)

    write_phrases(phrases(words), os.path.join(OUT_DIR, name + ".русский.txt"))

    os.remove(wav)
    print("\nГотово. Слов: %d" % len(words))
    print("Дальше — проверить русский текст и перевести (перевод.py).")


if __name__ == "__main__":
    main()
