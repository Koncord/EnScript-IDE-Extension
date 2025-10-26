/**
 * Symbol Operations
 * 
 * Handles symbol resolution, navigation, and reference finding.
 * Provides LSP features like go-to-definition, find-references, and hover.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Location, Position, Range, TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { IDocumentCacheManager } from '../cache/document-cache-interfaces';
import { IASTScopeResolver } from '../scopes/ast-scope-resolver-interfaces';
import {
    findExactDefinition,
    findSymbolsAtPosition,
    SymbolLookupResult
} from '../analyzer/symbol-lookup';
import { formatDeclaration } from '../analyzer/symbol-formatter';
import { normalizeUri, uriToDisplayPath } from '../../util/uri';
import { Logger } from '../../util/logger';
import {
    ASTNode,
    FileNode,
    ClassDeclNode,
    FunctionDeclNode,
    VarDeclNode,
    Declaration,
    BlockStatement,
    DeclarationStatement,
    ExpressionStatement,
    ReturnStatement,
    IfStatement,
    WhileStatement,
    ForStatement,
    CallExpression,
    MemberExpression,
    BinaryExpression,
    UnaryExpression,
    AssignmentExpression,
    CastExpression,
    NewExpression,
    Expression
} from '../ast/node-types';
import { RenameTypeVisitor } from '../ast/rename-type-visitor';
import { isClass, isIdentifier, isParameterDecl, isVarDecl } from '../../util';
import { ITypeResolver } from '../types/type-resolver-interfaces';
import { ISymbolOperations } from './symbol-operations-interfaces';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/tokens';
import { IWorkspaceManager } from '../workspace/workspace-interfaces';

/**
 * Handles symbol resolution and navigation operations
 */
@injectable()
export class SymbolOperations implements ISymbolOperations {
    constructor(
        @inject(TYPES.IDocumentCacheManager) private cacheManager: IDocumentCacheManager,
        @inject(TYPES.IASTScopeResolver) private astScopeResolver: IASTScopeResolver,
        @inject(TYPES.ITypeResolver) private typeResolver: ITypeResolver,
        @inject(TYPES.IWorkspaceManager) private workspaceManager: IWorkspaceManager
    ) { }

    /**
     * Resolve symbol definitions at a given position
     * Used for Go to Definition (F12) functionality
     */
    public async resolveDefinitions(doc: TextDocument, position: Position): Promise<SymbolLookupResult[]> {
        try {
            // Ensure document is parsed first
            this.cacheManager.ensureDocumentParsed(doc);

            // Use scope-aware exact definition finding
            const symbols = await findExactDefinition(
                doc,
                position,
                this.cacheManager.getDocCache(),
                this.astScopeResolver,
                this.typeResolver,
                this.workspaceManager.getIncludePaths(),
                async (className: string) => { await this.workspaceManager.loadClassFromIncludePaths(className); }
            );

            if (symbols.length > 0) {
                if (symbols.length > 1) {
                    Logger.info(`✅ resolveDefinitions: Found ${symbols.length} modded class definitions at ${position.line}:${position.character}`);
                } else {
                    Logger.debug(`✅ resolveDefinitions: Found exact definition at ${position.line}:${position.character}`);
                }
                return symbols;
            }

            Logger.debug(`❌ resolveDefinitions: No definition found at ${position.line}:${position.character}`);
            return [];
        } catch (error) {
            Logger.error('Error in resolveDefinitions:', error);
            return [];
        }
    }

    /**
     * Get hover information for symbol at position
     * Used for hover tooltips in the editor
     */
    public async getHover(doc: TextDocument, position: Position): Promise<string | null> {
        try {
            // Ensure document is parsed first
            this.cacheManager.ensureDocumentParsed(doc);

            // Use findExactDefinition to get smart symbol resolution (handles modded classes)
            let symbols = await findExactDefinition(
                doc,
                position,
                this.cacheManager.getDocCache(),
                this.astScopeResolver,
                this.typeResolver,
                this.workspaceManager.getIncludePaths(),
                async (className: string) => { await this.workspaceManager.loadClassFromIncludePaths(className); }
            );

            if (symbols.length === 0) {
                return null;
            }

            // For classes with modded versions, sort so original (non-modded) comes first
            if (symbols.length > 1 && isClass(symbols[0])) {
                symbols = this.sortClassesByModded(symbols);
            }

            // Format the first symbol for hover display
            const symbol = symbols[0];
            const formatted = formatDeclaration(symbol); // Already includes code fence

            // Build location information
            let locationInfo = '';

            // If it's a class with modded versions, show all locations (up to 5 modded)
            if (isClass(symbol) && symbols.length > 1) {
                const displayPath = uriToDisplayPath(symbols[0].uri);
                const clickableLink = this.makeClickableLink(symbols[0].uri, displayPath);
                locationInfo = `\n\n*Defined in:* ${clickableLink}`;

                // Show up to 5 modded class locations
                const moddedSymbols = symbols.slice(1, 6); // Get next 5 (indices 1-5)
                if (moddedSymbols.length > 0) {
                    locationInfo += '\n\n*Modded in:*';
                    for (const moddedSymbol of moddedSymbols) {
                        const moddedPath = uriToDisplayPath(moddedSymbol.uri);
                        const moddedLink = this.makeClickableLink(moddedSymbol.uri, moddedPath);
                        locationInfo += `\n- ${moddedLink}`;
                    }

                    // If there are more than 5 modded versions, indicate that
                    if (symbols.length > 6) {
                        const remaining = symbols.length - 6;
                        locationInfo += `\n- *(and ${remaining} more...)*`;
                    }
                }
            } else {
                // Single definition (non-class or class without modded versions)
                const displayPath = uriToDisplayPath(symbol.uri);
                const clickableLink = this.makeClickableLink(symbol.uri, displayPath);
                locationInfo = `\n\n*Defined in:* ${clickableLink}`;
            }

            Logger.debug(`getHover: Returning hover info for symbol "${symbol.name}"`);
            return formatted + locationInfo;
        } catch (error) {
            Logger.error('Error in getHover:', error);
            return null;
        }
    }

    /**
     * Sort class symbols so original (non-modded) comes first, then modded versions
     */
    private sortClassesByModded(symbols: SymbolLookupResult[]): SymbolLookupResult[] {
        return symbols.slice().sort((a, b) => {
            const aIsModded = a.modifiers?.includes('modded') || false;
            const bIsModded = b.modifiers?.includes('modded') || false;

            // Original (non-modded) classes should come first
            if (!aIsModded && bIsModded) return -1;
            if (aIsModded && !bIsModded) return 1;
            return 0; // Keep original order for same type
        });
    }

    /**
     * Create a clickable markdown link for a file path
     * @param uri The URI of the file
     * @param displayPath The human-readable path to display
     * @returns A markdown link that opens the file when clicked
     */
    private makeClickableLink(uri: string, displayPath: string): string {
        // Use markdown link format: [display text](uri)
        // The URI should already be normalized by normalizeUri
        return `[${displayPath}](${uri})`;
    }

    /**
     * Find all references to a symbol
     * Used for Find All References (Shift+F12) functionality
     * 
     * @param doc Document containing the symbol
     * @param position Position of the symbol
     * @param includeDeclaration Whether to include the declaration in results
     */
    public async findReferences(doc: TextDocument, position: Position, includeDeclaration: boolean): Promise<Location[]> {
        try {
            // Ensure document is parsed first
            this.cacheManager.ensureDocumentParsed(doc);

            const includePaths = this.workspaceManager.getIncludePaths();

            // Use exact definition finding with scope awareness
            const symbols = await findExactDefinition(
                doc,
                position,
                this.cacheManager.getDocCache(),
                this.astScopeResolver,
                this.typeResolver,
                includePaths,
                async (className: string) => { await this.workspaceManager.loadClassFromIncludePaths(className); }
            );

            if (symbols.length === 0) {
                Logger.debug('findReferences: No symbol found at position');
                return [];
            }

            const targetSymbol = symbols[0];
            const references: Location[] = [];

            // Include the declaration if requested
            if (includeDeclaration) {
                references.push({
                    uri: targetSymbol.uri,
                    range: {
                        start: targetSymbol.nameStart,
                        end: targetSymbol.nameEnd
                    }
                });
            }

            // Check if this is a local variable or parameter (should only search in containing function)
            const isLocalScope = isVarDecl(targetSymbol) || isParameterDecl(targetSymbol);

            if (isLocalScope) {
                // For local variables and parameters, only search in the current file within the function
                Logger.debug(`🔍 findReferences: Searching local scope only for "${targetSymbol.name}"`);
                const currentUri = normalizeUri(doc.uri);
                const currentAst = this.cacheManager.getDocCache().get(currentUri);

                if (currentAst) {
                    // Find references only within the containing function
                    const scopeContext = this.astScopeResolver.getScopeContext(doc, position);
                    if (scopeContext.containingFunction) {
                        // Search for actual usages (not just declarations) in the function body
                        this.findIdentifierReferencesInNode(
                            scopeContext.containingFunction,
                            targetSymbol.name,
                            currentUri,
                            references,
                            includeDeclaration ? targetSymbol : null
                        );
                    }
                }
            } else {
                // For global symbols (classes, functions, class members), search all files
                Logger.debug(`🌍 findReferences: Searching globally for "${targetSymbol.name}"`);
                for (const [uri, ast] of this.cacheManager.getDocCache().entries()) {
                    // Search for actual usages in all top-level declarations
                    this.findIdentifierReferencesInNode(
                        ast,
                        targetSymbol.name,
                        uri,
                        references,
                        includeDeclaration ? targetSymbol : null
                    );
                }
            }

            Logger.debug(`findReferences: Found ${references.length} reference(s) for "${targetSymbol.name}"`);
            return references;
        } catch (error) {
            Logger.error('Error in findReferences:', error);
            return [];
        }
    }

    /**
     * Recursively find all identifier references in an AST node
     * 
     * @param node The AST node to search in
     * @param targetName The identifier name to search for
     * @param uri URI of the document being searched
     * @param references Array to accumulate found references
     * @param skipDeclaration Declaration to skip (when includeDeclaration is false)
     * @private
     */
    private findIdentifierReferencesInNode(
        node: ASTNode | null | undefined,
        targetName: string,
        uri: string,
        references: Location[],
        skipDeclaration: Declaration | null
    ): void {
        if (!node) return;

        // Check if this is an identifier expression matching our target
        if (isIdentifier(node) && node.name === targetName) {

            // Skip if this is the declaration itself (when includeDeclaration was false)
            if (skipDeclaration &&
                node.start.line === skipDeclaration.nameStart.line &&
                node.start.character === skipDeclaration.nameStart.character) {
                return;
            }

            references.push({
                uri,
                range: {
                    start: node.start,
                    end: node.end
                }
            });
            return;
        }

        // Recursively search based on node type
        switch (node.kind) {
            case 'File':
                (node as FileNode).body.forEach(decl =>
                    this.findIdentifierReferencesInNode(decl, targetName, uri, references, skipDeclaration)
                );
                break;

            case 'ClassDecl':
                (node as ClassDeclNode).members.forEach(member =>
                    this.findIdentifierReferencesInNode(member, targetName, uri, references, skipDeclaration)
                );
                break;

            case 'FunctionDecl':
            case 'MethodDecl':
            case 'ProtoMethodDecl':
                const funcNode = node as FunctionDeclNode;
                // Search in function body
                if (funcNode.body) {
                    this.findIdentifierReferencesInNode(funcNode.body, targetName, uri, references, skipDeclaration);
                }
                break;

            case 'BlockStatement':
                (node as BlockStatement).body.forEach(stmt =>
                    this.findIdentifierReferencesInNode(stmt, targetName, uri, references, skipDeclaration)
                );
                break;

            case 'DeclarationStatement':
                const declStmt = node as DeclarationStatement;
                // Check all declarations (handles multiple comma-separated declarations like: int low, high;)
                if (declStmt.declarations && declStmt.declarations.length > 0) {
                    // Multiple declarations - check all
                    declStmt.declarations.forEach(decl =>
                        this.findIdentifierReferencesInNode(decl, targetName, uri, references, skipDeclaration)
                    );
                } else {
                    // Single declaration (backwards compatibility)
                    this.findIdentifierReferencesInNode(declStmt.declaration, targetName, uri, references, skipDeclaration);
                }
                break;

            case 'VarDecl':
                // Search in initializer
                const varDecl = node as VarDeclNode;
                if (varDecl.initializer) {
                    this.findIdentifierReferencesInNode(varDecl.initializer, targetName, uri, references, skipDeclaration);
                }
                break;

            case 'ExpressionStatement':
                this.findIdentifierReferencesInNode((node as ExpressionStatement).expression, targetName, uri, references, skipDeclaration);
                break;

            case 'ReturnStatement':
                this.findIdentifierReferencesInNode((node as ReturnStatement).argument, targetName, uri, references, skipDeclaration);
                break;

            case 'IfStatement':
                const ifStmt = node as IfStatement;
                this.findIdentifierReferencesInNode(ifStmt.test, targetName, uri, references, skipDeclaration);
                this.findIdentifierReferencesInNode(ifStmt.consequent, targetName, uri, references, skipDeclaration);
                this.findIdentifierReferencesInNode(ifStmt.alternate, targetName, uri, references, skipDeclaration);
                break;

            case 'WhileStatement':
                const whileStmt = node as WhileStatement;
                this.findIdentifierReferencesInNode(whileStmt.test, targetName, uri, references, skipDeclaration);
                this.findIdentifierReferencesInNode(whileStmt.body, targetName, uri, references, skipDeclaration);
                break;

            case 'ForStatement':
                const forStmt = node as ForStatement;
                this.findIdentifierReferencesInNode(forStmt.init, targetName, uri, references, skipDeclaration);
                this.findIdentifierReferencesInNode(forStmt.test, targetName, uri, references, skipDeclaration);
                this.findIdentifierReferencesInNode(forStmt.update, targetName, uri, references, skipDeclaration);
                this.findIdentifierReferencesInNode(forStmt.body, targetName, uri, references, skipDeclaration);
                break;

            case 'CallExpression':
                const callExpr = node as CallExpression;
                this.findIdentifierReferencesInNode(callExpr.callee, targetName, uri, references, skipDeclaration);
                callExpr.arguments.forEach((arg: Expression) =>
                    this.findIdentifierReferencesInNode(arg, targetName, uri, references, skipDeclaration)
                );
                break;

            case 'MemberExpression':
                const memberExpr = node as MemberExpression;
                this.findIdentifierReferencesInNode(memberExpr.object, targetName, uri, references, skipDeclaration);
                // Note: Don't search in 'property' as it's the member name, not a reference
                break;

            case 'BinaryExpression':
                const binaryExpr = node as BinaryExpression;
                this.findIdentifierReferencesInNode(binaryExpr.left, targetName, uri, references, skipDeclaration);
                this.findIdentifierReferencesInNode(binaryExpr.right, targetName, uri, references, skipDeclaration);
                break;

            case 'UnaryExpression':
                this.findIdentifierReferencesInNode((node as UnaryExpression).operand, targetName, uri, references, skipDeclaration);
                break;

            case 'AssignmentExpression':
                const assignExpr = node as AssignmentExpression;
                this.findIdentifierReferencesInNode(assignExpr.left, targetName, uri, references, skipDeclaration);
                this.findIdentifierReferencesInNode(assignExpr.right, targetName, uri, references, skipDeclaration);
                break;

            case 'CastExpression':
                this.findIdentifierReferencesInNode((node as CastExpression).expression, targetName, uri, references, skipDeclaration);
                break;

            case 'NewExpression':
                const newExpr = node as NewExpression;
                if (newExpr.arguments) {
                    newExpr.arguments.forEach((arg: Expression) =>
                        this.findIdentifierReferencesInNode(arg, targetName, uri, references, skipDeclaration)
                    );
                }
                break;

            // Leaf nodes that don't contain references
            case 'Literal':
                break;

            default:
                // For any unhandled node types, log a debug message
                Logger.debug(`findIdentifierReferencesInNode: Unhandled node kind: ${node.kind}`);
                break;
        }
    }

    /**
     * Prepare rename operation - check if symbol at position can be renamed
     * Used for rename validation before performing the actual rename
     */
    public prepareRename(doc: TextDocument, position: Position): Range | null {
        try {
            // Ensure document is parsed first
            this.cacheManager.ensureDocumentParsed(doc);

            // Find symbol at position
            const symbols = findSymbolsAtPosition(doc, position, this.cacheManager.getDocCache());
            if (symbols.length === 0) {
                Logger.debug('prepareRename: No symbol found at position');
                return null;
            }

            const symbol = symbols[0];

            // Return the range of the symbol name
            Logger.debug(`prepareRename: Symbol "${symbol.name}" can be renamed`);
            return {
                start: symbol.nameStart,
                end: symbol.nameEnd
            };
        } catch (error) {
            Logger.error('Error in prepareRename:', error);
            return null;
        }
    }

    /**
     * Perform rename operation - find all references and prepare workspace edit
     * Used for F2 rename functionality
     */
    public async renameSymbol(doc: TextDocument, position: Position, newName: string): Promise<WorkspaceEdit | null> {
        try {
            // Ensure document is parsed first
            this.cacheManager.ensureDocumentParsed(doc);

            // Find the symbol to rename
            const symbols = findSymbolsAtPosition(doc, position, this.cacheManager.getDocCache());
            if (symbols.length === 0) {
                Logger.debug('renameSymbol: No symbol found at position');
                return null;
            }

            const targetSymbol = symbols[0];
            const oldName = targetSymbol.name;

            // Find all references to this symbol (including declaration)
            const references = await this.findReferences(doc, position, true);

            if (references.length === 0) {
                return null;
            }

            const includePaths = this.workspaceManager.getIncludePaths();

            // Helper to check if a URI is in include paths
            const isInIncludePath = (uri: string) => includePaths.some(includePath => uri.startsWith(includePath));

            // Group edits by URI, skipping include paths
            const changes: { [uri: string]: TextEdit[] } = {};

            // Add identifier references
            for (const ref of references) {
                if (isInIncludePath(ref.uri)) continue;
                if (!changes[ref.uri]) changes[ref.uri] = [];
                changes[ref.uri].push({
                    range: ref.range,
                    newText: newName
                });
            }

            const typeVisitor = new RenameTypeVisitor(oldName, newName, changes);
            for (const [uri, ast] of this.cacheManager.getDocCache().entries()) {
                if (isInIncludePath(uri)) continue;
                typeVisitor.processFile(ast, uri);
            }

            const affectedCount = Object.values(changes).reduce((acc, edits) => acc + edits.length, 0);
            Logger.debug(`renameSymbol: Renaming "${oldName}" to "${newName}" (${affectedCount} occurrences, excluding include paths)`);
            return Object.keys(changes).length > 0 ? { changes } : null;
        } catch (error) {
            Logger.error('Error in renameSymbol:', error);
            return null;
        }
    }

}
