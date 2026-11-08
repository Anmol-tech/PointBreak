import voice from "./voice.json";

/** Fade between scenes, in frames. */
export const FADE_FRAMES = 12;

/** A scene lasts at least `min` seconds and always long enough for its voice line (0.3 s lead-in, 0.6 s tail). */
const fit = (min: number, line: number) => Math.max(min, line + 0.9);

export const SECONDS = {
  title: fit(4.5, voice.title),
  problem: fit(5.5, voice.problem),
  signin: fit(3.5, voice.signin),
  cognito: fit(3.5, voice.cognito),
  lead: fit(5, voice.lead),
  helpers: fit(6, voice.helpers),
  stop: fit(5, voice.stop),
  blocked: fit(5.5, voice.blocked),
  memo: fit(5, voice.memo),
  tools: fit(7.5, voice.tools),
  stolen: fit(7.5, voice.stolen),
  trace: fit(6, voice.trace),
  portal: fit(7, voice.portal),
  outro: fit(6, voice.outro),
};

export const frames = (seconds: number, fps: number) => Math.ceil(seconds * fps);

export const totalFrames = (fps: number) =>
  Object.values(SECONDS).reduce((sum, s) => sum + frames(s, fps), 0) - (Object.keys(SECONDS).length - 1) * FADE_FRAMES;

export const VOICE_DELAY = 0.3;
