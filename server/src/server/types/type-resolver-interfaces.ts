
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import { 
    ClassDeclNode, 
    Expression, 
    FileNode, 
    VarDeclNode, 
    FunctionDeclNode, 
    TypedefDeclNode, 
    EnumDeclNode 
} from '../ast/node-types';

/**
 * Interface for type resolution operations
 * Abstracts the TypeResolver for dependency injection
 */
export interface ITypeResolver {
    /**
     * Find all class definitions by name
     */
    findAllClassDefinitions(className: string): ClassDeclNode[];

    /**
     * Find all global function definitions by name
     */
    findAllGlobalFunctionDefinitions(functionName: string): FunctionDeclNode[];

    /**
     * Find all global variable definitions by name
     */
    findAllGlobalVariableDefinitions(variableName: string): VarDeclNode[];

    /**
     * Find all typedef definitions by name
     */
    findAllTypedefDefinitions(typedefName: string): TypedefDeclNode[];

    /**
     * Find all enum definitions by name
     */
    findAllEnumDefinitions(enumName: string): EnumDeclNode[];

    /**
     * Get all available class names
     */
    getAllAvailableClassNames(): string[];

    /**
     * Get all available enum names
     */
    getAllAvailableEnumNames(): string[];

    /**
     * Get all available typedef names
     */
    getAllAvailableTypedefNames(): string[];

    /**
     * Get the return type of a global function
     */
    getGlobalFunctionReturnType(functionName: string, doc: TextDocument): string | null;

    /**
     * Invalidate caches for external files only
     */
    invalidateExternalCaches(): void;

    /**
     * Invalidate caches for a specific document
     */
    invalidateCachesForDocument(uri: string): void;

    /**
     * Re-index symbols from a specific document after re-parsing
     */
    reindexDocumentSymbols(uri: string): void;

    /**
     * Resolve the type of an object/variable
     */
    resolveObjectType(objectName: string, doc: TextDocument, position?: Position): string | null;

    /**
     * Resolve expression type using AST structure
     */
    resolveExpressionType(expr: Expression, context: FileNode, doc?: TextDocument): string | null;

    /**
     * Resolve typedef to its underlying class type name
     * E.g., "InventoryItemSuper" -> "ItemBase"
     */
    resolveTypedefToClassName(typedefName: string): string | null;
}
