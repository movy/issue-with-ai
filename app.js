const chartColors = {
  opened: "#157a6e",
  closed: "#bf6c43",
  unclosed: "#8d5cc2"
};

const parseDate = value => new Date(`${value}T00:00:00Z`);
const dateLabel = value => parseDate(value).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const esc = value => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char]));

function chartSvg(days, type, label) {
  const width = Math.max(720, days.length * 34);
  const height = 220;
  const pad = { top: 15, right: 16, bottom: 30, left: 42 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const values = days.flatMap(day => type === "bars" ? [day.opened, day.closed] : [day.unclosed]);
  const max = Math.max(1, Math.ceil(Math.max(...values) * 1.15));
  const x = index => pad.left + (index / Math.max(1, days.length - 1)) * innerW;
  const y = value => pad.top + innerH - (value / max) * innerH;
  const grid = [0, .25, .5, .75, 1].map(ratio => {
    const value = Math.round(max * ratio);
    const yy = y(value);
    return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}" stroke="#e5dfd5"/><text x="${pad.left - 9}" y="${yy + 4}" text-anchor="end" fill="#89918e" font-size="10">${value}</text>`;
  }).join("");
  const labels = days.map((day, index) => index % Math.max(1, Math.ceil(days.length / 7)) === 0 ? `<text x="${x(index)}" y="${height - 7}" text-anchor="middle" fill="#89918e" font-size="10">${esc(dateLabel(day.date))}</text>` : "").join("");

  if (type === "bars") {
    const groupW = innerW / Math.max(1, days.length);
    const barW = Math.min(14, groupW * .25);
    const bars = days.map((day, index) => {
      const cx = pad.left + (index + .5) * groupW;
      return [
        `<rect x="${cx - barW - 2}" y="${y(day.opened)}" width="${barW}" height="${Math.max(0, y(0) - y(day.opened))}" rx="3" fill="${chartColors.opened}"><title>${esc(day.date)} — opened: ${day.opened}</title></rect>`,
        `<rect x="${cx + 2}" y="${y(day.closed)}" width="${barW}" height="${Math.max(0, y(0) - y(day.closed))}" rx="3" fill="${chartColors.closed}"><title>${esc(day.date)} — closed: ${day.closed}</title></rect>`
      ].join("");
    }).join("");
    return `<svg class="chart" role="img" aria-label="${esc(label)}" viewBox="0 0 ${width} ${height}">${grid}${bars}${labels}</svg>`;
  }

  const points = days.map((day, index) => `${x(index)},${y(day.unclosed)}`).join(" ");
  const area = `${pad.left},${y(0)} ${points} ${x(days.length - 1)},${y(0)}`;
  const dots = days.map((day, index) => `<circle cx="${x(index)}" cy="${y(day.unclosed)}" r="3.5" fill="${chartColors.unclosed}"><title>${esc(day.date)} — unclosed: ${day.unclosed}</title></circle>`).join("");
  return `<svg class="chart" role="img" aria-label="${esc(label)}" viewBox="0 0 ${width} ${height}">${grid}<polygon points="${area}" fill="#e8dff2" opacity=".72"/><polyline points="${points}" fill="none" stroke="${chartColors.unclosed}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}

function eventRail(days, events, slug) {
  if (!days.length) return "";
  const start = parseDate(days[0].date).getTime();
  const end = parseDate(days.at(-1).date).getTime();
  const range = Math.max(1, end - start);
  const matching = events.filter(event => event.repos.includes(slug) || event.repos.includes("*"));
  return `<div class="events" aria-label="Notable events">${matching.map(event => {
    const left = Math.max(0, Math.min(100, ((parseDate(event.date).getTime() - start) / range) * 100));
    return `<div class="event" style="left:${left}%"><a href="${esc(event.url)}" target="_blank" rel="noreferrer">${esc(event.label)}</a><small>${esc(dateLabel(event.date))}</small></div>`;
  }).join("")}</div>`;
}

function repoCard(repo, events) {
  const barsId = `${repo.slug.replaceAll("/", "-")}-bars`;
  const lineId = `${repo.slug.replaceAll("/", "-")}-line`;
  return `<article class="repo-card"><div class="repo-heading"><div><div class="eyebrow">REPOSITORY</div><h2>${esc(repo.name)}</h2></div><a class="repo-link" href="${esc(repo.url)}" target="_blank" rel="noreferrer">View on GitHub ↗</a></div><section class="chart-block" aria-labelledby="${barsId}-title"><div class="chart-title"><h3 id="${barsId}-title">Daily issue flow</h3><div class="legend"><span><i class="swatch" style="background:${chartColors.opened}"></i>Opened</span><span><i class="swatch" style="background:${chartColors.closed}"></i>Closed</span></div></div><div class="chart-frame">${chartSvg(repo.days, "bars", `${repo.name} daily opened and closed issues`)}</div>${eventRail(repo.days, events, repo.slug)}</section><section class="chart-block" aria-labelledby="${lineId}-title"><div class="chart-title"><h3 id="${lineId}-title">Unclosed issues at day end</h3><div class="legend"><span><i class="swatch" style="background:${chartColors.unclosed}"></i>Unclosed</span></div></div><div class="chart-frame">${chartSvg(repo.days, "line", `${repo.name} unclosed issues at day end`)}</div></section></article>`;
}

async function main() {
  const [snapshot, eventData] = await Promise.all([fetch("data/snapshot.json").then(response => response.json()), fetch("data/events.json").then(response => response.json())]);
  const meta = document.querySelector("#snapshot-meta");
  meta.textContent = snapshot.mode === "demo" ? "DEMO SNAPSHOT · Replace with npm run collect · Calendar dates shown in UTC" : `COLLECTED ${new Date(snapshot.generatedAt).toLocaleString()} · Calendar dates shown in ${snapshot.timezone}`;
  document.querySelector("#repo-sections").innerHTML = snapshot.repositories.length ? snapshot.repositories.map(repo => repoCard(repo, eventData.events)).join("") : `<p class="empty">No repository data is available yet. Run <code>npm run collect</code>, then reload this page.</p>`;
}

main().catch(error => {
  document.querySelector("#repo-sections").innerHTML = `<p class="empty">The snapshot could not be loaded. Run the site from a local HTTP server, then try again.<br><small>${esc(error.message)}</small></p>`;
});
