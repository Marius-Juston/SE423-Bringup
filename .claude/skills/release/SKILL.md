---
name: release
description: Publish the Bringup game: the web version on GitHub Pages and desktop installers as a GitHub release that the one-line install scripts fetch. Use when asked to release, publish, deploy, tag a version or update the installers.
---

# Publish

The repository is public. Nothing goes out without the checks in the `verify` skill passing, and without the owner asking for the push or the release.

**Web version.** Every push to `main` runs CI and `.github/workflows/pages.yml`, which tests, builds and deploys to https://marius-juston.github.io/SE423-Bringup/. Returning visitors get the new version on their next load (the service worker in `vite.config.ts` refreshes its cache when any file changes).

**Installers.**
1. Choose the version (`X.Y.Z`). Set it in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Refresh lockfiles: `npx -y npm@latest install --package-lock-only` (CI's npm rejects a lockfile without the optional WebAssembly helpers that older npm leaves out) and `cargo update -p bringup` in `src-tauri/`.
3. Commit, push `main`, wait for CI and Pages to pass (`gh run list`).
4. `git tag vX.Y.Z && git push origin vX.Y.Z`. `.github/workflows/release.yml` builds Windows, macOS (Apple silicon and Intel) and Linux installers and publishes the release. Check it: `gh release view vX.Y.Z --json assets --jq '.assets[].name'` should list a `.deb`, `.rpm`, `.AppImage`, two `.dmg`, a `-setup.exe` and an `.msi`.
5. Check the installer script picks it up: `curl -fsSL https://marius-juston.github.io/SE423-Bringup/install.sh | bash` on a test machine (or with `sudo` replaced by a stand-in on `PATH` to stop before the privileged step).

**Rules.** Actions in workflows are pinned by commit SHA with the version in a comment. The builds are not code-signed; the README and the install scripts say what students will see. Commit messages and release notes carry no session links.
