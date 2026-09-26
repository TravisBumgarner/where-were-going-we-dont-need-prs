---
name: init
description: Set up a new product repo to be built with tb — rules taxonomy root, CLAUDE.md, the pinned guardrails workflow, and CODEOWNERS. Use when the user says "/tb:init", starts a new product with this workflow, or asks to "set up a rules repo".
argument-hint: "[path to the new repo]"
---

# /tb:init

Bootstrap a product repo (like a todo app) that's built by reviewing rules instead of code. Templates are in this skill's base directory under `templates/`.

## 1. Gather values

Ask for everything in one message, and suggest defaults where you have them:

- **Path**: the argument, or the current directory. It must be empty or not exist yet. If it has files, stop and ask.
- **Product name**: becomes the root node's title (e.g. "Todo").
- **One- or two-sentence summary**: what the product is. It's shown at the top of the map.
- **GitHub owner**: used for CODEOWNERS. Default: the user from `gh api user --jq .login`, if `gh` is signed in.
- **Tool repo and commit**: where this plugin's repo lives on GitHub (`owner/we-dont-need-prs`) and the SHA to pin. Look it up from the plugin's root (two levels above this skill's base directory): `git -C <root> remote get-url origin` and `git -C <root> rev-parse HEAD`. If it isn't pushed yet, say so. The workflow still gets written, with `TODO` placeholders that the human fills in later.

## 2. Create the repo

1. Create the directory if needed and run `git init -b main`.
2. Copy the templates, replacing every `{{PLACEHOLDER}}`:
   - `templates/CLAUDE.md` → `CLAUDE.md`
   - `templates/rules/index.md` → `rules/index.md`
   - `templates/.github/workflows/guardrails.yml` → `.github/workflows/guardrails.yml`
   - `templates/.github/CODEOWNERS` → `.github/CODEOWNERS`
   - `templates/gitignore` → `.gitignore`
3. Afterwards, `grep -r '{{' .` must return nothing. The only placeholders allowed to remain are the explicit `TODO`s from step 1.
4. Show the user the file list, then ask before making the one allowed commit on `main`: `Initialize rules repo`. Every later change goes through `/tb:branch`.

## 3. Hand over the human-only setup

These steps are what make the guardrails real. Only the human can do them, so list them clearly and don't do them yourself:

1. Create the GitHub repo and push `main`.
2. Add a ruleset on `main`:
   - require a pull request with approval from code owners
   - require the `guardrails / guardrails` status check
   - block force pushes and deletion
   - allow only the owner to bypass
3. Give Claude a separate, lower-privilege identity for pushing branches and opening PRs: a bot account, or a fine-grained token with contents and pull-request write access to this repo only, and no admin rights.
4. If the tool repo is private, make sure this repo's Actions can read it (Settings → Actions → Access on the tool repo).

Finish by suggesting the first step: `/tb:branch "<first thing to build>"`.
