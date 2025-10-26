/**
 * Parser error types and error handling utilities
 * 
 * Provides structured error reporting with location information
 * and integration with VS Code diagnostics.
 */

import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import * as url from 'node:url';

/**
 * Custom error type for parser errors with enhanced location information
 */
export class ParseError extends Error {
    constructor(
        public readonly uri: string,
        public readonly line: number,
        public readonly column: number,
        message: string
    ) {
        let fsPath: string;
        try {
            fsPath = url.fileURLToPath(uri);
        } catch {
            // Handle test URIs or non-file URIs
            fsPath = uri;
        }
        super(`${message} (${fsPath}:${line}:${column})`);
        this.name = 'ParseError';
    }

    /**
     * Convert this ParseError to a VS Code Diagnostic
     */
    toDiagnostic(): Diagnostic {
        return {
            severity: DiagnosticSeverity.Error,
            range: {
                start: { line: this.line - 1, character: this.column - 1 },
                end: { line: this.line - 1, character: this.column }
            },
            message: this.message,
            source: 'enscript-parser'
        };
    }
}

/**
 * Parser warning for recoverable issues
 */
export class ParseWarning extends ParseError {
    readonly isWarning = true;

    /**
     * Convert this ParseWarning to a VS Code Diagnostic
     */
    toDiagnostic(): Diagnostic {
        return {
            severity: DiagnosticSeverity.Warning,
            range: {
                start: { line: this.line - 1, character: this.column - 1 },
                end: { line: this.line - 1, character: this.column }
            },
            message: this.message,
            source: 'enscript-parser'
        };
    }
}

/**
 * Error context information for better error reporting
 */
export interface ErrorContext {
    /** Expected token or construct */
    expected: string;
    /** Actually encountered token */
    actual: string;
    /** Suggestions for fixing the error */
    suggestions?: string[];
}

/**
 * Enhanced parse error with additional context
 */
export class ContextualParseError extends ParseError {
    constructor(
        uri: string,
        line: number,
        column: number,
        message: string,
        public readonly context: ErrorContext
    ) {
        super(uri, line, column, message);
        this.name = 'ContextualParseError';
    }

    /**
     * Convert to diagnostic with enhanced information
     */
    toDiagnostic(): Diagnostic {
        const diagnostic = super.toDiagnostic();

        // Add suggestions as related information if available
        if (this.context.suggestions && this.context.suggestions.length > 0) {
            diagnostic.message += `\nSuggestions: ${this.context.suggestions.join(', ')}`;
        }

        return diagnostic;
    }
}
