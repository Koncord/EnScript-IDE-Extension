/**
 * Preprocessor-aware lexer for EnScript/Enforce
 * 
 * This lexer evaluates preprocessor directives during tokenization
 * and only emits tokens for active code blocks.
 */

import { Token, TokenKind } from './token';
import {
    parseNextToken,
    type LexingState
} from './lexer-functions';

interface PreprocessorState {
    type: 'ifdef' | 'ifndef' | 'if';
    symbol: string;
    isActive: boolean;
    hasMatchedBranch: boolean; // tracks if any branch in this conditional has been active
}

export interface PreprocessorLexerConfig {
    /** Set of defined preprocessor symbols */
    definedSymbols: Set<string>;
    /** Whether to include preprocessor tokens in output (for debugging) */
    includePreprocessorTokens: boolean;
}

export interface PreprocessorLexerResult {
    tokens: Token[];
    unclosedDirectives: Array<{
        type: 'ifdef' | 'ifndef' | 'if';
        symbol: string;
        line: number;
        character: number;
    }>;
}

/**
 * Preprocessor-aware lexer that returns detailed information including unclosed directives
 */
export function lexWithPreprocessor(text: string, config: PreprocessorLexerConfig): PreprocessorLexerResult {
    const toks: Token[] = [];
    let i = 0;

    // Preprocessor state stack
    const preprocessorStack: PreprocessorState[] = [];
    const definedSymbols = new Set(config.definedSymbols);

    // Track positions of directives for error reporting
    const directivePositions = new Map<PreprocessorState, { line: number; character: number }>();

    const push = (kind: TokenKind, value: string, start: number) => {
        toks.push({ kind, value, start, end: start + value.length });
    };

    /**
     * Calculate line and character position from byte offset
     */
    const calculatePosition = (text: string, offset: number): { line: number; character: number } => {
        let line = 1;
        let character = 1;
        for (let pos = 0; pos < offset && pos < text.length; pos++) {
            if (text[pos] === '\n') {
                line++;
                character = 1;
            } else {
                character++;
            }
        }
        return { line, character };
    };

    /**
     * Check if we're currently in an active (non-skipped) block
     */
    const isInActiveBlock = (): boolean => {
        return preprocessorStack.every(state => state.isActive);
    };

    /**
     * Handle preprocessor directive
     */
    const handlePreprocessorDirective = (start: number): void => {
        const directiveEnd = i;
        const directive = text.slice(start, directiveEnd).trim();

        // Calculate line and character position
        const position = calculatePosition(text, start);

        // Include preprocessor token in output if requested
        if (config.includePreprocessorTokens) {
            push(TokenKind.Preproc, directive, start);
        }

        // Parse #ifdef SYMBOL
        if (directive.startsWith('#ifdef ')) {
            const symbol = directive.substring(7).trim();
            const isActive = definedSymbols.has(symbol);
            const state = {
                type: 'ifdef' as const,
                symbol,
                isActive,
                hasMatchedBranch: isActive
            };
            preprocessorStack.push(state);
            directivePositions.set(state, position);
            return;
        }

        // Parse #ifndef SYMBOL  
        if (directive.startsWith('#ifndef ')) {
            const symbol = directive.substring(8).trim();
            const isActive = !definedSymbols.has(symbol);
            const state = {
                type: 'ifndef' as const,
                symbol,
                isActive,
                hasMatchedBranch: isActive
            };
            preprocessorStack.push(state);
            directivePositions.set(state, position);
            return;
        }

        // Parse #else
        if (directive === '#else') {
            if (preprocessorStack.length > 0) {
                const current = preprocessorStack[preprocessorStack.length - 1];
                // Only activate #else if no previous branch was active
                current.isActive = !current.hasMatchedBranch;
                if (current.isActive) {
                    current.hasMatchedBranch = true;
                }
            }
            return;
        }

        // Parse #endif
        if (directive === '#endif') {
            if (preprocessorStack.length > 0) {
                preprocessorStack.pop();
            }
            return;
        }

        // Parse #define SYMBOL
        if (directive.startsWith('#define ')) {
            const symbol = directive.substring(8).trim();
            definedSymbols.add(symbol);
            return;
        }

        // Parse #undef SYMBOL
        if (directive.startsWith('#undef ')) {
            const symbol = directive.substring(7).trim();
            definedSymbols.delete(symbol);
            return;
        }

        // Ignore other preprocessor directives like #include, #pragma, etc.
    };

    /**
     * Skip content in inactive preprocessor blocks
     */
    const skipInactiveBlock = (): void => {
        while (i < text.length) {
            const ch = text[i];

            // Check for preprocessor directive that might change active state
            if (ch === '#') {
                const start = i;
                while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
                handlePreprocessorDirective(start);

                // Skip newline after directive
                if (i < text.length && (text[i] === '\n' || text[i] === '\r')) {
                    if (text[i] === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
                        i += 2; // Skip \r\n
                    } else {
                        i++; // Skip \n or \r
                    }
                }

                // Check if we're now in an active block
                if (isInActiveBlock()) {
                    break;
                }
                continue;
            }

            i++;
        }
    };

    // Main lexing loop - same as original but with fixed number parsing from lexCore
    while (i < text.length) {
        // If we're in an inactive block, skip until we find an active block
        if (!isInActiveBlock()) {
            skipInactiveBlock();
            if (i >= text.length) break;
        }

        const ch = text[i];
        const start = i;

        // Handle preprocessor directives first
        if (ch === '#') {
            while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
            handlePreprocessorDirective(start);
            continue;
        }

        // Use shared lexing functions for everything else
        const state: LexingState = {
            text,
            i,
            push: (kind, value, start) => {
                push(kind, value, start);
            }
        };

        const oldI = i;
        parseNextToken(state);
        i = state.i;

        // If we didn't advance, break to avoid infinite loop
        if (i === oldI) {
            i++;
        }
    }

    push(TokenKind.EOF, '', i);

    const unclosedDirectives = preprocessorStack.map(state => {
        const pos = directivePositions.get(state) || { line: 1, character: 1 };
        return {
            type: state.type,
            symbol: state.symbol,
            line: pos.line,
            character: pos.character
        };
    });

    return {
        tokens: toks,
        unclosedDirectives
    };
}

/**
 * Backward compatibility: use the original lexer
 */
export function lex(text: string): Token[] {
    // For backward compatibility, use original lexer behavior
    return lexWithPreprocessor(text, {
        definedSymbols: new Set(),
        includePreprocessorTokens: true
    }).tokens;
}
