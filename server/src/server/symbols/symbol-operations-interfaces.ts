import { TextDocument } from 'vscode-languageserver-textdocument';
import { Location, Position, Range, WorkspaceEdit } from 'vscode-languageserver';
import { SymbolLookupResult } from '../analyzer/symbol-lookup';

/**
 * Interface for symbol operations
 * Abstracts SymbolOperations for dependency injection
 */
export interface ISymbolOperations {
    /**
     * Resolve symbol definitions at a given position
     * Used for Go to Definition (F12) functionality
     */
    resolveDefinitions(doc: TextDocument, position: Position): Promise<SymbolLookupResult[]>;

    /**
     * Get hover information for symbol at position
     * Used for hover tooltips in the editor
     */
    getHover(doc: TextDocument, position: Position): Promise<string | null>;

    /**
     * Find all references to a symbol
     * Used for Find All References functionality
     */
    findReferences(doc: TextDocument, position: Position, includeDeclaration: boolean): Promise<Location[]>;

    /**
     * Prepare rename operation - check if symbol can be renamed
     * Returns the range of the symbol to be renamed
     */
    prepareRename(doc: TextDocument, position: Position): Range | null;

    /**
     * Perform rename operation on a symbol
     * Returns workspace edits for all references
     */
    renameSymbol(doc: TextDocument, position: Position, newName: string): Promise<WorkspaceEdit | null>;
}
