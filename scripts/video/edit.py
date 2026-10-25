"""Builds the demo video: title cards + recorded scenes, each synced to its voiceover."""
import html, json, os, subprocess, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "affinity-cart-demo.mp4")
W, H, FPS = 1440, 900, 30
segs = json.load(open(os.path.join(HERE, "script.json")))

CARD = """<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>
html,body{margin:0;width:1440px;height:900px;background:#fafaf7;color:#1a1830}
body{display:flex;flex-direction:column;justify-content:center;padding:0 140px;box-sizing:border-box}
.mark{width:64px;height:10px;background:#6a3df0;margin-bottom:44px}
h1{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:96px;line-height:.98;letter-spacing:-.035em;margin:0 0 28px;max-width:14ch}
p{font-family:'IBM Plex Sans',sans-serif;font-size:34px;line-height:1.35;color:#4a4760;margin:0;max-width:34ch;white-space:pre-line}
.brand{position:absolute;left:140px;bottom:70px;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:28px;color:#6a3df0}
</style></head><body><div class="mark"></div><h1>{title}</h1><p>{sub}</p><div class="brand">{brand}</div></body></html>"""


OVERLAY = """<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>
html,body{margin:0;width:1440px;height:900px;background:transparent}
.top{position:absolute;left:70px;top:70px;padding:34px 44px 38px;background:#fafaf7;border-radius:6px;box-shadow:0 18px 50px rgba(26,24,48,.28)}
.top .mark{width:54px;height:8px;background:#6a3df0;margin-bottom:22px}
.top h1{font:800 72px/1 'Bricolage Grotesque',sans-serif;letter-spacing:-.03em;color:#1a1830;margin:0 0 10px}
.top p{font:500 40px/1.2 'IBM Plex Sans',sans-serif;color:#6a3df0;margin:0}
.bottom{position:absolute;left:0;right:0;bottom:0;padding:30px 70px 34px;background:linear-gradient(90deg,#1a1830 0%,#2a1f63 100%);display:flex;align-items:baseline;gap:28px}
.bottom h1{font:800 54px/1 'Bricolage Grotesque',sans-serif;letter-spacing:-.02em;color:#fff;margin:0;white-space:nowrap}
.bottom p{font:500 28px/1.25 'IBM Plex Sans',sans-serif;color:#cfc3ff;margin:0}
</style></head><body><div class="{where}">{mark}<h1>{title}</h1><p>{sub}</p></div></body></html>"""


def run(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def cards():
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={"width": W, "height": H})
        for s in segs:
            ov = s.get("overlay")
            if ov:
                pg.set_content(OVERLAY.replace("{where}", ov["where"]).replace("{mark}", '<div class="mark"></div>' if ov["where"] == "top" else "")
                               .replace("{title}", html.escape(ov["title"])).replace("{sub}", html.escape(ov["sub"])))
                pg.wait_for_timeout(1200)
                pg.screenshot(path=os.path.join(HERE, f"{s['id']}-overlay.png"), omit_background=True)
            if s["kind"] != "card":
                continue
            brand = "" if s["title"] == "Affinity Cart" else "Affinity Cart"
            pg.set_content(CARD.replace("{title}", html.escape(s["title"])).replace("{sub}", html.escape(s["sub"])).replace("{brand}", brand))
            pg.wait_for_timeout(1200)  # fonts
            pg.screenshot(path=os.path.join(HERE, f"{s['id']}.png"))
        b.close()


def segment(s):
    out = os.path.join(HERE, f"seg-{s['id']}.mp4")
    audio = os.path.join(HERE, f"{s['id']}.wav")
    dur = s["dur"]
    if s["kind"] == "card":
        run("-loop", "1", "-framerate", str(FPS), "-i", os.path.join(HERE, f"{s['id']}.png"), "-i", audio,
            "-filter_complex", f"[0:v]fade=t=in:st=0:d=0.4,fade=t=out:st={dur - 0.4}:d=0.4,format=yuv420p[v];[1:a]apad[a]",
            "-map", "[v]", "-map", "[a]", "-t", str(dur), "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-c:a", "aac", "-b:a", "160k", out)
        return out
    m = json.load(open(os.path.join(HERE, f"{s['id']}.json")))
    # Keep [ready, end] minus the cuts (agent thinking, page reloads).
    keep, start = [], m["ready"]
    for a, b in sorted(m.get("cuts", [])):
        keep.append((start, a)); start = b
    keep.append((start, m["end"]))
    parts = "".join(f"[0:v]trim=start={a}:end={b},setpts=PTS-STARTPTS[p{i}];" for i, (a, b) in enumerate(keep))
    concat = "".join(f"[p{i}]" for i in range(len(keep))) + f"concat=n={len(keep)}:v=1:a=0[c];"
    length = sum(b - a for a, b in keep)
    # A scene longer than its line would leave dead air: play it a little faster instead.
    speed = min(1.6, length / dur) if length > dur + 0.3 else 1.0
    length /= speed
    total = max(length, dur)
    ov = s.get("overlay")
    inputs = ["-i", os.path.join(HERE, f"{s['id']}.webm"), "-i", audio]
    vf = (parts + concat +
          f"[c]setpts=PTS/{speed:.3f},tpad=stop_mode=clone:stop_duration={max(0, dur - length) + 0.1},fps={FPS},"
          f"fade=t=in:st=0:d=0.25,fade=t=out:st={total - 0.3}:d=0.3[base];")
    if ov:
        inputs += ["-loop", "1", "-i", os.path.join(HERE, f"{s['id']}-overlay.png")]
        vf += f"[2:v]format=rgba,fade=t=in:st=0.3:d=0.4:alpha=1,fade=t=out:st={total - 0.7}:d=0.4:alpha=1[ov];[base][ov]overlay=0:0:shortest=1[o];[o]format=yuv420p[v];"
    else:
        vf += "[base]format=yuv420p[v];"
    vf += "[1:a]apad[a]"
    run(*inputs, "-filter_complex", vf,
        "-map", "[v]", "-map", "[a]", "-t", f"{total:.2f}", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "160k", out)
    print(f"  {s['id']}: {total:.1f}s" + (f" (x{speed:.2f})" if speed > 1 else ""))
    return out


if __name__ == "__main__":
    cards()
    files = [segment(s) for s in segs]
    lst = os.path.join(HERE, "concat.txt")
    open(lst, "w").write("".join(f"file '{f}'\n" for f in files))
    joined = os.path.join(HERE, "joined.mp4")
    run("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", joined)
    music = os.path.join(HERE, "music.mp3")
    if os.path.exists(music):
        d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", joined]))
        mix = (f"[1:a]atrim=0:{d},volume=0.22,afade=t=in:st=0:d=1.5,afade=t=out:st={d - 3}:d=3[m];"
               "[0:a]asplit=2[vo][key];"
               "[m][key]sidechaincompress=threshold=0.03:ratio=5:attack=30:release=500[duck];"
               "[vo][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]")
        run("-i", joined, "-i", music, "-filter_complex", mix, "-map", "0:v", "-map", "[a]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", OUT)
    else:
        run("-i", joined, "-c", "copy", "-movflags", "+faststart", OUT)
    d = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT]).decode().strip()
    print(f"{OUT}  {float(d):.1f}s  {os.path.getsize(OUT) // 1024} KB")
