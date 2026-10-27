#!/usr/bin/env python3
"""Фильм «Гардарика 2026»: кадр для титула в стиле цветного нео-нуара (фото g020, мы втроём).

  python3 gardarika/tools/noir.py gardarika/photos/g020.jpg gardarika/photos/intro.jpg

Градиентная карта по яркости (чёрный → ночная синева → бирюза → холодный серо-бирюзовый → тёплые света),
фон тонируется сильнее и уводится в ночь, люди — мягче, как под фонарём; малиновый неон краем справа,
дымка огней у горизонта, свечение бликов, виньетка."""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
CROP = (0.18, 0.98)   # вертикальный кадр под экран телефона: все трое и тёмное небо сверху для названия
im = Image.open(src).convert('RGB')
W, H = im.size
a = np.asarray(im, np.float32) / 255
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
yy /= H; xx /= W
blur = lambda m, s: np.asarray(Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(s)), np.float32) / 255

r, g, b = a[..., 0], a[..., 1], a[..., 2]
sky = blur(np.clip((b - np.maximum(r, g) * 1.05) * 6, 0, 1) * np.clip((0.6 - yy) * 5, 0, 1), 4)
cx, cy, rx, ry = 0.63, 0.63, 0.25, 0.40
subj = blur(np.clip(1.3 - (((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2), 0, 1), W / 30)

lum = 0.299 * r + 0.587 * g + 0.114 * b
# ночь: фон темнее, небо почти чёрное
L = lum * (0.42 + 0.48 * subj) * (1 - 0.80 * sky)
L = np.clip(L, 0, 1)

# градиентная карта
stops = np.array([0.00, 0.10, 0.25, 0.42, 0.62, 1.00], np.float32)
cols = np.array([[0.008, 0.010, 0.022],    # почти чёрный с синевой
                 [0.015, 0.050, 0.090],    # ночная синева
                 [0.030, 0.180, 0.230],    # бирюза
                 [0.260, 0.330, 0.380],    # холодный серо-бирюзовый
                 [0.900, 0.640, 0.540],    # тёплый свет (кожа)
                 [1.000, 0.930, 0.860]], np.float32)
gm = np.stack([np.interp(L, stops, cols[:, k]) for k in range(3)], axis=-1)

# смешение с исходным цветом: у людей живые цвета, фон — стилизован
orig = a * (0.42 + 0.48 * subj)[..., None] * (1 - 0.8 * sky[..., None])
k = (0.85 - 0.50 * subj)[..., None]
o = gm * k + orig * (1 - k)

# неоновый контровой свет: справа малиновый, слева бирюзовый — на освещённом
right = np.clip((xx - 0.45) / 0.55, 0, 1) ** 1.2
left = np.clip(1 - xx / 0.55, 0, 1) ** 1.4
body = np.clip(L / 0.18, 0, 1)
rim = np.clip((xx - 0.72) / 0.28, 0, 1) ** 1.5   # малиновый — только краем справа, как от вывески
o = o + (rim[..., None] * np.array([0.26, 0.02, 0.12]) + left[..., None] * np.array([0.00, 0.07, 0.10])) * body[..., None] * 0.6

# огни у горизонта: узкая светящаяся полоса за деревьями
hz = np.exp(-((yy - 0.375) / 0.035) ** 2) * (0.3 + 0.7 * sky + 0.4 * (1 - sky))
o = o + hz[..., None] * (right[..., None] * np.array([0.28, 0.02, 0.12]) + left[..., None] * np.array([0.00, 0.10, 0.14]) + np.array([0.02, 0.02, 0.04]))

# свечение бликов
bl = blur(np.clip(o.max(axis=2) * 1.6 - 0.55, 0, 1), W / 40)
o = o + bl[..., None] * np.array([0.22, 0.12, 0.20])

# виньетка и контраст
v = np.clip(1 - (((xx - 0.6) / 0.72) ** 2 + ((yy - 0.58) / 0.78) ** 2), 0, 1) ** 1.2
o = o * (0.18 + 0.82 * v[..., None])
o = np.clip(o, 0, 1)
o = o ** 1.05
o = np.clip((o - 0.06) * 1.12, 0, 1)
res = Image.fromarray((o * 255).astype(np.uint8))
res = res.crop((int(CROP[0] * W), 0, int(CROP[1] * W), H))
res.save(out, quality=88, optimize=True, progressive=True)
print('готово', out)
