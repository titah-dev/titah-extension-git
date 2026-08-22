# @titah/extension-git

A git side panel for [Titah](https://github.com/titah-dev/titah): current branch,
local branches, worktrees, and how many files changed.

```
╭──────────────────╮
│ Git              │
│ main             │
│ 1 changed        │
│                  │
│ feature/panels   │
│ hotfix           │
│                  │
│ b branches · r … │
╰──────────────────╯
```

## Install

```bash
titah extension install @titah/extension-git
```

Or name it yourself:

```jsonc
{
  "extension": {
    "@titah/extension-git": {
      "side": "left",
      "key": "<leader>g",
      "options": { "branchLimit": 12, "worktrees": true }
    }
  }
}
```

| Option | Default | |
|---|---|---|
| `branchLimit` | `12` | How many other branches to list in the summary |
| `worktrees` | `true` | Show the worktree list. Hidden anyway when there is only one |

Inside the panel: `b` toggles the full branch list, `r` refreshes.

## Why this package exists twice over

It is a git panel, and it is also the **reference extension** — the thing that
proves Titah's extension API is enough before anyone else discovers it is not.

So it imports exactly one thing:

```ts
import type { ExtensionFactory, View, ViewRow } from "titah-code/extension"
```

That is not self-discipline. Titah's `package.json` declares `exports` with a
single entry, so `titah-code/core/permission.js` fails to resolve at all — the
allowlist in
[`docs/extensions.md`](https://github.com/titah-dev/titah/blob/main/docs/extensions.md)
is enforced by Node's resolver, not by a promise in a document.

It also has **no runtime dependencies**. A panel that fails because of module
resolution is a panel that fails for a reason with nothing to do with git.

## Notes from writing it

**Nothing here writes to your repo.** Every git call goes through
`--no-optional-locks` with `GIT_OPTIONAL_LOCKS=0`. A panel that refreshes while
you are mid-rebase must not touch `.git/index.lock` — that would break a rebase
in a way nobody would ever connect back to a side panel.

**`LC_ALL=C` on every call.** Without it the panel works on the author's machine
and shows blank rows on anyone whose locale changes git's output.

**Not a git repo is a valid state, not a failure.** People open Titah in ordinary
folders. A panel that reports `failed` there teaches people to ignore failure
reports — including the real ones.

**All four git commands run concurrently.** Titah's render budget is two seconds.
Run serially, a large repo waits for the sum of four commands, so the wait that
passes on a small repo times out on exactly the repo that most needs this panel.
There is a test that measures this rather than trusting the code shape.

**The `##` line is not a changed file.** `git status --porcelain=v1 --branch`
prints a `## main...origin/main` header. Counting it makes a clean repo report
one changed file — always, and nobody ever suspects the number one.

## Tests

```bash
npm test
```

Tests build against **real temporary git repositories**, never a faked `git`.
Faking the output would only test our guess about its format, and the format is
the part that actually differs between git versions.
