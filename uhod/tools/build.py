#!/usr/bin/env python3
# Открытая страница памятки «Реабилитация и уход после инсульта» — на неё ведёт QR-код стенда в отделении.
# Собирает всё из памятки РЕАБИТ (Reabilitaciya_i_uhod_A5_cvet.pdf):
#   облегчённый PDF (без потерь: рисунки чёрно-белые — храним серыми 8 бит с PNG-предиктором, страницы сверяются попиксельно),
#   картинки страниц p/NN.png (1100 px, PNG 64 цвета), превью для мессенджеров og.jpg, значок и index.html с оглавлением.
# Запуск: python3 uhod/tools/build.py путь/к/Reabilitaciya_i_uhod_A5_cvet.pdf
import html, io, os, struct, sys
import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageFont

SRC = sys.argv[1]
OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # папка uhod/
PDF = 'Reabilitaciya_i_uhod_posle_insulta.pdf'
URL = 'https://davidovna907-png.github.io/obed-pso/uhod/'
W = 1100                                                                  # ширина картинок страниц, px
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf'
TOC = [
    ('Главное', [(2, 'Коротко о главном: 10 правил'), (3, 'Что такое инсульт'), (4, 'Как проходит реабилитация')]),
    ('Как помогать', [(5, 'Как помогать правильно'), (6, 'Поддержка каждый день'), (7, 'Берегите больное плечо'),
                      (8, 'Кожа и пролежни')]),
    ('Положение в постели', [(9, 'Лежать на здоровом боку'), (10, 'Лежать на больном боку'), (11, 'Лежать на спине'),
                             (12, 'Сидеть в кровати'), (13, 'Сидеть в кресле')]),
    ('Перемещения', [(14, 'Повернуться и подвинуться в кровати'), (15, 'Встать с кровати самостоятельно'),
                     (16, 'Встать с кровати с помощником'), (17, 'Встать со стула'), (18, 'Пересесть со стула на стул'),
                     (19, 'Пересесть, если не может встать сам')]),
    ('Движение', [(20, 'Ходьба и нога'), (21, 'Рука и кисть'), (22, 'Спастичность'), (23, 'Лестница'),
                  (24, 'Если пациент упал')]),
    ('Быт', [(25, 'Одевание'), (26, 'Удобная одежда и обувь'), (27, 'Мытьё и гигиена'), (28, 'Средства ухода')]),
    ('Профилактика', [(29, 'Как избежать повторного инсульта'), (30, 'Давление')]),
    ('Важно', [(31, 'Когда звать врача'), (32, 'Ваша реабилитационная команда')]),
]
TITLES = {1: 'Обложка'}
for _, items in TOC:
    TITLES.update(items)


def idat(png):                     # потоки IDAT из PNG — это Flate с PNG-предиктором, его понимает PDF
    out, i = b'', 8
    while i < len(png):
        n = struct.unpack('>I', png[i:i + 4])[0]
        if png[i + 4:i + 8] == b'IDAT':
            out += png[i + 8:i + 8 + n]
        i += 12 + n
    return out


def web_pdf():
    d = pymupdf.open(SRC)
    done = set()
    for p in d:
        for img in p.get_images(full=True):
            x = img[0]
            if x in done:
                continue
            done.add(x)
            rgb = np.asarray(Image.open(io.BytesIO(d.extract_image(x)['image'])).convert('RGB')).astype(int)
            if (np.abs(rgb[..., 0] - rgb[..., 1]) + np.abs(rgb[..., 1] - rgb[..., 2])).max() > 0:
                continue                                                 # цветную картинку не трогаем
            im = Image.fromarray(rgb[..., 0].astype(np.uint8), 'L')
            buf = io.BytesIO()
            im.save(buf, 'PNG', optimize=True, compress_level=9)
            d.update_stream(x, idat(buf.getvalue()), compress=False)
            d.xref_set_key(x, 'Filter', '/FlateDecode')
            d.xref_set_key(x, 'BitsPerComponent', '8')
            d.xref_set_key(x, 'ColorSpace', '/DeviceGray')
            d.xref_set_key(x, 'DecodeParms', '<</Predictor 15/Colors 1/BitsPerComponent 8/Columns %d>>' % im.width)
    out = os.path.join(OUT, PDF)
    d.save(out, garbage=4, deflate=True, deflate_fonts=True, use_objstms=1)
    a, b = pymupdf.open(SRC), pymupdf.open(out)
    assert len(a) == len(b) == 32, len(b)
    for i in range(len(a)):                                              # страницы должны совпасть пиксель в пиксель
        pa, pb = a[i].get_pixmap(dpi=72), b[i].get_pixmap(dpi=72)
        assert pa.samples == pb.samples, 'страница %d отличается' % (i + 1)
    print('PDF: %.1f МБ -> %.1f МБ, страницы совпадают' % (os.path.getsize(SRC) / 2**20, os.path.getsize(out) / 2**20))
    return b


def pages(d):
    os.makedirs(os.path.join(OUT, 'p'), exist_ok=True)
    sizes = []
    for i, p in enumerate(d):
        z = W / p.rect.width
        pix = p.get_pixmap(matrix=pymupdf.Matrix(z, z))
        im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        im.quantize(64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(
            os.path.join(OUT, 'p', '%02d.png' % (i + 1)), optimize=True)
        sizes.append(im.size)
        if i == 0:
            cover = im
    print('картинки страниц:', len(sizes), sizes[0])
    return sizes, cover


def og(cover):                     # превью ссылки в мессенджерах, 1200×630
    im = Image.new('RGB', (1200, 630), '#EEF3F8')
    c = cover.copy()
    c.thumbnail((420, 580), Image.LANCZOS)
    sh = Image.new('RGB', (c.width + 16, c.height + 16), '#C9D6E4')
    im.paste(sh, (52, 33))
    im.paste(c, (44, 25))
    dr = ImageDraw.Draw(im)
    f = lambda s, b=False: ImageFont.truetype(FONT % ('-Bold' if b else ''), s)
    x = 44 + c.width + 56
    dr.text((x, 70), 'ГАУЗ ОЗП ГКБ № 8 · ПСО', font=f(27, True), fill='#1F5F99')
    y = 130
    for line in ('Реабилитация', 'и уход', 'после инсульта'):
        dr.text((x, y), line, font=f(62, True), fill='#1B2A41')
        y += 74
    dr.text((x, y + 22), 'Памятка для пациента', font=f(32), fill='#111111')
    dr.text((x, y + 62), 'и родственников — 32 страницы', font=f(32), fill='#111111')
    dr.rounded_rectangle((x, y + 130, x + 330, y + 196), 18, fill='#2A7FD4')
    dr.text((x + 30, y + 146), 'Читать онлайн', font=f(32, True), fill='#FFFFFF')
    im.save(os.path.join(OUT, 'og.jpg'), quality=86, optimize=True, progressive=True)


def icon():                        # значок для экрана «Домой»: белый крест на синем, как в шапке памятки
    s = 180
    im = Image.new('RGB', (s, s), '#2A7FD4')
    dr = ImageDraw.Draw(im)
    a, b = s * 0.2, s * 0.4
    dr.rectangle((b, a, s - b, s - a), fill='#FFFFFF')
    dr.rectangle((a, b, s - a, s - b), fill='#FFFFFF')
    im.save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)


def page_html(sizes):
    toc = ''.join('<h3>%s</h3><ol>%s</ol>' % (html.escape(g), ''.join(
        '<li><a href="#s%d"><span class="n">стр. %d</span><span>%s</span></a></li>' % (n, n, html.escape(t)) for n, t in items))
        for g, items in TOC)
    figs = ''.join(
        '<figure class="pg" id="s%d"><img src="p/%02d.png" width="%d" height="%d" alt="Страница %d. %s"%s decoding="async">'
        '<figcaption><span>Страница %d · %s</span><a href="#toc">к содержанию ↑</a></figcaption></figure>\n'
        % (n, n, w, h, n, html.escape(TITLES[n]), '' if n <= 2 else ' loading="lazy"', n, html.escape(TITLES[n]))
        for n, (w, h) in enumerate(sizes, 1))
    mb = ('%.1f' % (os.path.getsize(os.path.join(OUT, PDF)) / 2**20)).replace('.', ',')
    t = open(os.path.join(OUT, 'tools', 'page.html'), encoding='utf-8').read()
    t = t.replace('{{URL}}', URL).replace('{{PDF}}', PDF).replace('{{MB}}', mb).replace('{{TOC}}', toc).replace('{{PAGES}}', figs)
    open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(t)
    print('index.html готов')


d = web_pdf()
sizes, cover = pages(d)
og(cover)
icon()
page_html(sizes)
