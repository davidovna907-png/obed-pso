#!/usr/bin/env python3
"""Фотоальбом «Калининград»: готовит присланные фото для сайта и добавляет их в альбом.

Запуск из корня репозитория:
  python3 kaliningrad/album/tools/photo.py --day 2 [--place tower] [--memory "текст"] [--title "подпись"] --write фото1.jpg фото2.jpg

Что делает:
  • разворачивает фото по EXIF и уменьшает: 2000 px по длинной стороне, превью 800 px;
  • сохраняет БЕЗ EXIF и геометок: kaliningrad/album/photos/<id>.jpg и photos/t/<id>.jpg;
  • день берёт из --day, иначе из даты съёмки (10–17.10.2026, 10.10 — день 0); город — ближайший к геометке (до 15 км);
  • --write сохраняет фото и дописывает их в JSON album-data в kaliningrad/album/index.html;
    без него ничего не записывает, только показывает, что получится.
  • видео (.mov, .mp4): переводит в MP4 (H.264, до 1280 px), HDR с iPhone — в обычный цвет,
    убирает геометку и данные телефона, делает обложку и превью; нужен ffmpeg.
--place, --memory и --title относятся ко всем фото этого запуска: для разных подписей запускайте по одному фото.
"""
import argparse
import datetime
import json
import math
import os
import re
import subprocess
import sys

from PIL import Image, ImageOps

try:  # фото с iPhone в формате HEIC
    from pillow_heif import register_heif_opener
    register_heif_opener()
except Exception:
    pass

TRIP_START = datetime.date(2026, 10, 11)  # день 1; день 0 — приезд 10.10 (extraDays в album-data)
TRIP_DAYS = 7
FULL, THUMB, QUALITY = 2000, 800, 82
# Города с карты путеводителя (kaliningrad/index.html, TOWNS)
TOWNS = {
    "kgd": (20.51, 54.71), "zel": (20.48, 54.96), "sha": (20.66, 54.855), "khr": (20.59, 54.89),
    "kos": (20.86, 55.18), "bal": (19.91, 54.65), "yan": (19.94, 54.87), "svg": (20.15, 54.94),
    "sov": (21.88, 55.08), "che": (21.81, 54.63), "pra": (21.01, 54.44), "zhe": (21.31, 54.36),
}
VIDEO_EXT = (".mov", ".mp4", ".m4v")
VIDEO_MAX = 1280  # длинная сторона видео
# HLG/PQ с iPhone → обычный цвет BT.709 (без этого видео в браузере выглядит выцветшим)
TONEMAP = ("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
           "tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p")
BLOCK = re.compile(r'(<script type="application/json" id="album-data">)(.*?)(</script>)', re.S)


def km(a, b):
    (lon1, lat1), (lon2, lat2) = a, b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def exif_info(im):
    """Дата съёмки и геометка из EXIF (если телефон их сохранил)."""
    shot, where = None, None
    try:
        ex = im.getexif()
        raw = ex.get_ifd(0x8769).get(36867) or ex.get(306)
        if raw:
            shot = datetime.datetime.strptime(str(raw).strip()[:19], "%Y:%m:%d %H:%M:%S")
        gps = ex.get_ifd(0x8825)
        if gps and 2 in gps and 4 in gps:
            deg = lambda v: float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
            lat = deg(gps[2]) * (-1 if gps.get(1) == "S" else 1)
            lon = deg(gps[4]) * (-1 if gps.get(3) == "W" else 1)
            where = (lon, lat)
    except Exception:
        pass
    return shot, where


def video_info(path):
    """Длительность, HDR и дата съёмки (местное время телефона) из метаданных видео."""
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
                         capture_output=True, text=True, check=True).stdout
    info = json.loads(out)
    v = next(st for st in info["streams"] if st.get("codec_type") == "video")
    tags = info.get("format", {}).get("tags", {})
    shot = None
    raw = tags.get("com.apple.quicktime.creationdate")
    if raw:
        shot = datetime.datetime.fromisoformat(raw[:19])
    hdr = v.get("color_transfer") in ("arib-std-b67", "smpte2084")
    return float(info["format"].get("duration", 0)), hdr, shot


def make_video(path, out_mp4, poster, thumb_path, write, mute=False):
    dur, hdr, shot = video_info(path)
    scale = f"scale='if(gt(iw,ih),{VIDEO_MAX},-2)':'if(gt(iw,ih),-2,{VIDEO_MAX})'"
    vf = (TONEMAP + "," if hdr else "") + scale + ",format=yuv420p"
    if write:
        # mute — без звука (голоса): в альбоме и фильме поверх видео звучит музыка
        audio = ["-an"] if mute else ["-map", "0:a:0?", "-c:a", "aac", "-b:a", "96k", "-ac", "2"]
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-map", "0:v:0", *audio, "-vf", vf,
                        "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-profile:v", "high",
                        "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
                        "-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", out_mp4], check=True)
        t = min(0.6, dur / 3)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", out_mp4, "-frames:v", "1", "-q:v", "3", poster], check=True)
        im = Image.open(poster).convert("RGB")
        w, h = im.size
        im.thumbnail((THUMB, THUMB), Image.LANCZOS)
        im.save(thumb_path, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    else:
        w, h = 0, 0
    return dur, shot, w, h


def nearest_town(where):
    if not where:
        return None
    k, d = min(((k, km(where, t)) for k, t in TOWNS.items()), key=lambda x: x[1])
    return k if d <= 15 else None


def read_album(index):
    html = open(index, encoding="utf-8").read()
    m = BLOCK.search(html)
    if not m:
        sys.exit("Не найден блок album-data в " + index)
    return html, m, json.loads(m.group(2))


def dump(data):
    """JSON альбома: каждое фото одной строкой, чтобы правки было легко читать."""
    out = ["{"]
    keys = list(data)
    for i, k in enumerate(keys):
        comma = "," if i < len(keys) - 1 else ""
        if k == "photos":
            items = [" " + json.dumps(p, ensure_ascii=False) for p in data[k]]
            out.append(' "photos": [\n' + ",\n".join(items) + ("\n" if items else "") + " ]" + comma)
        else:
            out.append(" %s: %s%s" % (json.dumps(k, ensure_ascii=False), json.dumps(data[k], ensure_ascii=False), comma))
    out.append("}")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--day", type=int, help="день поездки: 0 — приезд 10.10, 1–7 — дни программы")
    ap.add_argument("--place", help="id места из путеводителя, например korol, tower, kosa")
    ap.add_argument("--town", help="ключ города, если места нет: kgd, zel, kos, bal, yan, svg, sov, che, pra, zhe")
    ap.add_argument("--title", help="своя подпись к кадру")
    ap.add_argument("--memory", help="история кадра словами пользователя")
    ap.add_argument("--write", action="store_true", help="дописать в album-data")
    ap.add_argument("--mute", action="store_true", help="видео без звука (убрать голоса)")
    ap.add_argument("--album", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))), help="папка альбома")
    a = ap.parse_args()

    index = os.path.join(a.album, "index.html")
    photos_dir, thumbs_dir = os.path.join(a.album, "photos"), os.path.join(a.album, "photos", "t")
    if a.write:
        os.makedirs(thumbs_dir, exist_ok=True)
    html, m, data = read_album(index)
    used = {p.get("id") for p in data.get("photos", [])}
    if os.path.isdir(photos_dir):
        used |= {os.path.splitext(f)[0] for f in os.listdir(photos_dir) if f.endswith(".jpg")}

    new = []
    for path in a.files:
        is_video = path.lower().endswith(VIDEO_EXT)
        if is_video:
            im, where = None, None
            shot = video_info(path)[2]
        else:
            im = Image.open(path)
            shot, where = exif_info(im)
        day = a.day
        if day is None and shot:
            n = (shot.date() - TRIP_START).days + 1
            day = n if 0 <= n <= TRIP_DAYS else None
        if day is None:
            sys.exit(f"{path}: не понятно, к какому дню поездки относится фото, укажите --day")
        k = 1
        while f"d{day}-{k:02d}" in used:
            k += 1
        pid = f"d{day}-{k:02d}"
        used.add(pid)

        if is_video:
            dur, shot, vw, vh = make_video(path, os.path.join(photos_dir, pid + ".mp4"), os.path.join(photos_dir, pid + ".jpg"),
                                           os.path.join(thumbs_dir, pid + ".jpg"), a.write, a.mute)
            e = {"id": pid, "day": day, "type": "video", "src": f"photos/{pid}.mp4", "poster": f"photos/{pid}.jpg",
                 "thumb": f"photos/t/{pid}.jpg", "w": vw, "h": vh, "dur": round(dur, 1)}
            if a.mute:
                e["muted"] = True
            for k_, v_ in (("place", a.place), ("town", a.town), ("title", a.title)):
                if v_:
                    e[k_] = v_
            e["date"] = shot.date().isoformat() if shot else (TRIP_START + datetime.timedelta(days=day - 1)).isoformat()
            if shot:
                e["time"] = shot.strftime("%H:%M")
            if a.memory:
                e["memory"] = a.memory
            new.append(e)
            print(f"{path} → {pid}.mp4 ({vw}×{vh}, {dur:.1f} с), день {day}" + (f", снято {shot:%d.%m %H:%M}" if shot else ""))
            continue

        im = ImageOps.exif_transpose(im)
        icc = im.info.get("icc_profile")
        im = im.convert("RGB")
        full = im.copy()
        full.thumbnail((FULL, FULL), Image.LANCZOS)
        thumb = im.copy()
        thumb.thumbnail((THUMB, THUMB), Image.LANCZOS)
        opts = dict(quality=QUALITY, optimize=True, progressive=True)
        if icc:
            opts["icc_profile"] = icc  # цветовой профиль, без EXIF и геометок
        if a.write:
            full.save(os.path.join(photos_dir, pid + ".jpg"), "JPEG", **opts)
            thumb.save(os.path.join(thumbs_dir, pid + ".jpg"), "JPEG", **opts)

        e = {"id": pid, "day": day, "src": f"photos/{pid}.jpg", "thumb": f"photos/t/{pid}.jpg", "w": full.width, "h": full.height}
        if a.place:
            e["place"] = a.place
        town = a.town or (None if a.place else nearest_town(where))
        if town:
            e["town"] = town
        if a.title:
            e["title"] = a.title
        e["date"] = shot.date().isoformat() if shot else (TRIP_START + datetime.timedelta(days=day - 1)).isoformat()
        if shot:
            e["time"] = shot.strftime("%H:%M")
        if a.memory:
            e["memory"] = a.memory
        new.append(e)
        print(f"{path} → {pid} ({full.width}×{full.height}), день {day}"
              + (f", снято {shot:%d.%m %H:%M}" if shot else ", без даты съёмки")
              + (f", геометка → {town}" if where and town and not a.town else ""))

    if not a.write:
        print(json.dumps(new, ensure_ascii=False, indent=1))
        return
    data.setdefault("photos", []).extend(new)
    # по дням; внутри дня — по времени съёмки, только если оно известно у всех кадров дня,
    # иначе порядок из JSON (новые — в конец дня)
    timed = {d for d in {p.get("day", 0) for p in data["photos"]}
             if all(p.get("time") for p in data["photos"] if p.get("day", 0) == d)}
    data["photos"].sort(key=lambda p: (p.get("day", 0), p.get("time") if p.get("day", 0) in timed else ""))
    block = dump(data)
    json.loads(block)  # проверка
    html = html[:m.start(2)] + "\n" + block + "\n" + html[m.end(2):]
    open(index, "w", encoding="utf-8").write(html)
    print(f"Добавлено в альбом: {len(new)}, всего фото: {len(data['photos'])}")


if __name__ == "__main__":
    main()
