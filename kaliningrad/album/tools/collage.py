"""Фотоальбом «Калининград»: коллаж-скрапбук — три фото в рамках-полароидах на тёмном фоне альбома.

  python3 kaliningrad/album/tools/collage.py [--column] ПАПКА_ШРИФТОВ выход.jpg "Заголовок" "подзаголовок" фото1 "подпись1" фото2 "подпись2" фото3 "подпись3"

Без --column — три карточки в ряд (широкая страница, подписи на рамках).
С --column — «сверху — посередине — снизу»: карточки лесенкой по вертикали, подписи от руки
со стрелкой на свободном месте рядом (высокая страница, удобна на телефоне).
У фото можно указать, что держать в кадре при обрезке до 3:4: путь@0.45,0.5 (доли ширины и высоты).

Шрифты Caveat (подписи от руки) и Oranienbaum (заголовок) — .ttf с Google Fonts:
  curl -A "Mozilla/4.0" "https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=Oranienbaum"
  (в ответе ссылки на .ttf; в коде ниже — их имена файлов). Готовый коллаж добавлять обычным photo.py,
  а в album-data у него ставить "collage": true — тогда в сетке он идёт на всю ширину без обрезки.
"""
import math
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

args = sys.argv[1:]
column = args[0] == "--column"
if column:
    args = args[1:]
FONTS, out, title, sub = args[:4]
items = [(args[i], args[i + 1]) for i in range(4, len(args), 2)]
HAND = f"{FONTS}/WnznHAc5bAfYB2QRah7pcpNvOx-pjSx6SII.ttf"
DISP = f"{FONTS}/OZpHg_txtzZKMuXLIVrx-3zn.ttf"
AMBER, AMBER2, INK = (244, 166, 58), (255, 211, 138), (37, 48, 100)
random.seed(7)


def background(W, H, glows):
    """Ночь альбома: тёмный фон, мягкое бирюзовое и янтарное сияние, лёгкое зерно."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    arr = np.zeros((H, W, 3), np.float32) + np.array([10, 15, 20], np.float32)
    for color, cx, cy, r, a in glows:
        f = np.clip(1 - np.hypot(xx - cx, yy - cy) / r, 0, 1) ** 2 * a
        arr += (np.array(color, np.float32) - arr) * f[..., None]
    arr += np.random.default_rng(7).normal(0, 3.5, (H, W, 1)).astype(np.float32)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def load(spec, size):
    path, _, focus = spec.partition("@")
    c = tuple(float(v) for v in focus.split(",")) if focus else (0.5, 0.5)
    return ImageOps.fit(ImageOps.exif_transpose(Image.open(path)).convert("RGB"), size, Image.LANCZOS, centering=c)


def polaroid(photo, B, BB, cap=None, font=None):
    """Карточка-полароид: тёплая бумага, фото, подпись от руки внизу (если есть), полоска скотча сверху."""
    PW, PH = photo.size
    fw, fh = PW + 2 * B, PH + B + BB
    paper = Image.new("RGBA", (fw, fh))
    pd = ImageDraw.Draw(paper)
    for y in range(fh):
        t = y / fh
        pd.line([(0, y), (fw, y)], fill=(int(248 - 10 * t), int(242 - 16 * t), int(228 - 24 * t), 255))
    paper.paste(photo, (B, B))
    if cap:
        cw = pd.textlength(cap, font=font)
        pd.text(((fw - cw) / 2, B + PH + 22), cap, font=font, fill=INK)
    card = Image.new("RGBA", (fw, fh + 40), (0, 0, 0, 0))
    card.paste(paper, (0, 40))
    tape = Image.new("RGBA", (190, 58), (244, 190, 110, 150)).rotate(random.uniform(-6, 6), expand=True, resample=Image.BICUBIC)
    card.alpha_composite(tape, ((fw - tape.width) // 2, 40 - tape.height // 2))
    return card


def place(bg, card, ang, cx, cy):
    rot = card.rotate(ang, expand=True, resample=Image.BICUBIC)
    shadow = Image.new("RGBA", rot.size, (0, 0, 0, 0))
    shadow.putalpha(rot.getchannel("A").point(lambda v: int(v * .6)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    x, y = cx - rot.width // 2, cy - rot.height // 2
    base = bg.convert("RGBA")
    base.alpha_composite(shadow, (x + 16, y + 26))
    base.alpha_composite(rot, (x, y))
    return base.convert("RGB")


def wrap(draw, text, font, width):
    lines, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = t
    return lines + ([cur] if cur else [])


def note(bg, text, cx, cy, width, ang, arrow_to):
    """Подпись от руки на свободном месте и нарисованная стрелка к фото."""
    font = ImageFont.truetype(HAND, 86)
    d = ImageDraw.Draw(bg)
    lines = wrap(d, text, font, width)
    lh = 92
    layer = Image.new("RGBA", (width + 80, lh * len(lines) + 40), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for i, ln in enumerate(lines):
        ld.text(((layer.width - ld.textlength(ln, font=font)) / 2, 10 + i * lh), ln, font=font, fill=AMBER2)
    layer = layer.rotate(ang, expand=True, resample=Image.BICUBIC)
    base = bg.convert("RGBA")
    base.alpha_composite(layer, (cx - layer.width // 2, cy - layer.height // 2))
    bg = base.convert("RGB")
    # стрелка: дуга от-под подписи к краю фото
    d = ImageDraw.Draw(bg)
    sx, sy = cx, cy + layer.height // 2 + 10
    ex, ey = arrow_to
    mx, my = (sx + ex) / 2, max(sy, ey) + 70
    pts = [((1 - t) ** 2 * sx + 2 * (1 - t) * t * mx + t * t * ex, (1 - t) ** 2 * sy + 2 * (1 - t) * t * my + t * t * ey) for t in [i / 40 for i in range(41)]]
    d.line(pts, fill=AMBER, width=7, joint="curve")
    (px, py), (qx, qy) = pts[-4], pts[-1]
    a = math.atan2(qy - py, qx - px)
    for s in (-1, 1):
        d.line([(qx, qy), (qx - 38 * math.cos(a + s * .5), qy - 38 * math.sin(a + s * .5))], fill=AMBER, width=7)
    return bg


if column:
    # «сверху — посередине — снизу»: лесенка из трёх карточек, подписи на свободной стороне
    W, PW, PH, B, BB, STEP, TOP = 1500, 820, 1093, 24, 44, 1000, 300
    card_h = PH + B + BB + 40
    H = TOP + card_h + STEP * (len(items) - 1) + 140
    bg = background(W, H, [((55, 203, 184), 200, 200, 1100, .22), ((244, 166, 58), 1400, H - 300, 1300, .2), ((173, 144, 244), 300, H * .55, 900, .1)])
    d = ImageDraw.Draw(bg)
    tf = ImageFont.truetype(DISP, 112)
    d.text(((W - d.textlength(title, font=tf)) / 2, 60), title, font=tf, fill=AMBER)
    sf = ImageFont.truetype(HAND, 76)
    d.text(((W - d.textlength(sub, font=sf)) / 2, 190), sub, font=sf, fill=AMBER2)
    for k, (spec, cap) in enumerate(items):
        left = k % 2 == 0
        cx, cy = (590 if left else 910), TOP + card_h // 2 + STEP * k
        ang = [-4, 4, -3][k % 3]
        bg = place(bg, polaroid(load(spec, (PW, PH)), B, BB), ang, cx, cy)
        edge_x = cx + (PW // 2 + B) + 10 if left else cx - (PW // 2 + B) - 10
        bg = note(bg, cap, 1265 if left else 235, cy - 120, 400, 6 if left else -6, (edge_x, cy + 40))
else:
    # три карточки в ряд, подписи на рамках
    W, H, PW, PH, B, BB = 2400, 1400, 600, 800, 26, 132
    bg = background(W, H, [((55, 203, 184), 260, 160, 1000, .22), ((244, 166, 58), 2200, 1350, 1100, .20), ((173, 144, 244), 1250, 1500, 700, .10)])
    d = ImageDraw.Draw(bg)
    tf = ImageFont.truetype(DISP, 118)
    d.text((110, 52), title, font=tf, fill=AMBER)
    d.text((110 + d.textlength(title, font=tf) + 40, 92), sub, font=ImageFont.truetype(HAND, 74), fill=AMBER2)
    hand = ImageFont.truetype(HAND, 72)
    layout = [(-6, 560, 830), (7, 1840, 830), (3, 1200, 790)]  # левое, правое, среднее (рисуется последним, сверху)
    for k in [0, 2, 1]:
        spec, cap = items[k]
        ang, cx, cy = layout[[0, 2, 1].index(k)]
        bg = place(bg, polaroid(load(spec, (PW, PH)), B, BB, cap, hand), ang, cx, cy)

bg.save(out, "JPEG", quality=94)
print(out, bg.size)
