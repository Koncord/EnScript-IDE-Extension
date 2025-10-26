# CI/CD Setup Documentation

## Overview

This project uses GitHub Actions for continuous integration and deployment. The CI/CD pipeline ensures code quality, runs tests, and automates the release process.

## Workflows

### 1. CI Workflow (`.github/workflows/ci.yml`)

**Triggers:**
- Push to `main`, `master`, or `develop` branches
- Pull requests targeting these branches

**Jobs:**
- Runs on Ubuntu (latest)
- Tests against Node.js 22.x
- Steps:
  - Linting (`npm run lint`)
  - Type checking (`npm run check-types`)
  - Unit tests with coverage (`npm test -- --coverage`)
  - Production build (`npm run compile:prod`)
  - Checks for uncommitted changes after build

### 2. Release Workflow (`.github/workflows/release.yml`)

**Triggers:**
- Git tags matching `v*.*.*` pattern (e.g., `v1.0.0`)

**Jobs:**
- **Package Job:**
  - Runs full validation
  - Packages extension as `.vsix` file
  - Creates GitHub release with assets
  
- **Publish Job:**
  - Publishes to VS Code Marketplace
  - Only runs for non-beta/alpha releases
  - Requires `VSCE_PAT` secret

## Setup Requirements

### Secrets

Add the following secrets to your GitHub repository:

1. **`VSCE_PAT`** (Required for publishing)
   - Personal Access Token from Visual Studio Marketplace
   - Generate at: https://dev.azure.com/
   - Permissions: Marketplace > Manage

### How to Create a Release

1. **Update Version:**
   ```bash
   npm version patch  # or minor, major
   ```

2. **Push Tag:**
   ```bash
   git push origin --tags
   ```

3. **Monitor Release:**
   - Check GitHub Actions tab
   - Release will be created automatically
   - Extension will be published to marketplace

### Manual Package/Publish

```bash
# Package only (creates .vsix file)
npm run package

# Package and publish to marketplace
npm run publish
```

## Dependabot

Automatic dependency updates are configured via `.github/dependabot.yml`:
- NPM dependencies: Weekly on Mondays
- GitHub Actions: Monthly
- Auto-labeled PRs for easy management

## Badge for README

Add this badge to your main README.md to show build status:

```markdown
[![CI](https://github.com/koncord/enscript-ide-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/koncord/enscript-ide-extension/actions/workflows/ci.yml)
```

## Troubleshooting

### Failed Builds
- Check the Actions tab in GitHub
- Review logs for specific error messages
- Common issues:
  - Lint errors: Run `npm run lint:fix`
  - Type errors: Run `npm run check-types`
  - Test failures: Run `npm test` locally

### Publishing Issues
- Verify `VSCE_PAT` secret is set correctly
- Ensure version in `package.json` is updated
- Check marketplace account has proper permissions

## Local Testing

Before pushing, validate locally:

```bash
# Install dependencies
npm ci

# Run all checks
npm run lint
npm run check-types
npm test

# Test build
npm run compile:prod
```
