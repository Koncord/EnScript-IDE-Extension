import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, CompletionItem } from 'vscode-languageserver';

/**
 * Interface for the main Analyzer
 * 
 * The Analyzer is the primary facade for all code analysis operations
 */
export interface IAnalyzer {
    /**
     * Get code completions at a specific position
     */
    getCompletions(doc: TextDocument, position: Position): Promise<CompletionItem[]>;

    /**
     * Dump all classes for debugging
     */
    dumpClasses(): unknown[];

    /**
     * Dump diagnostics for debugging
     */
    dumpDiagnostics(): unknown[];
}
