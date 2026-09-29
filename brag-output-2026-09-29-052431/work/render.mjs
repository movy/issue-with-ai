import { createRequire } from 'node:module'; const puppeteer = createRequire('/private/tmp/claude-503/-Volumes-Backup-home-IssueWithAI/7e365448-d966-4532-aefe-2dd24a847e1f/scratchpad/pp/')('puppeteer-core');
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const mode = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--allow-file-access-from-files', '--force-color-profile=srgb'] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.goto(pathToFileURL(new URL('./video.html', import.meta.url).pathname).href);
await page.evaluate(() => window.ready);
const grab = async t => Buffer.from((await page.evaluate(t => { renderFrame(t); return document.getElementById('c').toDataURL('image/png'); }, t)).split(',')[1], 'base64');
if (mode === 'stills') {
  mkdirSync('stills', { recursive: true });
  for (const t of process.argv.slice(3).map(Number)) writeFileSync(`stills/t${t.toFixed(2)}.png`, await grab(t));
} else {
  const fps = 30, dur = Number(process.argv[3] || 25), N = Math.round(fps * dur);
  const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', 'video-only.mp4'], { stdio: ['pipe', 'ignore', 'inherit'] });
  for (let f = 0; f < N; f++) {
    const buf = await grab(f / fps);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 60 === 0) console.log('frame', f, '/', N);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
}
await browser.close();
