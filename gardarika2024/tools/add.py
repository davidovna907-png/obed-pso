#!/usr/bin/env python3
"""Газета «Гардарика 2024»: готовит присланные фото и видео для сайта и ставит их в газету и кинохронику.

Запуск из корня репозитория:
  python3 gardarika2024/tools/add.py --sec guns [--cap "подпись"] [--blur 0.04,0.46,0.05] [--after n012] --write файлы…

Что делает:
  • фото: разворачивает по EXIF, уменьшает до 2000 px (превью 800 px), сохраняет БЕЗ EXIF и геометок;
  • --blur X,Y,R — размыть круг с центром X,Y (доли ширины и высоты) и радиусом R (доля ширины):
    лица детей и случайных людей (газета открыта всем, у кого есть ссылка); можно несколько раз;
  • видео: MP4 H.264 до 1280 px, без метаданных, с обложкой; звук — рядом в photos/<id>.mp3 ("sound": true);
  • дописывает снимки в JSON album-data в gardarika2024/index.html: полоса газеты — --sec (id из "sections"),
    подпись — --cap; в конец полосы, а с --after ID — сразу после этого снимка.
Без --write ничего не записывает, только показывает, что получится.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageOps

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(TOOLS, "..", "..", "kaliningrad", "album", "tools"))
import photo  # noqa: E402  общие функции фотоальбома «Калининград»: EXIF, чтение и запись album-data

# видео — как в фильме «Гардарика 2026» (не тяжелее ~2,5 Мбит/с); файл тоже называется add.py, поэтому грузим по пути
_spec = importlib.util.spec_from_file_location("gard2026_add", os.path.join(TOOLS, "..", "..", "gardarika", "tools", "add.py"))
_gard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gard)
make_video = _gard.make_video

PAPER = os.path.dirname(TOOLS)


def blur(im, spots):
    """Размывает круги (лица): сильное размытие, края круга мягкие."""
    if not spots:
        return im
    soft = im.filter(ImageFilter.GaussianBlur(max(12, im.width // 60)))
    mask = Image.new("L", im.size, 0)
    d = ImageDraw.Draw(mask)
    for x, y, r in spots:
        cx, cy, rr = x * im.width, y * im.height, r * im.width
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(max(4, im.width // 200)))
    return Image.composite(soft, im, mask)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--sec", required=True, help="полоса газеты (id из sections в album-data)")
    ap.add_argument("--cap", help="подпись под снимком")
    ap.add_argument("--blur", action="append", default=[], help="X,Y,R — размыть круг (доли кадра)")
    ap.add_argument("--mute", action="store_true", help="видео без звука")
    ap.add_argument("--turn", type=int, default=0, choices=[0, 90, -90, 180], help="довернуть видео")
    ap.add_argument("--after", help="вставить после снимка с этим id (например n012)")
    ap.add_argument("--write", action="store_true", help="сохранить и дописать в газету")
    a = ap.parse_args()

    index = os.path.join(PAPER, "index.html")
    photos_dir, thumbs_dir = os.path.join(PAPER, "photos"), os.path.join(PAPER, "photos", "t")
    if a.write:
        os.makedirs(thumbs_dir, exist_ok=True)
    html, m, data = photo.read_album(index)
    secs = [s.get("id") for s in data.get("sections", [])]
    if a.sec not in secs:
        sys.exit(f"Нет полосы {a.sec}; есть: {', '.join(secs)}")
    photos = data.setdefault("photos", [])
    ids = [p.get("id") for p in photos]
    if a.after and a.after not in ids:
        sys.exit(f"Нет снимка {a.after} в газете")
    spots = [tuple(float(v) for v in s.split(",")) for s in a.blur]
    used = set(ids)
    if os.path.isdir(photos_dir):
        used |= {os.path.splitext(f)[0] for f in os.listdir(photos_dir)}
    k = max((int(u[1:]) for u in used if u and u.startswith("n") and u[1:].isdigit()), default=0)

    new = []
    for path in a.files:
        k += 1
        pid = f"n{k:03d}"
        if path.lower().endswith(photo.VIDEO_EXT):
            mp4 = os.path.join(photos_dir, pid + ".mp4")
            dur, shot, vw, vh = make_video(path, mp4, os.path.join(photos_dir, pid + ".jpg"),
                                           os.path.join(thumbs_dir, pid + ".jpg"), a.write, a.mute, a.turn)
            e = {"id": pid, "type": "video", "src": f"photos/{pid}.mp4", "poster": f"photos/{pid}.jpg",
                 "thumb": f"photos/t/{pid}.jpg", "w": vw, "h": vh, "dur": round(dur, 1)}
            if a.write and not a.mute:
                has_audio = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                                            "-of", "csv=p=0", mp4], capture_output=True, text=True).stdout.strip()
                if has_audio:
                    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", mp4, "-vn", "-c:a", "libmp3lame", "-b:a", "112k",
                                    "-ac", "2", "-map_metadata", "-1", mp4[:-4] + ".mp3"], check=True)
                    e["sound"] = True
        else:
            im = Image.open(path)
            shot = photo.exif_info(im)[0]
            im = ImageOps.exif_transpose(im)
            icc = im.info.get("icc_profile")
            im = blur(im.convert("RGB"), spots)
            full = im.copy(); full.thumbnail((photo.FULL, photo.FULL), Image.LANCZOS)
            thumb = im.copy(); thumb.thumbnail((photo.THUMB, photo.THUMB), Image.LANCZOS)
            opts = dict(quality=photo.QUALITY, optimize=True, progressive=True)
            if icc:
                opts["icc_profile"] = icc  # цветовой профиль, без EXIF и геометок
            if a.write:
                full.save(os.path.join(photos_dir, pid + ".jpg"), "JPEG", **opts)
                thumb.save(os.path.join(thumbs_dir, pid + ".jpg"), "JPEG", **opts)
            e = {"id": pid, "src": f"photos/{pid}.jpg", "thumb": f"photos/t/{pid}.jpg", "w": full.width, "h": full.height}
            # чёрно-белый снимок (так снят или обработан в телефоне) — в газете и хронике остаётся чёрно-белым
            small = im.copy(); small.thumbnail((200, 200))
            px = small.tobytes()
            if max(max(abs(px[j] - px[j + 1]), abs(px[j + 1] - px[j + 2]), abs(px[j] - px[j + 2])) for j in range(0, len(px), 3)) < 24:
                e["bw"] = True
        e["sec"] = a.sec
        if a.cap:
            e["cap"] = a.cap
        if shot:
            e["date"] = shot.date().isoformat()
            e["time"] = shot.strftime("%H:%M:%S")
        new.append(e)
        print(f"{path} → {pid}" + (f", снято {shot:%d.%m.%Y %H:%M}" if shot else ", без даты съёмки"))

    if not a.write:
        print(json.dumps(new, ensure_ascii=False, indent=1))
        return
    if a.after:
        i = ids.index(a.after) + 1
    else:  # в конец своей полосы
        last = [j for j, p in enumerate(photos) if p.get("sec") == a.sec]
        i = last[-1] + 1 if last else len(photos)
    photos[i:i] = new
    block = photo.dump(data)
    json.loads(block)  # проверка
    html = html[:m.start(2)] + "\n" + block + "\n" + html[m.end(2):]
    open(index, "w", encoding="utf-8").write(html)
    print(f"Добавлено в газету: {len(new)}, всего снимков: {len(photos)}")


if __name__ == "__main__":
    main()
