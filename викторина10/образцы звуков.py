# -*- coding: utf-8 -*-
r"""Делает короткие образцы звуков таймера — чтобы послушать до сборки.

    python "образцы звуков.py" "куда положить"

Зачем. Выбрать звук по названию — гадание: «капли» и «вода» на слух
разные, а по слову не отличишь. Вика попросила слушать прямо на
сайте, поэтому образцы делаются заранее и кладутся рядом со страницей.

Образец — это три удара отсчёта и звук ответа, ровно теми же
функциями, что звучат в готовом ролике. Не «похожий» звук, а тот
самый: наборы берутся из «overlay.py».
"""
import io
import os
import struct
import sys
import wave

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

ПАУЗА = 0.55          # между ударами отсчёта
УДАРОВ = 3


def сделать(куда):
    import numpy as np
    import overlay

    os.makedirs(куда, exist_ok=True)
    сделано = []
    for имя, набор in overlay.PACKS.items():
        beat, reveal, _ = набор(np)
        дорожка = np.zeros(int(overlay.SR * (ПАУЗА * УДАРОВ + 2.0)))
        for k in range(УДАРОВ):
            кусок = beat(k, УДАРОВ)
            с = int(overlay.SR * ПАУЗА * k)
            дорожка[с:с + len(кусок)] += кусок[:len(дорожка) - с]
        кусок = reveal()
        с = int(overlay.SR * ПАУЗА * УДАРОВ)
        дорожка[с:с + len(кусок)] += кусок[:len(дорожка) - с]

        пик = float(np.max(np.abs(дорожка))) or 1.0
        дорожка = np.clip(дорожка / max(пик, 1.0) * 0.9, -1.0, 1.0)
        данные = (дорожка * 32767).astype("<i2").tobytes()

        файл = os.path.join(куда, "%s.wav" % имя)
        with wave.open(файл, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(overlay.SR)
            w.writeframes(данные)
        сделано.append((имя, os.path.getsize(файл)))
        print("  %-12s %6.0f КБ" % (имя, os.path.getsize(файл) / 1024))
    return сделано


if __name__ == "__main__":
    куда = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "звуки")
    print("Делаю образцы звуков в %s" % куда)
    сделать(куда)
    print("Готово.")
