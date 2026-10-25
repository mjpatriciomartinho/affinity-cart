# Demo video

Recorded against the local Playground store (`npm run dev:wp` + `npm run dev:api`). Needs Playwright, ffmpeg and boto3.

1. `python voice.py` generates the voiceover with ElevenLabs (voice Matilda) for every line in `script.json` and writes each scene's duration back. The key is read from SSM at runtime.
2. `python music.py` generates the background bed (ElevenLabs Music, instrumental).
3. `python record.py [scene ids]` records the browser scenes with Playwright, paced to the voiceover, with timing marks.
4. `python edit.py out.mp4` renders overlays and the closing card, cuts the waits, speeds up scenes that run long, and mixes the music under the voice (ducked while she speaks).

Generated audio and video are not committed.
