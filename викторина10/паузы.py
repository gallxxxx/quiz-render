# -*- coding: utf-8 -*-
r"""
Отмечает места, где нужен таймер, — по букве «т» в тексте.

Запуск:  python паузы.py            (расставить таймеры самому)
         python паузы.py --вручную  (по буквам «т» в out\<имя>.en.txt)
         python паузы.py --вернуть  (убрать все метки)

Ставить ничего не надо. В исходном ролике диктор сам делает паузу после
вопроса и перед ответом — эти молчания видно в расшифровке по разрыву
между словами, и таймер встаёт ровно туда же, куда его поставил автор.

Если запись без пауз (диктор тараторит подряд), включается запасной
способ: таймер перед фразой, в которой назван ответ.

Метка стоит перед всей фразой-ответом целиком: «Answer: Japan»,
«Correct answer. Giraffe». Шкала кончается до слова «Answer», и ответ
называется уже после таймера, не разрезанный паузой.

Ручной режим оставлен на случай, когда таймер нужен в неожиданном месте:
тогда «т» ставится руками перед нужной фразой в out\<имя>.en.txt.

Сам ролик этот скрипт НЕ двигает: он только записывает метки в
«раскадровка.txt» строкой МЕТКИ. Всю раскладку по времени делает
озвучка.py — там речь и решает, когда что происходит.

Метка хранится не секундой, а НОМЕРОМ СЛОВА: секунды поплывут, как только
голос поменяет скорость, а номер слова стоит на месте всегда.
"""
import glob, io, json, os, re, sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import папки

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = папки.work("out")
BOARD = папки.work("раскадровка.txt")
MARK = "т"


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
            cues.append([a, b, body])
    return cues


def find_marks(cues, flat):
    """Перед каким по счёту словом стоит каждая «т».

    Плоский текст — это те же реплики через пробел (так его пишет
    subs.py), поэтому слова идут в том же порядке. Идём по обоим
    спискам разом; «т» пропускаем и запоминаем номер следующего слова.
    """
    stream = []
    for ci, (a, b, text) in enumerate(cues):
        words = text.split()
        for wi, w in enumerate(words):
            stream.append((w, ci, wi, len(words)))

    marks, si, pending = [], 0, 0
    for tok in flat.split():
        if tok == MARK:
            pending += 1
            continue
        if si >= len(stream):
            break
        if tok != stream[si][0]:
            for j in range(si, min(si + 6, len(stream))):   # рассинхрон
                if stream[j][0] == tok:
                    si = j
                    break
        if pending:
            marks.append(si)
            pending = 0
        si += 1
    return marks


SILENCE = 1.0            # разрыв в речи, который считаем «временем подумать»


def original_silences(name, least=SILENCE):
    """Где диктор сам замолчал в исходном ролике.

    Это и есть места таймеров: в оригинале после вопроса идёт пауза на
    две-три секунды, и только потом ответ. Раньше мы вычисляли их по
    тексту перевода и попадали то до вопроса, то в середину фразы —
    а в самой записи всё уже размечено голосом.
    """
    path = os.path.join(OUT_DIR, name + ".слова.json")
    if not os.path.exists(path):
        return []
    words = json.load(io.open(path, encoding="utf-8"))
    out = []
    for i in range(1, len(words)):
        gap = words[i]["a"] - words[i - 1]["b"]
        if gap >= least:
            out.append((words[i]["a"], gap))
    return out


def marks_by_time(cues, moments):
    """Секунда в исходнике -> номер слова в английском тексте.

    Фразы перевода нарезаны по тем же паузам, поэтому нужное слово —
    первое слово фразы, которая начинается сразу после молчания.
    """
    starts, index, n = [], [], 0
    for a, b, text in cues:
        starts.append(a)
        index.append(n)
        n += len(text.split())
    marks = []
    for t, gap in moments:
        best = None
        for ci, a in enumerate(starts):
            if a >= t - 0.6:
                best = ci
                break
        if best is None or index[best] == 0:
            continue
        if index[best] not in marks:
            marks.append(index[best])
    return sorted(marks)


def board_answers():
    """Ответы из раскадровки: (секунда, английское название).

    Секунда — момент исходного ролика, когда диктор назвал ответ; её
    поставил ответы.py по русской расшифровке. Английские субтитры
    считаны с того же звука, поэтому времена у них общие.
    """
    if not os.path.exists(BOARD):
        return []
    out = []
    for raw in io.open(BOARD, encoding="utf-8-sig"):
        line = raw.strip()
        if not line or line.startswith("#") or "|" not in line:
            continue
        if re.match(r"^(?:ТЕМА|TITLE)\s*:", line, re.I):
            continue
        left, right = line.split("|", 1)
        m = re.match(r"^\s*(\d+):(\d+(?:\.\d+)?)\s*$", left.strip())
        if not m:
            continue
        name = right.split("#", 1)[0].strip()
        if name:
            out.append((int(m.group(1)) * 60 + float(m.group(2)), name))
    return sorted(out)


def word_stream(cues):
    """Все слова подряд: (слово, номер реплики, секунда начала реплики)."""
    stream = []
    for ci, (a, b, text) in enumerate(cues):
        for w in text.split():
            stream.append((w, ci, a))
    return stream


# Вводные слова перед ответом: «Answer: Japan», «Correct answer. Giraffe».
# Шкала таймера должна кончаться ДО них, чтобы вся фраза-ответ звучала
# уже после таймера. Иначе слово «Answer» остаётся под работающей шкалой,
# а вставленная пауза разрезает фразу пополам: «Answer:» — тишина — «Japan».
СЛОВО_ОТВЕТ = ("answer", "answers", "ответ", "ответы")
ПЕРЕД_ОТВЕТОМ = ("correct", "right", "the", "правильный", "правильная",
                 "правильные", "верный", "верная")
МЕЖДУ = ("is", "was", "the", "a", "an", "это")


SENT_END = (".", "!", "?", ":", ";")
TRAIL = chr(34) + chr(39) + ")"      # кавычки и скобка на хвосте слова


def sentence_start(stream, idx, limit=14):
    """Отходим назад до начала предложения, но не дальше limit слов.

    Таймер посреди фразы рвёт её пополам: «The first brand [пауза] is
    Mercedes». Нужно, чтобы пауза вставала между предложениями — после
    вопроса и перед ответом.
    """
    i = idx
    while i > 0 and idx - i < limit:
        prev = stream[i - 1][0].rstrip(TRAIL)
        if prev.endswith(SENT_END):
            break
        i -= 1
    return i


def _plain(word):
    return re.sub(r"[^a-zа-яё]", "", word.lower())


def lead_in_start(stream, idx, look=3):
    """Отходим назад на вводное «(correct) answer», если оно есть.

    Дальше вводного не идём. Отступ к началу предложения, который тут
    стоял раньше, уносил метку за сам вопрос — таймер вставал до того,
    как вопрос прозвучал.
    """
    hit = None
    for i in range(idx - 1, max(-1, idx - 1 - look), -1):
        w = _plain(stream[i][0])
        if w in СЛОВО_ОТВЕТ:
            hit = i
            break
        if w not in МЕЖДУ:
            break
    if hit is None:
        return idx
    while hit > 0 and _plain(stream[hit - 1][0]) in ПЕРЕД_ОТВЕТОМ:
        hit -= 1
    return hit


def auto_marks(cues, answers):
    """Сам считает, перед каким словом встанет таймер.

    Для каждого ответа ищем слово, которым его назвали по-английски
    (в переводе марки пишутся латиницей и почти всегда сохраняются),
    и отступаем на вводное «answer», если оно есть. Не нашлось слово —
    берём реплику, на которую попадает секунда ответа.
    """
    stream = word_stream(cues)
    if not stream:
        return [], []
    plain = [re.sub(r"[^a-z0-9]", "", w.lower()) for w, _, _ in stream]
    marks, report = [], []
    used = set()
    for t, name in answers:
        key = re.sub(r"[^a-z0-9]", "", name.lower().split()[0])
        hit = None
        if key:
            # ближайшее к секунде ответа вхождение названия
            best = None
            for i, w in enumerate(plain):
                if not w or key not in w:
                    continue
                if i in used:
                    continue
                d = abs(stream[i][2] - t)
                if best is None or d < best[0]:
                    best = (d, i)
            if best and best[0] < 12.0:
                hit = best[1]
        if hit is None:
            # по времени: первая реплика, которая начинается не позже ответа
            hit = 0
            for i, (w, ci, a) in enumerate(stream):
                if a <= t:
                    hit = i
                else:
                    break
        used.add(hit)
        # Метка встаёт перед ВСЕЙ фразой-ответом: «Answer: Japan»,
        # «Correct answer. Giraffe». Пауза вставляется перед меткой,
        # значит шкала кончается до слова «Answer», и фраза целиком
        # звучит уже после таймера. Если вводного слова нет («This is
        # a very expensive Mercedes»), метка остаётся на самом названии,
        # как и была. К началу предложения не отступаем — так метка
        # уезжала за сам вопрос.
        idx = lead_in_start(stream, hit)
        if idx > 0 and idx not in marks:
            marks.append(idx)
            after = " ".join(w for w, _, _ in stream[idx:idx + 6])
            report.append((name, idx, stream[idx][2], after))
    marks.sort()
    report.sort(key=lambda r: r[1])
    return marks, report


def word_time(cues, index):
    """Примерная секунда слова в исходном ролике — только чтобы показать
    в отчёте, где стоит метка."""
    n = 0
    for a, b, text in cues:
        words = text.split()
        if n + len(words) > index:
            wi = index - n
            return (a + (b - a) * wi / max(len(words), 1),
                    " ".join(words[wi:wi + 5]))
        n += len(words)
    return 0.0, ""


def mmss(sec):
    return "%d:%04.1f" % (int(sec // 60), sec % 60)


def write_marks(marks, report=()):
    lines = io.open(BOARD, encoding="utf-8-sig").read() \
        .replace("\r\n", "\n").split("\n")
    lines = [l for l in lines
             if not re.match(r"^\s*(МЕТКИ|ПАУЗЫ)\s*:", l, re.I)
             and not l.startswith("# Где стоит таймер")
             and not l.startswith("# ТАЙМЕРЫ")
             and not l.startswith("#   таймер перед")]
    while lines and not lines[-1].strip():
        lines.pop()
    if report:
        lines += ["", "# ТАЙМЕРЫ — скрипт расставил их сам, перед этими"
                      " фразами. Проверять не обязательно."]
        for name, idx, t, after in report:
            lines.append("#   таймер перед «%s...»  (%s, ответ %s)"
                         % (after[:46], mmss(t), name))
    if marks:
        lines += ["", "# Где стоит таймер: номера слов. Считает кнопка 2б,"
                      " править руками не надо.",
                  "МЕТКИ: " + ", ".join(str(m) for m in marks)]
    io.open(BOARD, "w", encoding="utf-8",
            newline="\r\n").write("\n".join(lines) + "\n")


def main():
    args = sys.argv[1:]
    restore = "--вернуть" in args or "--restore" in args
    by_hand = ("--вручную" in args or "--правка" in args
               or "--by-hand" in args)

    srts = sorted(glob.glob(os.path.join(OUT_DIR, "*.исходный.srt")) or
                  glob.glob(os.path.join(OUT_DIR, "*.en.srt")),
                  key=os.path.getmtime, reverse=True)
    if not srts:
        sys.exit("Нет субтитров. Сначала «1 Распознать речь».")
    name = os.path.basename(srts[0]).split(".")[0]
    orig = os.path.join(OUT_DIR, name + ".исходный.srt")
    if not os.path.exists(orig):
        io.open(orig, "w", encoding="utf-8").write(
            io.open(os.path.join(OUT_DIR, name + ".en.srt"),
                    encoding="utf-8-sig").read())
    cues = read_srt(orig)

    if restore:
        write_marks([])
        print("Метки убраны. Переозвучь (2г) и собери (3).")
        return

    if not by_hand:
        # Обычный путь: таймеры считаются сами по раскадровке — перед той
        # фразой, в которой назван ответ, с отступом к началу предложения.
        answers = board_answers()
        if not answers:
            sys.exit("В «раскадровка.txt» нет ответов. Сначала кнопка 2.")

        print("Ролик: %s" % name)
        # Ставим таймер перед СЛОВОМ ответа.
        #
        # Раньше основным путём были молчания русского оригинала
        # («original_silences» + «marks_by_time»): считалось, что автор
        # уже разметил паузы голосом. Но молчания русские, а метка нужна
        # в английском тексте, и сопоставление по времени промахивалось
        # мимо фразы — метка вставала ПОСЛЕ ответа. Тогда слово успевало
        # прозвучать и выскочить на экран раньше, чем шкала доходила до
        # конца. Обе функции оставлены ниже: ими пользуется ручной режим.
        marks, report = auto_marks(cues, answers)
        print("Ответов: %d,  таймеров расставлено: %d"
              % (len(answers), len(marks)))
        for nm, idx, t, after in report:
            print("   %-12s %s  перед «%s...»" % (nm, mmss(t), after[:44]))
        write_marks(marks, report)
        print()
        print("Таймеры записаны в раскадровку. Руками ничего ставить не надо.")
        print("Дальше 2г (озвучить) и 3 (собрать).")
        return

    # Запасной путь: буквы «т» руками в плоском тексте.
    flat_path = os.path.join(OUT_DIR, name + ".en.txt")
    if os.path.exists(flat_path):
        print("Открываю текст. Поставь «т» перед нужными фразами,")
        print("сохрани (Ctrl+S) и закрой блокнот.")
        os.system('notepad "%s"' % flat_path)
    if not os.path.exists(flat_path):
        sys.exit("Нет файла %s — в него ставятся буквы «т»."
                 % os.path.basename(flat_path))
    flat = io.open(flat_path, encoding="utf-8-sig").read()
    if (" %s " % MARK) not in (" " + flat + " "):
        sys.exit("В тексте нет ни одной буквы «т» отдельным словом.")
    marks = find_marks(cues, flat)
    print("Ролик: %s" % name)
    print("Найдено меток «т»: %d" % len(marks))
    report = []
    for idx in marks:
        t, after = word_time(cues, idx)
        report.append(("руками", idx, t, after))
        print("   слово №%-4d (~%s)  перед «%s...»" % (idx, mmss(t), after))
    write_marks(marks, report)
    print()
    print("Метки записаны в раскадровку.")


if __name__ == "__main__":
    main()
