# Contributing to EnScript IDE

Thank you for your interest in contributing to EnScript IDE! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- Node.js 22.x
- npm (comes with Node.js)
- VS Code (for testing the extension)

### Setup Development Environment

1. **Clone the repository:**
   ```bash
   git clone https://github.com/koncord/enscript-ide-extension.git
   cd enscript-ide-extension
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the extension:**
   ```bash
   npm run compile
   ```

4. **Run tests:**
   ```bash
   npm test
   ```

5. **Start watch mode (for development):**
   ```bash
   npm run watch
   ```

## Development Workflow

### Running the Extension

1. Open the project in VS Code
2. Press `F5` to launch the Extension Development Host
3. The extension will be loaded in a new VS Code window
4. Open a `.c` file to test EnScript features

### Code Style

- We use ESLint for code linting
- TypeScript strict mode is enabled
- Run `npm run lint` to check for issues
- Run `npm run lint:fix` to automatically fix issues

### Testing

- Write tests for new features and bug fixes
- Place tests in the `test/` directory
- Run tests with `npm test`
- Ensure all tests pass before submitting a PR

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-something` - for new features
- `fix/resolve-issue` - for bug fixes
- `docs/update-readme` - for documentation
- `refactor/improve-code` - for refactoring

### Commit Messages

Follow conventional commit format:
- `feat: add new completion provider`
- `fix: resolve hover information error`
- `docs: update installation instructions`
- `chore: update dependencies`
- `test: add tests for symbol lookup`
- `refactor: improve diagnostics performance`

### Pull Request Process

1. **Create a branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes:**
   - Write code
   - Add/update tests
   - Update documentation

3. **Verify your changes:**
   ```bash
   npm run lint
   npm run check-types
   npm test
   npm run compile:prod
   ```

4. **Commit your changes:**
   ```bash
   git add .
   git commit -m "feat: your feature description"
   ```

5. **Push to GitHub:**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request:**
   - Go to the repository on GitHub
   - Click "New Pull Request"
   - Fill out the PR template
   - Link any related issues

### PR Requirements

Before your PR can be merged:
- ✅ All CI checks must pass
- ✅ Code must be reviewed by a maintainer
- ✅ Tests must be included (if applicable)
- ✅ Documentation must be updated (if applicable)
- ✅ No merge conflicts

## Code Structure

```
enscript-ide-extension/
├── src/                 # Client-side extension code
├── server/              # Language server implementation
│   └── src/
│       ├── lsp/        # LSP handlers and services
│       └── server/     # Core language server logic
├── syntaxes/           # TextMate grammars
├── test/               # Test files
└── .github/            # CI/CD and GitHub configurations
```

## Reporting Issues

### Bug Reports

Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.yml) and include:
- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Extension and VS Code versions
- Operating system

### Feature Requests

Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.yml) and include:
- Problem you're trying to solve
- Proposed solution
- Alternative approaches considered
- Use cases and examples

## Getting Help

- 💬 [GitHub Discussions](https://github.com/koncord/enscript-ide-extension/discussions) - Ask questions
- 🐛 [Issues](https://github.com/koncord/enscript-ide-extension/issues) - Report bugs
- 📖 [Documentation](README.md) - Read the docs

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Give constructive feedback
- Focus on what's best for the community

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.

---

Thank you for contributing! 🎉
