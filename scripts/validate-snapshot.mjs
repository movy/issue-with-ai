import { readFile } from "node:fs/promises";

const snapshot = JSON.parse(await readFile(new URL("../data/snapshot.json", import.meta.url)));
if (snapshot.schemaVersion !== 1) throw new Error("Unsupported snapshot schemaVersion");
if (!Array.isArray(snapshot.repositories) || snapshot.repositories.length !== 2) throw new Error("Expected exactly two repositories");

for (const repo of snapshot.repositories) {
  if (!repo.slug || !Array.isArray(repo.days)) throw new Error(`Invalid repository: ${repo.slug}`);
  for (let index = 0; index < repo.days.length; index += 1) {
    const day = repo.days[index];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) throw new Error(`${repo.slug}: invalid date ${day.date}`);
    if (index && repo.days[index - 1].date >= day.date) throw new Error(`${repo.slug}: dates are not strictly ascending`);
    for (const key of ["opened", "closed", "unclosed"]) if (!Number.isInteger(day[key]) || day[key] < 0) throw new Error(`${repo.slug}: invalid ${key} on ${day.date}`);
    if (day.notableIssues !== undefined) {
      if (!Array.isArray(day.notableIssues)) throw new Error(`${repo.slug}: invalid notableIssues on ${day.date}`);
      for (let issueIndex = 0; issueIndex < day.notableIssues.length; issueIndex += 1) {
        const issue = day.notableIssues[issueIndex];
        if (!Number.isInteger(issue.number) || !issue.title || !issue.url || !Number.isInteger(issue.comments) || issue.comments < 25 || !Array.isArray(issue.actions) || !issue.actions.length) throw new Error(`${repo.slug}: invalid notable issue on ${day.date}`);
        if (issueIndex && day.notableIssues[issueIndex - 1].comments < issue.comments) throw new Error(`${repo.slug}: notable issues are not sorted on ${day.date}`);
      }
    }
  }
}
console.log(`Snapshot OK: ${snapshot.repositories.map(repo => `${repo.slug} (${repo.days.length} days)`).join(", ")}`);
