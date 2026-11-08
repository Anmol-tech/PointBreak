# VendorVault demo video

A 92-second, 1080p demo built with [Remotion](https://www.remotion.dev) from real recordings of the app.

| Piece | Where | How it's made |
|---|---|---|
| Footage | `public/footage/` | `scripts/record.mjs` drives Chrome (GPU) against a running copy of the app and logs key moments to `marks.json` |
| Voiceover | `public/voice/`, `src/voice.json` | `scripts/voice_polly.py` (Amazon Polly, generative voice "Ruth"); `scripts/voice.mjs` is an offline macOS fallback. Lines: `scripts/lines.json` |
| Music | `public/music/bed.mp3` | `scripts/music.sh` (ffmpeg-generated, nothing to license) |
| Scenes | `src/DemoVideo.tsx`, `src/timeline.ts` | Captions, zooms and footage start times; scene lengths follow the voice lines |

## Render

```bash
npm i
npx remotion render VendorVaultDemo out/vendorvault-demo.mp4
```

Preview and edit in Studio: `npx remotion studio`.

## Re-record the footage

1. Start a copy of the app with simulated logins on spare ports (from the repo root):
   ```bash
   GATEWAY_URL=http://127.0.0.1:8100 PARTY_SIM_URL=http://127.0.0.1:9101 VV_COGNITO=off .venv/bin/python -m uvicorn party.proxy:app --port 9101 &
   GATEWAY_URL=http://127.0.0.1:8100 PARTY_SIM_URL=http://127.0.0.1:9101 VV_COGNITO=off .venv/bin/python -m uvicorn gateway.app:app --port 8100 &
   ```
   Load `.env` first if the AI team should use Bedrock. The sign-in stills come from the real app on :8000.
2. `node scripts/record.mjs`
3. Update the `footageStart` values in `src/DemoVideo.tsx` from the new `public/footage/marks.json`.

## Change the voice

Edit `scripts/lines.json`, then `../.venv/bin/python scripts/voice_polly.py` (or `VOICE=Matthew ...`), and render again.
