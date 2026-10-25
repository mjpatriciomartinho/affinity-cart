"""ElevenLabs voiceover for every scene in script.json; writes <id>.wav and the duration back."""
import json, subprocess, sys
from el import call

VOICE = "XrExE9yKIg1WjnnlVkGX"  # Matilda: professional, upbeat
segs = json.load(open("script.json"))
only = set(sys.argv[1:])
prev = ""
for i, s in enumerate(segs):
    if not only or s["id"] in only:
        nxt = segs[i + 1]["vo"] if i + 1 < len(segs) else ""
        audio = call(f"/v1/text-to-speech/{VOICE}", {
            "text": s["vo"], "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.25, "use_speaker_boost": True},
            "previous_text": prev, "next_text": nxt,  # keeps intonation continuous across scenes
        }, query="?output_format=mp3_44100_192")
        open(f"{s['id']}.mp3", "wb").write(audio)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f"{s['id']}.mp3", "-ar", "48000", "-ac", "2", f"{s['id']}.wav"], check=True)
    d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f"{s['id']}.wav"]))
    s["dur"] = round(d + 0.6, 2)
    prev = s["vo"]
    print(f"{s['id']:12} {s['dur']:5.1f}s")
json.dump(segs, open("script.json", "w"), indent=1, ensure_ascii=False)
print("total", round(sum(s["dur"] for s in segs)), "s")
