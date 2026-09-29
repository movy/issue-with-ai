import { readFileSync, writeFileSync } from 'node:fs';
const snap = JSON.parse(readFileSync(new URL('../../data/snapshot.json', import.meta.url)));
const events = JSON.parse(readFileSync(new URL('../../data/events.json', import.meta.url))).events;
const repos = {};
for (const r of snap.repositories) repos[r.slug] = { slug: r.slug, name: r.name, days: r.days };
writeFileSync(new URL('./data.js', import.meta.url),
  `window.DATA=${JSON.stringify({ generatedAt: snap.generatedAt, repos, events })};`);
console.log('ok');
