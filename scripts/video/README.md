# Demo video

Recorded against the local Playground store (`npm run dev:wp` + `npm run dev:api`).

1. Voiceover: `script.json` holds the lines. Generate one WAV per scene (`say -v Samantha` for drafts) and write each scene's duration (`dur`, seconds) back into `script.json`.
2. `python record.py [scene ids]` records the browser scenes (Playwright) with timing marks.
3. `python edit.py out.mp4` renders the title cards and edits everything to the voiceover with ffmpeg.

Waits (the gift agent thinking, page reloads) are marked as cuts while recording and removed in the edit.
