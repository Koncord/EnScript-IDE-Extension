export const CfgKeywords = new Set<string>([
    'class', 'delete', 'enum', 'true', 'false', 'null', 'NULL'
]);

export const CfgPunctuations = new Set<string>([
    '{', '}', ';', ':', '=', '[', ']', ',', '+', '-', '*', '/'
]);

export const CfgOperators = new Set<string>([
    '+=', '-=', '=', '+', '-', '*', '/'
]);

export enum TokenKind {
    Keyword,
    Identifier,
    Number,
    String,
    Punctuation,
    EOF,
    Unknown
};

export interface CfgToken {
    kind: TokenKind;
    value: string;
    start: number;
    end: number;
    line: number;
    column: number;
};

export const isCfgKeyword = (value: string): boolean => {
    return CfgKeywords.has(value);
};;

export const isCfgPunctuation = (value: string): boolean => {
    return CfgPunctuations.has(value);
};


const operators = Array.from(CfgOperators).sort((a, b) => b.length - a.length);

export const lex = (input: string): CfgToken[] => {
    const tokens: CfgToken[] = [];
    let i = 0;
    let currentLine = 1;
    let currentColumn = 1;

    const push = (kind: TokenKind, value: string, start: number, end: number, tokenLine: number, tokenColumn: number) => {
        tokens.push({ kind, value, start, end, line: tokenLine, column: tokenColumn });
    };

    const updatePosition = (text: string) => {
        for (const char of text) {
            if (char === '\n') {
                currentLine++;
                currentColumn = 1;
            } else {
                currentColumn++;
            }
        }
    };

    while (i < input.length) {
        // Skip whitespace
        while (i < input.length && /\s/.test(input[i])) {
            updatePosition(input[i]);
            i++;
        }
        if (i >= input.length) break;

        const start = i;
        const startLine = currentLine;
        const startColumn = currentColumn;

        // Skip comments
        if (input[i] === '/' && i + 1 < input.length) {
            if (input[i + 1] === '/') {
                // Single-line comment
                while (i < input.length && input[i] !== '\n') {
                    i++;
                }
                continue;
            } else if (input[i + 1] === '*') {
                // Multi-line comment
                i += 2;
                while (i + 1 < input.length) {
                    if (input[i] === '*' && input[i + 1] === '/') {
                        i += 2;
                        break;
                    }
                    i++;
                }
                continue;
            }
        }

        // Lex operators
        let matched = false;
        for (const op of operators) {
            if (input.startsWith(op, i)) {
                push(TokenKind.Punctuation, op, i, i + op.length, startLine, startColumn);
                updatePosition(op);
                i += op.length;
                matched = true;
                break;
            }
        }
        if (matched) continue;

        // Lex the next token
        if (/[a-zA-Z_]/.test(input[i])) {
            while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
                i++;
            }
            const value = input.slice(start, i);
            const kind = isCfgKeyword(value) ? TokenKind.Keyword : TokenKind.Identifier;
            push(kind, value, start, i, startLine, startColumn);
            updatePosition(value);
        } else if (/\d/.test(input[i])) {
            const numStart = i;
            // Handle integer part
            while (i < input.length && /\d/.test(input[i])) {
                i++;
            }

            // Handle optional decimal part
            if (i < input.length && input[i] === '.') {
                i++;
                while (i < input.length && /\d/.test(input[i])) {
                    i++;
                }
            }

            // Handle optional scientific notation (e.g., e-4, E+8)
            if (i < input.length && /[eE]/.test(input[i])) {
                const ePos = i;
                i++;
                // Optional sign
                if (i < input.length && /[+-]/.test(input[i])) {
                    i++;
                }
                // Check if followed by digits (valid scientific notation)
                if (i < input.length && /\d/.test(input[i])) {
                    // Exponent digits
                    while (i < input.length && /\d/.test(input[i])) {
                        i++;
                    }
                } else {
                    // Not scientific notation, backtrack
                    i = ePos;
                }
            }

            // Check if it's followed by a letter or underscore (making it an identifier)
            if (i < input.length && /[a-zA-Z_]/.test(input[i])) {
                // It's an identifier that starts with a digit
                while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
                    i++;
                }
                const value = input.slice(numStart, i);
                push(TokenKind.Identifier, value, numStart, i, startLine, startColumn);
                updatePosition(value);
                continue;
            }

            const value = input.slice(numStart, i);
            push(TokenKind.Number, value, numStart, i, startLine, startColumn);
            updatePosition(value);
        } else if (input[i] === '"') {
            const stringStart = i;
            i++;
            while (i < input.length) {
                if (input[i] === '"') {
                    // Check if it's an escaped quote (doubled quote)
                    if (i + 1 < input.length && input[i + 1] === '"') {
                        i += 2; // Skip both quotes
                        continue;
                    }
                    // End of string
                    break;
                }
                i++;
            }
            const value = input.slice(stringStart + 1, i);
            push(TokenKind.String, value, stringStart, i + 1, startLine, startColumn);
            updatePosition(input.slice(stringStart, i + 1));
            i++;
        } else if (isCfgPunctuation(input[i])) {
            push(TokenKind.Punctuation, input[i], start, i + 1, startLine, startColumn);
            updatePosition(input[i]);
            i++;
        } else {
            const unknownStart = i;
            while (i < input.length && !/[a-zA-Z_]/.test(input[i]) && !/\d/.test(input[i]) && input[i] !== '"' && !isCfgPunctuation(input[i]) && !/\s/.test(input[i])) {
                i++;
            }
            const value = input.slice(unknownStart, i);
            push(TokenKind.Unknown, value, unknownStart, i, startLine, startColumn);
            updatePosition(value);
        }
    }

    return tokens;
};
