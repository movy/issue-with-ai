# Reddit posts

Site: https://movy.github.io/issue-with-ai/ (live once Pages is enabled). Attach `brag.mp4` or link to the site; most subs allow one or the other, not both.

---

## r/codex

**Title:** Happy DevDay everyone! The number of unclosed issues in the Codex repo is at an all-time high today

19,230 open issues, a new record. Out of curiosity I pulled every issue ever filed in openai/codex (30,746 of them) and lined them up with every OpenAI model release since o3. For each release I checked what happened to the number of open issues over the next two weeks.

A few things stood out:

- Open issues went from 30 on launch day to 19,230 today.
- In the last 30 days, 5,819 issues were opened and 815 were closed. That's about 14 closed for every 100 opened.
- The biggest two-week jump ever (+2,544) started the day GPT-6 Astra shipped.
- A few releases were followed by a small drop: GPT-5-Codex-Mini, GPT-5.1 and GPT-5.1-Codex-Max, back in November.
- In the week before GPT-5.6-Cyber, issues got closed at 3.2× the normal rate. That's the only Codex release with a clear pre-launch cleanup.

On average, though, a release fortnight looks like any other fortnight. The backlog grew 10%+ after 59% of releases and in 63% of all two-week stretches. So it's less "new model breaks things" and more "nobody is keeping up with incoming issues".

There's a 2-minute video that walks through every release, plus interactive charts: https://movy.github.io/issue-with-ai/

All numbers come from the public GitHub API. Happy to share the method or data if anyone wants to poke at it.

---

## r/claude

**Title:** Every Claude Code GitHub issue vs. every Anthropic model release: what happened to the backlog after each launch

I pulled all 95,197 issues ever filed in anthropics/claude-code and lined them up with every Anthropic release since Claude 3.7 Sonnet. For each release I looked at how the number of open issues changed over the next 14 days.

Highlights:

- The backlog peaked at 15,352 open issues on Aug 14 and is at 12,846 now.
- The Claude Code team closes a lot. In the last 30 days they closed 9,153 issues against 7,303 opened, about 125 closed for every 100 opened.
- The biggest cleanup (−2,698 in two weeks) came right after Fable 5.1 and Mythos 5.1.
- The biggest jumps came after Sonnet 5 (+2,315) and Opus 5 (+2,005).
- Some big swings had no release anywhere near them. From Dec 29 the backlog dropped by 2,084, and the nearest release was five weeks earlier.
- I also checked whether issues get closed faster right before a launch, in case the team is testing new models on its own repo first. Mostly no: the median is 0.95× the normal rate. Opus 4.8 (2.1×) and Sonnet 4.6 (1.7×) are the exceptions.

A 2-minute video walks through every release, and there are interactive charts: https://movy.github.io/issue-with-ai/

It's correlation, not causation. The data can't tell a bot clean-up from human triage. Still fun to see.

---

## r/singularity

**Title:** The first thing to reach the singularity will be the number of unclosed GitHub issues in the Codex repo

Half joking. Codex's open issues went from 30 to 19,230 in 17 months and the curve is still bending up. So I got curious whether new models have anything to do with it.

OpenAI and Anthropic both run public issue trackers for their coding agents (Codex and Claude Code). I lined up every model release from both labs, 52 of them, with every issue in those two repos. Then I asked a simple question: after a new model ships, does the pile of open issues grow or shrink?

The short answer:

1. **On average, releases don't move the backlog.** The two weeks after a launch look like any other two weeks. For Codex, the backlog grew 10%+ after 59% of releases and in 63% of all two-week stretches.
2. **But the extremes line up with launches.** Codex's biggest two-week jump started the day GPT-6 Astra shipped. Claude Code's biggest drop started two days before Fable 5.1 and Mythos 5.1.
3. **No sign of labs quietly cleaning up before a launch.** Closing rates in the week before a release are right at normal (0.98× and 0.95×), with a couple of exceptions.
4. **What really separates the two repos is closing capacity.** Over the last 30 days, Codex closed 14 issues for every 100 opened. Claude Code closed 125. Codex's backlog is at 19,230 and still climbing; Claude Code's peaked at 15,352 and is now at 12,846.

2-minute video plus interactive charts: https://movy.github.io/issue-with-ai/

Caveat: this is correlation, not causation. Issue counts depend on how many people use the tool, how the team triages and whether bots close stale issues. Treat it as a signal, not a verdict on either model.
