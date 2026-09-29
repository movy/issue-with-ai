// Shared by the renderer (browser) and the soundtrack (node): every stat and every
// scene time comes from here, so picture and sound stay in sync with the data.
(function (G) {
  const D = G.DATA;
  const DAY = 864e5;
  const dnum = s => Date.parse(s + 'T00:00:00Z') / DAY;

  const REPOS = {
    codex: { key: 'codex', slug: 'openai/codex', name: 'OpenAI Codex', short: 'Codex' },
    claude: { key: 'claude', slug: 'anthropics/claude-code', name: 'Anthropic Claude Code', short: 'Claude Code' }
  };
  // Big 14-day swings with no release within 14 days either side (validated below).
  const NOLINK = { codex: ['2026-05-28'], claude: ['2025-12-29', '2026-03-19'] };

  for (const r of Object.values(REPOS)) {
    r.days = D.repos[r.slug].days;
    r.idx = Object.fromEntries(r.days.map((d, i) => [d.date, i]));
    r.releases = D.events.filter(e => e.repos.includes(r.slug)).sort((a, b) => a.date.localeCompare(b.date));
    r.releaseDates = [...new Set(r.releases.map(e => e.date))];
    const n = r.days.length;
    r.opened = r.days.reduce((s, d) => s + d.opened, 0);
    r.closed = r.days.reduce((s, d) => s + d.closed, 0);
    r.open = r.days[n - 1].unclosed;
    r.peak = r.days.reduce((m, d) => d.unclosed > m.unclosed ? d : m, r.days[0]);
    const last = r.days.slice(-30);
    r.last30 = { opened: last.reduce((s, d) => s + d.opened, 0), closed: last.reduce((s, d) => s + d.closed, 0) };
    // base rate over every 14-day stretch after the tracker's first month
    let tot = 0, boom = 0, bust = 0;
    for (let i = 30; i + 14 < n; i++) {
      const p = (r.days[i + 14].unclosed - r.days[i].unclosed) / r.days[i].unclosed;
      tot++; if (p >= .10) boom++; if (p <= -.05) bust++;
    }
    r.base = { boom: boom / tot, bust: bust / tot };
    // biggest 14-day rise / fall anywhere
    let up = { d: -Infinity }, down = { d: Infinity };
    for (let i = 0; i + 14 < n; i++) {
      const d = r.days[i + 14].unclosed - r.days[i].unclosed;
      if (d > up.d) up = { d, i }; if (d < down.d) down = { d, i };
    }
    const nearest = i => r.releaseDates.map(x => ({ x, gap: dnum(x) - dnum(r.days[i].date) })).sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))[0];
    r.maxUp = { ...up, date: r.days[up.i].date, near: nearest(up.i) };
    r.maxDown = { ...down, date: r.days[down.i].date, near: nearest(down.i) };
    r.nearest = nearest;
  }

  // closing rate vs. "normal" (days 8–35 before), for the week before and the two weeks after
  const sumC = (r, a, b) => r.days.slice(Math.max(0, a), b).reduce((s, d) => s + d.closed, 0);
  function closing(r, i0) {
    const n = r.days.length, base = i0 >= 35 ? sumC(r, i0 - 35, i0 - 7) / 28 : null;
    const pre = sumC(r, i0 - 7, i0) / Math.max(1, Math.min(7, i0)), postN = Math.min(14, n - 1 - i0);
    const post = postN > 0 ? sumC(r, i0 + 1, i0 + 1 + postN) / postN : null;
    return { base, preRate: pre, postRate: post, preX: base ? pre / base : null, postX: base && post != null ? post / base : null };
  }
  function window14(r, i0) {
    const n = r.days.length, i1 = Math.min(n - 1, i0 + 14), at = r.days[i0].unclosed;
    const w = r.days.slice(i0 + 1, i1 + 1);
    return {
      ...closing(r, i0),
      i0, i1, days: i1 - i0, at,
      delta: r.days[i1].unclosed - at,
      before: at - r.days[Math.max(0, i0 - 14)].unclosed,
      opened: w.reduce((s, d) => s + d.opened, 0),
      closed: w.reduce((s, d) => s + d.closed, 0)
    };
  }
  const verdict = p => p >= .10 ? 'boom' : p <= -.05 ? 'bust' : 'shrug';

  function stopsFor(r) {
    const groups = [];
    for (const e of r.releases) {
      const g = groups.at(-1);
      if (g && dnum(e.date) - dnum(g.date) <= 7) { if (!g.names.includes(e.shortLabel)) g.names.push(e.shortLabel); g.lastDate = e.date; }
      else groups.push({ date: e.date, lastDate: e.date, names: [e.shortLabel] });
    }
    const out = groups.map((g, k) => {
      const w = window14(r, r.idx[g.date]);
      const pct = w.delta / w.at;
      const s = { ...g, ...w, pct, kind: verdict(pct), big: Math.abs(w.delta) >= 1500, n: k + 1, of: groups.length, notes: [] };
      if (w.i0 === 0) s.notes.push('The tracker’s first day: the first wave of issues arrives.');
      if (w.days < 14) s.notes.push(`Only ${w.days} days of data after this release so far.`);
      if (w.before / w.at <= -.05 && w.i0 > 0) s.notes.push(`The backlog was already falling before release (−${Math.abs(w.before).toLocaleString('en-US')} in the prior 14 days).`);
      if (s.kind === 'shrug' && w.before / w.at >= .15) s.notes.push('Growth before release was steeper than after.');
      if (g.lastDate !== g.date) s.notes.push('Releases within a week are grouped and measured from the first.');
      return s;
    });
    for (const date of NOLINK[r.key]) {
      const i0 = r.idx[date], w = window14(r, i0), near = r.nearest(i0);
      if (Math.abs(near.gap) <= 14) throw new Error('nolink window too close to a release: ' + date);
      const rel = r.releases.filter(e => e.date === near.x).map(e => e.shortLabel).join(' + ');
      out.push({ date, lastDate: date, names: [], ...w, pct: w.delta / w.at, kind: 'nolink', big: false, near, nearName: rel, notes: [] });
    }
    out.sort((a, b) => a.i0 - b.i0);
    return out;
  }

  const DUR = { shrug: 1.5, boom: 2.0, bust: 2.0, nolink: 2.5, big: 3.0 };
  const TRAVEL = .5;
  const scenes = [];
  let t = 0;
  const push = (type, dur, extra = {}) => { const s = { type, start: t, end: t + dur, ...extra }; scenes.push(s); t += dur; return s; };

  push('hook', 4.5);
  push('intro', 8.0);
  for (const key of ['codex', 'claude']) {
    const r = REPOS[key];
    push('chapter', 3.0, { repo: key });
    const stops = stopsFor(r);
    r.stops = stops;
    const sc = push('chart', 0, { repo: key, stops });
    let tt = sc.start + .5;
    stops.forEach((s, k) => {
      const dur = s.big ? DUR.big : DUR[s.kind];
      s.tTravel = tt; s.tArrive = tt + TRAVEL; s.tLeave = tt + dur;
      const next = stops[k + 1];
      s.reach = next ? Math.min(s.i1, next.i0) : s.i1;
      tt += dur;
    });
    sc.tRunEnd = tt + 1.0; sc.end = tt + 2.0; t = sc.end;
  }
  const median = v => { const x = [...v].sort((a, b) => a - b), m = x.length >> 1; return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2; };
  for (const r of Object.values(REPOS)) {
    const G = r.stops.filter(s => s.kind !== 'nolink' && s.base);
    const cl = r.days.map(d => d.closed), n = cl.length, profile = [];
    for (let off = -21; off <= 21; off++) {
      const v = G.filter(s => s.i0 + off + 2 <= n).map(s => (cl[s.i0 + off - 1] + cl[s.i0 + off] + cl[s.i0 + off + 1]) / 3 / s.base);
      profile.push({ off, v: median(v) });
    }
    r.study = { n: G.length, profile, pre: median(G.map(s => s.preX)), post: median(G.filter(s => s.postX != null).map(s => s.postX)) };
  }
  const spikes = Object.values(REPOS).flatMap(r => r.stops.filter(s => s.kind !== 'nolink' && s.preX >= 1.5).map(s => ({ ...s, repo: r.key }))).sort((a, b) => b.preX - a.preX);
  push('prerelease', 11.0, { spikes });
  push('throughput', 7.0);
  push('leaderboard', 8.5);
  push('takeaways', 11.5, { items: [0, 1, 2, 3].map(i => .6 + i * 2.4) });
  push('outro', 5.5);

  const allStops = [...REPOS.codex.stops, ...REPOS.claude.stops].map((s, k) => s);
  const releaseStops = allStops.filter(s => s.kind !== 'nolink');
  const rate = (r, kind) => { const st = r.stops.filter(s => s.kind !== 'nolink' && s.i0 >= 30); return { n: st.filter(s => s.kind === kind).length, of: st.length }; };

  G.TL = {
    REPOS, scenes, total: t, TRAVEL, releaseStops, median,
    releaseCount: D.events.length,
    counts: ['boom', 'bust', 'shrug'].reduce((o, k) => (o[k] = releaseStops.filter(s => s.kind === k).length, o), {}),
    rate,
    chapters: [
      ['Intro', 0], ['Codex', scenes.find(s => s.type === 'chapter' && s.repo === 'codex').start],
      ['Claude Code', scenes.find(s => s.type === 'chapter' && s.repo === 'claude').start],
      ['Pre-release?', scenes.find(s => s.type === 'prerelease').start],
      ['Wrap-up', scenes.find(s => s.type === 'throughput').start]
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
