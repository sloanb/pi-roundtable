#!/usr/bin/env bash
# Install pi-roundtable. Idempotent: re-running updates the install.
#
# Usage:
#   ./install.sh                  # install from current directory
#   curl ... | bash               # install from latest GitHub release
#
# Installs to:
#   ~/.pi-roundtable/             # all source files
#   ~/.local/bin/pi-roundtable    # symlink to the wrapper
#
# No sudo required. Doesn't touch any config outside ~/.pi-roundtable and
# ~/.local/bin.

set -euo pipefail

# Resolve the source directory. When invoked as `./install.sh`, $0 is the
# script itself. When piped from curl, $0 is "bash" — in that case we clone
# the repo first.
SRC_DIR=""
if [ "${0}" = "bash" ] || [ "${0}" = "/bin/bash" ] || [ "${0}" = "/usr/bin/bash" ]; then
	echo "Installing from GitHub (curl-piped installer)..."
	TMP_DIR="$(mktemp -d)"
	trap 'rm -rf "$TMP_DIR"' EXIT
	git clone --depth 1 https://github.com/sloanb/pi-roundtable.git "$TMP_DIR/pi-roundtable"
	SRC_DIR="$TMP_DIR/pi-roundtable"
else
	SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

INSTALL_DIR="${PI_ROUNDTABLE_HOME:-$HOME/.pi-roundtable}"
BIN_DIR="$HOME/.local/bin"

echo "Installing to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$BIN_DIR"

# Copy source files (bin, lib, peers, presets.json). Use rsync-like logic
# with cp -r. Skip files that don't exist so the script is robust to partial
# checkouts.
for dir in bin lib peers; do
	if [ -d "$SRC_DIR/$dir" ]; then
		cp -r "$SRC_DIR/$dir" "$INSTALL_DIR/"
	fi
done
for file in presets.json README.md LICENSE package.json; do
	if [ -f "$SRC_DIR/$file" ]; then
		cp "$SRC_DIR/$file" "$INSTALL_DIR/"
	fi
done

# Make the wrapper executable (git may have lost the bit).
chmod +x "$INSTALL_DIR/bin/pi-roundtable"

# Symlink into ~/.local/bin. Use -f so re-running updates the link.
ln -sf "$INSTALL_DIR/bin/pi-roundtable" "$BIN_DIR/pi-roundtable"

echo ""
echo "✅ pi-roundtable installed to $INSTALL_DIR"
echo "✅ $BIN_DIR/pi-roundtable is on PATH"
echo ""
echo "Verify with:  pi-roundtable --help"
echo ""
echo "If 'pi-roundtable' is not found, ensure ~/.local/bin is in your PATH:"
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
echo ""
echo "To uninstall:  rm -rf ~/.pi-roundtable ~/.local/bin/pi-roundtable"
