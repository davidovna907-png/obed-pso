#!/usr/bin/env python3
# Приложение «Памятки РЕАБИТ» (по просьбе пользователя 12.11.2026: «папку с памятками на телефоне, чтобы открывалась без интернета»).
# Памятки лежат в закрытом репозитории РЕАБИТ, поэтому на сайт они попадают только зашифрованными:
#   ключ — PBKDF2-SHA256 из пароля (соль и число повторов — в key.json, они не секретны), шифр — AES-256-GCM;
#   files/<имя>.bin — PDF и обложки, data.bin — каталог (разделы, названия, файлы). Без пароля прочитать нельзя.
#   Шифрование детерминированное: одинаковый файл даёт то же имя и тот же шифр, поэтому при обновлении меняются
#   только изменённые памятки (вектор и имя — HMAC от содержимого второй половиной ключа).
# Пароль НЕ хранится ни в одном репозитории: его знает пользователь. Каталог — REABIT/prilozhenie/katalog.json.
# Запуск: REABIT_PASSWORD='…' python3 reabit/tools/build.py путь/к/REABIT
import base64, hashlib, hmac, io, json, os, re, sys, time, unicodedata
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag
import pymupdf
from PIL import Image

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))     # папка reabit/
SRC = sys.argv[1]
PW = os.environ.get('REABIT_PASSWORD', '')
if not PW:
    sys.exit('Нужен пароль: REABIT_PASSWORD=… (пароль знает пользователь, в репозитории его нет)')


def norm(p):
    """Как norm() в index.html: без разницы регистр, «ё/е», пробелы, дефисы и тире (iPhone сам меняет «--» на «—»)."""
    p = unicodedata.normalize('NFC', p).lower().replace('ё', 'е')
    return re.sub(r'[\s\-_.,\u2010-\u2015]+', '', p)


kpath = os.path.join(APP, 'key.json')
if os.path.exists(kpath):
    K = json.load(open(kpath))
else:
    K = {'salt': base64.b64encode(os.urandom(16)).decode(), 'iter': 600000}
    json.dump(K, open(kpath, 'w'))
dk = hashlib.pbkdf2_hmac('sha256', norm(PW).encode('utf-8'), base64.b64decode(K['salt']), K['iter'], dklen=64)
AES, MAC = AESGCM(dk[:32]), dk[32:]

dpath = os.path.join(APP, 'data.bin')
if os.path.exists(dpath):          # защита: другой пароль сделал бы приложение у пользователя нечитаемым
    raw = open(dpath, 'rb').read()
    try:
        AES.decrypt(raw[:12], raw[12:], None)
    except InvalidTag:
        sys.exit('Пароль не тот, которым зашифровано приложение. Ничего не изменено.')


def seal(data, kind):
    h = hmac.new(MAC, kind + data, hashlib.sha256).digest()
    return h[12:24].hex() + '.bin', h[:12] + AES.encrypt(h[:12], data, None)


os.makedirs(os.path.join(APP, 'files'), exist_ok=True)
used, total = set(), 0


def put(data, kind):
    global total
    name, blob = seal(data, kind)
    p = os.path.join(APP, 'files', name)
    if not os.path.exists(p):
        open(p, 'wb').write(blob)
    used.add(name)
    total += len(blob)
    return name


def cover(pdf):
    d = pymupdf.open(pdf)
    r = d[0].rect
    if r.width > r.height:              # буклет: на листе А4 две страницы, обложка — справа
        r = pymupdf.Rect(r.x0 + r.width / 2, r.y0, r.x1, r.y1)
    z = 300 / r.width
    pix = d[0].get_pixmap(matrix=pymupdf.Matrix(z, z), clip=r)
    buf = io.BytesIO()
    Image.frombytes('RGB', (pix.width, pix.height), pix.samples).save(buf, 'JPEG', quality=80, optimize=True)
    return buf.getvalue()


cat = json.load(open(os.path.join(SRC, 'prilozhenie', 'katalog.json'), encoding='utf-8'))
nfiles = 0
for sec in cat['sections']:
    for it in sec['items']:
        rows = it.get('rows', [])
        files = [f for r in rows for f in r['files']] + it.get('stand', [])
        # обложка — первая страница той памятки, что открывается по нажатию на обложку: первый ряд не-буклет (как в index.html)
        crow = next((r for r in rows if r.get('hint') != 'b4'), rows[0] if rows else None)
        first = os.path.join(SRC, (crow['files'][0] if crow else files[0])['path'])
        for f in files:
            data = open(os.path.join(SRC, f['path']), 'rb').read()
            f['f'], f['size'], f['name'] = put(data, b'pdf'), len(data), os.path.basename(f['path'])
            del f['path']
            nfiles += 1
        cov = cover(first)
        it['cover'], it['cs'] = put(cov, b'cover'), len(cov) + 28     # cs — размер зашифрованной обложки
cat['date'] = time.strftime('%d.%m.%Y')
blob = json.dumps(cat, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
iv = hmac.new(MAC, b'data' + blob, hashlib.sha256).digest()[:12]
new = iv + AES.encrypt(iv, blob, None)
if not os.path.exists(dpath) or open(dpath, 'rb').read() != new:
    open(dpath, 'wb').write(new)
gone = [n for n in os.listdir(os.path.join(APP, 'files')) if n.endswith('.bin') and n not in used]
for n in gone:
    os.remove(os.path.join(APP, 'files', n))
print('памяток: %d, файлов: %d, всего зашифровано %.1f МБ, удалено старых: %d'
      % (sum(len(s['items']) for s in cat['sections']), nfiles, total / 2**20, len(gone)))
