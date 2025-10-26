/**
 * Token stream utility for navigating tokens during parsing
 */

import { Token, TokenKind } from './token';

/**
 * Utility class for token stream navigation
 * 
 * Handles automatic skipping of comments and preprocessor directives,
 * providing clean peek/next interface for parser consumption.
 */
export class TokenStream {
    private pos = 0;
    private respectPreprocessor = false;

    constructor(private tokens: Token[]) { }

    /**
     * Enable or disable preprocessor respect mode
     * When enabled, preprocessor directives are not automatically skipped
     */
    setPreprocessorRespect(respect: boolean): void {
        this.respectPreprocessor = respect;
    }

    /**
     * Peek at current token without skipping preprocessor directives
     * Used to check for preprocessor tokens specifically
     */
    peekRaw(): Token {
        // Skip only comments, not preprocessor directives
        while (
            this.pos < this.tokens.length &&
            this.tokens[this.pos].kind === TokenKind.Comment
        ) {
            this.pos++;
        }
        return this.tokens[this.pos] || this.tokens[this.tokens.length - 1];
    }

    /**
     * Consume and return current token without skipping preprocessor directives
     * Used to consume preprocessor tokens specifically
     */
    nextRaw(): Token {
        // Skip only comments, not preprocessor directives
        while (
            this.pos < this.tokens.length &&
            this.tokens[this.pos].kind === TokenKind.Comment
        ) {
            this.pos++;
        }
        return this.tokens[this.pos++] || this.tokens[this.tokens.length - 1];
    }

    /**
     * Peek at the current token without consuming it
     * Automatically skips trivia (comments and preprocessor directives)
     */
    peek(): Token {
        this.skipTrivia();
        return this.tokens[this.pos] || this.tokens[this.tokens.length - 1];
    }

    /**
     * Consume and return the current token
     * Automatically skips trivia (comments and preprocessor directives)
     */
    next(): Token {
        this.skipTrivia();
        return this.tokens[this.pos++] || this.tokens[this.tokens.length - 1];
    }

    /**
     * Check if we've reached the end of the token stream
     */
    eof(): boolean {
        this.skipTrivia();
        return this.peek().kind === TokenKind.EOF;
    }

    /**
     * Get the current position in the token stream
     */
    getPosition(): number {
        return this.pos;
    }

    /**
     * Set the position in the token stream (for error recovery)
     */
    setPosition(pos: number): void {
        this.pos = Math.max(0, Math.min(pos, this.tokens.length - 1));
    }

    /**
     * Get the total number of tokens in the stream
     */
    getTokenCount(): number {
        return this.tokens.length;
    }

    /**
     * Get the last N consumed tokens (excluding trivia)
     */
    getRecentTokens(count: number): Token[] {
        const recent: Token[] = [];
        let pos = this.pos - 1; // Start from the last consumed token

        while (recent.length < count && pos >= 0) {
            const token = this.tokens[pos];
            // Only include non-trivia tokens
            if (token.kind !== TokenKind.Comment && token.kind !== TokenKind.Preproc) {
                recent.unshift(token); // Add to beginning to maintain order
            }
            pos--;
        }

        return recent;
    }

    /**
     * Insert a token at the current position
     * Used for splitting compound tokens like '>>' into separate tokens
     */
    insertToken(token: Token): void {
        this.tokens.splice(this.pos, 0, token);
    }

    /**
     * Insert a token at a specific position
     * Used for splitting compound tokens like '>>' into separate tokens at precise locations
     */
    insertTokenAt(position: number, token: Token): void {
        this.tokens.splice(position, 0, token);
    }

    /**
     * Skip comments and optionally preprocessor directives
     */
    private skipTrivia(): void {
        while (this.pos < this.tokens.length) {
            const token = this.tokens[this.pos];
            if (token.kind === TokenKind.Comment) {
                this.pos++;
            } else if (token.kind === TokenKind.Preproc && !this.respectPreprocessor) {
                this.pos++;
            } else {
                break;
            }
        }
    }
}
