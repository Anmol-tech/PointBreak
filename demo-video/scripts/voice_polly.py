"""Generates the voiceover with Amazon Polly (generative voices) and records each line's length.

Reads scripts/lines.json, writes public/voice/<scene>.mp3 and src/voice.json ({scene: seconds}).
Uses AWS credentials from the environment, or AWS_* values in the repo's .env (never printed).

Run from demo-video/ with the project's Python (it has boto3):
    ../.venv/bin/python scripts/voice_polly.py            # voice Ruth
    VOICE=Matthew ../.venv/bin/python scripts/voice_polly.py
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import boto3

HERE = Path.cwd()
ENV = HERE.parent / ".env"
VOICE = os.environ.get("VOICE", "Ruth")
ENGINE = os.environ.get("ENGINE", "generative")

if ENV.exists():  # same rules as scripts/setup_cognito.py: AWS_* only, the shell wins, the Bedrock key is skipped
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.removeprefix("export ").strip(), value.strip().strip("'\"")
        if key.startswith("AWS_") and key != "AWS_BEARER_TOKEN_BEDROCK" and value:
            os.environ.setdefault(key, value)

polly = boto3.client("polly", region_name=os.environ.get("AWS_REGION", "us-east-1"))
lines = json.loads((HERE / "scripts" / "lines.json").read_text())
out = HERE / "public" / "voice"
out.mkdir(parents=True, exist_ok=True)
lengths = {}
for scene, text in lines.items():
    raw, final = out / f"{scene}.polly.mp3", out / f"{scene}.mp3"
    audio = polly.synthesize_speech(Text=text, OutputFormat="mp3", VoiceId=VOICE, Engine=ENGINE, SampleRate="24000")
    raw.write_bytes(audio["AudioStream"].read())
    # Normalize to a standard narration loudness so every line sits at the same level over the music.
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                    "-ar", "48000", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "160k", str(final)], check=True)
    raw.unlink()
    seconds = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(final)],
                                   check=True, capture_output=True, text=True).stdout)
    lengths[scene] = round(seconds, 2)
    print(f"{scene:<8} {lengths[scene]:.2f}s")
(HERE / "src" / "voice.json").write_text(json.dumps(lengths, indent=2) + "\n")
print(f"voice: {VOICE} ({ENGINE})", file=sys.stderr)
