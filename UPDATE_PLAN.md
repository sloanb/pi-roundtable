# pi-roundtable --update Feature Plan

## Overview

Add a `--update` flag to the CLI that securely fetches the latest version from GitHub and updates the local installation.

## Security Principles (Non-Negotiable)

1. **HTTPS Only** - All downloads must use `https://github.com/...`
2. **Signature Verification** - Verify GitHub release artifacts against known checksums or signed commits
3. **No Arbitrary Code Execution** - Never pipe curl directly to bash; always download, verify, then execute
4. **Pin to Specific Release/Tag** - Default to latest stable release, not `main` branch
5. **User Consent** - Interactive confirmation before making changes (unless `--yes` flag)
6. **Rollback Capability** - Keep previous version for easy rollback
7. **Transparency** - Show exactly what will be downloaded and from where
8. **Minimal Permissions** - Only write to `~/.pi-roundtable` and `~/.local/bin/pi-roundtable`

## Installation Structure Recap

```
~/.pi-roundtable/
  bin/pi-roundtable         ← wrapper script (symlinked from ~/.local/bin/)
  lib/pi-roundtable.mjs     ← main entrypoint
  lib/rpc-client.mjs
  lib/roundtable.mjs
  peers/*.md
  presets.json
  README.md
  LICENSE
```

## Implementation Plan (Phased)

---

### Phase 1: Core Update Logic (Bash Script)

**File**: `lib/update.sh` (new file, called by CLI)

Create a standalone, audit-friendly bash script that:

1. Determines current version (from package.json or git tag)
2. Fetches latest release metadata from GitHub API
3. Verifies release authenticity
4. Downloads release tarball
5. Verifies checksum
6. Backs up current installation
7. Installs new version
8. Updates symlink
9. Reports success/failure with rollback instructions

**Security measures in script:**

- Use `curl -fsSL` with explicit HTTPS URLs
- Verify TLS certificate (default)
- Download to temp dir, verify, then atomic move
- Preserve user-modified peer/preset files (merge strategy)
- No `eval`, no `bash -c "$(curl...)"` patterns

---

### Phase 2: CLI Integration

**File**: `lib/pi-roundtable.mjs`

1. Add `--update` flag to `parseArgs()`
2. Add `--yes` / `-y` flag for non-interactive mode
3. Add `--channel` flag: `stable` (default), `latest`, `prerelease`
4. Add `--check-only` flag to check for updates without installing
5. Call `lib/update.sh` via `spawn` with proper error handling
6. Exit after update (don't continue to run roundtable)

---

### Phase 3: Version Detection

**File**: `lib/pi-roundtable.mjs` + `package.json`

1. Embed version in built/installable artifact
2. Read current version from `~/.pi-roundtable/package.json` or git metadata
3. Compare with GitHub latest release
4. Show current vs available version in `--check-only` and `--update` output

---

### Phase 4: GitHub Release Verification

**Options (in order of preference):**

1. **Signed Commits/Tags** - Verify `git verify-tag` or `git verify-commit` (requires GPG setup)
2. **Checksums File** - GitHub releases can include `SHA256SUMS` signed by maintainer
3. **Release API + Known Fingerprint** - Compare artifact hash against expected value published separately
4. **Minimal: HTTPS + Release API** - Trust GitHub's TLS + release metadata (baseline)

**Recommendation for MVP**: Option 4 (HTTPS + GitHub Release API) with clear documentation that supply-chain verification is user's responsibility for high-security environments. Document how to add GPG verification later.

---

### Phase 5: Backup & Rollback

1. Before update: `cp -r ~/.pi-roundtable ~/.pi-roundtable.backup.$(date +%s)`
2. On failure: Offer to restore from backup
3. Keep last 3 backups, auto-clean older
4. `--rollback` flag to restore previous version

---

### Phase 6: Preserve User Customizations

**Files that may be user-modified:**

- `peers/*.md` (custom peers)
- `presets.json` (custom presets)
- `README.md` (unlikely but possible)

**Strategy:**

- Back up user files before update
- After update, show diff if user files differ from upstream
- Offer to merge or keep user versions
- Never overwrite without prompting (unless `--yes`)

---

## Task Breakdown

### Task 1: Create `lib/update.sh` (Standalone Update Script)

- [ ] Write script with all security measures
- [ ] Test manual execution
- [ ] Make executable

### Task 2: Add CLI Flags (`--update`, `--yes`, `--channel`, `--check-only`, `--rollback`)

- [ ] Update `parseArgs()`
- [ ] Update `printHelp()`
- [ ] Add handler in `main()`

### Task 3: Version Detection & Comparison

- [ ] Read current version from install dir
- [ ] Fetch latest release from GitHub API
- [ ] Compare versions (semver)

### Task 4: Integration - Call Update Script from CLI

- [ ] Spawn update.sh with proper args
- [ ] Handle output streaming
- [ ] Exit codes and error handling

### Task 5: Backup & Rollback Logic

- [ ] Implement backup in update.sh
- [ ] Add `--rollback` flag to CLI

### Task 6: User Customization Preservation

- [ ] Detect modified files
- [ ] Diff and merge strategy
- [ ] Interactive prompts

### Task 7: Testing & Documentation

- [ ] Test clean install → update
- [ ] Test with custom peers/presets
- [ ] Test rollback
- [ ] Update README with update instructions
- [ ] Document security model

---

## GitHub API Endpoints

- Latest release: `https://api.github.com/repos/sloanb/pi-roundtable/releases/latest`
- All releases: `https://api.github.com/repos/sloanb/pi-roundtable/releases`
- Release assets: Included in release object
- Tarball: `https://github.com/sloanb/pi-roundtable/archive/refs/tags/v{X.Y.Z}.tar.gz`

---

## Example User Flow

```bash
# Check for updates
$ pi-roundtable --check-only
Current version: 0.1.0
Latest release:  0.2.0 (2025-01-15)
Update available! Run: pi-roundtable --update

# Update interactively
$ pi-roundtable --update
Current: 0.1.0 → Available: 0.2.0
Download from: https://github.com/sloanb/pi-roundtable/releases/tag/v0.2.0
Backup current install to: ~/.pi-roundtable.backup.20250115-123456
Proceed? [y/N] y
✅ Updated to 0.2.0

# Non-interactive (CI/CD)
$ pi-roundtable --update --yes

# Rollback
$ pi-roundtable --rollback
Restored from: ~/.pi-roundtable.backup.20250115-123456
```

---

## Threat Model & Mitigations

| Threat | Mitigation |
| -------- | ------------ |
| MITM on download | HTTPS + TLS verification (curl default) |
| Compromised GitHub release | Document: verify GPG signatures for high-security use |
| Malicious update.sh | Script is part of repo; user audits on install; `--check-only` shows what would run |
| Accidental data loss | Auto-backup before update; `--rollback` |
| Supply chain attack | Pin to specific tag; verify checksums; signed releases (future) |
| Typosquatting | Hardcoded repo URL (sloanb/pi-roundtable) |

---

## Future Enhancements (Post-MVP)

1. **Auto-update daemon** (opt-in)
2. **GPG-signed release verification**
3. **Delta updates** (only changed files)
4. **Channel switching** (stable/beta/nightly)
5. **Update notifications** in roundtable output
