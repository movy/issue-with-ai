import { mkdir, readFile, writeFile } from "node:fs/promises";

const repositories = [
  { slug: "openai/codex", name: "OpenAI Codex", url: "https://github.com/openai/codex/issues" },
  { slug: "anthropics/claude-code", name: "Anthropic Claude Code", url: "https://github.com/anthropics/claude-code/issues" }
];
async function loadDotEnv() {
  try {
    const contents = await readFile(new URL("../.env", import.meta.url), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1].startsWith("#") || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await loadDotEnv();
const token = process.env.GITHUB_TOKEN?.trim();
if (!token) throw new Error("GITHUB_TOKEN is required. Add it to .env or export it in the shell.");
const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "issue-with-ai-data-collector", Authorization: `Bearer ${token}` };

const graphqlQuery = `
  query IssueHistory($owner: String!, $name: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      issues(first: 100, after: $after, states: [OPEN, CLOSED], orderBy: { field: CREATED_AT, direction: ASC }) {
        nodes { number title url createdAt closedAt comments { totalCount } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function fetchAllIssues(slug) {
  const issues = [];
  const [owner, name] = slug.split("/");
  let after = null;
  let pages = 0;
  for (;;) {
    let response;
    let payload;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        response = await fetch("https://api.github.com/graphql", {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({ query: graphqlQuery, variables: { owner, name, after } })
        });
        payload = await response.json();
        break;
      } catch (error) {
        if (attempt === 3) throw new Error(`${slug}: request failed after 3 attempts: ${error.message}`);
        const delay = attempt * 2_000;
        console.warn(`${slug}: request attempt ${attempt} failed (${error.message}); retrying in ${delay / 1000}s`);
        await wait(delay);
      }
    }
    if (!response.ok) throw new Error(`${slug}: GitHub returned ${response.status}: ${payload.message ?? "GraphQL request failed"}`);
    if (payload.errors?.length) throw new Error(`${slug}: ${payload.errors.map(error => error.message).join("; ")}`);
    const connection = payload.data?.repository?.issues;
    if (!connection) throw new Error(`${slug}: repository issue history was not returned`);
    issues.push(...connection.nodes.map(issue => ({
      number: issue.number,
      title: issue.title,
      url: issue.url,
      created_at: issue.createdAt,
      closed_at: issue.closedAt,
      comments_count: issue.comments.totalCount
    })));
    pages += 1;
    console.log(`${slug}: cursor page ${pages}, ${issues.length} issues collected`);
    if (!connection.pageInfo.hasNextPage) return { issues, pages };
    after = connection.pageInfo.endCursor;
  }
}

function isoDate(value) { return value.slice(0, 10); }
function addCount(map, date) { map.set(date, (map.get(date) ?? 0) + 1); }

function normalize(repo, result) {
  const opened = new Map();
  const closed = new Map();
  const notableIssues = new Map();
  const allDates = [];
  const addNotableIssue = (date, issue, action) => {
    if (issue.comments_count < 25) return;
    const dayIssues = notableIssues.get(date) ?? [];
    const existing = dayIssues.find(item => item.number === issue.number);
    if (existing) {
      if (!existing.actions.includes(action)) existing.actions.push(action);
    } else {
      dayIssues.push({ number: issue.number, title: issue.title, url: issue.url, comments: issue.comments_count, actions: [action] });
    }
    notableIssues.set(date, dayIssues);
  };
  for (const issue of result.issues) {
    const createdDate = isoDate(issue.created_at);
    addCount(opened, createdDate);
    addNotableIssue(createdDate, issue, "opened");
    allDates.push(createdDate);
    if (issue.closed_at) {
      const closedDate = isoDate(issue.closed_at);
      addCount(closed, closedDate);
      addNotableIssue(closedDate, issue, "closed");
      allDates.push(closedDate);
    }
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
    days.push({ date, opened: openedCount, closed: closedCount, unclosed: Math.max(0, unclosed), notableIssues: (notableIssues.get(date) ?? []).sort((a, b) => b.comments - a.comments || a.number - b.number) });
  }
  return { ...repo, days, issueCount: result.issues.length, collectionPages: result.pages };
}

const collected = [];
for (const repo of repositories) {
  const result = await fetchAllIssues(repo.slug);
  console.log(`${repo.slug}: collected ${result.issues.length} issues across ${result.pages} cursor page(s)`);
  collected.push(normalize(repo, result));
}

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(new URL("../data/snapshot.json", import.meta.url), `${JSON.stringify({
  schemaVersion: 1,
  mode: "live",
  generatedAt: new Date().toISOString(),
  timezone: "UTC",
  source: "GitHub GraphQL API repository.issues with cursor pagination",
  repositories: collected
}, null, 2)}\n`);
console.log("Wrote data/snapshot.json");
