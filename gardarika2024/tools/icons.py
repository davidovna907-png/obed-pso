#!/usr/bin/env python3
"""Газета «Гардарика 2024»: значки приложения, QR-код и картинка-приглашение (icons/).

Запуск из корня репозитория:  python3 gardarika2024/tools/icons.py
Нужны шрифты Old Standard TT, Oswald, PT Serif, PT Mono — скрипт сам скачивает их с Google Fonts
в ~/.cache/g24-fonts (один раз). QR-код проверяется распознаванием (OpenCV); если адрес приложения
меняется — поменять URL ниже и запустить заново (картинку-приглашение и qr.svg пересобрать обязательно).
"""
import io, os, re, urllib.request
import segno, cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "https://davidovna907-png.github.io/obed-pso/gardarika2024/"
F = os.path.expanduser("~/.cache/g24-fonts")
FONTS = {"OldStandard-Bold.ttf": ("Old Standard TT", "700", "normal"), "OldStandard-Italic.ttf": ("Old Standard TT", "400", "italic"),
         "Oswald-Bold.ttf": ("Oswald", "700", "normal"), "PTSerif-Regular.ttf": ("PT Serif", "400", "normal"),
         "PTSerif-Italic.ttf": ("PT Serif", "400", "italic"), "PTMono.ttf": ("PT Mono", "400", "normal")}


def get_fonts():
    """TTF с Google Fonts (старый User-Agent — чтобы отдали .ttf, а не .woff2)."""
    os.makedirs(F, exist_ok=True)
    for name, (fam, wght, style) in FONTS.items():
        path = os.path.join(F, name)
        if os.path.exists(path):
            continue
        q = fam.replace(" ", "+") + (":ital,wght@1," + wght if style == "italic" else ":wght@" + wght)
        req = urllib.request.Request("https://fonts.googleapis.com/css2?family=" + q, headers={"User-Agent": "Mozilla/4.0"})
        css = urllib.request.urlopen(req).read().decode()
        url = re.findall(r"url\((https://fonts\.gstatic\.com[^)]+\.ttf)\)", css)[-1]
        open(path, "wb").write(urllib.request.urlopen(url).read())


get_fonts()
PAPER, INK, RED, CREAM = (236, 227, 205), (29, 25, 19), (168, 38, 28), (245, 236, 216)
font = lambda name, size: ImageFont.truetype(os.path.join(F, name), size)

def paper(w, h, seed=7):
    rnd = np.random.default_rng(seed)
    base = np.ones((h, w, 3), np.float32) * np.array(PAPER, np.float32)
    n = rnd.normal(0, 1, (h // 2 + 1, w // 2 + 1)).astype(np.float32)
    n = cv2.resize(cv2.GaussianBlur(n, (0, 0), 1.2), (w, h))
    base += n[..., None] * np.array([5, 4.5, 3.5], np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    v = ((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2
    base -= (np.clip(v - .55, 0, None) * 28)[..., None] * np.array([.9, 1, 1.25], np.float32)
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))

def ctext(d, cx, y, text, f, fill):
    w = d.textlength(text, font=f)
    d.text((cx - w / 2, y), text, font=f, fill=fill)

# ---------- значок: бумага, буква «Г» газетным шрифтом, двойные линейки, «2024» красным ----------
def icon(size):
    S = 1024
    im = paper(S, S, 3); d = ImageDraw.Draw(im)
    d.rectangle((0, 0, S, 120), fill=INK)
    for y in (232, 248):
        d.line((150, y, S - 150, y), fill=INK, width=6 if y == 232 else 3)
    g = font("OldStandard-Bold.ttf", 520)
    bb = d.textbbox((0, 0), "Г", font=g)
    d.text(((S - (bb[2] - bb[0])) / 2 - bb[0], 290 - bb[1]), "Г", font=g, fill=INK)
    for y in (790, 806):
        d.line((150, y, S - 150, y), fill=INK, width=3 if y == 790 else 6)
    ctext(d, S / 2, 832, "2024", font("Oswald-Bold.ttf", 120), RED)
    return im.resize((size, size), Image.LANCZOS)

icon(512).save(os.path.join(APP, "icons/icon-512.png"), optimize=True)
icon(192).save(os.path.join(APP, "icons/icon-192.png"), optimize=True)
icon(180).save(os.path.join(APP, "icons/apple-touch-icon.png"), optimize=True)

# ---------- QR-код ----------
qr = segno.make(URL, error="m")
qr.save(os.path.join(APP, "icons/qr.svg"), scale=10, border=2, dark="#1d1913", light="#ffffff", xmldecl=False, svgns=True)
buf = io.BytesIO(); qr.save(buf, kind="png", scale=12, border=3, dark="#1d1913", light="#ffffff"); buf.seek(0)
qr_img = Image.open(buf).convert("RGB")
ok = cv2.QRCodeDetector().detectAndDecode(cv2.cvtColor(np.array(qr_img), cv2.COLOR_RGB2BGR))[0]
print("QR:", ok, "✓" if ok == URL else "✗ НЕ СОВПАДАЕТ")

# ---------- приглашение 1080×1920: первая полоса газеты с QR-кодом ----------
W, H = 1080, 1920
im = paper(W, H, 11); d = ImageDraw.Draw(im)
d.rectangle((0, 0, W, 70), fill=INK)
mono = font("PTMono.ttf", 26)
d.text((40, 20), "№ 1", font=mono, fill=CREAM)
ctext(d, W / 2, 20, "7 ДЕКАБРЯ 2024", mono, CREAM)
t = "ЦЕНА — УЛЫБКА"; d.text((W - 40 - d.textlength(t, font=mono), 20), t, font=mono, fill=CREAM)
ctext(d, W / 2, 104, "✦  ГАЗЕТА ПУТЕШЕСТВИЙ ВО ВРЕМЕНИ  ✦".replace("✦", "*"), font("PTMono.ttf", 24), (111, 99, 82))
mast = font("OldStandard-Bold.ttf", 132)
ctext(d, W / 2, 140, "Гардарикские", mast, INK)
ctext(d, W / 2, 272, "ведомости", mast, INK)
ctext(d, W / 2, 432, "издаётся в Гардарике", font("OldStandard-Italic.ttf", 36), (63, 55, 44))
for y, w in ((498, 6), (510, 2)):
    d.line((40, y, W - 40, y), fill=INK, width=w)
d.rectangle((40, 540, 40 + 320, 540 + 44), fill=RED)
d.text((56, 548), "СЕНСАЦИЯ НОМЕРА", font=font("PTMono.ttf", 26), fill=CREAM)
head = font("OldStandard-Bold.ttf", 76)
d.text((40, 600), "Путешествие во времени", font=head, fill=INK)
d.text((40, 690), "удалось!", font=head, fill=INK)
# снимок «в печати»: рунный камень, чёрно-белый с сепией
ph = Image.open(os.path.join(APP, "photos/n002.jpg")).convert("RGB")
pw, phh = ph.size
crop = ph.crop((0, int(phh * .36), pw, int(phh * .36) + int(pw * .66)))
crop = ImageOps.grayscale(crop).convert("RGB")
crop = Image.blend(crop, Image.new("RGB", crop.size, (112, 84, 52)), .12)
crop = ImageOps.autocontrast(crop, cutoff=1).resize((W - 80, int((W - 80) * crop.height / crop.width)), Image.LANCZOS)
im.paste(crop, (40, 800)); d.rectangle((40, 800, 40 + crop.width - 1, 800 + crop.height - 1), outline=INK, width=3)
y = 800 + crop.height + 14
d.text((40, y), "Встреча у рунного камня. Репортажи сквозь века — внутри номера", font=font("PTSerif-Italic.ttf", 28), fill=(63, 55, 44))
# QR-код и подпись
qs = 330
q = qr_img.resize((qs, qs), Image.NEAREST)
qy = H - qs - 70
d.rectangle((40 - 10, qy - 10, 40 + qs + 10, qy + qs + 10), outline=INK, width=3)
im.paste(q, (40, qy))
tx = 40 + qs + 40
d.text((tx, qy + 6), "Подписка на газету", font=font("OldStandard-Bold.ttf", 46), fill=INK)
lines = ["Наведите камеру телефона", "на QR-код и нажмите", "«Установить приложение»:", "газета и кинохроника", "откроются со своего значка", "и без интернета."]
sf = font("PTSerif-Regular.ttf", 31)
for k, l in enumerate(lines):
    d.text((tx, qy + 74 + k * 40), l, font=sf, fill=(63, 55, 44))
ctext(d, W / 2, H - 46, URL.replace("https://", ""), font("PTMono.ttf", 22), (111, 99, 82))
im.save(os.path.join(APP, "icons/invite.jpg"), quality=86, optimize=True, progressive=True)
inv = cv2.imread(os.path.join(APP, "icons/invite.jpg"))
print("QR в приглашении:", cv2.QRCodeDetector().detectAndDecode(inv)[0] == URL)
