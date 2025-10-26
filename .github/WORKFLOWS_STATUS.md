# GitHub Actions Status Dashboard

This page provides an overview of all automated workflows for the EnScript IDE extension.

## 🔄 Workflow Status

| Workflow | Status | Triggers | Purpose |
|----------|--------|----------|---------|
| CI | [![CI](https://github.com/koncord/enscript-ide-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/koncord/enscript-ide-extension/actions/workflows/ci.yml) | Push, PR | Multi-platform testing |
| Code Quality | [![Code Quality](https://github.com/koncord/enscript-ide-extension/actions/workflows/code-quality.yml/badge.svg)](https://github.com/koncord/enscript-ide-extension/actions/workflows/code-quality.yml) | Push, PR, Weekly | Quality checks & coverage |
| PR Validation | [![PR Validation](https://github.com/koncord/enscript-ide-extension/actions/workflows/pr-validation.yml/badge.svg)](https://github.com/koncord/enscript-ide-extension/actions/workflows/pr-validation.yml) | Pull Requests | PR-specific validation |
| Release | [![Release](https://github.com/koncord/enscript-ide-extension/actions/workflows/release.yml/badge.svg)](https://github.com/koncord/enscript-ide-extension/actions/workflows/release.yml) | Version Tags | Packaging & publishing |

## 📊 Quick Links

- [All Workflows](https://github.com/koncord/enscript-ide-extension/actions)
- [Recent Releases](https://github.com/koncord/enscript-ide-extension/releases)
- [Open Issues](https://github.com/koncord/enscript-ide-extension/issues)
- [Pull Requests](https://github.com/koncord/enscript-ide-extension/pulls)
- [Dependabot](https://github.com/koncord/enscript-ide-extension/network/updates)

## 🎯 Workflow Details

### CI Workflow
**File:** `.github/workflows/ci.yml`

Runs comprehensive tests on every push and PR:
- 🖥️ **Platforms:** Ubuntu, Windows, macOS
- 📦 **Node.js:** 22.x
- ✅ **Steps:** Lint → Type Check → Test → Build

### Code Quality Workflow
**File:** `.github/workflows/code-quality.yml`

Weekly health checks plus immediate PR feedback:
- 📈 **Coverage:** Test coverage reports
- 🔒 **Security:** npm audit for vulnerabilities
- 📦 **Dependencies:** Outdated package check
- 💾 **Size:** Build output size monitoring

### PR Validation Workflow
**File:** `.github/workflows/pr-validation.yml`

Validates all pull requests with extra checks:
- ✅ **Full validation:** All quality checks
- 💬 **Auto-comments:** Status updates on PRs
- 🔍 **Change detection:** Verifies no uncommitted files

### Release Workflow
**File:** `.github/workflows/release.yml`

Automated release process:
- 🏷️ **Trigger:** Git tags matching `v*.*.*`
- 📦 **Package:** Creates `.vsix` bundle
- 🚀 **Publish:** Pushes to VS Code Marketplace
- 📝 **Release:** Creates GitHub release with notes

## 🔔 Scheduled Runs

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| Code Quality | Weekly (Monday 9 AM UTC) | Regular health checks |
| Dependabot | Weekly (Monday) | Dependency updates |

## 🛠️ Maintenance

### View Workflow Runs
```bash
# Using GitHub CLI
gh run list
gh run view <run-id>
gh run watch <run-id>
```

### Re-run Failed Workflows
1. Go to Actions tab
2. Click on failed workflow run
3. Click "Re-run jobs" → "Re-run failed jobs"

### Cancel Running Workflows
```bash
# Using GitHub CLI
gh run list --status in_progress
gh run cancel <run-id>
```

## 📈 Metrics to Monitor

- ✅ **Pass Rate:** Percentage of successful runs
- ⏱️ **Duration:** Average workflow completion time
- 🔄 **Frequency:** Number of runs per day/week
- 📦 **Artifacts:** Size of build outputs
- 🐛 **Issues:** Failed runs and error patterns

## 🚨 Troubleshooting

### Common Issues

**1. Tests Failing**
- Check test logs in workflow run
- Run tests locally: `npm test`
- Verify dependencies: `npm ci`

**2. Build Errors**
- Type check locally: `npm run check-types`
- Clean build: `npm run clean && npm run compile`

**3. Lint Issues**
- Auto-fix: `npm run lint:fix`
- Check ESLint config

**4. Release Failed**
- Verify `VSCE_PAT` secret is set
- Check version in `package.json`
- Ensure all tests pass

## 📞 Getting Help

- 💬 [Discussions](https://github.com/koncord/enscript-ide-extension/discussions)
- 🐛 [Report Issue](https://github.com/koncord/enscript-ide-extension/issues/new/choose)
- 📖 [CI/CD Docs](.github/CI_CD_SETUP.md)
- 🤝 [Contributing Guide](../CONTRIBUTING.md)

---

*Last updated: October 26, 2025*
