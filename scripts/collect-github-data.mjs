import { mkdir, writeFile } from "node:fs/promises";

const repositories = [
  { slug: "openai/codex", name: "OpenAI Codex", url: "https://github.com/openai/codex/issues" },
  { slug: "anthropics/claude-code", name: "Anthropic Claude Code", url: "https://github.com/anthropics/claude-code/issues" }
];
const token = process.env.GITHUB_TOKEN;
const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "issue-with-ai-data-collector" };
if (token) headers.Authorization = `Bearer ${token}`;

async function fetchAllIssues(slug) {
  const issues = [];
  for (let page = 1; ; page += 1) {
    const url = `https://api.github.com/repos/${slug}/issues?state=all&per_page=100&page=${page}`;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`${slug}: GitHub returned ${response.status} for page ${page}`);
    const pageItems = await response.json();
    issues.push(...pageItems.filter(item => !item.pull_request));
    if (pageItems.length < 100) return { issues, pages: page, url };
  }
}

function isoDate(value) { return value.slice(0, 10); }
function addCount(map, date) { map.set(date, (map.get(date) ?? 0) + 1); }

function normalize(repo, result) {
  const opened = new Map();
  const closed = new Map();
  const allDates = [];
  for (const issue of result.issues) {
    addCount(opened, isoDate(issue.created_at));
    allDates.push(isoDate(issue.created_at));
    if (issue.closed_at) { addCount(closed, isoDate(issue.closed_at)); allDates.push(isoDate(issue.closed_at)); }
  }
  if (!allDates.length) return { ...repo, days: [] };
  const start = new Date(`${[...allDates].sort()[0]}T00:00:00Z`);
  const end = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const days = [];
  let unclosed = 0;
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const openedCount = opened.get(date) ?? 0;
    const closedCount = closed.get(date) ?? 0;
    unclosed += openedCount - closedCount;
    days.push({ date, opened: openedCount, closed: closedCount, unclosed: Math.max(0, unclosed) });
  }
  return { ...repo, days, issueCount: result.issues.length };
}

const collected = [];
for (const repo of repositories) {
  const result = await fetchAllIssues(repo.slug);
  console.log(`${repo.slug}: collected ${result.issues.length} issues across ${result.pages} page(s)`);
  collected.push(normalize(repo, result));
}

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(new URL("../data/snapshot.json", import.meta.url), `${JSON.stringify({
  schemaVersion: 1,
  mode: "live",
  generatedAt: new Date().toISOString(),
  timezone: "UTC",
  source: "GitHub REST API /issues?state=all&per_page=100",
  repositories: collected
}, null, 2)}\n`);
console.log("Wrote data/snapshot.json");
