# GitHub Workflows for bmp-debug

This directory contains automated workflows for building, testing, and releasing
the bmp-debug VS Code extension.

## Release Workflows

### Simplified Release Process

The release process has been consolidated into a streamlined workflow that
requires only one manual action.

#### Workflows Overview

1. **`bump-version.yml`** - Manual workflow to bump version and optionally trigger a release

   - **Trigger:** Manual (`workflow_dispatch`)
   - **Inputs:**
     - `bump_type`: patch, minor, or major
     - `release_type`: none, release, or prerelease
   - **Actions:**
     - Bumps version in `package.json`
     - Auto-generates a `CHANGELOG.md` entry from git commit history since the last tag
     - Creates a PR to `develop` branch with auto-merge enabled (SQUASH)
     - Tags the PR title with `[release]` or `[prerelease]` if specified

2. **`_auto-create-release-pr.yml`** - Automatic workflow triggered when version is bumped (prefixed with `_` to indicate it runs automatically)

   - **Trigger:** PR merged to `develop` branch, or manual `workflow_dispatch`
   - **Actions:**
     - Detects release type from PR title tag (`[release]` or `[prerelease]`)
     - Directly rebases `develop` onto `main` (release) or `pre-release` (prerelease)
     - No PRs, no squash, no merge commits — a straight rebase
     - Skips if no release tag is found

3. **`_release.yml`** - Automatic workflow for publishing the extension (prefixed with `_` to indicate it runs automatically)

   - **Trigger:** Push to `main` or `pre-release` branches
   - **Actions:**
     - Builds the extension
     - Publishes to VS Code Marketplace
     - Publishes to Open VSX Registry
     - Creates GitHub release with release notes

#### Release Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Developer triggers "Bump Version" workflow                   │
│    - Selects bump type (patch/minor/major)                     │
│    - Selects release type (none/release/prerelease)            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. bump-version.yml workflow runs                               │
│    - Bumps version in package.json                             │
│    - Generates CHANGELOG.md entry from git history             │
│    - Creates PR to develop branch                              │
│    - PR title: "feat: Bump version to X.Y.Z [release]"         │
│    - Auto-merge enabled (SQUASH)                               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. PR auto-merges to develop (after CI passes)                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. auto-create-release-pr.yml workflow triggers                 │
│    - Detects [release] or [prerelease] tag in PR title         │
│    - Rebases develop directly onto main/pre-release            │
│    - No PRs, no squash, no merge commits                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Push to main/pre-release triggers release.yml               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. release.yml workflow triggers                                │
│    - Builds extension                                           │
│    - Publishes to VS Code Marketplace                          │
│    - Publishes to Open VSX Registry                            │
│    - Creates GitHub release                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Build Workflow

- **`build.yaml`** - Continuous integration (build & lint)
  - **Trigger:** Push or PR to `develop`, or manual `workflow_dispatch` (any branch)
  - **Actions:** Installs dependencies, lints, builds, and packages the VSIX

## Required Secrets

The following secrets must be configured in the GitHub repository settings:

| Secret             | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `VSCE_TOKEN`       | Personal Access Token for VS Code Marketplace         |
| `OPEN_VSIX_TOKEN`  | Personal Access Token for Open VSX Registry           |
| `PAT_GITHUB`       | GitHub PAT with repo + workflow scopes (for auto-merge and release creation) |

## Branch Structure

| Branch         | Purpose                                       |
| -------------- | --------------------------------------------- |
| `develop`      | Active development branch                     |
| `main`         | Stable release branch (triggers release)      |
| `pre-release`  | Pre-release branch (triggers prerelease)      |

## Contributing

When modifying workflows, please ensure:

1. YAML syntax is valid
2. Shell commands follow best practices
3. Documentation is updated to reflect changes
