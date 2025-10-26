import { lex } from '../lexer/preprocessor-lexer';
import { Token } from '../lexer/token';

/**
 * Returns the token at a specific offset (e.g. mouse hover or cursor position).
 * Lexes only a small window around the position for performance.
 */
export function getTokenAtPosition(text: string, offset: number): Token | null {
    const windowSize = 64;
    let start = Math.max(0, offset - windowSize);
    const end = Math.min(text.length, offset + windowSize);

    // Extend the start backwards to ensure we don't start in the middle of a string or comment
    // Look for safe starting points (whitespace, line breaks, or word boundaries)
    while (start > 0 && start < offset) {
        const char = text[start];
        const prevChar = text[start - 1];

        // Safe to start after whitespace, line breaks, or certain punctuation
        if (/\s/.test(char) || /[;{}()[\],.]/.test(prevChar)) {
            break;
        }
        start--;
    }

    const slice = text.slice(start, end);
    const tokens = lex(slice);

    for (const t of tokens) {
        const absStart = start + t.start;
        const absEnd = start + t.end;

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
