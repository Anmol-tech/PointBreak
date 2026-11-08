// Records real footage of VendorVault for the demo video.
// Needs a running copy of the app (default: gateway :8100, vendor runtime :9101, simulated logins)
// and, for the sign-in stills, the real app on :8000. Writes public/footage/*.mp4, stills and marks.json.
//
//   node scripts/record.mjs
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs';
import { join } from 'node:path';

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8100';
const PORTAL = process.env.PORTAL ?? 'http://localhost:9101';
const LIVE = process.env.LIVE ?? 'http://localhost:8000';
const OUT = join(process.cwd(), 'public', 'footage');
const SIZE = { width: 1920, height: 1080 };
const marks = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, method = 'GET') => (await fetch(`${GATEWAY}${path}`, { method })).json();

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  // Use the Mac's GPU (Metal); software rendering only managed ~5 fps of the 3D world.
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});

/** Record one scene into public/footage/<name>.mp4 using Chrome's screencast frames and the system ffmpeg. */
async function scene(name, fn) {
  const dir = join(OUT, `tmp-${name}`);
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: SIZE, colorScheme: 'dark' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {}); // ack first so Chrome sends the next frame sooner
    const file = join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    frames.push({ file, t: metadata.timestamp });
    writeFile(file, Buffer.from(data, 'base64'), () => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 });
  const start = Date.now();
  const t0 = start / 1000;
  marks[name] = {};
  const mark = (label) => { marks[name][label] = (Date.now() - start) / 1000; console.log(`  ${name}: ${label} @ ${marks[name][label].toFixed(1)}s`); };
  console.log(`recording ${name}`);
  await fn(page, mark);
  mark('end');
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast').catch(() => {});
  await context.close();
  await sleep(500); // let the last frame writes finish
  // Frames only arrive when the screen changes, so each frame lasts until the next one.
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const from = i === 0 ? t0 : f.t;
    const to = i + 1 < frames.length ? frames[i + 1].t : end;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, to - from).toFixed(3)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file}'`);
  writeFileSync(join(dir, 'list.txt'), lines.join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
    '-vf', `fps=30,scale=${SIZE.width}:${SIZE.height}:force_original_aspect_ratio=decrease,pad=${SIZE.width}:${SIZE.height}:(ow-iw)/2:(oh-ih)/2`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', join(OUT, `${name}.mp4`)]);
  rmSync(dir, { recursive: true, force: true });
  console.log(`  ${name}.mp4: ${frames.length} frames`);
}

async function waitFor(check, timeoutMs, everyMs = 500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(everyMs);
  }
  throw new Error('timed out');
}

// --- stills: the real sign-in screen and Cognito's hosted login page (no credentials entered) ---
{
  const context = await browser.newContext({ viewport: SIZE, colorScheme: 'dark' });
  const page = await context.newPage();
  try {
    await page.goto(LIVE, { waitUntil: 'networkidle' });
    await page.screenshot({ path: join(OUT, 'signin.png') });
    await page.getByText('Sign in with Falcon SSO').click();
    await page.waitForURL(/amazoncognito\.com/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: join(OUT, 'cognito.png') });
    console.log('stills: signin.png, cognito.png');
  } catch (e) {
    console.log('stills skipped:', e.message);
  }
  await context.close();
}

await api('/api/reset', 'POST');

// --- 1. the AI agent team, with a helper stopped mid-task ---
await scene('team', async (page, mark) => {
  await page.goto(GATEWAY, { waitUntil: 'load' });
  await sleep(4000); // let the 3D world load
  mark('ready');
  await page.getByRole('button', { name: /AI agent team/ }).click();
  mark('started');
  await waitFor(async () => (await page.locator('.fp-team-agents li').count()) >= 3, 90000);
  mark('helpers');
  await sleep(1500);
  const rows = page.locator('.fp-team-agents li', { hasText: 'helper' });
  const target = (await rows.filter({ hasText: 'contract' }).count()) ? rows.filter({ hasText: 'contract' }).first() : rows.first();
  const helper = (await target.locator('.fp-team-name').innerText()).replace('helper', '').trim();
  await sleep(4000); // let it get an answer first
  await target.getByRole('button', { name: 'Stop' }).click();
  mark('stopped');
  marks.team.helper = helper;
  await waitFor(async () => {
    const s = await api('/api/state');
    return s.events.some((e) => e.kind === 'call' && e.decision === 'denied' && e.agent?.endsWith(`:${helper}`));
  }, 90000);
  mark('blocked');
  await waitFor(async () => (await api('/api/state')).demo.running === null, 180000, 1000);
  mark('done');
  await sleep(1500);
  await page.getByText('Read the memo').click();
  await page.locator('.fp-memo p').evaluate((el) => el.scrollTo({ top: 0 }));
  mark('memo');
  await sleep(6000);
});

// --- 2. Falcon turns an MCP tool off and on for a vendor ---
await scene('tools', async (page, mark) => {
  await page.goto(GATEWAY, { waitUntil: 'load' });
  await sleep(3000);
  await page.locator('.fp-vendors button', { hasText: 'LexPartners' }).click();
  await page.locator('.fp-tool-toggles').scrollIntoViewIfNeeded();
  mark('card');
  await sleep(2500);
  await page.locator('.fp-tool-toggles label', { hasText: 'list_folders' }).click();
  mark('off');
  await sleep(3000);
  await page.locator('.fp-tool-toggles label', { hasText: 'list_folders' }).click();
  mark('on');
  await sleep(2000);
});

// --- 3. stolen credentials ---
await scene('stolen', async (page, mark) => {
  await page.goto(GATEWAY, { waitUntil: 'load' });
  await sleep(3000);
  await page.getByRole('button', { name: 'Stolen badge' }).click();
  mark('started');
  await waitFor(async () => (await api('/api/state')).demo.running === null, 30000);
  mark('done');
  await sleep(7000);
});

// --- 4. trace a leaked answer ---
await scene('trace', async (page, mark) => {
  const s = await api('/api/state');
  const answer = [...s.events].reverse().find((e) => e.kind === 'call' && e.decision === 'allowed' && e.answer);
  await page.goto(GATEWAY, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Trace a leak' }).click();
  await sleep(1500);
  mark('tab');
  await page.locator('#leaked-answer').fill(answer.answer.split('\n').slice(1, 3).join('\n'));
  mark('pasted');
  await sleep(1500);
  await page.getByRole('button', { name: 'Find the source' }).click();
  await page.locator('.trace-results').waitFor();
  mark('found');
  await sleep(4000);
});

// --- 5. the vendor's own portal: answers, never files ---
await scene('portal', async (page, mark) => {
  await page.goto(PORTAL, { waitUntil: 'load' });
  await sleep(2500);
  mark('ready');
  await page.getByRole('button', { name: 'Send question' }).click();
  await page.getByText('Your answer').waitFor({ timeout: 60000 });
  mark('answer');
  await sleep(3500);
  await page.getByText('Test a blocked document download').click();
  await page.getByRole('button', { name: 'Try downloading a contract' }).click();
  await page.getByText('Request blocked').waitFor({ timeout: 20000 });
  await page.getByText('Request blocked').scrollIntoViewIfNeeded();
  mark('blocked');
  await sleep(3500);
});

await browser.close();
writeFileSync(join(OUT, 'marks.json'), JSON.stringify(marks, null, 2));
console.log('done:', readdirSync(OUT).join(', '));
