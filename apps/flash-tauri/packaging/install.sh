#!/bin/sh
# Installs Flash for the current user: ~/.local/bin/flash, its app-menu entry
# and icon. Run it from the unpacked release folder. Remove with --uninstall.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
bin="$HOME/.local/bin/flash"
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
icons="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$bin" "$apps/com.flash.clipper.desktop" "$icons/com.flash.clipper.png"
  echo "Flash removed. Clips and settings were left in place."
  exit 0
fi

mkdir -p "$(dirname "$bin")" "$apps" "$icons"
install -m 755 "$here/flash" "$bin"
install -m 644 "$here/flash.png" "$icons/com.flash.clipper.png"
# KDE resolves global shortcuts and its screencast permission through this
# entry, so Exec must be the real path.
sed "s|^Exec=.*|Exec=$bin|; s|^Icon=.*|Icon=com.flash.clipper|" "$here/com.flash.clipper.desktop" > "$apps/com.flash.clipper.desktop"
command -v update-desktop-database >/dev/null && update-desktop-database "$apps" 2>/dev/null || true
echo "Flash installed. Open it from your app menu."
