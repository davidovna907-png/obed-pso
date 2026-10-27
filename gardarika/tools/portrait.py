#!/usr/bin/env python3
"""Фильм «Гардарика 2026»: портрет героя для финальных титров в нео-нуаре (как кадр начала, tools/noir.py).

  python3 gardarika/tools/portrait.py фото.jpg gardarika/photos/p-имя.jpg CX CY D

CX, CY — центр лица в долях фото, D — сторона квадрата в долях ширины фото.
Квадрат 480×480: фон уходит в ночь (синева, бирюза), лицо — тёплым светом, как под фонарём,
справа краем малиновый неон, слева бирюзовый, виньетка. Подключается в album-data: intro.portraits = {"Имя": "photos/p-….jpg"}.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
cx, cy, d = map(float, sys.argv[3:6])
im = Image.open(src).convert('RGB')
W, H = im.size
side = d * W
box = (round(cx * W - side / 2), round(cy * H - side / 2), round(cx * W + side / 2), round(cy * H + side / 2))
S = 480
im = im.crop(box).resize((S, S), Image.LANCZOS)
a = np.asarray(im, np.float32) / 255
yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) / S
blur = lambda m, s: np.asarray(Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(s)), np.float32) / 255

# лицо в центре квадрата — «под фонарём»
face = blur(np.clip(1.25 - (((xx - .5) / .30) ** 2 + ((yy - .5) / .36) ** 2), 0, 1), S / 20)
lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
L = np.clip(lum * (0.40 + 0.55 * face), 0, 1)
stops = np.array([0.00, 0.10, 0.25, 0.42, 0.62, 1.00], np.float32)
cols = np.array([[0.008, 0.010, 0.022], [0.015, 0.050, 0.090], [0.030, 0.180, 0.230],
                 [0.260, 0.330, 0.380], [0.900, 0.640, 0.540], [1.000, 0.930, 0.860]], np.float32)
gm = np.stack([np.interp(L, stops, cols[:, k]) for k in range(3)], axis=-1)
orig = a * (0.40 + 0.55 * face)[..., None]
k = (0.85 - 0.55 * face)[..., None]
o = gm * k + orig * (1 - k)
# неон: справа малиновый, слева бирюзовый — краем
o = o + (np.clip((xx - .62) / .38, 0, 1) ** 1.6)[..., None] * np.array([.30, .02, .14]) * (0.3 + 0.7 * np.clip(L / .2, 0, 1))[..., None]
o = o + (np.clip(1 - xx / .38, 0, 1) ** 1.6)[..., None] * np.array([0, .10, .14]) * (0.3 + 0.7 * np.clip(L / .2, 0, 1))[..., None]
v = np.clip(1 - (((xx - .5) / .75) ** 2 + ((yy - .5) / .75) ** 2), 0, 1) ** 1.1
o = np.clip(o * (0.3 + 0.7 * v[..., None]), 0, 1)
o = np.clip((o ** 1.05 - 0.04) * 1.1, 0, 1)
Image.fromarray((o * 255).astype(np.uint8)).save(out, quality=88, optimize=True, progressive=True)
print('готово', out, box)
