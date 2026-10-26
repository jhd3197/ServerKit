---
name: create-pr
description: Generate a pull request title and description from the current branch's commits. Produces a concise summary, optional feature highlights, and collapsible technical details.
---

# Create PR Description

Generate a pull request title and description that's scannable, informative, and has just enough personality to feel human.

## Instructions

### 1. Gather context (do ALL of these)

Run these commands to build a complete picture before writing anything:

```bash
# Commit overview
git log main..HEAD --oneline --stat

# Full diff stat for file-level scope
git diff main..HEAD --stat

# Actual code changes — read the diff, don't just skim filenames
git diff main..HEAD
```

If the full diff is too large, diff individual areas (backend routes, frontend, storage, etc.) in batches. You must understand **what the code actually does**, not just which files were touched.

### 2. Write the PR file

Write **two** files under `.pr/` (create the directory if it doesn't exist), sharing one base name from today's date:

- `.pr/YYYY-MM-DD.title.txt` — the PR title, one line, nothing else.
- `.pr/YYYY-MM-DD.md` — the PR **body only**. It starts directly with the summary paragraph.

If files for today's date already exist, append a counter to the base name: `YYYY-MM-DD-2`, `YYYY-MM-DD-3`, etc.

**The body file must never contain the title.** No `# <Title>` heading, no `Title:` line, no frontmatter, no "PR description:" preamble. GitHub already renders the title above the body, so anything title-like in the body file shows up twice — whoever opens the PR (you, another agent, or the user copy-pasting) pastes the body file verbatim and should not have to edit it.

The structure depends on whether the PR introduces user-facing features or is purely internal (refactors, bug fixes, infra).

#### When the PR has user-facing features:

~~~markdown
<4-6 sentence summary>

### Highlights

- Highlight 1
- Highlight 2
- ...

<details>
<summary>Technical changes</summary>

- Detail 1
- Detail 2
- ...

</details>
~~~

#### When the PR is purely internal (no user-facing features):

~~~markdown
<4-6 sentence summary>

<details>
<summary>Technical changes</summary>

- Detail 1
- Detail 2
- ...

</details>
~~~

Omit the Highlights section entirely for internal-only PRs — don't force it.

### Style Rules

#### Title
- **Write a normal, human title — NOT a conventional-commit prefix.** Name the PR the way you'd describe it to a teammate. **No `type(scope):`, no `feat:` / `fix:` / `chore:` lead-in, no square-bracket tags** in the title.
  - Good: `Add the Cloudflare DNS provisioning extension` · `Harden the subprocess audit against injection`
  - Bad: `feat(dns): add cloudflare provisioning` · `fix: subprocess injection` · `chore(deps): bump`
- Capitalize the first word like a sentence; imperative or plain-descriptive are both fine; no trailing period. Keep it under ~70 chars.
- Leading with the subsystem and a colon in plain words is fine when it aids scanning: `Backend: …`, `Extensions: …`.
- The title lives **only** in the `.title.txt` file — that string is the `gh pr create --title` value. Don't repeat it, or a variant of it, as a headline in the body file.
- **Where the release weight actually lives (so you can safely keep it out of the title):** `version-bump.yml` reads the *commit message* pushed to `dev` (`github.event.head_commit.message`), **not this title.** A `feat:`/`feature:`/`minor:` prefix or a `[minor]` tag in the commit → minor bump; `BREAKING:`/`major:` or `[major]` → major; anything else → patch. Put any bump intent in your **commits**; leave the PR title human.

#### Summary
- **4-6 sentences.** This is the part people actually read — give it room to breathe.
- **Open with a touch of personality.** One line that makes the reader smile — a wry observation, a lighthearted remark, a playful metaphor. Not forced, just human. Examples of the energy (don't copy these literally, invent your own each time):
  - "This one's mostly about cleaning house."
  - "Turns out the type checker was right to complain."
  - A playful metaphor about what the code was doing wrong
  - A wry observation about the state of things before this PR
- **Match the tone to the change.** The voice should fit what the PR actually is — a bug fix can read dry and a little relieved ("This should've been caught months ago."), a new feature can read genuinely excited, a refactor can read like satisfying cleanup, a security fix should stay sober and matter-of-fact. Don't paste the same energy onto every PR; that's just a different kind of static.
- **Then explain what was going on and what this PR does about it.** Set the scene — what was broken, missing, or annoying? What's the approach? Name the main change areas (new feature, refactor target, bug fixed) but describe them in context, not as a dry list. The reader should walk away understanding the *story* of this PR, not just a changelog.
- **Include the "why" and the reasoning.** If there was a design choice, a trade-off, or a particular reason you went one way instead of another, mention it briefly. "We went with X instead of Y because Z" is the kind of thing that saves people from asking in review.
- **Do not repeat what Highlights or Technical changes already cover** verbatim, but it's fine to reference the same areas — the summary gives narrative context, the sections below give specifics.

#### Highlights (only when applicable)
- One bullet per user-facing feature, behavior change, or notable improvement.
- Write from the user's perspective — what they'll notice, not internal implementation.
- Plain language, no code references. "Schedules now respect your configured timezone" not "`SchedulerService` gains a `timezone` attribute".
- 3-7 bullets is the sweet spot. If you can only think of 1-2, fold them into the summary and skip this section.

#### Technical changes (inside the accordion)
- One bullet per discrete change. Be specific — name files, classes, functions, patterns.
- Format: `backtick code references` for identifiers, plain text for descriptions.
- Every meaningful change in the diff must have a bullet. If a change touches security (CORS, auth, SQL injection), error handling, accessibility, or concurrency, it gets its own bullet — do not bury these.
- Bullets should describe the mechanism, not just the intent. "Race condition in `get_or_create_chat` fixed by moving creation inside the lookup session" is good. "Fix database issues" is not.
- Group related changes together (all typing fixes, all security hardening, all API changes, etc.)

#### Contributors
- If the PR includes commits from multiple authors (not just the repo owner), add a **Contributors** section after the summary and before Highlights.
- Use `git log main..HEAD --format='%aN <%aE>' | sort -u` to find unique commit authors.
- Exclude bot accounts (e.g., `github-actions[bot]`).
- Format: `@username` if their GitHub handle is available (check the ARGUMENTS or commit metadata), otherwise use their name. Add a brief note about what they contributed if it's clear from the commits.
- Keep it short — one line per contributor, no need for a full changelog.

#### General
- **No test plan section.** Do not include "Test plan" or "Testing".
- **No mention of tests.** Do not reference test files, test results, or testing.
- **No emoji.**
- **No "Generated by" footer.**

### 3. Stop after writing the files

This skill's job ends when the `.pr/` files are written. **Do not** run `gh pr create`, `git push`, or any other remote-affecting command to actually open the PR — that's a separate, explicit step the user requests on its own. Print the title, the paths of both files, and a one-line note that they're ready to review/copy.

### 4. Opening the PR (only when the user explicitly asks)

Pass the two files separately — never derive the body from a file that has a heading in it:

```bash
gh pr create --base main --head dev --title "$(cat .pr/YYYY-MM-DD.title.txt)" --body-file .pr/YYYY-MM-DD.md
```

Before running it, check the first line of the body file: if it is a `#` heading or repeats the title, delete that line first. After creating, run `gh pr view --json title,body -q .body | head -3` and confirm the body does not start with the title.
