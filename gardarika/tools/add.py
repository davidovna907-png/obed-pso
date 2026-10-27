#!/usr/bin/env python3
"""Фильм «Гардарика 2026»: готовит присланные фото и видео для сайта и добавляет их в фильм.

Запуск из корня репозитория:
  python3 gardarika/tools/add.py [--title "подпись"] [--memory "текст"] [--mute] [--turn 90] --write файлы…

Что делает:
  • фото: разворачивает по EXIF, уменьшает до 2000 px (превью 800 px), сохраняет БЕЗ EXIF и геометок;
  • видео: MP4 H.264 до 1280 px (HDR с iPhone — в обычный цвет), без метаданных, с обложкой;
    звук видео кладёт рядом отдельным файлом photos/<id>.mp3 и ставит "sound": true —
    в фильме на это время музыка стихает (на iPhone звук видео играет из этого файла);
    --mute — видео без звука (музыка звучит как на фото);
  • дописывает кадры в JSON album-data в gardarika/index.html; порядок — по времени съёмки, если оно есть у всех кадров.
Без --write ничего не записывает, только показывает, что получится.
"""
import argparse
import datetime
import json
import os
import subprocess
import sys

from PIL import Image, ImageOps

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "kaliningrad", "album", "tools"))
import photo  # noqa: E402  общие функции фотоальбома «Калининград»: EXIF, видео, чтение и запись album-data

FILM = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def make_video(path, out_mp4, poster, thumb_path, write, mute=False, turn=0):
    """Как photo.make_video, но не тяжелее ~2,5 Мбит/с: иначе на мобильном интернете видео в фильме не успевает загрузиться."""
    dur, hdr, shot = photo.video_info(path)
    if not write:
        return dur, shot, 0, 0
    scale = f"scale='if(gt(iw,ih),{photo.VIDEO_MAX},-2)':'if(gt(iw,ih),-2,{photo.VIDEO_MAX})'"
    rot = {90: "transpose=2,", -90: "transpose=1,", 180: "hflip,vflip,"}.get(turn, "")
    vf = (photo.TONEMAP + "," if hdr else "") + rot + scale + ",format=yuv420p"
    audio = ["-an"] if mute else ["-map", "0:a:0?", "-c:a", "aac", "-b:a", "96k", "-ac", "2"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-map", "0:v:0", *audio, "-vf", vf,
                    "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-maxrate", "2.2M", "-bufsize", "4.4M", "-profile:v", "high",
                    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
                    "-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", out_mp4], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{min(0.6, dur / 3):.2f}", "-i", out_mp4, "-frames:v", "1", "-q:v", "3", poster], check=True)
    im = Image.open(poster).convert("RGB")
    w, h = im.size
    im.thumbnail((photo.THUMB, photo.THUMB), Image.LANCZOS)
    im.save(thumb_path, "JPEG", quality=photo.QUALITY, optimize=True, progressive=True)
    return dur, shot, w, h


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--title", help="подпись к кадру")
    ap.add_argument("--memory", help="история кадра словами пользователя")
    ap.add_argument("--mute", action="store_true", help="видео без звука")
    ap.add_argument("--turn", type=int, default=0, choices=[0, 90, -90, 180], help="довернуть видео")
    ap.add_argument("--write", action="store_true", help="сохранить и дописать в фильм")
    a = ap.parse_args()

    index = os.path.join(FILM, "index.html")
    photos_dir, thumbs_dir = os.path.join(FILM, "photos"), os.path.join(FILM, "photos", "t")
    if a.write:
        os.makedirs(thumbs_dir, exist_ok=True)
    html, m, data = photo.read_album(index)
    used = {p.get("id") for p in data.get("photos", [])}
    if os.path.isdir(photos_dir):
        used |= {os.path.splitext(f)[0] for f in os.listdir(photos_dir)}
    nums = [int(u[1:]) for u in used if u and u.startswith("g") and u[1:].isdigit()]
    k = max(nums, default=0)

    new = []
    for path in a.files:
        k += 1
        pid = f"g{k:03d}"
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
            im = im.convert("RGB")
            full = im.copy(); full.thumbnail((photo.FULL, photo.FULL), Image.LANCZOS)
            thumb = im.copy(); thumb.thumbnail((photo.THUMB, photo.THUMB), Image.LANCZOS)
            opts = dict(quality=photo.QUALITY, optimize=True, progressive=True)
            if icc:
                opts["icc_profile"] = icc  # цветовой профиль, без EXIF и геометок
            if a.write:
                full.save(os.path.join(photos_dir, pid + ".jpg"), "JPEG", **opts)
                thumb.save(os.path.join(thumbs_dir, pid + ".jpg"), "JPEG", **opts)
            e = {"id": pid, "src": f"photos/{pid}.jpg", "thumb": f"photos/t/{pid}.jpg", "w": full.width, "h": full.height}
        if a.title:
            e["title"] = a.title
        if shot:
            e["date"] = shot.date().isoformat()
            e["time"] = shot.strftime("%H:%M:%S")
        if a.memory:
            e["memory"] = a.memory
        new.append(e)
        print(f"{path} → {pid}" + (f", снято {shot:%d.%m.%Y %H:%M}" if shot else ", без даты съёмки"))

    if not a.write:
        print(json.dumps(new, ensure_ascii=False, indent=1))
        return
    data.setdefault("photos", []).extend(new)
    if all(p.get("date") and p.get("time") for p in data["photos"]):
        data["photos"].sort(key=lambda p: (p["date"], p["time"]))
    block = photo.dump(data)
    json.loads(block)  # проверка
    html = html[:m.start(2)] + "\n" + block + "\n" + html[m.end(2):]
    open(index, "w", encoding="utf-8").write(html)
    print(f"Добавлено в фильм: {len(new)}, всего кадров: {len(data['photos'])}")


if __name__ == "__main__":
    main()
