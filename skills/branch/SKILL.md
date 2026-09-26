---
name: branch
description: Start a new piece of work on a fresh git branch named from a short description. Use when the user says "/tb:branch <what we're doing>", "start a branch for …", or begins new work while on main.
argument-hint: "<what we're doing>"
---

# /tb:branch

Start new work on its own branch. The argument is a plain-English description of what we're about to do.

1. **Check the repo.** If this isn't a git repo, stop and tell the user. Don't run `git init` yourself.
2. **Check the working tree.** If `git status --porcelain` shows uncommitted changes, stop. List them and ask whether to commit them first (with `/tb:commit`), stash them, or carry them onto the new branch.
3. **Pick a name.** Base it on the description:
   - kebab-case, 2–5 words, lowercase `a-z0-9-` only
   - describe the behavior being changed, not the implementation (`free-trial-limits`, not `add-trial-column`)
   - if that branch already exists locally or on the remote, add a suffix (`-2`)
4. **Create it from the latest main.**
   ```sh
   git switch main
   git pull --ff-only   # skip if there's no remote
   git switch -c <name>
   ```
5. **Confirm** in one line: the branch name and the description it came from. Mention that `/tb:commit` will capture the conversation as rules when we're done.

If no description was given, ask for one. Don't make one up.
