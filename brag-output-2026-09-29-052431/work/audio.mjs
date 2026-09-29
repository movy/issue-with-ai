// Synthesizes the soundtrack: 120 BPM, A minor, bar downbeats at 1, 3, 5 … s.
// Music and SFX are written together so every hit lands on the video's events.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
require('./data.js'); require('./timeline.js');
const TL = globalThis.TL;
const SR = 44100, DUR = TL.total, N = Math.round(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);        // dry bus
const RL = new Float32Array(N), RR = new Float32Array(N);      // reverb send
const PADL = new Float32Array(N), PADR = new Float32Array(N);  // ducked bus (pad, bass)
const BEAT = .5, BAR = 2;
const midi = m => 440 * Math.pow(2, (m - 69) / 12);
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

function add(bus, t, fn, dur, gain = 1, pan = 0, send = 0) {
  const [bl, br] = bus;
  const s0 = Math.floor(t * SR), n = Math.floor(dur * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, gr = gain * Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
  for (let i = 0; i < n; i++) {
    const k = s0 + i; if (k < 0 || k >= N) continue;
    const v = fn(i / SR);
    bl[k] += v * gl; br[k] += v * gr;
    if (send) { RL[k] += v * gl * send; RR[k] += v * gr * send; }
  }
}
const DRY = [L, R], PAD = [PADL, PADR];

// ---------- instruments ----------
const kick = (t, g = 1) => add(DRY, t, x => { const f = 45 + 110 * Math.exp(-x * 28); return Math.sin(2 * Math.PI * (45 * x + (110 / 28) * (1 - Math.exp(-x * 28)))) * Math.exp(-x * 7) * (x < .003 ? x / .003 : 1); }, .45, .9 * g);
function noiseHit(t, dur, decay, hp, g, pan = 0, send = .1) {
  let prev = 0, lp = 0;
  add(DRY, t, x => { const w = rnd(); const h = w - prev; prev = w; lp += (h - lp) * hp; return lp * Math.exp(-x * decay); }, dur, g, pan, send);
}
const hat = (t, g = .12, pan = .25) => noiseHit(t, .06, 70, .9, g, pan, .02);
const clap = (t, g = .35) => { for (const o of [0, .011, .022]) noiseHit(t + o, .22, 18, .35, g * (o ? .5 : 1), 0, .35); };
function pluck(t, m, g = .25, pan = 0, send = .35, dur = .5) {
  const f = midi(m);
  add(DRY, t, x => { const e = Math.exp(-x * 9) * Math.min(1, x / .002); let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * x) * Math.exp(-x * h * 5) / h; return v * e * .6; }, dur, g, pan, send);
}
function padChord(t, notes, dur, g = .08) {
  for (const m of notes) for (const [det, pan] of [[-.12, -.6], [.12, .6]]) {
    const f = midi(m + det / 12 * 1);
    add(PAD, t, x => { const a = Math.min(1, x / .25) * Math.min(1, (dur - x) / .35); let v = 0; for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f * h * x + h) / (h * h); return v * a; }, dur, g, pan, .5);
  }
}
function bass(t, m, dur, g = .32) {
  const f = midi(m);
  add(PAD, t, x => { const a = Math.min(1, x / .006) * Math.exp(-x * 3) * Math.min(1, (dur - x) / .02); return (Math.sin(2 * Math.PI * f * x) + .35 * Math.sin(4 * Math.PI * f * x) + .12 * Math.tanh(4 * Math.sin(2 * Math.PI * f * x))) * a; }, dur, g);
}
function boom(t, g = 1) {          // sub drop + noise body for explosions
  add(DRY, t, x => Math.sin(2 * Math.PI * (33 * x + 60 / 6 * (1 - Math.exp(-x * 6)))) * Math.exp(-x * 2.2) * Math.min(1, x / .004), 1.8, .95 * g, 0, .2);
  noiseHit(t, .9, 5, .12, .45 * g, 0, .5);
  kick(t, 1.1 * g);
}
function riser(t, dur, g = .18) {  // filtered noise + gliding tone
  let lp = 0;
  add(DRY, t, x => { const p = x / dur; lp += (rnd() - lp) * (.02 + .5 * p * p); return lp * p * p; }, dur, g * 1.4, 0, .3);
  add(DRY, t, x => { const p = x / dur; return Math.sin(2 * Math.PI * (220 * x + 220 * p * p * dur / 1.5)) * p * p * .5; }, dur, g * .5, 0, .4);
}
function whoosh(t, dur = .7, g = .22) {
  let lp = 0, prev = 0;
  add(DRY, t - dur / 2, x => { const p = x / dur, c = .03 + .5 * Math.sin(Math.PI * p) ** 2; const w = rnd(); lp += (w - lp) * c; const out = lp - prev * .6; prev = lp; return out * Math.sin(Math.PI * p) ** 2; }, dur, g, 0, .4);
}

// ---------- arrangement (driven by the shared timeline) ----------
const CH_A = [[57, 60, 64, 71], [53, 57, 60, 67], [48, 55, 60, 64], [55, 59, 62, 67]]; // Am9 F C G
const RT_A = [45, 41, 48, 43];
const CH_B = [[53, 57, 60, 64], [55, 59, 62, 67], [57, 60, 64, 67], [52, 55, 59, 64]]; // Fmaj7 G Am7 Em
const RT_B = [41, 43, 45, 40];
const kicks = [], ducks = [];
const sc = type => TL.scenes.filter(s => s.type === type);
const scene = (type, repo) => TL.scenes.find(s => s.type === type && (!repo || s.repo === repo));

// groove between a and b; style: full | light | half | pulse
function groove(a, b, style, chords, roots, melody) {
  for (let t = a; t < b - 1e-6; t += BAR) {
    const bar = Math.round(t / BAR), c = ((bar % 4) + 4) % 4, len = Math.min(BAR, b - t);
    padChord(t, chords[c], len, style === 'pulse' ? .055 : .06);
    for (let k = 0; k < 4; k++) {
      const bt = t + k * BEAT; if (bt >= b - 1e-6) break;
      const fill = (bar % 8 === 7) && k === 3;
      if (style === 'full' || style === 'light') {
        kick(bt, style === 'light' ? .75 : .95); kicks.push(bt);
        if (k % 2) clap(bt, style === 'light' ? .2 : .27);
        for (let q = 0; q < 4; q++) hat(bt + q * .125, q === 2 ? .1 : .04, q % 2 ? .35 : -.35);
        bass(bt, roots[c], .22, .28); bass(bt + .25, roots[c] + 12, .2, .16);
        if (fill) for (let q = 0; q < 4; q++) clap(bt + q * .125, .08 + q * .03);
      } else if (style === 'half') {
        if (k === 0) { kick(bt, .85); kicks.push(bt); }
        if (k === 2) clap(bt, .25);
        hat(bt + .25, .06, .3);
        if (k % 2 === 0) bass(bt, roots[c], .45, .26);
      } else if (style === 'pulse') {
        if (k === 0 || k === 2) { kick(bt, .45); kicks.push(bt); }
        hat(bt + .25, .035, .3);
        bass(bt, roots[c], .4, .16);
      }
      if (melody) { const m = melody[(bar * 4 + k) % melody.length]; if (m) pluck(bt + .25, m, .065, (k % 2 ? .4 : -.4), .5, .45); }
    }
  }
}
const MEL_A = [76, 0, 72, 0, 74, 0, 71, 0, 72, 0, 76, 0, 79, 0, 74, 0];
const MEL_B = [72, 0, 76, 0, 74, 0, 79, 0, 76, 0, 72, 0, 71, 0, 74, 0];

// hook: riser → impact as the counter lands (1.4s), a pluck for the second counter
riser(0, 1.4, .22);
for (let i = 0; i < 14; i++) hat(.1 + i * .09, .04 + i * .007, i % 2 ? .3 : -.3);
boom(1.4, .85); ducks.push(1.4);
padChord(1.4, [45, 57, 60, 64, 71], 3.1, .07);
pluck(1.4, 69, .2, 0, .6, 1.2); pluck(1.4, 76, .13, .3, .6, 1.2);
[76, 79, 83].forEach((m, i) => pluck(2.3 + i * .08, m, .1, i % 2 ? .3 : -.3, .5));

// intro: soft pulse, legend cards get a pluck each, riser into chapter 1
const intro = scene('intro');
groove(intro.start, intro.end, 'pulse', CH_A, RT_A);
[0, 1, 2, 3].forEach(i => pluck(intro.start + 3.5 + .7 + i * .25, [81, 76, 72, 64][i], .1, i % 2 ? .3 : -.3));
riser(intro.end - 1.5, 1.5, .2);

// chapters: wipe whoosh + impact, then a sparse bar
for (const ch of sc('chapter')) {
  whoosh(ch.start, .8, .26); boom(ch.start + .25, .55); ducks.push(ch.start + .25);
  padChord(ch.start + .25, ch.repo === 'codex' ? [45, 52, 57, 60, 64] : [41, 48, 53, 57, 64], ch.end - ch.start - .25, .07);
  [0, 1, 2].forEach(i => pluck(ch.start + .7 + i * .18, [69, 72, 76][i] + (ch.repo === 'codex' ? 0 : -4), .12, (i - 1) * .4));
  riser(ch.end - 1.0, 1.0, .14);
}
// chart chapters: full groove, different progression per repo
groove(scene('chart', 'codex').start, scene('chart', 'codex').end, 'full', CH_A, RT_A, MEL_A);
groove(scene('chart', 'claude').start, scene('chart', 'claude').end, 'full', CH_B, RT_B, MEL_B);

// one cue per stop, in key
const upArp = (t, g = 1) => [69, 72, 76, 81].forEach((m, i) => pluck(t + i * .06, m, (.11 + i * .015) * g, (i % 2 ? .35 : -.35), .45));
const downArp = (t, g = 1) => [81, 76, 72, 69, 64].forEach((m, i) => pluck(t + i * .06, m, (.15 - i * .012) * g, (i % 2 ? .35 : -.35), .45));
for (const key of ['codex', 'claude']) for (const s of TL.REPOS[key].stops) {
  const t = s.tArrive;
  if (s.kind === 'boom') { upArp(t, s.big ? 1.3 : 1); if (s.big) { boom(t, 1); ducks.push(t); } }
  else if (s.kind === 'bust') { downArp(t, s.big ? 1.3 : 1); if (s.big) { boom(t, .8); ducks.push(t); pluck(t + .4, 57, .2, 0, .6, .9); } }
  else if (s.kind === 'shrug') { pluck(t, 76, .1, -.2); pluck(t + .2, 75, .08, .2); }
  else { [76, 74, 76, 83].forEach((m, i) => pluck(t + i * .12, m, .1, (i % 2 ? .35 : -.35), .7, .7)); }
}

// pre-release study: wipe, half-time groove, cues as the lines draw and the lists land
const pre = scene('prerelease');
whoosh(pre.start, .8, .24); boom(pre.start + .25, .5); ducks.push(pre.start + .25);
groove(pre.start, pre.end, 'half', CH_B, RT_B);
[3.4, 5.0, 6.2].forEach((o, i) => pluck(pre.start + o, [76, 72, 69][i], .13, 0, .6, .9));

// throughput: half-time; bars grow with a soft rise, ratio hits land
const thr = scene('throughput');
groove(thr.start, thr.end, 'half', CH_A, RT_A);
[0, 1].forEach(i => { const t0 = thr.start + .5 + i * .6; pluck(t0 + .8, i ? 81 : 64, .16, 0, .5, .8); });

// ranking: groove returns, light
const lb = scene('leaderboard');
groove(lb.start, lb.end, 'light', CH_B, RT_B, MEL_B);
[0, 1, 2].forEach(i => pluck(lb.start + 2.2 + i * .12, [81, 76, 71][i], .12, (i - 1) * .4));

// takeaways: breakdown, one bell per takeaway
const tk = scene('takeaways');
groove(tk.start, tk.end, 'pulse', CH_B, RT_B);
tk.items.forEach((o, i) => { const t = tk.start + o; pluck(t, [76, 81, 83, 88][i], .16, 0, .7, 1.2); pluck(t, [64, 69, 71, 76][i], .1, 0, .7, 1.2); });
riser(tk.end - 1.2, 1.2, .16);

// outro: final hit and a long tail
const out = scene('outro');
boom(out.start, .8); ducks.push(out.start);
padChord(out.start, [45, 52, 57, 60, 64, 71], out.end - out.start, .08);
[69, 72, 76, 79, 83].forEach((m, i) => pluck(out.start + i * .09, m, .12, (i % 2 ? .4 : -.4), .7, 1.6));
pluck(out.start + 1.5, 81, .09, 0, .8, 2);

// ---------- sidechain duck (kick + explosions) on pad/bass bus ----------
const duck = new Float32Array(N).fill(1);
for (const t of kicks) for (let i = 0; i < SR * .25; i++) { const k = Math.floor(t * SR) + i; if (k < N) duck[k] = Math.min(duck[k], 1 - .5 * Math.exp(-i / SR * 14)); }
for (const t of ducks) for (let i = 0; i < SR * .8; i++) { const k = Math.floor(t * SR) + i; if (k < N) duck[k] = Math.min(duck[k], 1 - .65 * Math.exp(-i / SR * 4)); }
for (let k = 0; k < N; k++) { L[k] += PADL[k] * duck[k]; R[k] += PADR[k] * duck[k]; }

// ---------- reverb (Schroeder) ----------
function reverb(inp, offs) {
  const out = new Float32Array(N);
  for (const [d, fb] of [[1557, .82], [1617, .81], [1491, .83], [1422, .82]].map(([d, f]) => [d + offs, f])) {
    const buf = new Float32Array(d); let idx = 0, lp = 0;
    for (let k = 0; k < N; k++) { const y = buf[idx]; lp = y * .7 + lp * .3; buf[idx] = inp[k] + lp * fb; idx = (idx + 1) % d; out[k] += y * .25; }
  }
  for (const [d, g] of [[225, .5], [556, .5]]) {
    const buf = new Float32Array(d); let idx = 0;
    for (let k = 0; k < N; k++) { const b = buf[idx], y = -out[k] * g + b; buf[idx] = out[k] + b * g; idx = (idx + 1) % d; out[k] = y; }
  }
  return out;
}
const wl = reverb(RL, 0), wr = reverb(RR, 23);
for (let k = 0; k < N; k++) { L[k] += wl[k] * .5; R[k] += wr[k] * .5; }

// ---------- master: soft clip, fades, normalize ----------
let peak = 0;
for (let k = 0; k < N; k++) {
  const t = k / SR, fade = Math.min(1, t / .02) * Math.min(1, (DUR - t) / .7);
  L[k] = Math.tanh(L[k] * 1.1) * fade; R[k] = Math.tanh(R[k] * 1.1) * fade;
  peak = Math.max(peak, Math.abs(L[k]), Math.abs(R[k]));
}
const norm = .89 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let k = 0; k < N; k++) { buf.writeInt16LE(Math.round(L[k] * norm * 32767), 44 + k * 4); buf.writeInt16LE(Math.round(R[k] * norm * 32767), 46 + k * 4); }
writeFileSync(new URL('./soundtrack.wav', import.meta.url), buf);
console.log('peak', peak.toFixed(3));
