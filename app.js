const chartColors = {
  opened: "#bc4c00",
  closed: "#8250df",
  outstanding: "#d73a4a",
  outstandingFill: "#f7d4d7",
  grid: "#e5dfd5",
  axis: "#89918e",
  ink: "#17202a"
};
const repoColors = { "openai/codex": "#157a6e", "anthropics/claude-code": "#bf6c43" };
const verdicts = {
  boom: { color: "#c24369", arrow: "↑", word: "Boom", rule: "backlog grew ≥ 10% in 14 days" },
  bust: { color: "#1f8f4d", arrow: "↓", word: "Bust", rule: "backlog shrank ≥ 5% in 14 days" },
  shrug: { color: "#687482", arrow: "~", word: "Shrug", rule: "moved less than either" },
  swing: { color: "#5a4a8a", arrow: "?", word: "No release", rule: "a big swing with no release within 14 days" }
};
const WINDOW = 14;
const PAD = { left: 64, right: 72 };
const PLOT_HEIGHT = 270;
const FLOW_HEIGHT = 46;
const FLOW_GAP = 26;
const LANE_HEIGHT = 30;
const MAX_PX_PER_DAY = 24;

const parseDate = value => new Date(`${value}T00:00:00Z`);
const dayNumber = value => parseDate(value).getTime() / 86400000;
const dateLabel = value => parseDate(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDate = value => parseDate(value).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthLabel = value => parseDate(value).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(" ", " ’");
const esc = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
const number = value => new Intl.NumberFormat("en-US").format(Math.round(value));
const signed = value => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${number(Math.abs(value))}`;
const percent = value => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(Math.abs(value) < .1 ? 1 : 0)}%`;
const times = value => value == null ? "n/a" : `${value.toFixed(value >= 10 ? 0 : 1)}×`;
const times2 = value => value == null ? "n/a" : `${value.toFixed(2)}×`;
const perDay = value => value == null ? "n/a" : value < 10 ? value.toFixed(1) : number(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sum = (days, key) => days.reduce((total, day) => total + day[key], 0);
const median = values => {
  const sorted = values.filter(value => value != null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
let chartTooltipsSuspended = false;
let chartTooltipResumeTimer;
const chartStates = [];

function niceMax(value) {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find(candidate => candidate * magnitude >= value);
  return step * magnitude;
}

let measureContext;
function textWidth(text, font = "700 12px Inter, system-ui, sans-serif") {
  measureContext ??= document.createElement("canvas").getContext("2d");
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

function matchingEvents(days, events, slug) {
  if (!days.length) return [];
  const start = parseDate(days[0].date).getTime();
  const end = parseDate(days.at(-1).date).getTime();
  return events
    .filter(event => event.repos.includes(slug) || event.repos.includes("*"))
    .filter(event => {
      const time = parseDate(event.date).getTime();
      return time >= start && time <= end;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- analysis: the same measures the film uses ----------

function analyzeRepo(repo, events) {
  const days = repo.days;
  const count = days.length;
  const index = new Map(days.map((day, i) => [day.date, i]));
  const releases = matchingEvents(days, events, repo.slug);
  const releaseDates = [...new Set(releases.map(event => event.date))];
  const closedPerDay = (from, to) => { const slice = days.slice(Math.max(0, from), Math.max(0, to)); return slice.length ? sum(slice, "closed") / slice.length : null; };

  const measure = i0 => {
    const i1 = Math.min(count - 1, i0 + WINDOW);
    const at = days[i0].unclosed;
    const after = days.slice(i0 + 1, i1 + 1);
    const base = i0 >= 35 ? closedPerDay(i0 - 35, i0 - 7) : null;
    const preRate = i0 > 0 ? closedPerDay(i0 - 7, i0) : null;
    const postRate = after.length ? sum(after, "closed") / after.length : null;
    const delta = days[i1].unclosed - at;
    return {
      i0, i1, span: i1 - i0, at, delta, pct: at ? delta / at : 0,
      before: at - days[Math.max(0, i0 - WINDOW)].unclosed,
      opened: sum(after, "opened"), closed: sum(after, "closed"),
      base, preRate, postRate,
      preX: base && preRate != null ? preRate / base : null,
      postX: base && postRate != null ? postRate / base : null
    };
  };
  const verdictFor = pct => pct >= .10 ? "boom" : pct <= -.05 ? "bust" : "shrug";
  const nearestRelease = i => releaseDates
    .map(date => ({ date, gap: dayNumber(date) - dayNumber(days[i].date) }))
    .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))[0];
  const namesOn = date => releases.filter(event => event.date === date).map(event => event.shortLabel || event.label);

  // releases within a week of each other are one "moment", measured from the first
  const groups = [];
  for (const event of releases) {
    const last = groups.at(-1);
    if (last && dayNumber(event.date) - dayNumber(last.date) <= 7) {
      last.events.push(event);
      last.lastDate = event.date;
    } else groups.push({ date: event.date, lastDate: event.date, events: [event] });
  }
  const moments = groups.map((group, k) => {
    const stats = measure(index.get(group.date));
    const names = [...new Set(group.events.map(event => event.shortLabel || event.label))];
    return { id: `${repo.slug}#${k + 1}`, type: "release", n: k + 1, of: groups.length, date: group.date, lastDate: group.lastDate, names, events: group.events, kind: verdictFor(stats.pct), ...stats };
  });

  // big 14-day swings with no release anywhere near them
  const candidates = [];
  for (let i = 30; i + WINDOW < count; i += 1) {
    const stats = measure(i);
    const near = nearestRelease(i);
    // "nothing nearby": no release in the three weeks before the window starts or during it
    if (Math.abs(stats.pct) >= .2 && Math.abs(stats.delta) >= 500 && (!near || Math.abs(near.gap) > 21)) candidates.push({ ...stats, near });
  }
  const swings = [];
  for (const candidate of candidates.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))) {
    if (swings.length === 2) break;
    if (swings.some(swing => Math.abs(swing.i0 - candidate.i0) < 21)) continue;
    swings.push(candidate);
  }
  const swingMoments = swings.sort((a, b) => a.i0 - b.i0).map((swing, k) => ({
    id: `${repo.slug}?${k + 1}`, type: "swing", kind: "swing", date: days[swing.i0].date, lastDate: days[swing.i0].date,
    names: [], nearNames: swing.near ? namesOn(swing.near.date) : [], ...swing
  }));

  // how often any 14-day stretch "booms", for comparison with release windows
  let stretches = 0, booms = 0;
  for (let i = 30; i + WINDOW < count; i += 1) {
    stretches += 1;
    if ((days[i + WINDOW].unclosed - days[i].unclosed) / days[i].unclosed >= .10) booms += 1;
  }
  const measured = moments.filter(moment => moment.i0 >= 30);
  let up = { delta: -Infinity }, down = { delta: Infinity };
  for (let i = 0; i + WINDOW < count; i += 1) {
    const delta = days[i + WINDOW].unclosed - days[i].unclosed;
    if (delta > up.delta) up = { delta, i };
    if (delta < down.delta) down = { delta, i };
  }
  const extreme = move => { const near = nearestRelease(move.i); return { ...move, date: days[move.i].date, near, nearNames: near ? namesOn(near.date) : [] }; };

  const last30 = days.slice(-30);
  const withBase = moments.filter(moment => moment.base);
  return {
    ...repo,
    color: repoColors[repo.slug] ?? chartColors.ink,
    anchor: `repo-${repo.slug.replaceAll("/", "-")}`,
    index, releases, releaseDates, moments, swings: swingMoments,
    all: [...moments, ...swingMoments].sort((a, b) => a.i0 - b.i0),
    totals: { opened: sum(days, "opened"), closed: sum(days, "closed"), open: days.at(-1).unclosed },
    peak: days.reduce((best, day) => day.unclosed > best.unclosed ? day : best, days[0]),
    last30: { opened: sum(last30, "opened"), closed: sum(last30, "closed"), from: last30[0].date, to: last30.at(-1).date },
    baseBoom: stretches ? booms / stretches : 0,
    releaseBoom: { n: measured.filter(moment => moment.kind === "boom").length, of: measured.length },
    maxUp: extreme(up), maxDown: extreme(down),
    closing: {
      pre: median(withBase.map(moment => moment.preX)),
      post: median(withBase.map(moment => moment.postX)),
      spikes: withBase.filter(moment => moment.preX >= 1.5).sort((a, b) => b.preX - a.preX)
    }
  };
}

// ---------- hero, findings and method copy ----------

function relation(move) {
  if (!move.near) return "";
  const names = move.nearNames.join(" + ");
  if (move.near.gap === 0) return `began the day ${names} shipped`;
  return move.near.gap > 0 ? `began ${move.near.gap} days before ${names} shipped` : `began ${-move.near.gap} days after ${names} shipped`;
}

function findingsMarkup(models) {
  const [codex, claude] = models;
  const pct = value => `${Math.round(value * 100)}%`;
  const ratio = model => Math.round(100 * model.last30.closed / Math.max(1, model.last30.opened));
  const swings = models.flatMap(model => model.swings.map(swing => ({ ...swing, model })));
  const spikes = models.flatMap(model => model.closing.spikes.map(spike => ({ ...spike, model }))).sort((a, b) => b.preX - a.preX);
  const chip = model => `<i class="repo-dot" style="background:${model.color}"></i>`;
  const cards = [
    {
      tone: "shrug", title: "A release fortnight looks like any other fortnight.",
      stat: `${pct(codex.releaseBoom.n / Math.max(1, codex.releaseBoom.of))} <small>vs</small> ${pct(codex.baseBoom)}`,
      body: `${chip(codex)}Codex’s backlog grew by 10% or more after ${codex.releaseBoom.n} of ${codex.releaseBoom.of} releases, and in ${pct(codex.baseBoom)} of all 14-day stretches anyway. ${chip(claude)}Claude Code: ${pct(claude.releaseBoom.n / Math.max(1, claude.releaseBoom.of))} vs ${pct(claude.baseBoom)}.`
    },
    {
      tone: "boom", title: "But the biggest swings sit right next to launches.",
      stat: `${signed(codex.maxUp.delta)} <small>/</small> ${signed(claude.maxDown.delta)}`,
      body: `${chip(codex)}Codex’s largest 14-day jump ${relation(codex.maxUp)}. ${chip(claude)}Claude Code’s largest 14-day drop ${relation(claude.maxDown)}.`
    },
    {
      tone: "swing", title: "Some big moves had nothing to do with a release.",
      stat: `${swings.length} <small>swings, no launch within 3 weeks</small>`,
      body: swings.map(swing => `<span class="finding-line">${chip(swing.model)}<b>${signed(swing.delta)}</b> from ${shortDate(swing.date)} · nearest release ${Math.abs(swing.near.gap)} days away</span>`).join("")
    },
    {
      tone: "bust", title: "No sign of a quiet cleanup before releases.",
      stat: `${times2(codex.closing.pre)} <small>/</small> ${times2(claude.closing.pre)}`,
      body: `Median closing rate in the week before a release, vs. normal: ${chip(codex)}Codex ${times2(codex.closing.pre)}, ${chip(claude)}Claude Code ${times2(claude.closing.pre)}. Exceptions: ${spikes.slice(0, 3).map(spike => `${spike.names[0]} ${times(spike.preX)}`).join(", ") || "none"}.`
    }
  ];
  const throughput = models.map(model => {
    const r = ratio(model);
    return `<div class="throughput-row"><div class="throughput-name">${chip(model)}${esc(model.slug)}</div><div class="throughput-bars"><span class="bar-opened" style="--w:${Math.min(100, 100 * model.last30.opened / Math.max(...models.map(m => Math.max(m.last30.opened, m.last30.closed))))}%"><b>${number(model.last30.opened)}</b> opened</span><span class="bar-closed" style="--w:${Math.min(100, 100 * model.last30.closed / Math.max(...models.map(m => Math.max(m.last30.opened, m.last30.closed))))}%"><b>${number(model.last30.closed)}</b> closed</span></div><div class="throughput-ratio ${r >= 100 ? "is-good" : "is-bad"}"><strong>${r}</strong><span>closed per 100 opened</span></div></div>`;
  }).join("");
  return `<div class="finding-grid">${cards.map(card => `<article class="finding-card tone-${card.tone}"><h3>${card.title}</h3><div class="finding-stat">${card.stat}</div><p>${card.body}</p></article>`).join("")}</div><article class="throughput-card"><div><h3>What actually decides the backlog is closing capacity. Last 30 days, ${esc(shortDate(codex.last30.from))} – ${esc(dateLabel(codex.last30.to))}:</h3></div>${throughput}</article>`;
}

function verdictSummary(models) {
  const [codex, claude] = models;
  const ratio = model => Math.round(100 * model.last30.closed / Math.max(1, model.last30.opened));
  return `Across ${models.reduce((total, model) => total + model.releases.length, 0)} releases, backlog growth after a launch happens about as often as it does in any other two weeks. The most dramatic fortnights do line up with launches, and the long-run gap comes down to closing: in the last 30 days Codex closed ${ratio(codex)} issues for every 100 opened, and Claude Code closed ${ratio(claude)}.`;
}

// ---------- chart ----------

// the model shipped that day; a moment with several releases shows the first plus a count
function flagLabel(moment, maxChars = Infinity) {
  if (moment.type === "swing") return "No release";
  const first = moment.names[0].length > maxChars ? `${moment.names[0].slice(0, maxChars - 1).trimEnd()}…` : moment.names[0];
  return moment.names.length > 1 ? `${first} +${moment.names.length - 1}` : first;
}

// flags try the full model name, then a shortened one, then just the number, whichever fits in 4 lanes
function layoutFlags(model, xForIndex, plotLeft, plotRight) {
  const place = mode => {
    const laneEnds = [];
    const flags = model.all.map(moment => {
      const x = xForIndex(moment.i0);
      const label = mode === "full" ? flagLabel(moment) : mode === "short" ? flagLabel(moment, 9) : null;
      const width = !label ? 26 : 30 + textWidth(label) + 10;
      const left = clamp(x - 13, plotLeft - 8, plotRight + 8 - width);
      let lane = laneEnds.findIndex(end => left - end > 5);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = left + width;
      return { moment, x, left, width, lane, label };
    });
    return { flags, lanes: Math.max(1, laneEnds.length) };
  };
  for (const mode of ["full", "short"]) {
    const layout = place(mode);
    if (layout.lanes <= 4) return layout;
  }
  return place("compact");
}

function chartSvg(state) {
  const { model, pxPerDay } = state;
  const days = model.days;
  const width = Math.round(PAD.left + PAD.right + days.length * pxPerDay);
  const plotLeft = PAD.left;
  const plotRight = width - PAD.right;
  const xForIndex = index => plotLeft + (index + .5) * pxPerDay;
  const { flags, lanes } = layoutFlags(model, xForIndex, plotLeft, plotRight);
  const plotTop = 16 + lanes * LANE_HEIGHT + 14;
  const plotBottom = plotTop + PLOT_HEIGHT;
  const flowMid = plotBottom + FLOW_GAP + FLOW_HEIGHT;
  const flowBottom = flowMid + FLOW_HEIGHT;
  const height = flowBottom + 34;
  const dailyMax = niceMax(Math.max(...days.flatMap(day => [day.opened, day.closed]), 1));
  const outstandingMax = Math.max(1, ...days.map(day => day.unclosed)) * 1.08;
  const flowHeight = value => Math.min(1, value / dailyMax) * FLOW_HEIGHT;
  const yOutstanding = value => plotBottom - (value / outstandingMax) * PLOT_HEIGHT;
  const barWidth = Math.max(.8, Math.min(8, pxPerDay * .75));
  Object.assign(state, { width, plotTop, plotBottom, flowMid, flowBottom, dailyMax, xForIndex });

  const grid = [0, .25, .5, .75, 1].map(ratio => {
    const y = plotBottom - ratio * PLOT_HEIGHT;
    return `<line x1="${plotLeft}" x2="${plotRight}" y1="${y}" y2="${y}" stroke="${chartColors.grid}"${ratio ? "" : ` stroke-width="1.5"`}/>`;
  }).join("");

  const windows = model.all.map(moment => {
    const color = verdicts[moment.kind].color;
    const x0 = xForIndex(moment.i0) - pxPerDay / 2;
    const x1 = xForIndex(moment.i1) + pxPerDay / 2;
    const dashed = moment.type === "swing" ? ` stroke="${color}" stroke-dasharray="5 5" stroke-width="1.2"` : "";
    return `<rect class="moment-window" data-moment="${esc(moment.id)}" x="${x0}" y="${plotTop}" width="${x1 - x0}" height="${flowBottom - plotTop}" fill="${color}"${dashed}/>`;
  }).join("");

  // daily flow strip under the backlog: opened grows up, closed grows down
  const bars = days.map((day, index) => {
    const x = xForIndex(index) - barWidth / 2;
    const up = flowHeight(day.opened), down = flowHeight(day.closed);
    return `<rect x="${x}" y="${flowMid - up}" width="${barWidth}" height="${up}" fill="${chartColors.opened}"/><rect x="${x}" y="${flowMid}" width="${barWidth}" height="${down}" fill="${chartColors.closed}"/>`;
  }).join("");
  const flowFrame = `<rect x="${plotLeft}" y="${flowMid - FLOW_HEIGHT}" width="${plotRight - plotLeft}" height="${FLOW_HEIGHT * 2}" fill="#f7f3ec"/><line x1="${plotLeft}" x2="${plotRight}" y1="${flowMid}" y2="${flowMid}" stroke="#c9c1b3"/><text x="${plotLeft + 8}" y="${flowMid - FLOW_HEIGHT + 13}" class="flow-label" fill="${chartColors.opened}">OPENED / DAY ↑</text><text x="${plotLeft + 8}" y="${flowMid + FLOW_HEIGHT - 6}" class="flow-label" fill="${chartColors.closed}">CLOSED / DAY ↓</text>`;

  const points = days.map((day, index) => `${xForIndex(index).toFixed(1)},${yOutstanding(day.unclosed).toFixed(1)}`).join(" ");
  const area = `${plotLeft},${plotBottom} ${points} ${plotRight},${plotBottom}`;

  const minMonthGap = 46;
  let lastMonthX = -Infinity;
  const monthTicks = days.map((day, index) => {
    if (day.date.slice(8) !== "01") return "";
    const x = xForIndex(index);
    const labelled = x - lastMonthX >= minMonthGap;
    if (labelled) lastMonthX = x;
    return `<line x1="${x}" x2="${x}" y1="${flowBottom}" y2="${flowBottom + (labelled ? 7 : 4)}" stroke="${chartColors.axis}"/>${labelled ? `<text x="${x}" y="${flowBottom + 22}" text-anchor="middle" fill="${chartColors.axis}" font-size="11">${esc(monthLabel(day.date))}</text>` : ""}`;
  }).join("");

  // every individual release date gets a solid line in the lab's colour
  const releaseLines = model.releaseDates.map(date => {
    const x = xForIndex(model.index.get(date));
    return `<line class="release-line" x1="${x}" x2="${x}" y1="${plotTop}" y2="${flowBottom}" stroke="${model.color}"/>`;
  }).join("");

  const flagMarkup = flags.map(({ moment, x, left, width, lane, label }) => {
    const verdict = verdicts[moment.kind];
    const top = 16 + lane * LANE_HEIGHT;
    const circleX = left + 13;
    const badge = moment.type === "swing" ? "?" : String(moment.n);
    const badgeColor = moment.type === "swing" ? verdict.color : model.color;
    const aria = moment.type === "swing"
      ? `Swing with no release: ${signed(moment.delta)} open issues from ${dateLabel(moment.date)}`
      : `Release ${moment.n} of ${moment.of}: ${moment.names.join(", ")} on ${dateLabel(moment.date)}. ${verdict.word}: ${signed(moment.delta)} open issues in ${moment.span} days`;
    return `<g class="release-flag kind-${moment.kind}" data-moment="${esc(moment.id)}" tabindex="0" role="button" aria-label="${esc(aria)}"><line class="flag-stem" x1="${x}" x2="${x}" y1="${top + 22}" y2="${plotTop}" stroke="${badgeColor}"${moment.type === "swing" ? ` stroke-dasharray="3 3"` : ""}/><rect class="flag-body" x="${left}" y="${top}" width="${width}" height="22" rx="11" stroke="${verdict.color}"/><circle cx="${circleX}" cy="${top + 11}" r="9" fill="${badgeColor}"/><text class="flag-badge" x="${circleX}" y="${top + 15}" text-anchor="middle">${esc(badge)}</text>${label ? `<text class="flag-text" x="${left + 28}" y="${top + 15.5}">${esc(label)}</text>` : ""}</g>`;
  }).join("");

  const hitAreas = days.map((day, index) => `<rect class="chart-hitarea" x="${plotLeft + index * pxPerDay}" y="${plotTop}" width="${pxPerDay}" height="${flowBottom - plotTop}" tabindex="-1" data-index="${index}"></rect>`).join("");

  const label = `${model.name}: open issues over time, daily opened and closed issues, and ${model.moments.length} release moments`;
  return `<svg class="chart" role="img" aria-label="${esc(label)}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${grid}<g class="windows">${windows}</g>${flowFrame}${bars}<polygon class="outstanding-area" points="${area}" fill="${chartColors.outstandingFill}" opacity=".85"/><polyline class="outstanding-line" points="${points}" fill="none" stroke="${chartColors.outstanding}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>${releaseLines}${monthTicks}${flagMarkup}<line class="chart-crosshair" x1="0" x2="0" y1="${plotTop}" y2="${flowBottom}" stroke="${chartColors.ink}" stroke-width="1.2" stroke-opacity=".5" stroke-dasharray="4 4" pointer-events="none"/><g class="hitareas">${hitAreas}</g><g class="drag-select" display="none" pointer-events="none"><rect class="drag-band" x="0" y="${plotTop}" width="0" height="${flowBottom - plotTop}"/><text class="drag-label" x="0" y="${plotTop + 18}" text-anchor="middle"></text></g></svg>`;
}

// left: open issues (rescales to the visible range) · right: the daily flow strip
function axisMarkup(state) {
  const { plotTop, flowMid, dailyMax } = state;
  const ticks = [0, .25, .5, .75, 1];
  const tick = (ratio) => `<span class="axis-tick" data-axis="outstanding" data-ratio="${ratio}" style="top:${plotTop + (1 - ratio) * PLOT_HEIGHT}px"></span>`;
  const flowTick = (y, text, cls) => `<span class="axis-tick ${cls}" style="top:${y}px">${text}</span>`;
  return {
    left: `<span class="axis-title" style="top:${plotTop - 24}px">OPEN ISSUES</span>${ticks.map(tick).join("")}`,
    right: `<span class="axis-title" style="top:${flowMid - FLOW_HEIGHT - 16}px">PER DAY</span>${flowTick(flowMid - FLOW_HEIGHT, number(dailyMax), "tick-opened")}${flowTick(flowMid, "0", "")}${flowTick(flowMid + FLOW_HEIGHT, number(dailyMax), "tick-closed")}`
  };
}

function renderChart(state, { anchorDay, anchorPx } = {}) {
  state.scroll.innerHTML = chartSvg(state);
  const axes = axisMarkup(state);
  state.axisLeft.innerHTML = axes.left;
  state.axisRight.innerHTML = axes.right;
  if (anchorDay != null) state.scroll.scrollLeft = PAD.left + anchorDay * state.pxPerDay - anchorPx;
  if (state.active) highlightMoment(state, state.active, { scroll: false });
  applyFilter(state);
  updateOutstandingScale(state);
  state.card.querySelector(".zoom-readout").textContent = state.fit ? "Whole history" : `${Math.round(state.pxPerDay * 30)} px / month`;
}

function fitPxPerDay(state) {
  return Math.max(.2, (state.scroll.clientWidth - PAD.left - PAD.right) / state.model.days.length);
}

function zoomTo(state, pxPerDay, anchorPx = state.scroll.clientWidth / 2) {
  const fit = fitPxPerDay(state);
  const next = clamp(pxPerDay, fit, MAX_PX_PER_DAY);
  const anchorDay = (state.scroll.scrollLeft + anchorPx - PAD.left) / state.pxPerDay;
  state.fit = next <= fit + 1e-6;
  state.pxPerDay = next;
  renderChart(state, { anchorDay, anchorPx });
}

// fit days [start, end) into the plot area; very short ranges hit the zoom cap and are centred
function zoomToRange(state, start, end) {
  const fit = fitPxPerDay(state);
  const width = state.scroll.clientWidth;
  const next = clamp((width - PAD.left - PAD.right) / (end - start), fit, MAX_PX_PER_DAY);
  state.fit = next <= fit + 1e-6;
  state.pxPerDay = next;
  renderChart(state, { anchorDay: (start + end) / 2, anchorPx: (PAD.left + width - PAD.right) / 2 });
}

function updateOutstandingScale(state) {
  const chart = state.scroll.querySelector("svg.chart");
  if (!chart) return;
  const days = state.model.days;
  const first = clamp(Math.floor((state.scroll.scrollLeft - PAD.left) / state.pxPerDay), 0, days.length - 1);
  const last = clamp(Math.ceil((state.scroll.scrollLeft + state.scroll.clientWidth - PAD.left) / state.pxPerDay), 0, days.length - 1);
  let visibleMax = 1;
  for (let i = first; i <= last; i += 1) visibleMax = Math.max(visibleMax, days[i].unclosed);
  const outstandingMax = niceMax(visibleMax * 1.05);
  const y = value => state.plotBottom - (value / outstandingMax) * PLOT_HEIGHT;
  const points = days.map((day, index) => `${state.xForIndex(index).toFixed(1)},${y(day.unclosed).toFixed(1)}`).join(" ");
  chart.querySelector(".outstanding-line")?.setAttribute("points", points);
  chart.querySelector(".outstanding-area")?.setAttribute("points", `${PAD.left},${state.plotBottom} ${points} ${state.width - PAD.right},${state.plotBottom}`);
  state.outstandingMax = outstandingMax;
  state.axisLeft.querySelectorAll(".axis-tick").forEach(tick => { tick.textContent = number(outstandingMax * Number(tick.dataset.ratio)); });
}

// ---------- tooltips ----------

function issueStatusIcon(state) {
  if (state === "CLOSED") return `<svg aria-hidden="true" focusable="false" class="issue-status-icon issue-closed" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z"/><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z"/></svg>`;
  return `<svg aria-hidden="true" focusable="false" class="issue-status-icon issue-opened" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>`;
}

function commentIcon() {
  return `<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tooltip-comment-icon"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12"/><path d="M12 8v3"/><path d="M12 14v.01"/></svg>`;
}

function dayTooltip(state, index) {
  const { model } = state;
  const day = model.days[index];
  const previous = [...model.moments].reverse().find(moment => moment.i0 <= index);
  const context = previous
    ? `<em class="tooltip-context">${index - previous.i0 === 0 ? "Release day" : `${index - previous.i0} days after`} · ${esc(previous.names.join(", "))}</em>`
    : "";
  const issues = (day.notableIssues ?? []).slice(0, 5).map(issue => ({ ...issue, state: state.issueStates.get(issue.number) ?? (issue.actions.includes("closed") ? "CLOSED" : "OPEN") }));
  const issueMarkup = issues.length ? `<div class="tooltip-issues"><strong class="tooltip-issues-heading">Most-discussed issues · 25+ comments</strong>${issues.map(issue => `<a class="tooltip-issue" href="${esc(issue.url)}" target="_blank" rel="noreferrer"><span class="tooltip-issue-copy"><span class="tooltip-issue-title">${issueStatusIcon(issue.state)}<b>${esc(issue.title)}</b></span><small>${issue.state} · #${issue.number}</small></span><span class="tooltip-issue-comments">${commentIcon()}${number(issue.comments)}</span></a>`).join("")}</div>` : "";
  return `<strong>${esc(dateLabel(day.date))}</strong>${context}<span><i style="background:${chartColors.opened}"></i>Opened <b>${number(day.opened)}</b></span><span><i style="background:${chartColors.closed}"></i>Closed <b>${number(day.closed)}</b></span><span><i style="background:${chartColors.outstanding}"></i>Open issues <b>${number(day.unclosed)}</b></span>${issueMarkup}`;
}

function momentTooltip(moment) {
  const verdict = verdicts[moment.kind];
  const head = moment.type === "swing"
    ? `<strong>No release nearby · ${esc(shortDate(moment.date))} – ${esc(dateLabel(moment.lastDate === moment.date ? moment.date : moment.lastDate))}</strong><em class="tooltip-context">Nearest release: ${esc(moment.nearNames.join(" + "))}, ${Math.abs(moment.near.gap)} days ${moment.near.gap < 0 ? "earlier" : "later"}</em>`
    : `<strong>Release ${moment.n} of ${moment.of} · ${esc(dateLabel(moment.date))}</strong><em class="tooltip-context">${esc(moment.names.join(" · "))}</em>`;
  return `${head}<div class="tooltip-verdict" style="--v:${verdict.color}"><b>${verdict.arrow} ${verdict.word}</b><span class="tooltip-delta">${signed(moment.delta)}</span></div><small class="tooltip-note">open issues over ${moment.span} days · ${percent(moment.pct)} of the backlog</small><span><i style="background:${chartColors.opened}"></i>Opened in window <b>${number(moment.opened)}</b></span><span><i style="background:${chartColors.closed}"></i>Closed in window <b>${number(moment.closed)}</b></span><span><i style="background:${chartColors.closed};opacity:.45"></i>Closed/day, week before <b>${perDay(moment.preRate)}${moment.preX != null ? ` · ${times(moment.preX)}` : ""}</b></span><span><i style="background:${chartColors.closed};opacity:.45"></i>Closed/day, after <b>${perDay(moment.postRate)}${moment.postX != null ? ` · ${times(moment.postX)}` : ""}</b></span><small class="tooltip-note">Click to pin · × = vs. normal closing (days 8–35 before)</small>`;
}

function bindTooltip() {
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  const place = (x, y) => {
    const gap = 14, edge = 12;
    const width = tooltip.offsetWidth;
    const right = x + gap;
    const left = right + width <= window.innerWidth - edge ? right : x - width - gap;
    tooltip.style.left = `${clamp(left, edge, window.innerWidth - width - edge)}px`;
    tooltip.style.top = `${Math.max(edge, y - tooltip.offsetHeight - gap)}px`;
  };
  return {
    show(html, x, y) {
      if (chartTooltipsSuspended) return;
      tooltip.innerHTML = html;
      tooltip.hidden = false;
      place(x, y);
    },
    hide() { tooltip.hidden = true; }
  };
}

// ---------- interactions ----------

function highlightMoment(state, id, { scroll = true } = {}) {
  state.active = id;
  const svg = state.scroll.querySelector("svg.chart");
  svg?.querySelectorAll(".is-active").forEach(node => node.classList.remove("is-active"));
  state.card.querySelectorAll(".moment-card.is-active").forEach(node => node.classList.remove("is-active"));
  if (!id) return;
  svg?.querySelectorAll(`[data-moment="${CSS.escape(id)}"]`).forEach(node => node.classList.add("is-active"));
  const card = state.card.querySelector(`.moment-card[data-moment="${CSS.escape(id)}"]`);
  card?.classList.add("is-active");
  if (!scroll) return;
  const moment = state.model.all.find(item => item.id === id);
  if (moment && !state.fit) {
    const center = state.xForIndex((moment.i0 + moment.i1) / 2);
    state.scroll.scrollTo({ left: center - state.scroll.clientWidth / 2, behavior: "smooth" });
  }
  card?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

function applyFilter(state) {
  const filter = state.filter;
  state.scroll.querySelectorAll(".release-flag, .moment-window").forEach(node => {
    const moment = state.model.all.find(item => item.id === node.dataset.moment);
    node.classList.toggle("is-dimmed", filter !== "all" && moment?.kind !== filter);
  });
  state.card.querySelectorAll(".moment-card").forEach(node => { node.hidden = filter !== "all" && node.dataset.kind !== filter; });
  state.card.querySelectorAll(".filter-chip").forEach(node => node.setAttribute("aria-pressed", String(node.dataset.filter === filter)));
}

function bindChart(state, tooltip) {
  const { scroll } = state;
  const crosshair = () => scroll.querySelector(".chart-crosshair");
  const momentById = id => state.model.all.find(item => item.id === id);

  // drag across the plot to zoom to that stretch, as on a finance chart
  let drag = null;
  const dayAt = clientX => clamp((clientX - scroll.getBoundingClientRect().left + scroll.scrollLeft - PAD.left) / state.pxPerDay, 0, state.model.days.length);
  const dragRange = () => {
    const start = clamp(Math.floor(Math.min(drag.from, drag.to)), 0, state.model.days.length - 1);
    return { start, end: Math.max(start + 1, Math.ceil(Math.max(drag.from, drag.to))) };
  };
  const drawDrag = () => {
    const group = scroll.querySelector(".drag-select");
    if (!group) return;
    const { start, end } = dragRange();
    const days = state.model.days;
    const x0 = PAD.left + start * state.pxPerDay, x1 = PAD.left + end * state.pxPerDay;
    const band = group.querySelector(".drag-band"), label = group.querySelector(".drag-label");
    band.setAttribute("x", x0);
    band.setAttribute("width", x1 - x0);
    label.setAttribute("x", (x0 + x1) / 2);
    label.textContent = `${shortDate(days[start].date)} – ${shortDate(days[Math.min(days.length, end) - 1].date)} · ${end - start} days`;
    group.removeAttribute("display");
  };
  const endDrag = (event, apply) => {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const { active } = drag;
    const range = dragRange();
    if (scroll.hasPointerCapture(drag.id)) scroll.releasePointerCapture(drag.id);
    drag = null;
    scroll.classList.remove("is-dragging");
    scroll.querySelector(".drag-select")?.setAttribute("display", "none");
    if (active && apply && range.end - range.start >= 3) zoomToRange(state, range.start, range.end);
  };
  scroll.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse" || event.button !== 0 || !event.target.closest?.(".chart-hitarea")) return;
    event.preventDefault();
    const day = dayAt(event.clientX);
    drag = { id: event.pointerId, startX: event.clientX, from: day, to: day, active: false };
  });
  scroll.addEventListener("pointerup", event => endDrag(event, true));
  scroll.addEventListener("pointercancel", event => endDrag(event, false));
  document.addEventListener("keydown", event => { if (event.key === "Escape") endDrag(null, false); });
  scroll.addEventListener("dblclick", event => { if (!state.fit && event.target.closest?.(".chart-hitarea")) zoomTo(state, 0); });

  const onPointer = event => {
    if (drag && !(event.buttons & 1)) endDrag(null, false);
    if (drag) {
      drag.to = dayAt(event.clientX);
      if (!drag.active && Math.abs(event.clientX - drag.startX) > 5) {
        drag.active = true;
        scroll.setPointerCapture(drag.id);
        scroll.classList.add("is-dragging");
        tooltip.hide();
        const line = crosshair();
        if (line) line.style.display = "none";
      }
      if (drag.active) { drawDrag(); return; }
    }
    const flag = event.target.closest?.(".release-flag");
    const hit = event.target.closest?.(".chart-hitarea");
    const line = crosshair();
    if (flag) {
      if (line) line.style.display = "none";
      scroll.querySelectorAll(".moment-window.is-hover").forEach(node => node.classList.remove("is-hover"));
      scroll.querySelectorAll(`.moment-window[data-moment="${CSS.escape(flag.dataset.moment)}"]`).forEach(node => node.classList.add("is-hover"));
      tooltip.show(momentTooltip(momentById(flag.dataset.moment)), event.clientX, event.clientY);
      return;
    }
    scroll.querySelectorAll(".moment-window.is-hover").forEach(node => node.classList.remove("is-hover"));
    if (hit) {
      const index = Number(hit.dataset.index);
      const x = state.xForIndex(index);
      if (line) { line.setAttribute("x1", x); line.setAttribute("x2", x); line.style.display = "block"; }
      tooltip.show(dayTooltip(state, index), event.clientX, event.clientY);
      return;
    }
    if (line) line.style.display = "none";
    tooltip.hide();
  };
  scroll.addEventListener("pointermove", onPointer);
  scroll.addEventListener("pointerleave", () => {
    if (drag?.active) return;
    tooltip.hide();
    const line = crosshair();
    if (line) line.style.display = "none";
    scroll.querySelectorAll(".moment-window.is-hover").forEach(node => node.classList.remove("is-hover"));
  });
  scroll.addEventListener("click", event => {
    const flag = event.target.closest?.(".release-flag");
    if (flag) highlightMoment(state, state.active === flag.dataset.moment ? null : flag.dataset.moment);
  });
  scroll.addEventListener("keydown", event => {
    const flag = event.target.closest?.(".release-flag");
    if (flag && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      highlightMoment(state, flag.dataset.moment);
    }
  });
  scroll.addEventListener("focusin", event => {
    const flag = event.target.closest?.(".release-flag");
    if (!flag) return;
    const bounds = flag.getBoundingClientRect();
    tooltip.show(momentTooltip(momentById(flag.dataset.moment)), bounds.left + bounds.width / 2, bounds.top);
  });
  scroll.addEventListener("focusout", () => tooltip.hide());

  let raf = 0;
  scroll.addEventListener("scroll", () => {
    chartTooltipsSuspended = true;
    tooltip.hide();
    clearTimeout(chartTooltipResumeTimer);
    chartTooltipResumeTimer = setTimeout(() => { chartTooltipsSuspended = false; }, 140);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => updateOutstandingScale(state));
  }, { passive: true });
  scroll.addEventListener("wheel", event => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const bounds = scroll.getBoundingClientRect();
      zoomTo(state, state.pxPerDay * (event.deltaY > 0 ? .9 : 1.1), event.clientX - bounds.left);
      return;
    }
    if (scroll.scrollWidth > scroll.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX) && event.shiftKey) {
      scroll.scrollLeft += event.deltaY;
      event.preventDefault();
    }
  }, { passive: false });

  state.card.querySelector(".zoom-in").addEventListener("click", () => zoomTo(state, state.pxPerDay * 1.8));
  state.card.querySelector(".zoom-out").addEventListener("click", () => zoomTo(state, state.pxPerDay / 1.8));
  state.card.querySelector(".zoom-fit").addEventListener("click", () => zoomTo(state, 0));
  state.card.querySelectorAll(".filter-chip").forEach(chip => chip.addEventListener("click", () => { state.filter = chip.dataset.filter; applyFilter(state); }));
  state.card.querySelectorAll(".moment-card").forEach(card => {
    card.addEventListener("click", () => {
      const id = card.dataset.moment;
      if (state.active === id) { highlightMoment(state, null); return; }
      if (state.fit) zoomTo(state, 4, 0);
      highlightMoment(state, id);
      state.card.querySelector(".chart-frame").scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    card.addEventListener("pointerenter", () => scroll.querySelectorAll(`.moment-window[data-moment="${CSS.escape(card.dataset.moment)}"]`).forEach(node => node.classList.add("is-hover")));
    card.addEventListener("pointerleave", () => scroll.querySelectorAll(".moment-window.is-hover").forEach(node => node.classList.remove("is-hover")));
  });
}

// ---------- repo card ----------

function momentCard(model, moment) {
  const verdict = verdicts[moment.kind];
  const title = moment.type === "swing" ? "No release nearby" : moment.names.join(" · ");
  const date = moment.type === "swing" ? `${shortDate(moment.date)} – ${dateLabel(model.days[moment.i1].date)}` : (moment.lastDate !== moment.date ? `${shortDate(moment.date)} – ${dateLabel(moment.lastDate)}` : dateLabel(moment.date));
  const badge = moment.type === "swing" ? "?" : moment.n;
  const pre = moment.type === "swing"
    ? `Nearest release ${Math.abs(moment.near.gap)} days ${moment.near.gap < 0 ? "earlier" : "later"}`
    : moment.preX == null ? "Too early for a closing baseline" : `Closing the week before: <b class="${moment.preX >= 1.5 ? "is-spike" : ""}">${times(moment.preX)}</b> normal`;
  return `<button class="moment-card kind-${moment.kind}" type="button" data-moment="${esc(moment.id)}" data-kind="${moment.kind}" style="--v:${verdict.color};--repo:${moment.type === "swing" ? verdict.color : model.color}"><span class="moment-top"><span class="moment-badge">${badge}</span><span class="moment-date">${esc(date)}</span></span><span class="moment-title">${esc(title)}</span><span class="moment-verdict">${verdict.arrow} ${verdict.word}</span><span class="moment-delta">${signed(moment.delta)}</span><span class="moment-sub">open issues in ${moment.span} days · ${percent(moment.pct)}</span><span class="moment-pre">${pre}</span></button>`;
}

function repoCard(model) {
  const counts = kind => model.all.filter(moment => moment.kind === kind).length;
  const ratio = Math.round(100 * model.last30.closed / Math.max(1, model.last30.opened));
  const busiest = model.days.reduce((best, day) => day.opened > best.opened ? day : best, model.days[0]);
  const biggestClose = model.days.reduce((best, day) => day.closed > best.closed ? day : best, model.days[0]);
  const filters = ["all", "boom", "bust", "shrug", "swing"].map(kind => {
    const label = kind === "all" ? `All <b>${model.all.length}</b>` : `${verdicts[kind].arrow} ${verdicts[kind].word} <b>${counts(kind)}</b>`;
    return `<button class="filter-chip" type="button" data-filter="${kind}" aria-pressed="${kind === "all"}" style="--v:${kind === "all" ? chartColors.ink : verdicts[kind].color}">${label}</button>`;
  }).join("");
  return `<article class="repo-card" id="${model.anchor}" style="--repo:${model.color}">
    <header class="repo-heading">
      <div><h2>${esc(model.name)}</h2><p class="repo-range"><a href="${esc(model.url)}" target="_blank" rel="noreferrer">${esc(model.slug)}</a> · ${esc(dateLabel(model.days[0].date))} – ${esc(dateLabel(model.days.at(-1).date))} · ${model.releases.length} releases in ${model.moments.length} moments · UTC</p></div>
      <div class="repo-kpis">
        <div><span>Open now</span><strong class="kpi-open">${number(model.totals.open)}</strong></div>
        <div><span>Closed per 100 opened · 30d</span><strong class="${ratio >= 100 ? "is-good" : "is-bad"}">${ratio}</strong></div>
        <div><span>Filed · closed all-time</span><strong>${number(model.totals.opened)} <small>·</small> ${number(model.totals.closed)}</strong></div>
      </div>
    </header>
    <section class="chart-block" aria-label="${esc(model.name)} chart">
      <div class="chart-toolbar">
        <div class="legend"><span><i class="swatch area-swatch" style="background:${chartColors.outstanding}"></i>Open issues</span><span><i class="swatch" style="background:${chartColors.opened}"></i>Opened / day ↑</span><span><i class="swatch" style="background:${chartColors.closed}"></i>Closed / day ↓</span><span><i class="swatch line-swatch" style="background:${model.color}"></i>Release</span><span><i class="swatch window-swatch"></i>14 days after, tinted by verdict</span></div>
        <div class="zoom-controls" role="group" aria-label="Zoom"><button class="zoom-out" type="button" aria-label="Zoom out">−</button><span class="zoom-readout">Whole history</span><button class="zoom-in" type="button" aria-label="Zoom in">+</button><button class="zoom-fit" type="button">Fit</button></div>
      </div>
      <div class="chart-frame"><div class="chart-scroll" tabindex="0" aria-label="${esc(model.name)} timeline. Drag across the chart or Ctrl/⌘ + scroll to zoom, Shift + scroll to pan."></div><div class="chart-axis chart-axis-left" aria-hidden="true"></div><div class="chart-axis chart-axis-right" aria-hidden="true"></div></div>
      <p class="chart-hint">Hover a flag for the release’s numbers · hover the chart for a single day · drag across it to zoom in, double-click to zoom back out · <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + scroll also zooms</p>
      <div class="moments-head"><h3>Release moments <small>change in open issues over the next 14 days</small></h3><div class="moment-filters" role="group" aria-label="Filter release moments">${filters}</div></div>
      <div class="moment-strip">${model.all.map(moment => momentCard(model, moment)).join("")}</div>
      <div class="summary-strip"><div><span>Issues opened</span><strong>${number(model.totals.opened)}</strong></div><div><span>Issues closed</span><strong>${number(model.totals.closed)}</strong></div><div><span>Backlog peak</span><strong>${number(model.peak.unclosed)} <small>${esc(shortDate(model.peak.date))}</small></strong></div><div><span>Busiest day · opened / closed</span><strong><b class="is-opened">${number(busiest.opened)}</b> <small>${esc(shortDate(busiest.date))}</small> · <b class="is-closed">${number(biggestClose.closed)}</b> <small>${esc(shortDate(biggestClose.date))}</small></strong></div></div>
    </section>
  </article>`;
}

async function main() {
  const [snapshot, eventData] = await Promise.all([fetch("data/snapshot.json").then(response => response.json()), fetch("data/events.json").then(response => response.json())]);
  const meta = document.querySelector("#snapshot-meta");
  meta.textContent = snapshot.mode === "demo"
    ? "DEMO SNAPSHOT · Replace with npm run collect · Calendar dates in UTC"
    : `Snapshot collected ${new Date(snapshot.generatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} · ${snapshot.repositories.map(repo => `${number(repo.days.reduce((t, d) => t + d.opened, 0))} ${repo.name} issues`).join(" · ")}`;
  const sections = document.querySelector("#repo-sections");
  if (!snapshot.repositories.length) {
    sections.innerHTML = `<p class="empty">No repository data is available yet. Run <code>npm run collect</code>, then reload this page.</p>`;
    return;
  }
  const models = snapshot.repositories.map(repo => analyzeRepo(repo, eventData.events));
  document.querySelectorAll("[data-release-count]").forEach(node => { node.textContent = models.reduce((total, model) => total + model.releases.length, 0); });
  if (models.length === 2) {
    document.querySelector("#findings-body").innerHTML = findingsMarkup(models);
    document.querySelector("#verdict-summary").textContent = verdictSummary(models);
  }
  sections.innerHTML = models.map(repoCard).join("");
  const tooltip = bindTooltip();
  for (const model of models) {
    const card = document.getElementById(model.anchor);
    const issueStates = new Map();
    model.days.flatMap(day => day.notableIssues ?? []).forEach(issue => {
      if (issue.actions.includes("closed")) issueStates.set(issue.number, "CLOSED");
      else if (!issueStates.has(issue.number)) issueStates.set(issue.number, "OPEN");
    });
    const state = {
      model, card, issueStates, fit: true, filter: "all", active: null,
      scroll: card.querySelector(".chart-scroll"),
      axisLeft: card.querySelector(".chart-axis-left"),
      axisRight: card.querySelector(".chart-axis-right")
    };
    state.pxPerDay = fitPxPerDay(state);
    chartStates.push(state);
    renderChart(state);
    bindChart(state, tooltip);
  }
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => chartStates.forEach(state => {
      if (state.fit) { state.pxPerDay = fitPxPerDay(state); renderChart(state); } else updateOutstandingScale(state);
    }), 120);
  });
}

main().catch(error => {
  document.querySelector("#repo-sections").innerHTML = `<p class="empty">The snapshot could not be loaded. Run the site from a local HTTP server, then try again.<br><small>${esc(error.message)}</small></p>`;
  console.error(error);
});
