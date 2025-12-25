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
    Expression,
    TypeNode
} from '../ast/node-types';
import { RenameTypeVisitor } from '../ast/rename-type-visitor';
import {
    isClass,
    isIdentifier,
    isParameterDecl,
    isVarDecl,
    isTypeReference,
    isGenericType,
    isAutoType,
    isMemberExpression,
    isCallExpression,
    isBinaryExpression,
    isAssignmentExpression,
    isCastExpression,
    isNewExpression
} from '../../util';
import { ITypeResolver } from '../types/type-resolver-interfaces';
import { ISymbolOperations } from './symbol-operations-interfaces';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/tokens';
import { IWorkspaceManager } from '../workspace/workspace-interfaces';
import { URI } from 'vscode-uri';
import * as fs from 'fs';

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
            let formatted = formatDeclaration(symbol); // Already includes code fence

            // Documentation (Comments)
            const documentation = await this.getSymbolDocumentation(symbol, doc);
            if (documentation) {
                formatted += `\n\n---\n${documentation}\n\n---`;
            }

            // For parameters and variables with generic or auto types, show the inferred type
            if ((isParameterDecl(symbol) || isVarDecl(symbol)) && symbol.type) {
                const declaredType = this.getTypeNameFromNode(symbol.type);

                // Check if it's a generic type parameter or auto
                if (this.isGenericTypeParameter(declaredType) || declaredType === 'auto') {
                    const currentUri = normalizeUri(doc.uri);
                    const currentAst = this.cacheManager.getDocCache().get(currentUri);

                    if (currentAst) {
                        let inferredType: string | null = null;

                        // First try: if it's a VarDecl with auto type, use TypeResolver directly
                        if (declaredType === 'auto' && isVarDecl(symbol)) {
                            inferredType = this.typeResolver.resolveObjectType(symbol.name, doc, position);
                        }

                        // Second try: find the expression at the cursor position
                        if (!inferredType) {
                            const expr = this.findExpressionAtPosition(currentAst, position);
                            if (expr) {
                                inferredType = this.typeResolver.resolveExpressionType(expr, currentAst, doc);
                            }
                        }

                        if (inferredType && inferredType !== declaredType && !this.isGenericTypeParameter(inferredType)) {
                            // Add inferred type information
                            formatted += `\n\n*Inferred type:* \`${inferredType}\``;
                        }
                    }
                }
            }

            // Build location information
            let locationInfo = '';

            // If it's a class with modded versions, show all locations (up to 5 modded)
            if (isClass(symbol) && symbols.length > 1) {
                const displayPath = uriToDisplayPath(symbols[0].uri);
                const clickableLink = this.makeClickableLinkWithPosition(symbols[0], displayPath);
                locationInfo = `\n\n*Defined in:* ${clickableLink}`;

                // Show up to 5 modded class locations
                const moddedSymbols = symbols.slice(1, 6); // Get next 5 (indices 1-5)
                if (moddedSymbols.length > 0) {
                    locationInfo += '\n\n*Modded in:*';
                    for (const moddedSymbol of moddedSymbols) {
                        const moddedPath = uriToDisplayPath(moddedSymbol.uri);
                        const moddedLink = this.makeClickableLinkWithPosition(moddedSymbol, moddedPath);
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
                const clickableLink = this.makeClickableLinkWithPosition(symbol, displayPath);
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
     * Get type name from TypeNode (handles generics, arrays, etc.)
     */
    private getTypeNameFromNode(typeNode: TypeNode): string {
        if (!typeNode) return 'unknown';

        if (isTypeReference(typeNode)) {
            return typeNode.name;
        }
        if (isGenericType(typeNode)) {
            const baseName = this.getTypeNameFromNode(typeNode.baseType);
            const args = typeNode.typeArguments.map((arg: TypeNode) => this.getTypeNameFromNode(arg)).join(',');
            return `${baseName}<${args}>`;
        }
        if (typeNode.kind === 'ArrayType') {
            return this.getTypeNameFromNode(typeNode.elementType) + '[]';
        }
        if (isAutoType(typeNode)) {
            return 'auto';
        }
        return 'unknown';
    }

    /**
     * Check if a type name is a generic type parameter (like T, T1, T2, etc.)
     */
    private isGenericTypeParameter(typeName: string): boolean {
        // Generic type parameters are typically single uppercase letters or T followed by number
        return /^T\d*$/.test(typeName) || /^[A-Z]$/.test(typeName);
    }

    /**
     * Find the expression node at a specific position in the AST
     * Prefers MemberExpression over Identifier when both contain the position
     */
    private findExpressionAtPosition(node: ASTNode, position: Position): Expression | null {
        if (!node) return null;

        // Helper to check if position is within node
        const isPositionInNode = (n: ASTNode): boolean => {
            if (!n.start || !n.end) return false;
            if (position.line < n.start.line || position.line > n.end.line) return false;
            if (position.line === n.start.line && position.character < n.start.character) return false;
            if (position.line === n.end.line && position.character > n.end.character) return false;
            return true;
        };

        // Helper to update currentBest, preferring MemberExpression over Identifier
        const updateBest = (current: Expression | null, candidate: Expression | null): Expression | null => {
            if (!candidate) return current;
            if (!current) return candidate;
            // Prefer MemberExpression over Identifier
            if (candidate.kind === 'MemberExpression') return candidate;
            if (current.kind === 'Identifier' && candidate.kind !== 'Identifier') return candidate;
            return current;
        };

        // Recursively find all expressions at this position, preferring more specific ones
        const findBestExpression = (n: ASTNode): Expression | null => {
            if (!isPositionInNode(n)) return null;

            let currentBest: Expression | null = null;

            // Check if this node itself is an expression
            if (isMemberExpression(n) || isIdentifier(n) || isCallExpression(n) ||
                isBinaryExpression(n) || isAssignmentExpression(n) || isCastExpression(n) ||
                isNewExpression(n)) {
                currentBest = n as Expression;
            }

            // Search children based on node type
            switch (n.kind) {
                case 'File':
                    for (const decl of (n as FileNode).body) {
                        currentBest = updateBest(currentBest, findBestExpression(decl));
                    }
                    break;

                case 'ClassDecl':
                    for (const member of (n as ClassDeclNode).members) {
                        currentBest = updateBest(currentBest, findBestExpression(member));
                    }
                    break;

                case 'FunctionDecl':
                case 'MethodDecl':
                case 'ProtoMethodDecl':
                    const funcNode = n as FunctionDeclNode;
                    if (funcNode.body) {
                        currentBest = updateBest(currentBest, findBestExpression(funcNode.body));
                    }
                    break;

                case 'BlockStatement':
                    for (const stmt of (n as BlockStatement).body) {
                        currentBest = updateBest(currentBest, findBestExpression(stmt));
                    }
                    break;

                case 'DeclarationStatement':
                    const declStmt = n as DeclarationStatement;
                    if (declStmt.declarations && declStmt.declarations.length > 0) {
                        for (const decl of declStmt.declarations) {
                            currentBest = updateBest(currentBest, findBestExpression(decl));
                        }
                    } else if (declStmt.declaration) {
                        currentBest = updateBest(currentBest, findBestExpression(declStmt.declaration));
                    }
                    break;

                case 'VarDecl':
                    const varDecl = n as VarDeclNode;
                    if (varDecl.initializer) {
                        currentBest = updateBest(currentBest, findBestExpression(varDecl.initializer));
                    }
                    break;

                case 'ExpressionStatement':
                    currentBest = updateBest(currentBest, findBestExpression((n as ExpressionStatement).expression));
                    break;

                case 'ReturnStatement':
                    const retStmt = n as ReturnStatement;
                    if (retStmt.argument) {
                        currentBest = updateBest(currentBest, findBestExpression(retStmt.argument));
                    }
                    break;

                case 'IfStatement':
                    const ifStmt = n as IfStatement;
                    currentBest = updateBest(currentBest, findBestExpression(ifStmt.test));
                    currentBest = updateBest(currentBest, findBestExpression(ifStmt.consequent));
                    if (ifStmt.alternate) {
                        currentBest = updateBest(currentBest, findBestExpression(ifStmt.alternate));
                    }
                    break;

                case 'WhileStatement':
                    const whileStmt = n as WhileStatement;
                    currentBest = updateBest(currentBest, findBestExpression(whileStmt.test));
                    currentBest = updateBest(currentBest, findBestExpression(whileStmt.body));
                    break;

                case 'ForStatement':
                    const forStmt = n as ForStatement;
                    if (forStmt.init) {
                        currentBest = updateBest(currentBest, findBestExpression(forStmt.init));
                    }
                    if (forStmt.test) {
                        currentBest = updateBest(currentBest, findBestExpression(forStmt.test));
                    }
                    if (forStmt.update) {
                        currentBest = updateBest(currentBest, findBestExpression(forStmt.update));
                    }
                    currentBest = updateBest(currentBest, findBestExpression(forStmt.body));
                    break;

                case 'CallExpression':
                    const callExpr = n as CallExpression;
                    currentBest = updateBest(currentBest, findBestExpression(callExpr.callee));
                    for (const arg of callExpr.arguments) {
                        currentBest = updateBest(currentBest, findBestExpression(arg));
                    }
                    break;

                case 'MemberExpression':
                    const memberExpr = n as MemberExpression;
                    currentBest = updateBest(currentBest, findBestExpression(memberExpr.object));
                    // Note: Don't search 'property' as it's the member name, not an expression context
                    break;

                case 'BinaryExpression':
                    const binaryExpr = n as BinaryExpression;
                    currentBest = updateBest(currentBest, findBestExpression(binaryExpr.left));
                    currentBest = updateBest(currentBest, findBestExpression(binaryExpr.right));
                    break;

                case 'UnaryExpression':
                    const unaryExpr = n as UnaryExpression;
                    currentBest = updateBest(currentBest, findBestExpression(unaryExpr.operand));
                    break;

                case 'AssignmentExpression':
                    const assignExpr = n as AssignmentExpression;
                    currentBest = updateBest(currentBest, findBestExpression(assignExpr.left));
                    currentBest = updateBest(currentBest, findBestExpression(assignExpr.right));
                    break;

                case 'CastExpression':
                    const castExpr = n as CastExpression;
                    currentBest = updateBest(currentBest, findBestExpression(castExpr.expression));
                    break;

                case 'NewExpression':
                    const newExpr = n as NewExpression;
                    if (newExpr.arguments) {
                        for (const arg of newExpr.arguments) {
                            currentBest = updateBest(currentBest, findBestExpression(arg));
                        }
                    }
                    break;
            }

            return currentBest;
        };

        return findBestExpression(node);
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
     * Create a clickable markdown link to a file with position
     * @param symbol The symbol with location information
     * @param displayPath The human-readable path to display
     * @returns A markdown link that opens the file at the exact position
     */
    private makeClickableLinkWithPosition(symbol: SymbolLookupResult, displayPath: string): string {
        let uri = symbol.uri;

        // Add line and column to URI if available (VS Code format: file://path#L10:5)
        if (symbol.start) {
            // LSP uses 0-indexed, VS Code uses 1-indexed for display
            const line = symbol.start.line + 1;
            const col = symbol.start.character + 1;
            uri += `#L${line}:${col}`;
        }

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

    /**
     * Extracts documentation.
     * Priority:
     * 1. Trailing comment on the same line (// ... or //!< ...)
     * 2. Preceding block comment (/** ... *\/ or // ...)
     *
     * Stops immediately if non-comment code is found above.
     */
    private async getSymbolDocumentation(symbol: SymbolLookupResult, activeDoc: TextDocument): Promise<string | null> {
        try {
            if (!symbol.uri || !symbol.start) return null;

            let lines: string[];

            // Get file content
            if (normalizeUri(activeDoc.uri) === normalizeUri(symbol.uri)) {
                lines = activeDoc.getText().split(/\r?\n/);
            } else {
                const filePath = URI.parse(symbol.uri).fsPath;
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    lines = content.split(/\r?\n/);
                } else {
                    return null;
                }
            }

            const startLine = symbol.start.line;
            if (startLine >= lines.length) return null;

            // Check for Trailing Comment on the EXACT definition line
            // Supports: float x; // comment AND float x; //!< comment
            const currentLine = lines[startLine];
            // Regex: Find "//" that is NOT at the start of the line (checked by code context logic usually,
            // but here we assume the symbol exists on this line).
            // We capture everything after //, optionally stripping < or ! if it's Doxygen style
            const trailingMatch = currentLine.match(/[^\/](\/\/[!/<]*\s*)(.*)$/);

            if (trailingMatch && trailingMatch[2]) {
                const rawComment = trailingMatch[2].trim();
                // If it's not just a closing brace or semicolon or empty
                if (rawComment.length > 0) {
                    return this.formatDoxygenToMarkdown(rawComment);
                }
            }

            // Check for Preceding Comments (Go upwards)
            let docLines: string[] = [];
            let inCommentBlock = false;

            for (let i = startLine - 1; i >= 0; i--) {
                const line = lines[i].trim();

                // Skip blank lines ONLY if we are inside a /** */ block
                // OR if we haven't found any comments yet (allow 1 line gap? Usually strict is better).
                // Let's be strict: if empty line and NOT in block -> stop.
                // Exceptions: some code styles leave 1 empty line between comment and func.
                // But generally, documentation should touch the code.
                if (line === '') {
                    if (inCommentBlock) {
                        // Empty line inside JSDoc block is fine
                        docLines.unshift('');
                        continue;
                    }
                    // If we found comments already, an empty line means the comment block ended.
                    if (docLines.length > 0) break;

                    // If we haven't found comments yet, allow MAX 1 empty line gap?
                    // No, to fix your "Sticky" issue, better to stop.
                    // If you want to allow gaps, add logic here. For now: stop.
                    continue;
                }

                // Handle closing of block comments (when reading upwards)
                if (line.endsWith('*/')) {
                    inCommentBlock = true;
                }

                // Handle Start of block comments (/**, /*!)
                if (line.startsWith('/**') || line.startsWith('/*!')) {
                    if (inCommentBlock) {
                        docLines.unshift(this.cleanCommentLine(line));
                        break; // Block complete
                    }
                }

                if (inCommentBlock) {
                    // Inside a block, take everything
                    docLines.unshift(this.cleanCommentLine(line));
                    if (line.startsWith('/*')) break; // Saftey break
                } else {
                    // Single line comments
                    if (line.startsWith('//')) {
                        // Remove leading slashes and doxygen markers (//, ///, //!<)
                        const cleaned = line.replace(/^\/\/[!/<]*\s?/, '');
                        docLines.unshift(cleaned);
                    } else {
                        // HIT CODE or Garbage -> STOP
                        // This fixes the "RPC exchanged data" sticking to variables below it
                        break;
                    }
                }
            }

            if (docLines.length === 0) return null;

            const rawDocs = docLines.join('\n');
            return this.formatDoxygenToMarkdown(rawDocs);

        } catch (e) {
            Logger.error('Error extracting documentation:', e);
            return null;
        }
    }

    /**
     * Converts Doxygen-style tags to Markdown for VS Code Hover.
     */
    private formatDoxygenToMarkdown(text: string): string {
        if (!text) return '';

        let md = text;

        // Escape '>' and '<' at the start of list items to prevent Blockquotes
        // Converts "- > 0" to "- \> 0" so it renders as text, not a quote block.
        md = md.replace(/^(\s*[-*+]\s+)>/gm, '$1\\>');
        md = md.replace(/^(\s*[-*+]\s+)</gm, '$1\\<');

        // Clean up misuse of \p for alignment (just remove it)
        md = md.replace(/\s+([@\\])p\s+/g, ' ');

        // Remove metadata tags
        md = md.replace(/^[\t ]*([@\\])(?:fn|class|struct|headerfile|file|ingroup|name)\s+.*$/gm, '');

        // Code Blocks
        md = md.replace(/([@\\])code(?:\{\.?(\w+)\})?/g, '\n```$2');
        md = md.replace(/([@\\])endcode/g, '```\n');

        // Inline Formatting
        md = md.replace(/([@\\])c\s+(\S+)/g, '`$2`');     // Code
        md = md.replace(/([@\\])p\s+(\S+)/g, '`$2`');     // Param reference
        md = md.replace(/([@\\])b\s+(\S+)/g, '**$2**');   // Bold
        md = md.replace(/([@\\])(?:e|em)\s+(\S+)/g, '*$2*'); // Italic

        // Major Sections
        md = md.replace(/([@\\])(?:brief|short)\s+/g, '');
        md = md.replace(/([@\\])details\s*/g, '\n\n');

        // Parameters (With Header Logic)
        // We use a stateful replace to insert the header only once per block of text.
        // Note: This works because 'md' is processed linearly.
        let hasParamHeader = false;

        // Regex handles: @param, @param[in], \param
        md = md.replace(/([@\\])param(?:\[.*?\])?\s+(\w+)/g, (match, prefix, name) => {
            let replacement = '';

            // If this is the first param we found in this documentation block, add a Header
            if (!hasParamHeader) {
                replacement += '\n\n**Parameters:**\n';
                hasParamHeader = true;
            }

            // Format: - `name`:
            replacement += `- \`${name}\`:`;
            return replacement;
        });

        // Template params
        md = md.replace(/([@\\])tparam\s+(\w+)/g, '\n- **$2** (template):');
        // Returns
        md = md.replace(/([@\\])(?:result|return|returns|retval)\s+/g, '\n**Returns:** ');

        // Block Sections
        const blockSections = [
            { tag: 'note', label: '💡 Note' },
            { tag: 'warning', label: '⚠️ Warning' },
            { tag: 'todo', label: '📝 TODO' },
            { tag: 'deprecated', label: '⛔ Deprecated' },
            { tag: 'see', label: 'See also' },
            { tag: 'sa', label: 'See also' }
        ];
        for (const section of blockSections) {
            const regex = new RegExp(`([@\\\\])${section.tag}\\s+`, 'g');
            md = md.replace(regex, `\n> **${section.label}:** `);
        }

        // Lists
        md = md.replace(/([@\\])(?:arg|li)\s+/g, '\n- ');
        // Final Cleanup
        md = md.replace(/\n{3,}/g, '\n\n');

        return md.trim();
    }

    /**
     * Helper to clean JSDoc syntax from lines but PRESERVE indentation
     * essential for nested markdown lists.
     */
    private cleanCommentLine(line: string): string {
        // Remove standard comment markers
        let cleaned = line
            .replace(/^\s*\/\*\*?/, '')   // remove /** or /* with leading space
            .replace(/^\s*\/\*!/, '')     // remove /*!
            .replace(/^\s*\*\//, '')      // remove */
            .replace(/^\s*\/\/\/?/, '')   // remove // or ///
            .replace(/^\s*\/\/!/, '');    // remove //!
        // Remove the leading asterisk common in block comments
        cleaned = cleaned.replace(/^\s*\*\s?/, '');
        // Remove trailing */ but keep trailing spaces (optional)
        cleaned = cleaned.replace(/\*\/$/, '');

        // DO NOT do .trim() here, otherwise nested lists (  - item) become top level (- item)
        return cleaned.trimEnd();
    }
}
