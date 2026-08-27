# Working in this repo

## Git: commit and push automatically
Commit finished chunks of work as you go — don't wait to be asked, don't batch a
session's changes into one commit at the end. Push after committing; `origin/main`
is the working copy, not a staging area that needs review before it updates.

Still always ask first for anything destructive or history-rewriting: force-push,
`reset --hard`, amending a commit that's already been pushed, rebase. Those stay
manual regardless of this rule.

Commit identity for this repo only (not global git config) is set to the GitHub
noreply address, so pushes don't expose the real one (GitHub account has "keep
email private" on — GH007 rejects a push otherwise). Already configured in
`.git/config`; if it's ever missing, the address is
`77525853+WYTongFeng@users.noreply.github.com`.

## APK releases: rebuild and track whenever package.json's version changes
The repo tracks exactly one APK at a time — whichever matches the current
`package.json` version — as `lifemanager-<version>.apk` in the repo root.
`.gitignore` blanket-excludes `*.apk` and re-includes only that one file via a
`!lifemanager-<version>.apk` line.

Whenever a version bump lands (`package.json`'s `version` no longer matches the
currently-tracked apk), rebuild and swap it in:

```bash
npm run release                             # builds web + apk, writes dist/version.json
cp dist/downloads/lifemanager-<new>.apk .   # stage the new one at repo root
git rm lifemanager-<old>.apk                # drop the old tracked one
```

Then update `.gitignore`'s `!lifemanager-<old>.apk` line to the new version,
`git add` both the apk and `.gitignore`, commit, push.

**`firebase deploy --only hosting` always stays a manual, user-run step** — never
run it automatically, even under the auto-commit/push rule above. `npm run
release` deliberately stops short of deploying (see the comment at the top of
`scripts/release.mjs`): it's the one step here that's actually visible to the
outside world, since installed phones pull updates from it.

Building the apk needs a JDK 21 + space-free-agent-jar workaround because of
where this project lives on disk (`C:\Users\MacBook Pro\...`); `npm run release`
/ `npm run apk` already handle it automatically. If a build ever fails outright
instead of just running normally, see `android/BUILD_NOTES.md` before
re-deriving the fix from scratch.

## .gitignore
Already set up correctly — don't loosen any of this without being asked:
- `node_modules`, `dist`, `dist-ssr`, `.firebase` — regenerated, not source
- `*.local` (covers `.env.local`) and `lifemanager-*.json` — real secrets /
  personal financial backups
- `*.apk` except the one current release apk (see above)
- `.claude/settings.local.json` — per-machine permissions, not shared project config
