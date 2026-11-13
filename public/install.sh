#!/usr/bin/env bash
# Installs Bringup, the SE 423 practice game.
#   curl -fsSL https://marius-juston.github.io/SE423-Bringup/install.sh | bash
# Linux: the .deb (Debian, Ubuntu), the .rpm (Fedora) or an AppImage in
# ~/.local/bin. macOS: the app in /Applications. Nothing else is changed.
# The game also runs in a browser, with nothing to install:
#   https://marius-juston.github.io/SE423-Bringup/
set -euo pipefail

REPO="Marius-Juston/SE423-Bringup"
WEB="https://marius-juston.github.io/SE423-Bringup/"
say() { printf '%s\n' "$*"; }
fail() { say "bringup: $*" >&2; say "You can play in the browser instead: $WEB" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is needed to download the installer."
os="$(uname -s)"
arch="$(uname -m)"

say "Looking up the latest release of Bringup..."
assets="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(https[^"]*\)"/\1/')" ||
  fail "no release has been published yet."
[ -n "$assets" ] || fail "the latest release has no installers."
pick() { printf '%s\n' "$assets" | grep -E "$1" | head -n 1 || true; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
get() { say "Downloading $(basename "$1")..."; curl -fL --progress-bar -o "$tmp/$(basename "$1")" "$1"; }

case "$os" in
  Linux)
    case "$arch" in
      x86_64 | amd64) deb='_amd64\.deb$'; rpm='\.x86_64\.rpm$'; img='_amd64\.AppImage$' ;;
      aarch64 | arm64) deb='_arm64\.deb$'; rpm='\.aarch64\.rpm$'; img='_aarch64\.AppImage$' ;;
      *) fail "there is no desktop build for $arch." ;;
    esac
    url=""
    if command -v apt-get >/dev/null 2>&1; then url="$(pick "$deb")"; fi
    if [ -n "$url" ]; then
      get "$url"
      say "Installing (this asks for your password)..."
      sudo apt-get install -y "$tmp/$(basename "$url")"
    elif command -v dnf >/dev/null 2>&1 && url="$(pick "$rpm")" && [ -n "$url" ]; then
      get "$url"
      say "Installing (this asks for your password)..."
      sudo dnf install -y "$tmp/$(basename "$url")"
    else
      url="$(pick "$img")"
      [ -n "$url" ] || fail "the latest release has no Linux build for $arch."
      get "$url"
      mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications"
      install -m 755 "$tmp/$(basename "$url")" "$HOME/.local/bin/bringup"
      cat >"$HOME/.local/share/applications/bringup.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Bringup
Comment=SE 423 practice game
Exec=$HOME/.local/bin/bringup
Terminal=false
Categories=Education;
DESKTOP
      say "Installed to ~/.local/bin/bringup (make sure ~/.local/bin is on your PATH)."
    fi
    say "Done. Start Bringup from your applications menu."
    ;;
  Darwin)
    case "$arch" in
      arm64) url="$(pick '_aarch64\.dmg$')" ;;
      x86_64) url="$(pick '_x64\.dmg$')" ;;
      *) url="" ;;
    esac
    [ -n "$url" ] || fail "the latest release has no macOS build for $arch."
    get "$url"
    mnt="$tmp/mnt"
    mkdir -p "$mnt"
    hdiutil attach -nobrowse -quiet -mountpoint "$mnt" "$tmp/$(basename "$url")"
    rm -rf "/Applications/Bringup.app"
    cp -R "$mnt/Bringup.app" /Applications/
    hdiutil detach -quiet "$mnt"
    # The app is not signed with an Apple developer certificate. Without
    # this, macOS refuses to open an app that was downloaded.
    xattr -dr com.apple.quarantine "/Applications/Bringup.app" 2>/dev/null || true
    say "Done. Bringup is in your Applications folder."
    ;;
  *)
    fail "this installer covers Linux and macOS. On Windows, run in PowerShell:  irm ${WEB}install.ps1 | iex"
    ;;
esac
