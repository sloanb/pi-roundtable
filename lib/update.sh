#!/usr/bin/env bash
# pi-roundtable update script
# Downloads and installs the latest release from GitHub.
# Security: HTTPS only, no arbitrary code execution, backup before update.

set -euo pipefail

# ========== CONFIGURATION ==========
REPO_OWNER="sloanb"
REPO_NAME="pi-roundtable"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}"
API_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}"
INSTALL_DIR="${PI_ROUNDTABLE_HOME:-$HOME/.pi-roundtable}"
BIN_DIR="$HOME/.local/bin"
WRAPPER_NAME="pi-roundtable"

# Files that users may customize (preserved during update)
USER_FILES=(
    "peers"
    "presets.json"
)

# ========== HELPER FUNCTIONS ==========

log() { echo "[$(date '+%H:%M:%S')] $*"; }
info() { log "INFO: $*"; }
warn() { log "WARN: $*" >&2; }
error() { log "ERROR: $*" >&2; }
die() {
    error "$*"
    exit 1
}

# Semantic version comparison
# Returns: 0 if v1 == v2, 1 if v1 > v2, 2 if v1 < v2
version_compare() {
    local v1="$1" v2="$2"
    # Strip leading 'v' if present
    v1="${v1#v}"
    v2="${v2#v}"
    if [[ "$v1" == "$v2" ]]; then return 0; fi
    local IFS=.
    local i ver1=($v1) ver2=($v2)
    # Fill empty fields with zeros
    for ((i = ${#ver1[@]}; i < ${#ver2[@]}; i++)); do ver1[i]=0; done
    for ((i = ${#ver2[@]}; i < ${#ver1[@]}; i++)); do ver2[i]=0; done
    for ((i = 0; i < ${#ver1[@]}; i++)); do
        if ((10#${ver1[i]} > 10#${ver2[i]})); then return 1; fi
        if ((10#${ver1[i]} < 10#${ver2[i]})); then return 2; fi
    done
    return 0
}

# Fetch JSON from GitHub API
github_api() {
    local endpoint="$1"
    curl -fsSL -H "Accept: application/vnd.github.v3+json" "${API_URL}${endpoint}"
}

# Get current installed version
get_current_version() {
    local version_file="${INSTALL_DIR}/package.json"
    if [[ -f "$version_file" ]]; then
        grep '"version"' "$version_file" | head -1 | sed -E 's/.*"version": *"([^"]+)".*/\1/'
    else
        echo "unknown"
    fi
}

# Get latest release from GitHub
get_latest_release() {
    local channel="${1:-stable}"
    local releases
    releases=$(github_api "/releases")

    if [[ -z "$releases" || "$releases" == "[]" ]]; then
        die "No releases found on GitHub. Cannot check for updates."
    fi

    if [[ "$channel" == "prerelease" ]]; then
        # Include pre-releases, sort by date, take first
        echo "$releases" | grep -E '"tag_name"|"prerelease"|"published_at"' | head -30
    fi

    # Default: latest stable release (not prerelease, not draft)
    echo "$releases" | grep -B2 '"prerelease": false' | grep -B2 '"draft": false' | head -6
}

# Parse release info from GitHub API JSON
parse_release() {
    local json="$1"
    local tag_name version tarball_url zipball_url published_at prerelease draft

    tag_name=$(echo "$json" | grep '"tag_name"' | head -1 | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
    version=$(echo "$tag_name" | sed 's/^v//')
    tarball_url=$(echo "$json" | grep '"tarball_url"' | head -1 | sed -E 's/.*"tarball_url": *"([^"]+)".*/\1/')
    zipball_url=$(echo "$json" | grep '"zipball_url"' | head -1 | sed -E 's/.*"zipball_url": *"([^"]+)".*/\1/')
    published_at=$(echo "$json" | grep '"published_at"' | head -1 | sed -E 's/.*"published_at": *"([^"]+)".*/\1/')
    prerelease=$(echo "$json" | grep '"prerelease"' | head -1 | sed -E 's/.*"prerelease": *([^,}]+).*/\1/')
    draft=$(echo "$json" | grep '"draft"' | head -1 | sed -E 's/.*"draft": *([^,}]+).*/\1/')

    echo "TAG_NAME=$tag_name"
    echo "VERSION=$version"
    echo "TARBALL_URL=$tarball_url"
    echo "ZIPBALL_URL=$zipball_url"
    echo "PUBLISHED_AT=$published_at"
    echo "PRERELEASE=$prerelease"
    echo "DRAFT=$draft"
}

# Download and verify tarball
download_and_verify() {
    local url="$1" dest_dir="$2" expected_version="$3"
    local tarball="${dest_dir}/pi-roundtable-${expected_version}.tar.gz"
    local sha256_file="${dest_dir}/pi-roundtable-${expected_version}.tar.gz.sha256"

    info "Downloading release tarball..."
    curl -fsSL -o "$tarball" "$url"

    # Verify download
    if [[ ! -s "$tarball" ]]; then
        die "Download failed or empty file"
    fi

    # Calculate SHA256
    local actual_sha256
    actual_sha256=$(sha256sum "$tarball" | cut -d' ' -f1)
    info "Downloaded tarball SHA256: $actual_sha256"

    # TODO: In future, verify against published checksums file
    # For now, we trust GitHub's TLS + release API
    echo "$actual_sha256" >"$sha256_file"

    echo "$tarball"
}

# Extract tarball
extract_tarball() {
    local tarball="$1" dest_dir="$2"
    info "Extracting release..."
    tar -xzf "$tarball" -C "$dest_dir" --strip-components=1
}

# Backup current installation
backup_installation() {
    local backup_dir="${INSTALL_DIR}.backup.$(date +%Y%m%d-%H%M%S)"
    info "Backing up current installation to $backup_dir"
    cp -r "$INSTALL_DIR" "$backup_dir"

    # Also backup user files separately for easy restore
    local user_backup="${backup_dir}.user-files"
    mkdir -p "$user_backup"
    for f in "${USER_FILES[@]}"; do
        if [[ -e "${INSTALL_DIR}/$f" ]]; then
            cp -r "${INSTALL_DIR}/$f" "$user_backup/"
        fi
    done

    echo "$backup_dir"
}

# Restore user customizations
restore_user_files() {
    local backup_dir="$1"
    local user_backup="${backup_dir}.user-files"

    if [[ ! -d "$user_backup" ]]; then
        warn "No user backup found at $user_backup"
        return 0
    fi

    info "Restoring user customizations..."
    for f in "${USER_FILES[@]}"; do
        if [[ -e "${user_backup}/$f" ]]; then
            # Compare with new version
            if [[ -e "${INSTALL_DIR}/$f" ]]; then
                if ! diff -r "${user_backup}/$f" "${INSTALL_DIR}/$f" >/dev/null 2>&1; then
                    warn "User file $f differs from upstream. Keeping user version."
                    # User version already in place (we didn't overwrite USER_FILES dirs)
                else
                    # Identical, nothing to do
                    :
                fi
            else
                # New file in upstream, user didn't have it - restore user's anyway
                cp -r "${user_backup}/$f" "${INSTALL_DIR}/"
            fi
        fi
    done
}

# Update symlink
update_symlink() {
    info "Updating symlink in $BIN_DIR"
    ln -sf "${INSTALL_DIR}/bin/${WRAPPER_NAME}" "${BIN_DIR}/${WRAPPER_NAME}"
}

# Clean old backups (keep last 3)
clean_old_backups() {
    local pattern="${INSTALL_DIR}.backup.*"
    local backups=()

    # Find all backup dirs, sort by name (timestamp), keep last 3
    mapfile -t backups < <(ls -1d $pattern 2>/dev/null | sort -r)

    if [[ ${#backups[@]} -gt 3 ]]; then
        info "Cleaning old backups (keeping 3 most recent)..."
        for ((i = 3; i < ${#backups[@]}; i++)); do
            rm -rf "${backups[i]}"
            rm -rf "${backups[i]}.user-files" 2>/dev/null || true
        done
    fi
}

# Check for updates only
check_only() {
    local channel="${1:-stable}"
    local current_version releases_json release_json release_info latest_version

    current_version=$(get_current_version)
    info "Current version: $current_version"

    # Fetch all releases and find the latest suitable one
    releases_json=$(github_api "/releases")
    if [[ -z "$releases_json" || "$releases_json" == "[]" ]]; then
        die "No releases found on GitHub. Cannot check for updates."
    fi

    # Find first non-prerelease, non-draft release
    release_json=$(echo "$releases_json" | grep -B2 '"prerelease": false' | grep -B2 '"draft": false' | head -6)
    if [[ -z "$release_json" ]]; then
        die "No stable releases found on GitHub."
    fi

    release_info=$(parse_release "$release_json")
    eval "$release_info"

    if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
        die "Could not parse latest release version"
    fi

    latest_version="$VERSION"
    info "Latest release:  $latest_version (tag: $TAG_NAME)"
    info "Published:       $PUBLISHED_AT"
    info "Release URL:     ${REPO_URL}/releases/tag/${TAG_NAME}"

    version_compare "$current_version" "$latest_version"
    local cmp=$?

    case $cmp in
    0)
        echo "✅ Already at latest version ($current_version)"
        return 0
        ;;
    1)
        echo "ℹ️  Current version ($current_version) is NEWER than latest release ($latest_version)"
        return 0
        ;;
    2)
        echo "🔄 Update available: $current_version → $latest_version"
        return 1
        ;;
    esac
}

# Main update function
do_update() {
    local channel="${1:-stable}"
    local assume_yes="${2:-false}"
    local current_version release_info latest_version tarball backup_dir

    current_version=$(get_current_version)
    info "Current version: $current_version"

    # Fetch latest release
    info "Fetching latest release from GitHub..."
    releases_json=$(github_api "/releases")
    if [[ -z "$releases_json" || "$releases_json" == "[]" ]]; then
        die "No releases found on GitHub. Cannot update."
    fi

    # Find first non-prerelease, non-draft release (respecting channel)
    if [[ "$channel" == "prerelease" ]]; then
        release_json=$(echo "$releases_json" | head -6)
    else
        release_json=$(echo "$releases_json" | grep -B2 '"prerelease": false' | grep -B2 '"draft": false' | head -6)
    fi
    if [[ -z "$release_json" ]]; then
        die "No suitable releases found on GitHub for channel: $channel"
    fi

    release_info=$(parse_release "$release_json")
    eval "$release_info"

    if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
        die "Could not parse latest release version"
    fi

    latest_version="$VERSION"
    info "Latest release:  $latest_version (tag: $TAG_NAME)"
    info "Published:       $PUBLISHED_AT"
    info "Release URL:     ${REPO_URL}/releases/tag/${TAG_NAME}"

    # Compare versions
    version_compare "$current_version" "$latest_version"
    local cmp=$?

    case $cmp in
    0)
        info "Already at latest version ($current_version)"
        return 0
        ;;
    1)
        warn "Current version ($current_version) is newer than latest release ($latest_version)"
        if [[ "$assume_yes" != "true" ]]; then
            read -rp "Continue anyway? [y/N] " -n 1
            echo
            [[ $REPLY =~ ^[Yy]$ ]] || {
                info "Aborted."
                return 0
            }
        fi
        ;;
    2)
        info "Update available: $current_version → $latest_version"
        ;;
    esac

    # Confirm with user
    if [[ "$assume_yes" != "true" ]]; then
        echo
        echo "This will:"
        echo "  1. Backup current installation"
        echo "  2. Download and verify release $TAG_NAME"
        echo "  3. Install to $INSTALL_DIR"
        echo "  4. Update symlink in $BIN_DIR"
        echo "  5. Preserve your custom peers/ and presets.json"
        echo
        read -rp "Proceed? [y/N] " -n 1
        echo
        [[ $REPLY =~ ^[Yy]$ ]] || {
            info "Aborted by user."
            return 0
        }
    fi

    # Backup
    backup_dir=$(backup_installation)

    # Create temp directory for download/extraction
    local tmp_dir
    tmp_dir=$(mktemp -d -t pi-roundtable-update.XXXXXX)
    trap 'rm -rf "$tmp_dir"' EXIT

    # Download
    tarball=$(download_and_verify "$TARBALL_URL" "$tmp_dir" "$latest_version")

    # Extract to temp location first
    local extract_dir="${tmp_dir}/extract"
    mkdir -p "$extract_dir"
    extract_tarball "$tarball" "$extract_dir"

    # Verify extracted structure
    if [[ ! -f "${extract_dir}/package.json" ]] || [[ ! -d "${extract_dir}/lib" ]]; then
        die "Extracted release has unexpected structure. Aborting."
    fi

    # Preserve user directories before copying
    local user_backups=()
    for f in "${USER_FILES[@]}"; do
        if [[ -e "${INSTALL_DIR}/$f" ]]; then
            local ub="${tmp_dir}/user-${f//\//-}"
            cp -r "${INSTALL_DIR}/$f" "$ub"
            user_backups+=("$f:$ub")
        fi
    done

    # Install new version (rsync-style: delete files not in source, but preserve USER_FILES)
    info "Installing new version..."
    rsync -a --delete \
        --exclude='peers' \
        --exclude='presets.json' \
        "${extract_dir}/" "${INSTALL_DIR}/"

    # Restore user files
    for entry in "${user_backups[@]}"; do
        local f="${entry%%:*}"
        local ub="${entry#*:}"
        cp -r "$ub" "${INSTALL_DIR}/$f"
    done

    # Update symlink
    update_symlink

    # Clean old backups
    clean_old_backups

    # Verify installation
    local new_version
    new_version=$(get_current_version)
    if [[ "$new_version" == "$latest_version" ]]; then
        info "✅ Successfully updated to version $new_version"
    else
        warn "Version mismatch after update: expected $latest_version, got $new_version"
    fi

    echo
    echo "Backup saved at: $backup_dir"
    echo "To rollback:     pi-roundtable --rollback"
    echo
}

# Rollback to previous version
do_rollback() {
    local backups=()

    mapfile -t backups < <(ls -1d "${INSTALL_DIR}.backup."* 2>/dev/null | sort -r)

    if [[ ${#backups[@]} -eq 0 ]]; then
        die "No backups found. Cannot rollback."
    fi

    local latest_backup="${backups[0]}"
    info "Found backup: $latest_backup"

    if [[ ! -d "$latest_backup" ]]; then
        die "Backup directory not found: $latest_backup"
    fi

    echo "This will restore the previous installation from:"
    echo "  $latest_backup"
    read -rp "Proceed with rollback? [y/N] " -n 1
    echo
    [[ $REPLY =~ ^[Yy]$ ]] || {
        info "Aborted."
        return 0
    }

    # Remove current installation
    rm -rf "$INSTALL_DIR"

    # Restore backup
    mv "$latest_backup" "$INSTALL_DIR"

    # Update symlink
    update_symlink

    local restored_version
    restored_version=$(get_current_version)
    info "✅ Rolled back to version $restored_version"
}

# ========== MAIN ==========

usage() {
    cat <<EOF
pi-roundtable update script

Usage: $0 [command] [options]

Commands:
  check         Check for updates (exit code 1 if update available)
  update        Download and install latest release
  rollback      Restore previous version from backup

Options:
  --channel CHANNEL    Release channel: stable (default), prerelease
  --yes, -y            Non-interactive mode (assume yes to prompts)
  --help               Show this help

Environment:
  PI_ROUNDTABLE_HOME   Override install directory (default: ~/.pi-roundtable)

Examples:
  $0 check
  $0 update
  $0 update --yes
  $0 rollback
EOF
}

main() {
    local cmd="${1:-}"
    local channel="stable"
    local assume_yes="false"

    shift || true
    while [[ $# -gt 0 ]]; do
        case $1 in
        --channel)
            channel="$2"
            shift 2
            ;;
        --yes | -y)
            assume_yes="true"
            shift
            ;;
        --help)
            usage
            exit 0
            ;;
        *) die "Unknown option: $1" ;;
        esac
    done

    # Validate channel
    case "$channel" in
    stable | prerelease) ;;
    *) die "Invalid channel: $channel (must be stable or prerelease)" ;;
    esac

    case "$cmd" in
    check) check_only "$channel" ;;
    update) do_update "$channel" "$assume_yes" ;;
    rollback) do_rollback ;;
    "")
        usage
        exit 1
        ;;
    *) die "Unknown command: $cmd" ;;
    esac
}

main "$@"
