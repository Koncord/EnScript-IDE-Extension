/**
 *  Generic AST Parser for Enforce/EnScript
 **/

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver';

// Re-export all types and interfaces
export * from '../ast/node-types';

// Re-export backward compatibility type aliases
export type { 
    ASTNode,
    Declaration,
    TypedefDeclNode,
    FileNode as File
} from '../ast/node-types';

// Re-export utility functions (excluding getOperatorPrecedence which is already in node-types)
export {
    isModifier, 
    isPrimitiveType,
    setParentReferences
} from '../util/utils';

// Re-export configuration
export * from '../ast/config';

// Re-export error types
export * from '../ast/errors';

// Re-export factory
export { ParserFactory } from '../util/factory';

// Import internal dependencies
import { ParserConfig, defaultConfig } from '../ast/config';

// Import new AST types and factory for direct parsing
import { FileNode } from '../ast/node-types';
import { ParserFactory } from '../util/factory';
import { ParseWarning } from '../ast/errors';
import { setParentReferences } from '../util/utils';

/**
 * Parse with enhanced error reporting and diagnostics
 * 
 * @param doc Document to parse
 * @param config Optional parser configuration overrides
 * @param workspaceFolders Optional workspace folders for determining file context (unused, kept for compatibility)
 * @returns Object containing parsed file and diagnostics
 */
export function parseWithDiagnostics(
    doc: TextDocument,
    config?: Partial<ParserConfig>,
    _workspaceFolders?: string[]
): { file: FileNode; diagnostics: Diagnostic[] } {
    // Merge config with defaults and enable error recovery for better diagnostics
    const enhancedConfig = {
        ...defaultConfig,
        ...config,
        errorRecovery: true
    };

    // Use the improved parser directly
    const parser = ParserFactory.createEnScriptParser(doc, enhancedConfig);
    const file = parser.parse();
    
    // Set parent references throughout the AST tree
    // This ensures all tools (diagnostics, completion, hover, etc.) can use parent context
    setParentReferences(file);
    
    // Extract diagnostics from parser
    const diagnostics: Diagnostic[] = [];
    
    // Get parse errors and warnings as diagnostics (both are in parseErrors array)
    const parseErrors = parser.getParseErrors();
    for (const error of parseErrors) {
        // Determine severity based on error type
        const isWarning = error instanceof ParseWarning;
        
        diagnostics.push({
            range: {
                start: { line: error.line - 1, character: error.column - 1 },
                end: { line: error.line - 1, character: error.column }
            },
            severity: isWarning ? 2 : 1, // Warning : Error
            message: error.message,
            source: 'enscript-parser'
        });
    }

    return { file, diagnostics };
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

// Export key types for external usage
export {
    FileNode,
    ClassDeclNode,
    FunctionDeclNode,
    VarDeclNode,
    TypeNode
} from '../ast/node-types';
export { ParserConfig, defaultConfig } from '../ast/config';
