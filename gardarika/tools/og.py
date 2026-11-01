#!/usr/bin/env python3
"""Фильм «Гардарика 2026»: картинка для ссылки в мессенджерах (icons/og.jpg, 1200×630) — ночной кадр intro,
неоновое «ГАРДАРИКА 2026» и QR-код приложения. Её показывают Telegram, MAX, WhatsApp, ВКонтакте, когда
пересылают одну ссылку (без картинки-приглашения) — так у друзей всё равно видно QR-код.

Запуск из корня репозитория:  python3 gardarika/tools/og.py
Шрифты Oswald и PT Mono берутся из ~/.cache/g24-fonts (их скачивает gardarika2024/tools/icons.py).
QR-код проверяется распознаванием (OpenCV). Если меняется адрес приложения — поменять URL и запустить заново.
"""
import io
import os

import cv2
import numpy as np
import segno
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

FILM = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "https://davidovna907-png.github.io/obed-pso/gardarika/"
F = os.path.expanduser("~/.cache/g24-fonts")
W, H = 1200, 630
PINK, CYAN = (255, 45, 111), (25, 227, 255)


def font(name, size):
    return ImageFont.truetype(os.path.join(F, name), size)


def neon(base, xy, text, f, color, core=(255, 240, 246)):
    """Неоновая надпись: несколько слоёв свечения и светлая сердцевина."""
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).text(xy, text, font=f, fill=color + (255,))
    for r, a in ((26, .55), (12, .8), (4, 1.0)):
        g = layer.filter(ImageFilter.GaussianBlur(r))
        if a < 1:
            g.putalpha(g.getchannel("A").point(lambda v, a=a: int(v * a)))
        base.alpha_composite(g)
    ImageDraw.Draw(base).text(xy, text, font=f, fill=core + (255,))


# ночной кадр втроём: полоса с лицами, затемнена, левый край темнее — там надпись
bg = Image.open(os.path.join(FILM, "photos", "intro.jpg")).convert("RGB")
bw, bh = bg.size
top = int(bh * .20)   # лица — ниже надписи: между ней и QR-кодом видна Наталья
bg = bg.crop((0, top, bw, top + int(bw * H / W))).resize((W, H), Image.LANCZOS)
bg = ImageEnhance.Brightness(bg).enhance(.55).convert("RGBA")
shade = Image.new("L", (W, H))
ImageDraw.Draw(shade).rectangle((0, 0, W, H), fill=0)
grad = np.clip(np.linspace(235, 40, W)[None, :].repeat(H, 0), 0, 255).astype(np.uint8)
dark = Image.new("RGBA", (W, H), (5, 5, 9, 0))
dark.putalpha(Image.fromarray(grad))
im = Image.alpha_composite(bg, dark)

neon(im, (56, 92), "ГАРДАРИКА", font("Oswald-Bold.ttf", 132), PINK)
neon(im, (62, 262), "2 0 2 6", font("Oswald-Bold.ttf", 76), CYAN, (225, 252, 255))
d = ImageDraw.Draw(im)
d.line((62, 372, 400, 372), fill=PINK + (255,), width=3)
mono = font("PTMono.ttf", 27)
for k, line in enumerate(["фильм-приложение · ND", "смотрится без интернета", "наведите камеру на QR-код →"]):
    d.text((62, 396 + k * 40), line, font=mono, fill=(232, 228, 240, 255))

# QR-код на белой карточке справа
qr = segno.make(URL, error="m")
buf = io.BytesIO()
qr.save(buf, kind="png", scale=10, border=2, dark="#0b0a09", light="#ffffff")
buf.seek(0)
q = Image.open(buf).convert("RGB").resize((360, 360), Image.NEAREST)
x0, y0 = W - 56 - 384, (H - 384) // 2
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).rounded_rectangle((x0 - 6, y0 - 6, x0 + 390, y0 + 390), 28, fill=CYAN + (200,))
im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(18)))
d = ImageDraw.Draw(im)
d.rounded_rectangle((x0, y0, x0 + 384, y0 + 384), 22, fill=(255, 255, 255, 255))
im.paste(q, (x0 + 12, y0 + 12))
im = im.convert("RGB")
out = os.path.join(FILM, "icons", "og.jpg")
im.save(out, quality=86, optimize=True, progressive=True)
ok = cv2.QRCodeDetector().detectAndDecode(cv2.imread(out))[0]
print("og.jpg:", im.size, "QR:", ok, "✓" if ok == URL else "✗ НЕ СОВПАДАЕТ")
