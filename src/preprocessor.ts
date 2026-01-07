import * as vscode from 'vscode';

/**
 * Custom Folding Provider for EnforceScript.
 *
 * Product Value:
 * Standard VS Code folding relies on indentation. In EnforceScript/C++, preprocessor
 * directives like #ifdef often break the visual indentation flow (placed at column 0).
 * This provider ignores indentation and calculates folding ranges based on explicit
 * semantic blocks ({}) and custom // region markers. This ensures the code structure
 * remains collapsible and navigable even in complex, heavily preprocessed files.
 */
class EnScriptFoldingProvider implements vscode.FoldingRangeProvider {
    provideFoldingRanges(document: vscode.TextDocument, context: vscode.FoldingContext, token: vscode.CancellationToken): vscode.FoldingRange[] {
        const ranges: vscode.FoldingRange[] = [];
        const bracketStack: number[] = [];
        const regionStack: number[] = [];

        // Regex for C#-style regions, popular in modding tools
        const regionStartRegex = /^\s*\/\/\s*region\b/;
        const regionEndRegex = /^\s*\/\/\s*endregion\b/;

        // Helper to ignore braces inside strings or comments
        function stripCommentsAndStrings(text: string): string {
            return text.replace(/\/\/.*/, '').replace(/"(?:[^"\\]|\\.)*"/g, '');
        }

        for (let i = 0; i < document.lineCount; i++) {
            const lineOriginal = document.lineAt(i).text;

            // Handle // region markers
            if (regionStartRegex.test(lineOriginal)) {
                regionStack.push(i);
            } else if (regionEndRegex.test(lineOriginal)) {
                if (regionStack.length > 0) {
                    ranges.push(new vscode.FoldingRange(regionStack.pop()!, i, vscode.FoldingRangeKind.Region));
                }
            }

            // Handle structural blocks {}
            const lineClean = stripCommentsAndStrings(lineOriginal);
            for (let char of lineClean) {
                if (char === '{') {
                    bracketStack.push(i);
                } else if (char === '}') {
                    if (bracketStack.length > 0) {
                        const start = bracketStack.pop()!;
                        // Don't fold single lines like { return; }
                        if (start !== i) {
                            ranges.push(new vscode.FoldingRange(start, i));
                        }
                    }
                }
            }
        }
        return ranges;
    }
}

// Theme-aware colors. Uses bracket pairs colors by default for native feel, falling back to static colors.
const LEVEL_COLORS = [
    new vscode.ThemeColor('editorBracketHighlight.foreground2'), // Level 0
    new vscode.ThemeColor('editorBracketHighlight.foreground1'), // Level 1
    new vscode.ThemeColor('editorBracketHighlight.foreground3'), // Level 2
    '#FF6347', // Level 3 (Tomato)
    '#90EE90', // Level 4 (Light Green)
    '#FFD700', // Level 5 (Gold)
];

// Decorations for the keywords themselves (#ifdef, #else, #endif) to show depth visually
const keywordDecorations = LEVEL_COLORS.map(color => vscode.window.createTextEditorDecorationType({
    color: color,
    fontWeight: 'medium'
}));

// "Ghost Text" decoration for the logical explanation at the end of the line
const infoDecoration = vscode.window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 1.5em',
        color: new vscode.ThemeColor('editorCodeLens.foreground'), // Subtle gray
        fontStyle: 'italic',
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

interface Condition {
    name: string;
    invert: boolean;
}

/**
 * Analyzes the document and applies "Rainbow" highlighting and logical hints.
 *
 * Product Value:
 * 1. Cognitive Load Reduction: Developers often lose track of which #ifdef block they are in.
 *    By coloring the keywords based on nesting level, matching pairs (#ifdef ... #endif) becomes instant.
 *
 * 2. Logical Context: Displays "Ghost Text" (e.g., // → [2] SERVER && !DIAG) next to directives.
 *    This allows the developer to see the exact boolean logic required to reach that specific
 *    code block without scrolling up hundreds of lines to find the definitions.
 */
function updateDecorations(editor: vscode.TextEditor) {
    if (!editor || editor.document.languageId !== 'enscript') return;

    const text = editor.document.getText();
    const lines = text.split(/\r?\n/);

    const rangesPerLevel: vscode.Range[][] = LEVEL_COLORS.map(() => []);
    const infoOptions: vscode.DecorationOptions[] = [];
    const stack: Condition[] = [];

    const regexStart = /^\s*(#(ifdef|ifndef))\s+([\w_]+)/;
    const regexElse = /^\s*(#else)\b/;
    const regexEndIf = /^\s*(#endif)\b/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Start of a conditional block (#ifdef / #ifndef)
        let match = line.match(regexStart);
        if (match) {
            const directive = match[2];
            const name = match[3];
            const isInverted = directive === 'ifndef';
            const level = stack.length;
            const colorIndex = level % LEVEL_COLORS.length;
            const keywordStart = line.indexOf(match[1]);

            // Highlight the keyword based on depth
            rangesPerLevel[colorIndex].push(new vscode.Range(i, keywordStart, i, keywordStart + match[1].length));

            // Construct logical path string
            const currentLogic = (isInverted ? '!' : '') + name;
            const fullPath = stack.map(c => c.invert ? `!${c.name}` : c.name).concat([currentLogic]).join(' && ');

            // Add Ghost Text: "→ [Level] PATH"
            infoOptions.push({
                range: new vscode.Range(i, line.length, i, line.length),
                renderOptions: { after: { contentText: `// → [${level}] ${fullPath}` } }
            });

            stack.push({ name: name, invert: isInverted });
            continue;
        }

        // Branch switch (#else)
        match = line.match(regexElse);
        if (match) {
            if (stack.length > 0) {
                const level = stack.length - 1;
                const colorIndex = level % LEVEL_COLORS.length;
                const keywordStart = line.indexOf(match[1]);

                rangesPerLevel[colorIndex].push(new vscode.Range(i, keywordStart, i, keywordStart + match[1].length));

                // Invert logic for the display (current condition is now opposite)
                const currentCond = stack[level];
                const parentPath = stack.slice(0, -1).map(c => c.invert ? `!${c.name}` : c.name);
                const invertedLast = currentCond.invert ? currentCond.name : `!${currentCond.name}`;

                const fullPath = parentPath.length > 0
                    ? parentPath.join(' && ') + ' && ' + invertedLast
                    : invertedLast;

                // Add Ghost Text: "↷ [Level] PATH" (Curved arrow indicates branching)
                infoOptions.push({
                    range: new vscode.Range(i, line.length, i, line.length),
                    renderOptions: { after: { contentText: `// ↷ [${level}] ${fullPath}` } }
                });

                // Flip state in stack for subsequent lines
                stack[level].invert = !stack[level].invert;
            }
            continue;
        }

        // End of block (#endif)
        match = line.match(regexEndIf);
        if (match) {
            if (stack.length > 0) {
                const closedCond = stack.pop()!;
                const level = stack.length;
                const colorIndex = level % LEVEL_COLORS.length;
                const keywordStart = line.indexOf(match[1]);

                rangesPerLevel[colorIndex].push(new vscode.Range(i, keywordStart, i, keywordStart + match[1].length));

                // Add Ghost Text: "← [Level] NAME" (Left arrow indicates exit)
                infoOptions.push({
                    range: new vscode.Range(i, line.length, i, line.length),
                    renderOptions: { after: { contentText: `// ← [${level}] ${closedCond.name}` } }
                });
            }
            continue;
        }
    }

    // Apply decorations to editor
    for (let i = 0; i < LEVEL_COLORS.length; i++) {
        editor.setDecorations(keywordDecorations[i], rangesPerLevel[i]);
    }
    editor.setDecorations(infoDecoration, infoOptions);
}

/**
 * Registers all preprocessor-related features (Folding, Syntax Enhancements).
 * Should be called during extension activation.
 */
export function registerPreprocessorFeatures(context: vscode.ExtensionContext) {
    // Register Folding Provider
    const provider = new EnScriptFoldingProvider();
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider({ language: 'enscript' }, provider)
    );

    // Setup Decorator Triggers
    const triggerUpdate = () => {
        if (vscode.window.activeTextEditor) {
            updateDecorations(vscode.window.activeTextEditor);
        }
    };

    // Trigger immediately on activation
    if (vscode.window.activeTextEditor) triggerUpdate();

    // Trigger on tab switch
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) triggerUpdate();
        })
    );

    // Trigger on typing (with debounce to avoid performance hit)
    let timeout: NodeJS.Timeout | undefined = undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
                if (timeout) clearTimeout(timeout);
                timeout = setTimeout(triggerUpdate, 500);
            }
        })
    );
}
