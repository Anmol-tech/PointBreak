// Offline fallback: generates the voiceover with macOS text-to-speech and records each line's length.
// The main voiceover uses Amazon Polly (scripts/voice_polly.py). Lines live in scripts/lines.json.
// Writes public/voice/<scene>.mp3 and src/voice.json ({ scene: seconds }).
//
//   node scripts/voice.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VOICE = process.env.VOICE ?? 'Samantha';
const RATE = process.env.RATE ?? '178'; // words per minute

const LINES = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'lines.json'), 'utf8'));

const out = join(process.cwd(), 'public', 'voice');
mkdirSync(out, { recursive: true });
const lengths = {};
for (const [scene, text] of Object.entries(LINES)) {
  const aiff = join(out, `${scene}.aiff`);
  const wav = join(out, `${scene}.mp3`);
  execFileSync('say', ['-v', VOICE, '-r', RATE, '-o', aiff, text]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '160k', wav]);
  rmSync(aiff);
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString());
  lengths[scene] = Math.round(seconds * 100) / 100;
  console.log(`${scene.padEnd(8)} ${lengths[scene].toFixed(2)}s`);
}
writeFileSync(join(process.cwd(), 'src', 'voice.json'), JSON.stringify(lengths, null, 2) + '\n');
