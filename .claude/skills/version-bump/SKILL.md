---
name: version-bump
description: Bump the app version (minor for new features, patch for bug fixes only) and increase the Android build count (versionCode). Use when asked to bump, raise or release a new version of the app.
---

# Version bump

The version is kept in three files and must be the same in all of them:

| File | Field |
|---|---|
| `app.json` | `expo.version` |
| `package.json` | `version` |
| `android/app/build.gradle` | `versionName` in `defaultConfig` |

The build count is `versionCode` in `android/app/build.gradle` (`defaultConfig`). It goes up by 1
with every bump, the Play Store refuses a bundle with a versionCode it has seen before.
`app.json` has no `android.versionCode`, the `android/` folder is committed and its `build.gradle`
is what counts.

## 1. Find the changes since the last bump

There are no git tags. A bump is a commit with the message `Version X.Y.Z`:

```bash
last=$(git log --format=%H --grep='^Version [0-9]\+\.[0-9]\+\.[0-9]\+$' -1)
git log --oneline "$last"..HEAD
```

If there are no commits after the last bump, stop and tell the user there is nothing to release.

## 2. Choose the part to bump

Read the commit subjects (and the diffs where the subject is unclear):

- **minor** (`1.1.0` → `1.2.0`): at least one commit adds a feature or changes behavior the user
  can see — a new screen, setting, action, a new way something works.
- **patch** (`1.1.0` → `1.1.1`): all commits only fix bugs, or are refactors, docs, build or
  dependency changes without a new feature.
- **major**: only when the user asks for it.

If the user names the part (or the exact version), use that. Tell the user which part you chose
and list the commits that decided it.

## 3. Edit the files

Read the current version from `app.json` and check that `package.json` and `versionName` match it;
if they do not, ask the user which one is right.

Set the new version in all three places and raise `versionCode` by 1, e.g. for 1.1.0 → 1.2.0:

```diff
-        versionCode 2
-        versionName "1.1.0"
+        versionCode 3
+        versionName "1.2.0"
```

Do not touch `yarn.lock` or any other file.

Check the result:

```bash
grep -n '"version"' app.json package.json
grep -nE 'versionCode|versionName' android/app/build.gradle
```

## 4. Commit

Commit only these three files, with the message `Version X.Y.Z` (exactly that, so the next bump
finds it) and the usual attribution lines. Do not tag and do not push unless the user asks.

`./build.sh bundle` names the output `dist/WanderNavi-X.Y.Z.aab` after `app.json`, so build after
the bump commit when a release is wanted.
