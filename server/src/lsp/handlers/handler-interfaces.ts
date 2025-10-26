import { Connection, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * DI token for handler registration
 */
export const HANDLER_TYPES = {
    IHandlerRegistration: Symbol.for('IHandlerRegistration')
};

/**
 * Interface for LSP handler registration classes
 * 
 * All LSP handlers implement this interface and are registered via DI:
 * - Injectable class with dependencies
 * - register() method sets up the handler with the server
 */
export interface IHandlerRegistration {
    /**
     * Register this handler with the LSP server
     */
    register(connection: Connection, documents: TextDocuments<TextDocument>): void;
}

// reexport types for convenience
export { Connection, TextDocuments, TextDocument };