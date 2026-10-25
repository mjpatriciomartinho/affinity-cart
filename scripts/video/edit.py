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


def run(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def cards():
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={"width": W, "height": H})
        for s in segs:
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
    total = max(length, dur)
    vf = (parts + concat +
          f"[c]tpad=stop_mode=clone:stop_duration={max(0, dur - length) + 0.1},fps={FPS},"
          f"fade=t=in:st=0:d=0.25,fade=t=out:st={total - 0.3}:d=0.3,format=yuv420p[v];[1:a]apad[a]")
    run("-i", os.path.join(HERE, f"{s['id']}.webm"), "-i", audio, "-filter_complex", vf,
        "-map", "[v]", "-map", "[a]", "-t", f"{total:.2f}", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "160k", out)
    return out


if __name__ == "__main__":
    cards()
    files = [segment(s) for s in segs]
    lst = os.path.join(HERE, "concat.txt")
    open(lst, "w").write("".join(f"file '{f}'\n" for f in files))
    run("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", "-movflags", "+faststart", OUT)
    d = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT]).decode().strip()
    print(f"{OUT}  {float(d):.1f}s  {os.path.getsize(OUT) // 1024} KB")
