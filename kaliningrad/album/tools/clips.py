"""Звук видео для фильма: для каждого видео со своим звуком ("sea": true или "sound": true)
делает рядом photos/<id>.mp3 (если его нет или видео новее).

Зачем: на iPhone фильм меняет кадры сам, без нажатия пальцем, а в таком случае телефон даёт видео
играть только без звука. Поэтому в фильме видео идёт без звука, а его прибой или звон рынды играет
музыкальный движок альбома (Web Audio) — ему звук разрешён нажатием «Смотреть фильм».

  python3 kaliningrad/album/tools/clips.py
"""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import photo  # noqa: E402

ALB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html, m, data = photo.read_album(os.path.join(ALB, "index.html"))
for p in data["photos"]:
    if p.get("type") != "video" or not (p.get("sea") or p.get("sound")):
        continue
    mp4 = os.path.join(ALB, p["src"].split("?")[0])
    mp3 = mp4[:-4] + ".mp3"
    if os.path.exists(mp3) and os.path.getmtime(mp3) >= os.path.getmtime(mp4):
        continue
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", mp4, "-vn", "-c:a", "libmp3lame", "-b:a", "112k", "-ac", "2",
                    "-map_metadata", "-1", mp3], check=True)
    print(p["id"], "→", os.path.basename(mp3), os.path.getsize(mp3) // 1024, "КБ")
