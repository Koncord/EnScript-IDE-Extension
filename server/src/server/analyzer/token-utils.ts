import { lex } from '../lexer/preprocessor-lexer';
import { Token } from '../lexer/token';

/**
 * Returns the token at a specific offset (e.g. mouse hover or cursor position).
 * Lexes only a small window around the position for performance.
 */
export function getTokenAtPosition(text: string, offset: number): Token | null {
    // Check if we're actually on a word character (not whitespace/punctuation)
    const charAtPos = text[offset];
    if (!charAtPos || !/[a-zA-Z0-9_]/.test(charAtPos)) {
        return null;
    }

    // Find the start of the current line
    let lineStart = offset;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') {
        lineStart--;
    }

    // Find the end of the current line (or use a reasonable window)
    let lineEnd = offset;
    const maxWindow = 200; // Maximum characters to lex
    const endBound = Math.min(text.length, lineStart + maxWindow);
    while (lineEnd < endBound && text[lineEnd] !== '\n') {
        lineEnd++;
    }

    // Lex from the start of the line to get proper context
    const slice = text.slice(lineStart, lineEnd);
    const tokens = lex(slice);

    // Find exact token at position
    for (const t of tokens) {
        const absStart = lineStart + t.start;
        const absEnd = lineStart + t.end;

        if (offset >= absStart && offset <= absEnd) {
            return {
                ...t,
                start: absStart,
                end: absEnd
            };
        }
    }

    return null;
}
