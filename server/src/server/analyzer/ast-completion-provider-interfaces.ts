/**
 * AST Completion Provider Interface
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import { Declaration } from '../ast/node-types';

/**
 * Interface for AST completion provider
 */
export interface IASTCompletionProvider {
    /**
     * Get member completions using AST analysis
     * @param objectName The name of the object to get members for
     * @param doc The document containing the code
     * @param knownType Optional known type of the object
     * @param position Optional position in the document
     * @returns Array of member declarations
     */
    getMemberCompletions(
        objectName: string,
        doc: TextDocument,
        knownType?: string | null,
        position?: Position
    ): Promise<Declaration[]>;
}
