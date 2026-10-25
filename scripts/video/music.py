"""Background bed for the demo: subtle, instrumental, generated with ElevenLabs Music."""
from el import call
audio = call("/v1/music", {
    "prompt": "Subtle, minimal background music for a calm tech product demo video. Soft warm synth pads, gentle plucked "
              "arpeggio, light brushed percussion, steady and optimistic, unobtrusive under a voiceover, no build-ups, "
              "no drops, no vocals, consistent energy throughout, clean ending.",
    "music_length_ms": 152000,
    "force_instrumental": True,
}, query="?output_format=mp3_44100_192")
open("music.mp3", "wb").write(audio)
print("music.mp3", len(audio) // 1024, "KB")
