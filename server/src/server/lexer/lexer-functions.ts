import { TokenKind } from './token';
import { keywords, punct, keywordToTokenKind } from './rules';

export interface LexingState {
    text: string;
    i: number;
    push: (kind: TokenKind, value: string, start: number) => void;
}

// Character classification helpers to replace regex usage
function isDigit(ch: string): boolean {
    const code = ch.charCodeAt(0);
    return code >= 48 && code <= 57; // '0' to '9'
}

function isHexDigit(ch: string): boolean {
    const code = ch.charCodeAt(0);
    return (code >= 48 && code <= 57) ||  // '0' to '9'
        (code >= 65 && code <= 70) ||  // 'A' to 'F'
        (code >= 97 && code <= 102);   // 'a' to 'f'
}

function isIdentifierStart(ch: string): boolean {
    const code = ch.charCodeAt(0);
    return code === 95 ||                   // '_'
        (code >= 65 && code <= 90) ||   // 'A' to 'Z'
        (code >= 97 && code <= 122);    // 'a' to 'z'
}

function isIdentifierPart(ch: string): boolean {
    const code = ch.charCodeAt(0);
    return code === 95 ||                   // '_'
        (code >= 48 && code <= 57) ||   // '0' to '9'
        (code >= 65 && code <= 90) ||   // 'A' to 'Z'
        (code >= 97 && code <= 122);    // 'a' to 'z'
}

function isWhitespace(ch: string): boolean {
    const code = ch.charCodeAt(0);
    return code === 32 ||   // space
        code === 9 ||    // tab
        code === 10 ||   // \n
        code === 13 ||   // \r
        code === 11 ||   // \v
        code === 12;     // \f
}

/**
 * Parse a single line comment starting from //
 */
export function parseSingleLineComment(state: LexingState): boolean {
    const { text, push } = state;
    let { i } = state;

    if (text[i] === '/' && i + 1 < text.length && text[i + 1] === '/') {
        const start = i;
        i += 2; // skip "//"
        while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
        push(TokenKind.Comment, text.slice(start, i), start);
        state.i = i;
        return true;
    }
    return false;
}

/**
 * Parse a multi-line comment starting from /*
 */
export function parseMultiLineComment(state: LexingState): boolean {
    const { text, push } = state;
    let { i } = state;

    if (text[i] === '/' && i + 1 < text.length && text[i + 1] === '*') {
        const start = i;
        i += 2; // skip /*
        while (
            i + 1 < text.length &&
            !(text[i] === '*' && text[i + 1] === '/')
        ) {
            i++;
        }
        i += 2; // skip closing */
        push(TokenKind.Comment, text.slice(start, i), start);
        state.i = i;
        return true;
    }
    return false;
}

/**
 * Parse a preprocessor directive starting from #
 */
export function parsePreprocessorDirective(state: LexingState): boolean {
    const { text, push } = state;
    let { i } = state;

    if (text[i] === '#') {
        const start = i;
        while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
        push(TokenKind.Preproc, text.slice(start, i), start);
        state.i = i;
        return true;
    }
    return false;
}

/**
 * Parse a string literal with double quotes
 */
export function parseDoubleQuotedString(state: LexingState): boolean {
    const { text, push } = state;
    let { i } = state;

    if (text[i] === '"') {
        const start = i;
        i++;
        while (i < text.length && text[i] !== '"') {
            if (text[i] === '\\') i += 2;
            else i++;
        }
        i++; // consume closing "
        push(TokenKind.String, text.slice(start, i), start);
        state.i = i;
        return true;
    }
    return false;
}

/**
 * Parse a string literal with single quotes
 */
export function parseSingleQuotedString(state: LexingState): boolean {
    const { text, push } = state;
    let { i } = state;

    if (text[i] === '\'') {
        const start = i;
        i++;
        while (i < text.length && text[i] !== '\'') {
            if (text[i] === '\\') i += 2;
            else i++;
        }
        i++; // consume closing '
        push(TokenKind.String, text.slice(start, i), start);
        state.i = i;
        return true;
    }
    return false;
}

/**
 * Parse a numeric literal (with FIXED binary operator handling)
 * This includes integers, floats, hexadecimal, and scientific notation
 */
export function parseNumberLiteral(state: LexingState): boolean {
    const { text, push } = state;
    let { i } = state;
    const ch = text[i];

    if (isDigit(ch)) {
        const start = i;

        // Check for hexadecimal (0x or 0X)
        if (ch === '0' && i + 1 < text.length &&
            (text[i + 1] === 'x' || text[i + 1] === 'X')) {
            i += 2; // skip '0x'
            while (i < text.length && isHexDigit(text[i])) i++;
            push(TokenKind.Number, text.slice(start, i), start);
            state.i = i;
            return true;
        }

        // Regular decimal number (including floats and scientific notation)
        while (i < text.length && (isDigit(text[i]) || text[i] === '.')) i++;

        // Handle scientific notation (e.g., 1e+5, 1e-3, 1E+5, 1E-3)
        if (i < text.length && (text[i] === 'e' || text[i] === 'E')) {
            i++; // consume 'e' or 'E'
            if (i < text.length && (text[i] === '+' || text[i] === '-')) {
                i++; // consume '+' or '-' after 'e'/'E'
            }
            while (i < text.length && isDigit(text[i])) i++;
        }

        push(TokenKind.Number, text.slice(start, i), start);
        state.i = i;
        return true;
    }
    return false;
}

/**
 * Parse an identifier or keyword
 */
export function parseIdentifierOrKeyword(state: LexingState): boolean {
    const { text, push } = state;
    let { i } = state;
    const ch = text[i];

    if (isIdentifierStart(ch)) {
        const start = i;
        while (i < text.length && isIdentifierPart(text[i])) i++;
        const value = text.slice(start, i);
        
        // Check if it's a keyword and get its specific type
        let kind: TokenKind;
        if (keywords.has(value)) {
            const mappedKind = keywordToTokenKind.get(value);
            if (!mappedKind) {
                throw new Error(`Keyword '${value}' found in keywords set but not mapped in keywordToTokenKind`);
            }
            kind = mappedKind;
        } else {
            kind = TokenKind.Identifier;
        }
        
        push(kind, value, start);
        state.i = i;
        return true;
    }
    return false;
}

/**
 * Parse compound operators (++, --, ==, etc.)
 */
export function parseCompoundOperator(state: LexingState): boolean {
    const { text, push } = state;
    let { i } = state;

    if (i + 1 < text.length) {
        const twoChar = text.slice(i, i + 2);
        if (twoChar === '++' || twoChar === '--' || twoChar === '==' || twoChar === '!=' ||
            twoChar === '<=' || twoChar === '>=' || twoChar === '&&' || twoChar === '||' ||
            twoChar === '->' || twoChar === '<<' || twoChar === '>>' || twoChar === '+=' ||
            twoChar === '-=' || twoChar === '*=' || twoChar === '/=' || twoChar === '%=' ||
            twoChar === '&=' || twoChar === '|=' || twoChar === '^=') {
            const start = i;
            i += 2;
            push(TokenKind.Operator, twoChar, start);
            state.i = i;
            return true;
        }
    }
    return false;
}

/**
 * Parse single character punctuation or operators
 */
export function parsePunctuationOrOperator(state: LexingState): boolean {
    const { text, push } = state;
    const { i } = state;
    const ch = text[i];

    if (punct.includes(ch)) {
        push(TokenKind.Punctuation, ch, i);
        state.i = i + 1;
        return true;
    }

    // Unknown char → treat as operator
    push(TokenKind.Operator, ch, i);
    state.i = i + 1;
    return true;
}

/**
 * Skip whitespace characters
 */
export function skipWhitespace(state: LexingState): boolean {
    const { text } = state;
    let { i } = state;

    if (isWhitespace(text[i])) {
        while (i < text.length && isWhitespace(text[i])) {
            i++;
        }
        state.i = i;
        return true;
    }
    return false;
}

/**
 * Generic lexing function that tries all token parsers in order
 */
export function parseNextToken(state: LexingState): boolean {
    return (
        skipWhitespace(state) ||
        parseSingleLineComment(state) ||
        parseMultiLineComment(state) ||
        parsePreprocessorDirective(state) ||
        parseDoubleQuotedString(state) ||
        parseSingleQuotedString(state) ||
        parseNumberLiteral(state) ||
        parseIdentifierOrKeyword(state) ||
        parseCompoundOperator(state) ||
        parsePunctuationOrOperator(state)
    );
}
