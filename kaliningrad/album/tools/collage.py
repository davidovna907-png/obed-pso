"""Фотоальбом «Калининград»: коллаж-скрапбук — три фото в рамках-полароидах под разными углами.

  python3 kaliningrad/album/tools/collage.py ПАПКА_ШРИФТОВ выход.jpg "Заголовок" "подзаголовок" фото1 "подпись1" фото2 "подпись2" фото3 "подпись3"

Шрифты Caveat (подписи от руки) и Oranienbaum (заголовок) — .ttf с Google Fonts:
  curl -A "Mozilla/4.0" "https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=Oranienbaum"
  (в ответе ссылки на .ttf; в коде ниже — их имена файлов). Готовый коллаж добавлять обычным photo.py,
  а в album-data у него ставить "collage": true — тогда в сетке он идёт на всю ширину без обрезки.
"""
import sys, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

FONTS = sys.argv[1]
HAND = f"{FONTS}/WnznHAc5bAfYB2QRah7pcpNvOx-pjSx6SII.ttf"
DISP = f"{FONTS}/OZpHg_txtzZKMuXLIVrx-3zn.ttf"
out, title, sub = sys.argv[2], sys.argv[3], sys.argv[4]
items = [(sys.argv[i], sys.argv[i + 1]) for i in range(5, len(sys.argv), 2)]
W, H = 2400, 1400
random.seed(7)

# фон: ночь, бирюзовое и янтарное сияние, лёгкое зерно
import numpy as np
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
arr = np.zeros((H, W, 3), np.float32) + np.array([10, 15, 20], np.float32)
for color, cx, cy, r, a in [((55, 203, 184), 260, 160, 1000, .22), ((244, 166, 58), 2200, 1350, 1100, .20), ((173, 144, 244), 1250, 1500, 700, .10)]:
    f = np.clip(1 - np.hypot(xx - cx, yy - cy) / r, 0, 1) ** 2 * a
    arr += (np.array(color, np.float32) - arr) * f[..., None]
arr += np.random.default_rng(7).normal(0, 3.5, (H, W, 1)).astype(np.float32)
bg = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

d = ImageDraw.Draw(bg)
d.text((110, 52), title, font=ImageFont.truetype(DISP, 118), fill=(244, 166, 58))
tw = d.textlength(title, font=ImageFont.truetype(DISP, 118))
d.text((110 + tw + 40, 92), sub, font=ImageFont.truetype(HAND, 74), fill=(255, 211, 138))

PW, PH, B, BB = 600, 800, 26, 132
hand = ImageFont.truetype(HAND, 72)
layout = [(-6, 560, 830), (7, 1840, 830), (3, 1200, 790)]  # порядок рисования: левое, правое, среднее сверху
order = [0, 2, 1]
for k in order:
    path, cap = items[k]
    ang, cx, cy = layout[[0, 2, 1].index(k)] if False else layout[order.index(k)]
    ph = ImageOps.fit(ImageOps.exif_transpose(Image.open(path)).convert("RGB"), (PW, PH), Image.LANCZOS)
    fw, fh = PW + 2 * B, PH + B + BB
    card = Image.new("RGBA", (fw, fh + 40), (0, 0, 0, 0))
    paper = Image.new("RGBA", (fw, fh), (246, 239, 224, 255))
    pd = ImageDraw.Draw(paper)
    for y in range(fh):  # тёплый градиент бумаги
        t = y / fh; pd.line([(0, y), (fw, y)], fill=(int(248 - 10 * t), int(242 - 16 * t), int(228 - 24 * t), 255))
    paper.paste(ph, (B, B))
    cw = pd.textlength(cap, font=hand)
    pd.text(((fw - cw) / 2, B + PH + 22), cap, font=hand, fill=(37, 48, 100))
    card.paste(paper, (0, 40))
    tape = Image.new("RGBA", (190, 58), (244, 190, 110, 150)).rotate(random.uniform(-6, 6), expand=True, resample=Image.BICUBIC)
    card.alpha_composite(tape, ((fw - tape.width) // 2, 40 - tape.height // 2))
    rot = card.rotate(ang, expand=True, resample=Image.BICUBIC)
    shadow = Image.new("RGBA", rot.size, (0, 0, 0, 0)); shadow.putalpha(rot.getchannel("A").point(lambda v: int(v * .6)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    x, y = cx - rot.width // 2, cy - rot.height // 2
    base = bg.convert("RGBA"); base.alpha_composite(shadow, (x + 16, y + 26)); base.alpha_composite(rot, (x, y)); bg = base.convert("RGB")

bg.save(out, "JPEG", quality=94)
print(out, bg.size)
