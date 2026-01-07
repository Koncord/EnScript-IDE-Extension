/**
 * Lexer for Enfusion config format (.imageset, .layout, etc.)
 * Tokenizes input into identifiers, strings, numbers, braces, and comments
 */

export enum EnfusionTokenKind {
    Identifier,
    String,
    Number,
    LeftBrace,
    RightBrace,
    Comment,
    EOF,
    Unknown
}

export interface EnfusionToken {
    kind: EnfusionTokenKind;
    value: string;
    start: number;
    end: number;
    line: number;
    column: number;
}

export const lex = (input: string): EnfusionToken[] => {
    const tokens: EnfusionToken[] = [];
    let i = 0;
    let line = 1;
    let column = 1;

    const push = (kind: EnfusionTokenKind, value: string, start: number, end: number, startLine: number, startColumn: number) => {
        tokens.push({ kind, value, start, end, line: startLine, column: startColumn });
    };

    const updatePosition = (text: string) => {
        for (const char of text) {
            if (char === '\n') {
                line++;
                column = 1;
            } else {
                column++;
            }
        }
    };

    while (i < input.length) {
        const start = i;
        const startLine = line;
        const startColumn = column;

        // Skip whitespace
        if (/\s/.test(input[i])) {
            while (i < input.length && /\s/.test(input[i])) {
                updatePosition(input[i]);
                i++;
            }
            continue;
        }

        // Single-line comment: //
        if (input[i] === '/' && input[i + 1] === '/') {
            while (i < input.length && input[i] !== '\n') {
                i++;
            }
            const value = input.slice(start, i);
            push(EnfusionTokenKind.Comment, value, start, i, startLine, startColumn);
            updatePosition(value);
            continue;
        }

        // Multi-line comment: /* */
        if (input[i] === '/' && input[i + 1] === '*') {
            i += 2;
            while (i < input.length - 1 && !(input[i] === '*' && input[i + 1] === '/')) {
                i++;
            }
            if (i < input.length - 1) {
                i += 2; // Skip */
            }
            const value = input.slice(start, i);
            push(EnfusionTokenKind.Comment, value, start, i, startLine, startColumn);
            updatePosition(value);
            continue;
        }

        // String literals: "..."
        if (input[i] === '"') {
            i++;
            while (i < input.length && input[i] !== '"') {
                if (input[i] === '\\' && i + 1 < input.length) {
                    i += 2; // Skip escaped character
                } else {
                    i++;
                }
            }
            if (i < input.length) i++; // Skip closing "
            const value = input.slice(start + 1, i - 1); // Extract content without quotes
            push(EnfusionTokenKind.String, value, start, i, startLine, startColumn);
            updatePosition(input.slice(start, i));
            continue;
        }

        // Left brace
        if (input[i] === '{') {
            push(EnfusionTokenKind.LeftBrace, '{', start, i + 1, startLine, startColumn);
            updatePosition('{');
            i++;
            continue;
        }

        // Right brace
        if (input[i] === '}') {
            push(EnfusionTokenKind.RightBrace, '}', start, i + 1, startLine, startColumn);
            updatePosition('}');
            i++;
            continue;
        }

        // Identifiers (alphanumeric + underscore)
        if (/[a-zA-Z_]/.test(input[i])) {
            while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
                i++;
            }
            const value = input.slice(start, i);
            push(EnfusionTokenKind.Identifier, value, start, i, startLine, startColumn);
            updatePosition(value);
            continue;
        }

        // Numbers (integer or decimal, with optional negative sign)
        if (/\d/.test(input[i]) || (input[i] === '-' && i + 1 < input.length && /\d/.test(input[i + 1]))) {
            const numStart = i;
            
            // Handle optional negative sign
            if (input[i] === '-') {
                i++;
            }

            // Handle integer part
            while (i < input.length && /\d/.test(input[i])) {
                i++;
            }

            // Handle optional decimal part
            if (i < input.length && input[i] === '.' && i + 1 < input.length && /\d/.test(input[i + 1])) {
                i++;
                while (i < input.length && /\d/.test(input[i])) {
                    i++;
                }
            }

            // Handle optional scientific notation (e.g., e-4, E+8)
            if (i < input.length && /[eE]/.test(input[i])) {
                i++;
                if (i < input.length && /[+-]/.test(input[i])) {
                    i++;
                }
                while (i < input.length && /\d/.test(input[i])) {
                    i++;
                }
            }

            const value = input.slice(numStart, i);
            push(EnfusionTokenKind.Number, value, numStart, i, startLine, startColumn);
            updatePosition(value);
            continue;
        }

        // Unknown character
        const unknownStart = i;
        i++;
        const value = input[unknownStart];
        push(EnfusionTokenKind.Unknown, value, unknownStart, i, startLine, startColumn);
        updatePosition(value);
    }

    // Add EOF token
    push(EnfusionTokenKind.EOF, '', i, i, line, column);

    return tokens;
};
