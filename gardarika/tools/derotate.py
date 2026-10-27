#!/usr/bin/env python3
"""Фильм «Гардарика 2026»: видео, где посреди съёмки телефон повернули боком (и обратно).

  python3 gardarika/tools/derotate.py исходное.mov готовое.mov

Что делает:
  • меряет поворот телефона в каждом кадре: кадр сопоставляется с предыдущим (перебор угла ±20°
    и фазовая корреляция), повороты складываются;
  • участки, где телефон держали ровно, приводит к точным 0° / 90° / 180°, а сами повороты —
    плавно между ними (накопленная ошибка измерения так не копится);
  • доворачивает каждый кадр обратно: горизонт всё время ровный, кадр «вплывает» поворотом,
    боковой участок — почти во всю ширину с медленным наездом, фон — тот же кадр, размытый и
    затемнённый (без чёрных углов);
  • ничего не вырезает, звук остаётся целиком.
Готовое видео (720×1280) добавлять обычным `add.py` (или заменять им файл кадра с `?v=2`).
Перед этим проверять кадры: `ffmpeg … -vf "fps=6,…,tile=…"` до и после.
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "kaliningrad", "album", "tools"))
import photo  # noqa: E402  TONEMAP: HDR с iPhone — в обычный цвет

W, H, FPS = 720, 1280, 30


def measure(src):
    """Накопленный поворот содержимого кадра (по часовой стрелке, в градусах) для каждого кадра."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", "scale=180:320,format=gray", "-f", "rawvideo", "-"],
                         capture_output=True, check=True).stdout
    F = np.frombuffer(raw, np.uint8).reshape(-1, 320, 180)
    win = np.outer(np.hanning(120), np.hanning(120))
    crop = lambda a: a[100:220, 30:150].astype(float)

    def peak(a, b):
        A = np.fft.fft2((a - a.mean()) * win)
        B = np.fft.fft2((b - b.mean()) * win)
        R = A * np.conj(B)
        return np.fft.ifft2(R / (np.abs(R) + 1e-9)).real.max()

    angles = np.arange(-20, 20.01, 0.5)
    delta = np.zeros(len(F))
    for i in range(1, len(F)):
        prev, cur = Image.fromarray(F[i - 1]), crop(F[i])
        base = peak(crop(F[i - 1]), cur)
        best = max((peak(crop(np.asarray(prev.rotate(-a, resample=Image.BILINEAR))), cur), a) for a in angles)
        # поворот засчитываем, только если он заметно лучше «без поворота» (иначе дрожь руки копится)
        delta[i] = best[1] if best[0] > base * 1.02 else 0
    return np.cumsum(delta)


def plan(cum):
    """Ровные участки — к точным 0/90/180°, повороты — плавно между ними."""
    n = len(cum)
    snap = np.round(cum / 90) * 90
    speed = np.abs(np.gradient(np.convolve(cum, np.ones(5) / 5, mode="same")))
    moving = speed > 1.0                     # больше 1° за кадр — телефон поворачивают
    ang = snap.copy()
    i = 0
    while i < n:
        if not moving[i]:
            i += 1
            continue
        j = i
        while j < n and moving[j]:
            j += 1
        a0, b0 = max(0, i - 3), min(n - 1, j + 3)
        s0, s1 = snap[a0], snap[b0]
        c0, c1 = cum[a0], cum[b0]
        for k in range(a0, b0 + 1):
            x = (cum[k] - c0) / (c1 - c0) if abs(c1 - c0) > 1e-6 else 0
            ang[k] = s0 + np.clip(x, 0, 1) * (s1 - s0)
        i = j
    return np.convolve(np.pad(ang, 1, mode="edge"), np.ones(3) / 3, mode="valid")


def render(src, ang, out):
    n = len(ang)
    t = np.arange(n) / FPS
    side = np.abs(np.sin(np.radians(ang))) > 0.99
    # медленный наезд на боковых участках: 0.6 → 0.7 (полная ширина — 0.5625)
    zoom = np.full(n, 0.6)
    if side.any():
        idx = np.where(side)[0]
        t0, t1 = t[idx[0]], t[idx[-1]]
        x = np.clip((t - t0) / max(0.1, t1 - t0), 0, 1)
        zoom = 0.6 + 0.1 * x * x * (3 - 2 * x)
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                            "-i", src, "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-crf", "12", "-preset", "fast",
                            "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", "-shortest", out], stdin=subprocess.PIPE)
    i = 0
    while True:
        buf = dec.stdout.read(W * H * 3)
        if len(buf) < W * H * 3:
            break
        a = float(ang[min(i, n - 1)])
        im = Image.frombuffer("RGB", (W, H), buf, "raw", "RGB", 0, 1)
        if abs(a) < 0.3 or abs(abs(a) - 180) < 0.3:
            frame = im.rotate(a) if abs(a) > 90 else im
        else:
            p = abs(np.sin(np.radians(a)))
            s = 1 + (zoom[min(i, n - 1)] - 1) * (p * p * (3 - 2 * p))
            fg = im.convert("RGBA").rotate(a, expand=True, resample=Image.BICUBIC)
            fg = fg.resize((max(1, round(fg.width * s)), max(1, round(fg.height * s))), Image.BICUBIC)
            # фон: самый большой прямоугольник 9:16 без чёрных углов из повёрнутого кадра, размытый и затемнённый
            rgb = im.rotate(a, expand=True, resample=Image.BILINEAR)
            ca, sa = abs(np.cos(np.radians(a))), abs(np.sin(np.radians(a)))
            r = H / W
            x = min(W / (ca + r * sa), H / (sa + r * ca))
            cx, cy = rgb.width / 2, rgb.height / 2
            bg = rgb.crop((round(cx - x / 2), round(cy - x * r / 2), round(cx + x / 2), round(cy + x * r / 2)))
            bg = bg.resize((W // 8, H // 8), Image.BILINEAR).filter(ImageFilter.GaussianBlur(5)).resize((W, H), Image.BILINEAR)
            bg = ImageEnhance.Brightness(bg).enhance(1 - 0.45 * p)
            bg.paste(fg, ((W - fg.width) // 2, (H - fg.height) // 2), fg)
            frame = bg
        enc.stdin.write(frame.tobytes())
        i += 1
    enc.stdin.close()
    enc.wait()
    dec.wait()
    return i


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, out = sys.argv[1], sys.argv[2]
    with tempfile.TemporaryDirectory() as tmp:
        mid = os.path.join(tmp, "src.mov")
        hdr = photo.video_info(src)[1]
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?",
                        "-vf", (photo.TONEMAP + "," if hdr else "") + f"scale={W}:{H},fps={FPS},format=yuv420p", "-c:v", "libx264", "-crf", "12",
                        "-preset", "fast", "-c:a", "pcm_s16le", mid], check=True)
        cum = measure(mid)
        ang = plan(cum)
        for sec in np.arange(0, len(ang) / FPS, 0.5):
            k = int(sec * FPS)
            print(f"{sec:4.1f} с: поворот {cum[k]:6.1f}° → доворот {ang[k]:5.0f}°")
        frames = render(mid, ang, out)
    print("Готово:", out, "кадров", frames)


if __name__ == "__main__":
    main()
