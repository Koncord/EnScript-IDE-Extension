# EnScript IDE by Alpine Team

Inspired by yuvalno's [Enfusion Script extension](https://github.com/yuvalino/enscript)

**Note:** Currently only DayZ game supported.

EnScript IDE is a powerful VSCode extension for DayZ modders that provides comprehensive language support for Enfusion Script. It features intelligent code completion, real-time diagnostics, syntax highlighting, symbol lookup, jump to definition, and many other advanced IDE capabilities to streamline your modding workflow.

## 🔧 Initial Setup

EnScript IDE works out of the box for your current project, but to unlock its full potential and index the vanilla Enfusion Script codebase, additional setup is required.

Locate your extracted scripts folder (typically `P:\scripts`) and add it to your VS Code user settings.

**Important:** Reload the VS Code window after saving your settings!

## 🚀 Features

### 1. **Syntax Highlighting**
Full syntax highlighting support for Enfusion Script language with proper colorization of keywords, types, functions, and more.

### 2. **Intelligent Code Completion**
Context-aware autocompletion for classes, methods, variables, and fields. Get suggestions as you type with full IntelliSense support for your entire workspace and vanilla game scripts.

### 3. **Real-time Diagnostics**
Instant error detection and warnings as you code. Catch syntax errors, type mismatches, and other issues before runtime with detailed diagnostic messages.

### 4. **Hover & Jump to Definition**
Intelligent hover tooltips display type information and documentation. Use Ctrl+Click (Cmd+Click on Mac) to instantly jump to symbol definitions across your workspace.

### 5. **Workspace Symbol Search**
Quickly find and navigate to any symbol in your workspace with fast, fuzzy symbol search. Locate classes, methods, and variables instantly.

### 6. Command Palette (`Ctrl+Shift+P`)

- **Enscript: Restart Language Server** — Instantly restarts the Enscript language server for troubleshooting or updates.
- **Enscript: Refresh File Index** — Re-indexes your workspace files for up-to-date symbol search and completions.
- **Enscript: Dump Diagnostics** — Outputs all current diagnostics for your project to help with debugging.
- **Enscript: Dump Indexed Classes** — Lists all classes indexed by the extension for quick inspection.
- **Enscript: Show Rule Documentation** — Displays documentation for the selected rule directly in VS Code.
