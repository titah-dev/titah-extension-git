# @titah/extension-git

A lazygit-style git sidebar for [Titah](https://github.com/titah-dev/titah).
**Read-only** — it watches, it never changes your repository.

```
╭────────────────────────────────╮
│ Git                            │
│ Files (2)                      │
│ › ·M src/tui/panels.ts         │
│   ?? README.md                 │
│ Worktrees (1)                  │
│ Branches (4) main              │
│ Commits (4)                    │
│ Stash (1)                      │
│ tab section · ↑↓ move          │
╰────────────────────────────────╯
```

Five sections, accordion style: the focused one expands, the others collapse to a
header with their count. `tab` moves forward through them, `↑`/`↓` move the cursor
inside the open one, and clicking a header opens it.

## Install

```bash
titah extension install @titah/extension-git
```

```jsonc
{
  "extension": {
    "@titah/extension-git": {
      "side": "left",
      "key": "<leader>g",
      "options": { "commitLimit": 50, "start": "files" }
    }
  },
  "panel": { "left": { "width": 34 } }
}
```

| Option | Default | |
|---|---|---|
| `commitLimit` | `50` | How many commits to list. Reading is capped at 50 regardless |
| `start` | `"files"` | Which section is open first: `files`, `worktrees`, `branches`, `commits`, `stash` |

**`width: 34` is the number to use.** That leaves 30 columns inside the frame —
enough for `a1b2c3 a reasonably short subject` and `·M src/tui/panels.ts` without
cutting mid-word. At the default 20 a commit hash alone eats a third of the line.

## Keys

`Ctrl+X` `F` hands the keyboard to the panel; `Esc` gives it back without closing
the panel.

| | |
|---|---|
| `tab` | next section, wrapping back to Files |
| `↑` / `↓` | move the cursor inside the open section |
| `r` | refresh now |
| click a header | open that section |
| click a row | put the cursor there |
| `+` / `-` / `=` | resize the panel — Titah's keys, not this extension's |

**`tab` only goes forward.** `shift+tab` arrives indistinguishable from `tab` — no
shift flag reaches an extension — and its escape sequence can be read as `escape`,
which releases panel focus. So going back means pressing `tab` four more times.

The cursor **clamps** at both ends rather than wrapping. In a windowed list,
wrapping from the last row to the first moves the entire window at once, and from
where you sit that looks like the list changed contents rather than like the
cursor going home.

Each section remembers its own cursor. Coming back to Branches after scrolling
Commits puts you back on the row you left.

## Why it is read-only, and will stay that way

No checkout, no staging, no stash apply. Not "not yet" — this panel runs inside
the Titah process **without passing through the permission dialog**, so a
keystroke that changed the working tree would never be shown to anyone first. And
that working tree is being used by an agent that may be halfway through editing a
file.

Watching is the whole feature. Use `git` for anything that writes.

## Notes from building it

**Nothing here writes to your repo.** Every call goes through
`--no-optional-locks` with `GIT_OPTIONAL_LOCKS=0`. A panel that refreshes while
you are mid-rebase must not touch `.git/index.lock` — that breaks a rebase in a
way nobody would connect back to a side panel.

**All six git commands run concurrently.** Titah's render budget is two seconds.
Run serially, a large repository waits for the sum of six commands, so the wait
that passes on a small repo times out on exactly the repo that most needs the
panel. There is a test that measures this rather than trusting the code's shape.

**The current branch is forced to the top of Branches.** `--sort=-committerdate`
gives an arbitrary order when branches point at the same commit, and it was
measured putting `main` fourth — which in a three-row accordion means the branch
you are actually on scrolls off the panel. The one thing you always need was the
easiest thing to lose.

**The `##` line is not a changed file.** `git status --porcelain=v1 --branch`
prints a `## main...origin/main` header. Counting it makes a clean repository
report one changed file — always, and nobody ever suspects the number one.

**Paths are shortened from the front.** Titah truncates tails, which for a path
throws away the only part that distinguishes it: two different files in the same
directory would render identically. Here `src/tui/panels.ts` becomes
`…i/panels.ts` — the filename survives.

**Status spaces become `·`.** ` M` and `M ` are different states — worktree versus
index — and a leading space is invisible.

**`Stash (0)` is drawn, not hidden.** A section that disappears when empty makes
the whole sidebar shift under your eyes every time you stash something.

## Tests

```bash
npm test
```

49 tests. The layout arithmetic — how many rows the open section gets, which
window is visible when the cursor scrolls past the bottom, which screen row means
what when clicked — lives in `src/sections.ts` as pure functions and is tested
exhaustively, because a one-row drift there makes every click select its
neighbour. Everything touching git is tested against **real temporary
repositories**, never a faked `git`: faking the output would only test our guess
about its format, and the format is the part that actually differs between git
versions.
