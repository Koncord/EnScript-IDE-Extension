/**
 * AST Type Resolver
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import {
    FileNode,
    ASTNode,
    Expression,
    VarDeclNode,
    ClassDeclNode,
    FunctionDeclNode,
    MethodDeclNode,
    ParameterDeclNode,
    TypedefDeclNode,
    EnumDeclNode,
    CallExpression,
    MemberExpression,
    AssignmentExpression,
    BinaryExpression,
    BlockStatement,
    Identifier,
    Literal,
    NewExpression
} from '../ast/node-types';
import { BaseASTVisitor } from '../ast/ast-visitor';
import { Logger } from '../../util/logger';
import { normalizeUri } from '../../util/uri';
import { getTypeName } from '../analyzer/symbol-formatter';
import {
    isIdentifier,
    isTypedef,
    isTypeReference,
    isEnum,
    isVarDecl,
    mergeClassDefinitions,
    isMemberExpression,
    isBlockStatement,
    isDeclaration,
    isAutoType
} from '../util/ast-class-utils';
import { parseGenericType } from '../util/type-utils';
import { isMethod, isFunction, isClass, findMemberInClassWithInheritance } from '../util/ast-class-utils';
import { extractTypeName } from '../util/symbol-resolution-utils';
import { ISymbolCacheManager } from '../cache/symbol-cache-manager-interfaces';
import { ITypeCache } from '../cache/type-cache';
import { IWorkspaceManager } from '../workspace/workspace-interfaces';
import { isPositionInNode } from '../util/utils';
import { ITypeResolver } from './type-resolver-interfaces';
import { IDocumentCacheManager } from '../cache/document-cache-interfaces';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/tokens';

/**
 * Document cache interface for AST
 */
export type NewDocumentCache = Map<string, FileNode>;

/**
 * Symbol kind for generic search
 */
type SymbolKind = 'class' | 'function' | 'variable' | 'typedef' | 'enum';

/**
 * Symbol node types
 */
type SymbolNode = ClassDeclNode | FunctionDeclNode | VarDeclNode | TypedefDeclNode | EnumDeclNode;

/**
 * Type resolver using new AST format directly
 */
@injectable()
export class TypeResolver implements ITypeResolver {
    private enableDetailedLogging = false; // Disable by default for performance

    private cacheVersion = 0; // Track cache invalidation

    private docCache: NewDocumentCache;

    constructor(
        @inject(TYPES.IDocumentCacheManager) private cacheManager: IDocumentCacheManager,
        @inject(TYPES.ISymbolCacheManager) private symbolCache: ISymbolCacheManager,
        @inject(TYPES.ITypeCache) private typeCache: ITypeCache,
        @inject(TYPES.IWorkspaceManager) private workspaceManager: IWorkspaceManager
    ) {
        this.docCache = cacheManager.getDocCache();
    }

    /**
     * Enable detailed logging for debugging
     */
    public setDetailedLogging(enabled: boolean): void {
        this.enableDetailedLogging = enabled;
    }

    /**
     * Invalidate all caches (both workspace and external)
     * Call this when the document cache changes significantly
     */
    public invalidateCaches(): void {
        this.typeCache.clear();
        this.symbolCache.invalidateAllCaches();
        this.cacheVersion++;
        Logger.debug(`🔄 All type resolver caches invalidated (version: ${this.cacheVersion})`);
    }

    /**
     * Invalidate only external caches, keeping workspace caches intact
     * Call this when external files (from include paths) are loaded
     */
    public invalidateExternalCaches(): void {
        // Note: typeCache is mixed workspace+external, but it's a simple Map so we clear it all
        // The performance impact is minimal compared to selective clearing
        this.typeCache.clear();
        this.symbolCache.invalidateExternalCaches();
        this.cacheVersion++;
        Logger.debug(`🔄 External type resolver caches invalidated (version: ${this.cacheVersion})`);
    }

    /**
     * Invalidate caches for a specific document URI
     * More granular than full cache invalidation
     */
    public invalidateCachesForDocument(uri: string): void {
        const normalizedUri = normalizeUri(uri);

        // Clear type cache entries related to this document
        this.typeCache.invalidateCachesForDocument(normalizedUri);

        // Determine if this is a workspace file
        const isWorkspaceFile = this.workspaceManager.isWorkspaceFile(normalizedUri);

        // Delegate to symbol cache manager for granular invalidation
        this.symbolCache.invalidateCachesForDocument(normalizedUri, isWorkspaceFile);
    }

    /**
     * Re-index symbols from a specific document
     * Scans the document's AST and populates symbol caches with its declarations
     * Used after re-parsing a file (e.g., after re-stubbing an external file)
     */
    public reindexDocumentSymbols(uri: string): void {
        const normalizedUri = normalizeUri(uri);
        const ast = this.docCache.get(normalizedUri);

        if (!ast) {
            Logger.warn(`Cannot reindex symbols - document not in cache: ${normalizedUri}`);
            return;
        }

        const isWorkspaceFile = this.workspaceManager.isWorkspaceFile(normalizedUri);
        const isWorkspace = isWorkspaceFile !== false; // Treat null as workspace to avoid losing symbols

        let classCount = 0;
        let functionCount = 0;
        let variableCount = 0;
        let typedefCount = 0;
        let enumCount = 0;

        // Scan all top-level declarations in the AST
        for (const node of ast.body) {
            if (isClass(node) && node.name) {
                this.symbolCache.addClassToCache(node.name, node, isWorkspace);
                classCount++;
            } else if (isFunction(node) && node.name) {
                const cache = this.symbolCache.getFunctionCache(node.name);
                const workspace = cache.workspace || [];
                const external = cache.external || [];
                if (isWorkspace) {
                    workspace.push(node);
                } else {
                    external.push(node);
                }
                this.symbolCache.setFunctionCache(node.name, workspace, external);
                functionCount++;
            } else if (isVarDecl(node) && node.name) {
                const cache = this.symbolCache.getVariableCache(node.name);
                const workspace = cache.workspace || [];
                const external = cache.external || [];
                if (isWorkspace) {
                    workspace.push(node);
                } else {
                    external.push(node);
                }
                this.symbolCache.setVariableCache(node.name, workspace, external);
                variableCount++;
            } else if (isTypedef(node) && node.name) {
                const cache = this.symbolCache.getTypedefCache(node.name);
                const workspace = cache.workspace || [];
                const external = cache.external || [];
                if (isWorkspace) {
                    workspace.push(node);
                } else {
                    external.push(node);
                }
                this.symbolCache.setTypedefCache(node.name, workspace, external);
                typedefCount++;
            } else if (isEnum(node) && node.name) {
                const cache = this.symbolCache.getEnumCache(node.name);
                const workspace = cache.workspace || [];
                const external = cache.external || [];
                if (isWorkspace) {
                    workspace.push(node);
                } else {
                    external.push(node);
                }
                this.symbolCache.setEnumCache(node.name, workspace, external);
                enumCount++;
            }
        }

        Logger.debug(`🔄 Reindexed ${normalizedUri}: ${classCount} classes, ${functionCount} functions, ${variableCount} variables, ${typedefCount} typedefs, ${enumCount} enums`);
    }

    /**
     * Attempts to resolve the type of an object/variable using new AST format
     */
    resolveObjectType(objectName: string, doc: TextDocument, position?: Position): string | null {
        Logger.debug(`🔍 TypeResolver.resolveObjectType("${objectName}") called`);

        // Create a more stable cache key that considers scope context rather than exact position
        let cacheKey: string;
        if (position) {
            // Try to determine scope context for more stable caching
            const ast = this.ensureDocumentParsed(doc);
            const containingFunction = this.findContainingFunctionAtPosition(ast, position);
            const containingClass = this.findClassAtPosition(ast, position);

            // Create a stable scope-based key
            const scopeKey = this.createScopeBasedCacheKey(containingClass, containingFunction, position);
            cacheKey = `${doc.uri}|${objectName}|${scopeKey}`;
        } else {
            cacheKey = `${doc.uri}|${objectName}|global`;
        }

        // Check cache first for significant performance improvement
        if (this.typeCache.has(cacheKey)) {
            const cached = this.typeCache.get(cacheKey)!;
            Logger.debug(`   ✓ Found in cache: ${cached}`);
            return cached;
        }

        Logger.debug(`   → Not in cache, resolving...`);

        let result: string | null = null;

        // Special handling for 'this' keyword
        if (objectName === 'this') {
            result = this.resolveThisType(doc, position);
        }
        // Special handling for 'super' keyword
        else if (objectName === 'super') {
            result = this.resolveSuperType(doc, position);
        }
        // Check if this is a chained expression (e.g., "myArray.Get(0)" or "player.GetInventory().GetItem(0)")
        else if (objectName.includes('.')) {
            result = this.resolveChainedExpression(objectName, doc, position);
        }
        // Special handling for method calls (e.g., "GetPlayer()")
        else if (objectName.includes('(') && objectName.includes(')')) {
            result = this.resolveMethodCallType(objectName, doc);
        }
        else {
            const currentAst = this.ensureDocumentParsed(doc);
            const currentUri = normalizeUri(doc.uri);

            // Look in current document first with position context
            result = this.searchForVariableType(objectName, currentAst, currentUri, false, doc, position);

            // Then look for global variables in all documents if not found locally
            if (!result) {
                for (const [uri, ast] of this.docCache.entries()) {
                    if (uri === currentUri) continue; // Already checked

                    result = this.searchForVariableType(objectName, ast, uri, true, doc, position);
                    if (result) {
                        break; // Found it, no need to continue searching
                    }
                }
            }
        }

        // Cache the result for future calls (cache manages its own size)
        this.typeCache.set(cacheKey, result);

        if (this.enableDetailedLogging) {
            if (result) {
                Logger.debug(`🎯 TypeResolver: Found type "${result}" for "${objectName}"`);
            } else {
                Logger.debug(`❌ TypeResolver: No type found for "${objectName}"`);
            }
        }

        return result;
    }

    /**
     * Resolve expression type using AST structure
     */
    resolveExpressionType(expr: Expression, context: FileNode, doc?: TextDocument): string | null {
        if (this.enableDetailedLogging) {
            Logger.debug(`🔍 TypeResolver: Resolving expression type for ${expr.kind}`);
        }

        switch (expr.kind) {
            case 'CallExpression':
                return this.resolveCallExpression(expr as CallExpression, context, doc);
            case 'MemberExpression':
                return this.resolveMemberExpression(expr as MemberExpression, context, doc);
            case 'BinaryExpression':
                return this.resolveBinaryExpression(expr as BinaryExpression, context, doc);
            case 'AssignmentExpression':
                return this.resolveAssignmentExpression(expr as AssignmentExpression, context, doc);
            case 'Identifier':
                return this.resolveIdentifier(expr as Identifier, context, doc);
            case 'Literal':
                return this.resolveLiteral(expr as Literal);
            case 'NewExpression':
                return this.resolveNewExpression(expr as NewExpression, context);
            default:
                Logger.debug(`⚠️ TypeResolver: Unhandled expression type: ${expr.kind}`);
                return null;
        }
    }

    /**
     * Resolve auto variable type from AST structure
     */
    resolveAutoVariableFromAST(varDecl: VarDeclNode, functionBody: BlockStatement, doc?: TextDocument): string | null {
        Logger.debug(`🔍 TypeResolver: Resolving auto variable "${varDecl.name}" from AST`);

        // First, check if the variable has an initializer (most common case for auto)
        if (varDecl.initializer) {
            Logger.debug(`   ✓ Variable has initializer of kind: ${varDecl.initializer.kind}`);
            // Get the file context - prefer from document if available
            let context: FileNode | null = null;
            if (doc) {
                context = this.ensureDocumentParsed(doc);
                Logger.debug(`   ✓ Got context from document, body length: ${context.body.length}`);
            } else {
                context = this.findFileContext(varDecl);
                Logger.debug(`   ${context ? '✓' : '❌'} Got context from findFileContext`);
            }

            if (context) {
                Logger.debug(`   → Calling resolveExpressionType...`);
                const initializerType = this.resolveExpressionType(varDecl.initializer as Expression, context, doc);
                if (initializerType) {
                    Logger.debug(`🎯 TypeResolver: Resolved auto variable "${varDecl.name}" from initializer to "${initializerType}"`);
                    return initializerType;
                } else {
                    Logger.warn(`   ❌ resolveExpressionType returned null`);
                }
            } else {
                Logger.warn(`   ❌ No context available to resolve initializer`);
            }
        } else {
            Logger.debug(`   ❌ Variable has no initializer`);
        }

        // If no initializer, look for assignment expressions in the function body
        const assignments = this.findAssignmentsToVariable(varDecl.name, functionBody);

        if (assignments.length > 0) {
            // Get the containing file context
            let context: FileNode | null = null;
            if (doc) {
                context = this.ensureDocumentParsed(doc);
            } else {
                context = this.findFileContext(varDecl);
            }

            if (context) {
                const assignmentType = this.resolveExpressionType(assignments[0].right, context);
                if (assignmentType) {
                    Logger.debug(`🎯 TypeResolver: Resolved auto variable "${varDecl.name}" from assignment to "${assignmentType}"`);
                    return assignmentType;
                }
            }
        }

        Logger.debug(`❌ TypeResolver: Could not resolve auto variable "${varDecl.name}"`);
        return null;
    }

    // ============================================================================
    // PRIVATE HELPER METHODS
    // ============================================================================

    /**
     * Ensure a document is parsed and cached
     */
    private ensureDocumentParsed(doc: TextDocument): FileNode {
        const uri = normalizeUri(doc.uri);
        let ast = this.docCache.get(uri);

        if (!ast) {
            ast = this.cacheManager.ensureDocumentParsed(doc);
            // Invalidate symbol caches when a new document is added
            this.invalidateCachesForDocument(uri);
        }

        return ast;
    }

    /**
     * Search for variable type within a FileNode
     */
    private searchForVariableType(
        objectName: string,
        ast: FileNode,
        uri: string,
        globalOnly = false,
        doc?: TextDocument,
        position?: Position
    ): string | null {
        // Create a more stable cache key for this specific search
        let searchCacheKey: string;
        if (globalOnly) {
            searchCacheKey = `search:${objectName}:${uri}:global`;
        } else if (position) {
            // Use scope-based key for local searches
            const containingFunction = this.findContainingFunctionAtPosition(ast, position);
            const containingClass = this.findClassAtPosition(ast, position);
            const scopeKey = this.createScopeBasedCacheKey(containingClass, containingFunction, position);
            searchCacheKey = `search:${objectName}:${uri}:${scopeKey}`;
        } else {
            searchCacheKey = `search:${objectName}:${uri}:nopos`;
        }

        if (this.typeCache.has(searchCacheKey)) {
            return this.typeCache.get(searchCacheKey)!;
        }

        if (this.enableDetailedLogging) {
            Logger.debug(`🔍 TypeResolver: Searching for "${objectName}" in ${uri}, globalOnly: ${globalOnly}`);
        }

        for (const node of ast.body) {
            // Check for global variable declarations
            if (isVarDecl(node) && node.name === objectName) {
                if (this.enableDetailedLogging) {
                    Logger.debug(`🎯 TypeResolver: Found global variable "${objectName}"`);
                }
                const varType = this.resolveVariableType(node, doc);
                // Cache and return the result
                this.typeCache.set(searchCacheKey, varType);
                return varType;
            }

            if (globalOnly && !position) {
                continue; // Skip local scopes if searching globally without position context
            }

            // Check inside class members and methods
            if (isClass(node)) {
                const classType = this.searchInClass(objectName, node, position, doc);
                if (classType) {
                    // Cache and return the result
                    this.typeCache.set(searchCacheKey, classType);
                    return classType;
                }
            }

            // Check inside function bodies
            if (isFunction(node)) {
                const funcType = this.searchInFunction(objectName, node, position, doc);
                if (funcType) {
                    // Cache and return the result
                    this.typeCache.set(searchCacheKey, funcType);
                    return funcType;
                }
            }
        }

        // Cache the null result to avoid repeated searches
        this.typeCache.set(searchCacheKey, null);
        return null;
    }

    /**
     * Search for variable in class scope
     */
    private searchInClass(
        objectName: string,
        classNode: ClassDeclNode,
        position?: Position,
        doc?: TextDocument
    ): string | null {
        if (this.enableDetailedLogging) {
            Logger.debug(`🔍 TypeResolver: Checking class "${classNode.name}" for "${objectName}"`);
        }

        // Check class members
        for (const member of classNode.members || []) {
            if (isVarDecl(member) && member.name === objectName) {
                if (this.enableDetailedLogging) {
                    Logger.debug(`🎯 TypeResolver: Found class member "${objectName}"`);
                }
                return this.resolveVariableType(member, doc);
            }

            // Check method parameters and local variables
            if (isMethod(member) && position) {
                const method = member as MethodDeclNode;
                const isInMethod = isPositionInNode(position, method);
                if (this.enableDetailedLogging) {
                    Logger.debug(`🔍 TypeResolver: Checking method "${method.name}" for position ${position.line}:${position.character}`);
                    Logger.debug(`   Method bounds: ${method.start.line}:${method.start.character} - ${method.end.line}:${method.end.character}`);
                    Logger.debug(`   Position in method: ${isInMethod}`);
                }
                if (isInMethod) {
                    const methodType = this.searchInFunction(objectName, method, position, doc);
                    if (methodType) {
                        return methodType;
                    }
                } else if (this.enableDetailedLogging) {
                    Logger.debug(`   ❌ Position ${position.line}:${position.character} not in method bounds`);
                }
            }
        }

        return null;
    }

    /**
     * Search for variable in function scope
     */
    private searchInFunction(
        objectName: string,
        funcNode: FunctionDeclNode | MethodDeclNode,
        position?: Position,
        doc?: TextDocument
    ): string | null {
        // Check parameters
        for (const param of funcNode.parameters || []) {
            if (param.name === objectName) {
                if (this.enableDetailedLogging) {
                    Logger.debug(`🎯 TypeResolver: Found parameter "${objectName}"`);
                }
                return this.resolveParameterType(param, doc);
            }
        }

        // FIRST: Check funcNode.locals if it exists (populated by parser)
        if (funcNode.locals) {
            for (const local of funcNode.locals) {
                if (isVarDecl(local) && local.name === objectName) {
                    // Check if declaration is before position (if position specified)
                    if (position) {
                        const declEndPos = local.nameEnd || local.end;
                        const isBeforeOrAt = declEndPos.line < position.line ||
                            (declEndPos.line === position.line && declEndPos.character <= position.character);
                        if (!isBeforeOrAt) {
                            continue; // Skip if not yet declared
                        }
                    }
                    if (this.enableDetailedLogging) {
                        Logger.debug(`🎯 TypeResolver: Found local variable "${objectName}" in funcNode.locals`);
                    }
                    const result = this.resolveVariableType(local, doc);
                    return result;
                }
            }
        }

        // SECOND: Check local variables in function body (fallback for AST structure variations)
        if (isBlockStatement(funcNode.body)) {
            const localVar = this.findLocalVariable(objectName, funcNode.body, position);
            if (localVar) {
                Logger.debug(`🎯 TypeResolver: Found local variable "${objectName}" in function body`);
                return this.resolveVariableType(localVar, doc);
            }
        }

        return null;
    }

    /**
     * Find local variable declaration in block statement
     */
    private findLocalVariable(
        varName: string,
        block: BlockStatement,
        position?: Position
    ): VarDeclNode | null {
        for (const stmt of block.body) {
            if (isDeclaration(stmt)) {
                // Check all declarations (handles multiple comma-separated declarations like: int low, high;)
                const declarationsToCheck: VarDeclNode[] = [];

                if (stmt.declarations && stmt.declarations.length > 0) {
                    // Multiple declarations - check all
                    declarationsToCheck.push(...stmt.declarations.filter(isVarDecl) as VarDeclNode[]);
                } else if (stmt.declaration && isVarDecl(stmt.declaration)) {
                    // Single declaration (backwards compatibility)
                    declarationsToCheck.push(stmt.declaration as VarDeclNode);
                }

                for (const decl of declarationsToCheck) {
                    if (decl.name === varName) {
                        // If position is specified, only return if variable name ends at or before the cursor position
                        // This allows looking up the type at the declaration itself or after
                        if (!position) {
                            return decl;
                        }

                        // Check if declaration is before or at position
                        const declEndPos = decl.nameEnd || decl.end;
                        const isBeforeOrAt = declEndPos.line < position.line ||
                            (declEndPos.line === position.line && declEndPos.character <= position.character);

                        if (isBeforeOrAt) {
                            return decl;
                        }
                    }
                }
            }

            // Recursively search nested blocks
            if (isBlockStatement(stmt)) {
                const nested = this.findLocalVariable(varName, stmt, position);
                if (nested) {
                    return nested;
                }
            }
        }

        return null;
    }

    /**
     * Resolve parameter type (parameters don't use auto inference)
     */
    private resolveParameterType(paramNode: ParameterDeclNode, _doc?: TextDocument): string | null {
        const typeName = getTypeName(paramNode.type);
        if (this.enableDetailedLogging) {
            Logger.debug(`🔍 TypeResolver: Resolving parameter "${paramNode.name}" with type: ${typeName}`);
        }
        return typeName;
    }

    /**
     * Resolve variable type including auto inference
     */
    private resolveVariableType(varNode: VarDeclNode, doc?: TextDocument): string | null {
        const baseType = getTypeName(varNode.type);
        if (this.enableDetailedLogging) {
            Logger.debug(`🔍 TypeResolver: Resolving variable "${varNode.name}" with base type: ${baseType}`);
        }

        // If it's not auto, return the declared type
        if (baseType !== 'auto') {
            return baseType;
        }

        // Handle auto type inference - check if type node has inferredType property
        if (isAutoType(varNode.type)) {
            const inferredType = this.extractInferredType(varNode.type.inferredType);
            if (inferredType) {
                if (this.enableDetailedLogging) {
                    Logger.debug(`🎯 TypeResolver: Auto type resolved to: ${inferredType}`);
                }
                return inferredType;
            }
        }

        // Try AST-based auto resolution if we have document context
        if (doc) {
            const astBasedType = this.tryResolveAutoFromAST(varNode, doc);
            if (astBasedType) {
                if (this.enableDetailedLogging) {
                    Logger.debug(`🎯 TypeResolver: AST-based auto resolution: ${astBasedType}`);
                }
                return astBasedType;
            }
        }

        Logger.warn(`⚠️ TypeResolver: Auto type inference failed for variable: ${varNode.name}`);
        return null;
    }

    /**
     * Try to resolve auto variable by finding assignments in AST
     */
    private tryResolveAutoFromAST(varNode: VarDeclNode, doc: TextDocument): string | null {
        const ast = this.ensureDocumentParsed(doc);

        // Find the function or class containing this variable
        const containingFunction = this.findContainingFunction(varNode, ast);
        if (containingFunction && isBlockStatement(containingFunction.body)) {
            return this.resolveAutoVariableFromAST(varNode, containingFunction.body, doc);
        }

        return null;
    }

    /**
     * Find assignments to a specific variable in a block
     */
    private findAssignmentsToVariable(varName: string, block: BlockStatement): AssignmentExpression[] {
        const assignments: AssignmentExpression[] = [];
        const visitor = new AssignmentFinder(varName, assignments);
        visitor.visit(block);
        return assignments;
    }

    // ============================================================================
    // EXPRESSION RESOLUTION METHODS
    // ============================================================================

    /**
     * Resolve call expression type
     */
    private resolveCallExpression(expr: CallExpression, context: FileNode, doc?: TextDocument): string | null {
        // Handle function calls - resolve the function and get its return type
        if (isIdentifier(expr.callee)) {
            const funcName = expr.callee.name;

            // First, check if we're inside a class and this might be a method call (including inherited)
            if (doc && expr.start) {
                const containingClass = this.findClassAtPosition(context, expr.start);
                if (containingClass) {
                    // Look for the method in this class and its inheritance chain
                    const methodReturnType = this.getMethodReturnType(containingClass.name, funcName, doc);
                    if (methodReturnType) {
                        return methodReturnType;
                    }
                }
            }

            const functionDecl = this.findFunction(funcName, context);
            if (functionDecl) {
                return getTypeName(functionDecl.returnType);
            }
        }

        // Handle method calls
        if (isMemberExpression(expr.callee)) {
            const memberExpr = expr.callee;

            // Special handling for Cast method: ClassName.Cast(obj) returns ClassName
            if (isIdentifier(memberExpr.property) && memberExpr.property.name === 'Cast') {
                // Try to resolve the object (left side of the dot)
                const objectType = this.resolveExpressionType(memberExpr.object, context, doc);

                // If objectType is null, the object might be a class name (static call)
                if (!objectType && isIdentifier(memberExpr.object)) {
                    const className = memberExpr.object.name;
                    // Check if this is actually a class name
                    const classDefinitions = this.findAllClassDefinitions(className);
                    if (classDefinitions.length > 0) {
                        return className;
                    }
                }

                // If we resolved objectType, it means instance.Cast() which shouldn't happen
                // but if it does, return the object's type
                if (objectType) {
                    return objectType;
                }
            }

            // Regular method call resolution
            const result = this.resolveMemberExpression(memberExpr, context, doc);
            return result;
        }

        return null;
    }

    /**
     * Resolve new expression type (e.g., new TypeName())
     */
    private resolveNewExpression(expr: NewExpression, _context: FileNode): string | null {
        if (expr.type) {
            return getTypeName(expr.type);
        }
        return null;
    }

    /**
     * Resolve member expression type
     */
    private resolveMemberExpression(expr: MemberExpression, context: FileNode, doc?: TextDocument): string | null {
        // Get the type of the object being accessed
        const objectType = this.resolveExpressionType(expr.object, context, doc);
        if (!objectType) {
            return null;
        }

        // Parse generic type if present (e.g., "array<PlayerBase>" -> base: "array", args: ["PlayerBase"])
        const genericInfo = parseGenericType(objectType);
        const baseTypeName = genericInfo.baseType;
        const genericArgs = genericInfo.typeArguments;

        // Find and merge all class definitions for the base type
        const classDefinitions = this.findAllClassDefinitions(baseTypeName);
        const classDecl = mergeClassDefinitions(classDefinitions);
        if (!classDecl) {
            return null;
        }

        // Look for the member in the class
        const memberName = expr.property.name;
        for (const member of classDecl.members || []) {
            if (member.name === memberName) {
                if (isVarDecl(member)) {
                    const memberType = getTypeName(member.type);
                    return this.substituteGenericTypes(memberType, classDecl, genericArgs);
                }
                if (isMethod(member)) {
                    const returnType = getTypeName(member.returnType);
                    return this.substituteGenericTypes(returnType, classDecl, genericArgs);
                }
            }
        }

        return null;
    }

    /**
     * Resolve binary expression type
     */
    private resolveBinaryExpression(expr: BinaryExpression, context: FileNode, doc?: TextDocument): string | null {
        // For most binary expressions, resolve based on operands and operator
        const leftType = this.resolveExpressionType(expr.left, context, doc);
        const rightType = this.resolveExpressionType(expr.right, context, doc);

        // Handle comparison operators
        if (['==', '!=', '<', '>', '<=', '>='].includes(expr.operator)) {
            return 'bool';
        }

        // Handle logical operators
        if (['&&', '||'].includes(expr.operator)) {
            return 'bool';
        }

        // Handle arithmetic operators with proper type rules
        if (['+', '-', '*', '/', '%'].includes(expr.operator)) {
            // Vector arithmetic: vector +- vector -> vector
            if ((expr.operator === '+' || expr.operator === '-') &&
                leftType === 'vector' && rightType === 'vector') {
                return 'vector';
            }

            // Vector-scalar multiplication: vector * scalar or scalar * vector -> vector
            if (expr.operator === '*') {
                const hasVector = leftType === 'vector' || rightType === 'vector';
                const hasNumeric = (leftType === 'int' || leftType === 'float') ||
                    (rightType === 'int' || rightType === 'float');
                if (hasVector && hasNumeric) {
                    return 'vector';
                }
            }

            // Vector-scalar division: vector / scalar -> vector
            if (expr.operator === '/' && leftType === 'vector' &&
                (rightType === 'int' || rightType === 'float')) {
                return 'vector';
            }

            // String concatenation
            if (expr.operator === '+' && (leftType === 'string' || rightType === 'string')) {
                return 'string';
            }

            // Numeric type promotion
            if (leftType === 'float' || rightType === 'float') {
                return 'float';
            }

            if (leftType === 'int' && rightType === 'int') {
                return 'int';
            }

            // If we couldn't resolve one of the types, don't guess
            if (!leftType || !rightType || leftType === 'unknown' || rightType === 'unknown') {
                return null;
            }

            // Default to left type
            return leftType || rightType;
        }

        // Bitwise operators
        if (['&', '|', '^', '<<', '>>'].includes(expr.operator)) {
            return 'int';
        }

        return leftType || rightType;
    }

    /**
     * Resolve assignment expression type
     */
    private resolveAssignmentExpression(expr: AssignmentExpression, context: FileNode, doc?: TextDocument): string | null {
        // Assignment expressions have the type of their right-hand side
        return this.resolveExpressionType(expr.right, context, doc);
    }

    /**
     * Resolve identifier type
     */
    private resolveIdentifier(expr: Identifier, context: FileNode, doc?: TextDocument): string | null {

        // If we have document context, try to resolve using position-aware search
        if (doc) {
            // Use the identifier's position for scope-aware resolution
            const position = expr.start;
            const type = this.resolveObjectType(expr.name, doc, position);
            if (type) {
                return type;
            }
        }

        // Fallback to simple file-level search
        const varDecl = this.findVariableDeclaration(expr.name, context);
        if (varDecl) {
            const type = getTypeName(varDecl.type);
            return type;
        }
        return null;
    }

    /**
     * Resolve literal type
     */
    private resolveLiteral(expr: Literal): string {
        // Handle null literal explicitly
        if (expr.value === null) {
            return 'null';
        }

        switch (expr.literalType) {
            case 'int':
                return 'int';
            case 'float':
                return 'float';
            case 'string':
                return 'string';
            case 'bool':
                return 'bool';
            default:
                return 'unknown';
        }
    }

    // ============================================================================
    // UTILITY METHODS
    // ============================================================================

    /**
     * Extract type from inferred type information
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private extractInferredType(inferredType: any): string | null {
        if (!inferredType) return null;

        switch (inferredType.tag) {
            case 'class':
            case 'primitive':
                return inferredType.name;
            case 'generic':
                if (inferredType.name && inferredType.args) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const args = inferredType.args.map((arg: any) => arg.name || arg).join(', ');
                    return `${inferredType.name}<${args}>`;
                }
                return inferredType.name;
            case 'auto':
                return inferredType.inferred ? this.extractInferredType(inferredType.inferred) : null;
            default:
                return null;
        }
    }

    /**
     * Find function declaration by name
     */
    /**
     * Find function declaration by name in a specific document
     */
    private findFunction(funcName: string, context: FileNode): FunctionDeclNode | null {
        // Search in top-level functions
        for (const decl of context.body) {
            if (isFunction(decl) && decl.name === funcName) {
                return decl;
            }
        }
        return null;
    }

    /**
     * Substitute generic type parameters with actual types
     * e.g., if method returns "T" and we have array<PlayerBase>, substitute T with PlayerBase
     */
    private substituteGenericTypes(
        typeName: string,
        classDecl: ClassDeclNode,
        genericArgs: string[]
    ): string {
        // If no generic parameters in class or no args provided, return as-is
        if (!classDecl.genericParameters || classDecl.genericParameters.length === 0 || genericArgs.length === 0) {
            return typeName;
        }

        // Build substitution map: T -> PlayerBase, U -> OtherType, etc.
        const substitutionMap = new Map<string, string>();
        for (let i = 0; i < Math.min(classDecl.genericParameters.length, genericArgs.length); i++) {
            const paramName = classDecl.genericParameters[i].name;
            const argType = genericArgs[i];
            substitutionMap.set(paramName, argType);
        }

        // Substitute the type name
        return this.applyGenericSubstitution(typeName, substitutionMap);
    }

    /**
     * Apply generic type substitution to a type string
     */
    private applyGenericSubstitution(typeName: string, substitutionMap: Map<string, string>): string {
        // Simple substitution - check if the entire type name is a generic parameter
        if (substitutionMap.has(typeName)) {
            return substitutionMap.get(typeName)!;
        }

        // Handle complex types like "array<T>" where T needs substitution
        const genericInfo = parseGenericType(typeName);
        if (genericInfo.typeArguments.length > 0) {
            const substitutedArgs = genericInfo.typeArguments.map(arg =>
                this.applyGenericSubstitution(arg, substitutionMap)
            );
            return `${genericInfo.baseType}<${substitutedArgs.join(', ')}>`;
        }

        return typeName;
    }

    /**
     * Find variable declaration by name in file scope
     */
    private findVariableDeclaration(varName: string, context: FileNode): VarDeclNode | null {
        for (const decl of context.body) {
            if (isVarDecl(decl) && decl.name === varName) {
                return decl;
            }
        }
        return null;
    }

    /**
     * Find the function containing a variable declaration
     */
    private findContainingFunction(varNode: VarDeclNode, _ast: FileNode): FunctionDeclNode | MethodDeclNode | null {
        // Walk up the AST parent chain to find the containing function/method
        let current: ASTNode | undefined = varNode.parent;
        while (current) {
            if (isFunction(current) || isMethod(current)) {
                return current as FunctionDeclNode | MethodDeclNode;
            }
            current = current.parent;
        }
        return null;
    }

    /**
     * Find file context for a node by walking up the parent chain
     */
    private findFileContext(node: ASTNode): FileNode | null {
        // Walk up the parent chain to find the FileNode
        let current: ASTNode | undefined = node;
        while (current) {
            if (current.kind === 'File') {
                return current as FileNode;
            }
            current = current.parent;
        }

        // Fallback: try to find by URI in cache
        if (node.uri) {
            for (const [_, ast] of this.docCache.entries()) {
                if (ast.uri === node.uri) {
                    return ast;
                }
            }
        }

        return null;
    }

    /**
     * Find the containing function at a specific position
     */
    private findContainingFunctionAtPosition(ast: FileNode, position: Position): FunctionDeclNode | MethodDeclNode | null {
        // First check for global functions
        for (const node of ast.body) {
            if (isFunction(node)) {
                if (isPositionInNode(position, node)) {
                    return node;
                }
            }
            // Then check for methods within classes
            if (isClass(node)) {
                for (const member of node.members || []) {
                    if (isMethod(member)) {
                        if (isPositionInNode(position, member)) {
                            return member;
                        }
                    }
                }
            }
        }
        return null;
    }

    /**
     * Create a stable cache key based on scope context rather than exact position
     */
    private createScopeBasedCacheKey(
        containingClass: ClassDeclNode | null,
        containingFunction: FunctionDeclNode | MethodDeclNode | null,
        position: Position
    ): string {
        // For global scope
        if (!containingClass && !containingFunction) {
            return 'global';
        }

        // For class scope but outside method
        if (containingClass && !containingFunction) {
            return `class:${containingClass.name}`;
        }

        // For function/method scope - use function name and class if applicable
        if (containingFunction) {
            const functionId = containingClass
                ? `method:${containingClass.name}.${containingFunction.name}`
                : `function:${containingFunction.name}`;
            return functionId;
        }

        // Fallback to position-based key
        return `pos:${position.line}:${position.character}`;
    }

    /**
     * Find the class declaration that contains the given position
     */
    private findClassAtPosition(ast: FileNode, position: Position): ClassDeclNode | null {
        for (const node of ast.body) {
            if (isClass(node)) {
                if (isPositionInNode(position, node)) {
                    Logger.debug(`🔍 TypeResolver: Found class ${node.name} at position ${position.line}:${position.character}`);
                    return node;
                }
            }
        }
        return null;
    }

    private resolveThisType(doc: TextDocument, position?: Position): string | null {
        Logger.debug(`🔍 TypeResolver: Resolving 'this' keyword in ${doc.uri}`);

        const currentAst = this.ensureDocumentParsed(doc);

        // If we have position information, find the specific class containing this position
        if (position) {
            const containingClass = this.findClassAtPosition(currentAst, position);
            if (containingClass) {
                Logger.debug(`🎯 TypeResolver: 'this' resolves to class: ${containingClass.name}`);
                return containingClass.name;
            }
        }

        // Fallback: Find the first class in the current document
        for (const node of currentAst.body) {
            if (isClass(node)) {
                Logger.debug(`🎯 TypeResolver: 'this' resolves to class: ${node.name}`);
                return node.name;
            }
        }

        Logger.debug(`❌ TypeResolver: Could not resolve 'this' - no class found in ${doc.uri}`);
        return null;
    }

    /**
     * Resolve the type that 'super' refers to in EnScript
     * 
     * In EnScript, 'super' has two different meanings:
     * 1. In a modded class: refers to the original (non-modded) class with the same name
     *    Example: modded class PlayerBase { super.Init(); } -> refers to original PlayerBase
     * 2. In a regular class: refers to the explicit base class
     *    Example: class Child extends Parent { super.Method(); } -> refers to Parent
     * 
     * @param position Optional position to find the containing class (more accurate)
     * @returns The class name that 'super' refers to, or null if not applicable
     */
    private resolveSuperType(doc: TextDocument, position?: Position): string | null {
        Logger.debug(`🔍 TypeResolver: Resolving 'super' keyword in ${doc.uri}`);

        const currentAst = this.ensureDocumentParsed(doc);

        // If we have a position, find the containing class at that position (preferred)
        if (position) {
            const containingClass = this.findContainingClassAtPosition(currentAst, position);
            if (containingClass) {
                Logger.debug(`🔍 TypeResolver: Found containing class '${containingClass.name}' at position`);

                // Check if this is a modded class
                const isModdedClass = containingClass.modifiers?.includes('modded') || false;

                if (isModdedClass) {
                    // Modded class: super refers to the original class (same name)
                    Logger.debug(`🎯 TypeResolver: Modded class '${containingClass.name}' - super refers to original class '${containingClass.name}'`);
                    return containingClass.name;
                }

                // Regular class: super refers to the explicit base class
                if (containingClass.baseClass) {
                    const baseClassName = getTypeName(containingClass.baseClass);
                    Logger.debug(`🎯 TypeResolver: 'super' resolves to base class: ${baseClassName} for class ${containingClass.name}`);
                    return baseClassName;
                }

                Logger.debug(`❌ TypeResolver: Class '${containingClass.name}' has no base class`);
                return null;
            }
        }

        // Fallback: Find all classes and look for one with a base class (legacy behavior)
        let foundClasses = 0;
        for (const node of currentAst.body) {
            if (isClass(node)) {
                foundClasses++;
                Logger.debug(`🔍 TypeResolver: Found class ${node.name}, has baseClass: ${!!node.baseClass}`);

                if (node.baseClass) {
                    const baseClassName = getTypeName(node.baseClass);
                    Logger.debug(`🎯 TypeResolver: 'super' resolves to base class: ${baseClassName} for class ${node.name} (fallback)`);
                    return baseClassName;
                }
            }
        }

        Logger.debug(`❌ TypeResolver: Found ${foundClasses} classes, but none have base classes in ${doc.uri}`);
        return null;
    }

    /**
     * Find the class that contains a given position
     */
    private findContainingClassAtPosition(ast: FileNode, position: Position): ClassDeclNode | null {
        for (const node of ast.body) {
            if (isClass(node)) {
                // Check if position is within this class
                if (node.start && node.end) {
                    const afterStart = position.line > node.start.line ||
                        (position.line === node.start.line && position.character >= node.start.character);
                    const beforeEnd = position.line < node.end.line ||
                        (position.line === node.end.line && position.character <= node.end.character);

                    if (afterStart && beforeEnd) {
                        return node;
                    }
                }
            }
        }
        return null;
    }

    private resolveMethodCallType(methodCall: string, doc: TextDocument): string | null {
        // Parse the method call string to extract method name
        const methodMatch = methodCall.match(/^(\w+)\(/);
        if (!methodMatch) {
            Logger.debug(`⚠️ TypeResolver: Invalid method call format: ${methodCall}`);
            return null;
        }

        const methodName = methodMatch[1];
        Logger.debug(`🔍 TypeResolver: Looking for method "${methodName}"`);

        const currentAst = this.ensureDocumentParsed(doc);

        // Search for the method in all classes in the current file
        for (const decl of currentAst.body) {
            if (isClass(decl)) {
                for (const member of decl.members || []) {
                    if (isMethod(member) && member.name === methodName) {
                        const returnType = getTypeName(member.returnType);
                        Logger.debug(`🎯 TypeResolver: Found method "${methodName}" with return type "${returnType}"`);
                        return returnType;
                    }
                }
            }

            // Also check for standalone functions
            if (isFunction(decl) && decl.name === methodName) {
                const returnType = getTypeName((decl as FunctionDeclNode).returnType);
                Logger.debug(`🎯 TypeResolver: Found function "${methodName}" with return type "${returnType}"`);
                return returnType;
            }
        }

        // Search in all cached documents for global functions or methods
        for (const [_uri, ast] of this.docCache.entries()) {
            for (const decl of ast.body) {
                if (isClass(decl)) {
                    for (const member of decl.members || []) {
                        if ((isMethod(member)) && member.name === methodName) {
                            const returnType = getTypeName(member.returnType);
                            Logger.debug(`🎯 TypeResolver: Found method "${methodName}" in external class with return type "${returnType}"`);
                            return returnType;
                        }
                    }
                }

                // Check for standalone functions
                if (isFunction(decl) && decl.name === methodName) {
                    const returnType = getTypeName(decl.returnType);
                    Logger.debug(`🎯 TypeResolver: Found global function "${methodName}" with return type "${returnType}"`);
                    return returnType;
                }
            }
        }

        Logger.debug(`❌ TypeResolver: Could not find method "${methodName}"`);
        return null;
    }

    /**
     * Resolve a chained expression like "myArray.Get(0)" or "player.GetInventory().GetItem(0)"
     * Recursively resolves each part of the chain
     */
    private resolveChainedExpression(expression: string, doc: TextDocument, position?: Position): string | null {
        Logger.debug(`🔗 TypeResolver: Resolving chained expression: "${expression}"`);

        // Find the first dot to split the chain
        const firstDotIndex = this.findFirstMemberAccessDot(expression);
        if (firstDotIndex < 0) {
            // No dot found, shouldn't happen since we checked for '.' before calling this
            return this.resolveObjectType(expression, doc, position);
        }

        // Split into object part and member part
        const objectPart = expression.substring(0, firstDotIndex).trim();
        const memberPart = expression.substring(firstDotIndex + 1).trim();

        Logger.debug(`   → Object part: "${objectPart}"`);
        Logger.debug(`   → Member part: "${memberPart}"`);

        // Resolve the object part first (could be a variable, method call, or nested chain)
        let objectType: string | null = null;

        if (objectPart.includes('.')) {
            // Nested chain - recurse
            objectType = this.resolveChainedExpression(objectPart, doc, position);
        } else if (objectPart.includes('(') && objectPart.includes(')')) {
            // Method call
            objectType = this.resolveMethodCallType(objectPart, doc);
        } else {
            // Simple variable, 'this', or class name (for static method calls)
            objectType = this.resolveObjectType(objectPart, doc, position);

            // If not found as a variable, check if it's a class name (static method call)
            if (!objectType) {
                const classDefinitions = this.findAllClassDefinitions(objectPart);
                if (classDefinitions.length > 0) {
                    Logger.debug(`   ✓ Found class "${objectPart}" - treating as static method call`);
                    objectType = objectPart; // Use the class name as the type
                }
            }
        }

        if (!objectType) {
            Logger.debug(`   ❌ Could not resolve object part "${objectPart}"`);
            return null;
        }

        Logger.debug(`   ✓ Object type: "${objectType}"`);

        // Now resolve the member part in the context of the object type
        // Parse generic type if present
        const genericInfo = parseGenericType(objectType);
        const baseTypeName = genericInfo.baseType;
        const genericArgs = genericInfo.typeArguments;

        // Find and merge all class definitions
        const classDefinitions = this.findAllClassDefinitions(baseTypeName);
        const classDecl = mergeClassDefinitions(classDefinitions);
        if (!classDecl) {
            Logger.debug(`   ❌ Could not find class "${baseTypeName}"`);
            return null;
        }

        // Extract the member name (could be a method call or property access)
        let memberName: string;
        let isMethodCall = false;

        if (memberPart.includes('(')) {
            // Method call - extract name before parentheses
            const parenIndex = memberPart.indexOf('(');
            memberName = memberPart.substring(0, parenIndex).trim();
            isMethodCall = true;
        } else if (memberPart.includes('.')) {
            // Another chain - extract first part
            const nextDotIndex = this.findFirstMemberAccessDot(memberPart);
            memberName = memberPart.substring(0, nextDotIndex).trim();
        } else {
            // Simple member access
            memberName = memberPart;
        }

        Logger.debug(`   → Looking for member: "${memberName}" (isMethodCall: ${isMethodCall})`);

        // Special handling for Cast method from implicit Class base
        // Cast is a static method where the return type is the calling class, not the declared type
        // Example: PlayerBase.Cast(this) returns PlayerBase (or null)
        // Note: CastTo is NOT handled here - it returns bool and uses an out parameter
        if (isMethodCall && memberName === 'Cast') {
            Logger.debug(`   ✨ Special Cast method detected - returning calling class type: "${baseTypeName}"`);

            // For generic types, preserve the full generic signature
            const fullTypeName = genericArgs.length > 0
                ? `${baseTypeName}<${genericArgs.join(', ')}>`
                : baseTypeName;

            // If there's more to the chain, continue resolving
            if (memberPart.includes('.')) {
                const closingParenIndex = this.findMatchingClosingParen(memberPart, memberPart.indexOf('('));
                if (closingParenIndex >= 0 && closingParenIndex < memberPart.length - 1) {
                    const remainingPart = memberPart.substring(closingParenIndex + 1).trim();
                    if (remainingPart.startsWith('.')) {
                        const nextChain = remainingPart.substring(1).trim();
                        return this.resolveChainedExpression(fullTypeName + '.' + nextChain, doc, position);
                    }
                }
            }

            return fullTypeName;
        }

        // Find the member in the class (including inherited members)
        const memberType = this.findMemberType(classDecl, memberName, genericArgs);
        if (!memberType) {
            Logger.debug(`   ❌ Could not find member "${memberName}" in class "${baseTypeName}"`);
            return null;
        }

        Logger.debug(`   ✓ Member type: "${memberType}"`);

        // If there's more to the chain, continue resolving
        if (isMethodCall && memberPart.includes('.')) {
            // Find the part after the method call
            const closingParenIndex = this.findMatchingClosingParen(memberPart, memberPart.indexOf('('));
            if (closingParenIndex >= 0 && closingParenIndex < memberPart.length - 1) {
                const remainingPart = memberPart.substring(closingParenIndex + 1).trim();
                if (remainingPart.startsWith('.')) {
                    const nextChain = remainingPart.substring(1).trim();
                    // Recurse with the member type as the new object and remaining chain
                    return this.resolveChainedExpression(memberType + '.' + nextChain, doc, position);
                }
            }
        } else if (!isMethodCall && memberPart.includes('.')) {
            // Property access followed by more chain
            const nextDotIndex = this.findFirstMemberAccessDot(memberPart);
            const remainingPart = memberPart.substring(nextDotIndex + 1).trim();
            return this.resolveChainedExpression(memberType + '.' + remainingPart, doc, position);
        }

        return memberType;
    }

    /**
     * Find the first dot that represents member access (not inside method call parentheses)
     */
    private findFirstMemberAccessDot(expression: string): number {
        let parenDepth = 0;
        for (let i = 0; i < expression.length; i++) {
            const char = expression[i];
            if (char === '(') {
                parenDepth++;
            } else if (char === ')') {
                parenDepth--;
            } else if (char === '.' && parenDepth === 0) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Find the matching closing parenthesis for an opening one
     */
    private findMatchingClosingParen(expression: string, openIndex: number): number {
        let depth = 1;
        for (let i = openIndex + 1; i < expression.length; i++) {
            const char = expression[i];
            if (char === '(') {
                depth++;
            } else if (char === ')') {
                depth--;
                if (depth === 0) {
                    return i;
                }
            }
        }
        return -1;
    }

    /**
     * Find member type in a class (including checking base classes)
     */
    private findMemberType(classDecl: ClassDeclNode, memberName: string, genericArgs: string[]): string | null {
        // Check the class members
        for (const member of classDecl.members || []) {
            if (member.name === memberName) {
                if (isVarDecl(member)) {
                    const memberType = getTypeName(member.type);
                    return this.substituteGenericTypes(memberType, classDecl, genericArgs);
                }
                if (isMethod(member)) {
                    const returnType = getTypeName(member.returnType);
                    return this.substituteGenericTypes(returnType, classDecl, genericArgs);
                }
            }
        }

        // Check base class if present
        if (isTypeReference(classDecl.baseClass)) {
            const baseClassName = classDecl.baseClass.name;
            const baseClassDefinitions = this.findAllClassDefinitions(baseClassName);
            const baseClassDecl = mergeClassDefinitions(baseClassDefinitions);
            if (baseClassDecl) {
                return this.findMemberType(baseClassDecl, memberName, []);
            }
        }

        return null;
    }

    /**
     * Generic method to find symbols with two-tier caching
     * Reduces code duplication across different symbol types
     */
    private findSymbols<T extends SymbolNode>(
        symbolName: string,
        symbolKind: SymbolKind,
        getCacheFunc: (name: string) => { workspace: T[] | null; external: T[] | null },
        setCacheFunc: (name: string, workspace: T[], external: T[]) => void,
        matchPredicate: (node: ASTNode, name: string) => boolean
    ): T[] {
        // Check both caches
        const cache = getCacheFunc(symbolName);

        // If both caches have data, combine and return
        if (cache.workspace && cache.external) {
            if (this.enableDetailedLogging) {
                Logger.debug(`✓ Full cache hit for ${symbolKind} "${symbolName}" (${cache.workspace.length} workspace + ${cache.external.length} external)`);
            }
            return [...cache.workspace, ...cache.external];
        }

        // Need to search - separate workspace and external files
        const workspaceSymbols: T[] = cache.workspace || [];
        const externalSymbols: T[] = cache.external || [];
        const needWorkspaceSearch = !cache.workspace;
        const needExternalSearch = !cache.external;

        if (needWorkspaceSearch || needExternalSearch) {
            if (this.enableDetailedLogging) {
                Logger.debug(`🔍 Searching for ${symbolKind} "${symbolName}" in ${this.docCache.size} cached documents`);
            }

            for (const [uri, ast] of this.docCache.entries()) {
                const isWorkspace = this.workspaceManager.isWorkspaceFile(uri);

                // Skip if we already have the cache for this tier
                if (isWorkspace === true && !needWorkspaceSearch) continue;
                if (isWorkspace === false && !needExternalSearch) continue;
                // If null (can't determine), only search if we need either cache
                if (isWorkspace === null && !needWorkspaceSearch && !needExternalSearch) continue;

                for (const node of ast.body) {
                    if (matchPredicate(node, symbolName)) {
                        const symbolNode = node as T;

                        // Add to appropriate cache(s)
                        if (isWorkspace === null) {
                            // Can't determine - add to workspace cache only (avoid duplicates)
                            if (needWorkspaceSearch) workspaceSymbols.push(symbolNode);
                        } else if (isWorkspace) {
                            if (needWorkspaceSearch) workspaceSymbols.push(symbolNode);
                        } else {
                            if (needExternalSearch) externalSymbols.push(symbolNode);
                        }

                        if (this.enableDetailedLogging) {
                            const location = isWorkspace === null ? 'unknown' : (isWorkspace ? 'workspace' : 'external');
                            Logger.debug(`   ✓ Found "${symbolName}" in ${location}: ${uri}`);
                        }
                    }
                }
            }

            // Cache the results
            if (needWorkspaceSearch || needExternalSearch) {
                setCacheFunc(symbolName, workspaceSymbols, externalSymbols);
            }
        }

        const totalSymbols = [...workspaceSymbols, ...externalSymbols];

        if (this.enableDetailedLogging) {
            Logger.debug(`🔍 Found ${totalSymbols.length} ${symbolKind} definitions for "${symbolName}" (${workspaceSymbols.length} workspace + ${externalSymbols.length} external)`);
        }

        return totalSymbols;
    }

    /**
     * Resolve typedef to its underlying type name
     * E.g., "TStringArray" -> "array<string>" -> "array"
     */
    resolveTypedefToClassName(typedefName: string): string | null {
        const typedefs = this.findAllTypedefDefinitions(typedefName);
        if (typedefs.length === 0) {
            return null;
        }

        // Get the target type from the typedef
        const typedef = typedefs[0];
        if (!typedef.type) {
            return null;
        }

        // Extract the base type name (handles generic types)
        return extractTypeName(typedef.type);
    }

    /**
     * Finds all class definitions with the same name (including original + modded versions)
     * Uses two-tier caching: workspace cache and external cache
     * Also resolves typedefs to their underlying class type
     */
    findAllClassDefinitions(className: string): ClassDeclNode[] {
        // First try direct class lookup
        const directClasses = this.findSymbols<ClassDeclNode>(
            className,
            'class',
            (name) => this.symbolCache.getClassCache(name),
            (name, ws, ext) => this.symbolCache.setClassCache(name, ws, ext),
            (node, name) => isClass(node) && node.name === name
        );

        if (directClasses.length > 0) {
            return directClasses;
        }

        // If no direct class found, try resolving as typedef
        const resolvedClassName = this.resolveTypedefToClassName(className);
        if (resolvedClassName && resolvedClassName !== className) {
            if (this.enableDetailedLogging) {
                Logger.debug(`🔍 Resolved typedef "${className}" -> "${resolvedClassName}"`);
            }
            return this.findAllClassDefinitions(resolvedClassName);
        }

        return [];
    }

    /**
     * Finds all global function definitions with the same name
     * Uses two-tier caching: workspace cache and external cache
     */
    findAllGlobalFunctionDefinitions(functionName: string): FunctionDeclNode[] {
        return this.findSymbols<FunctionDeclNode>(
            functionName,
            'function',
            (name) => this.symbolCache.getFunctionCache(name),
            (name, ws, ext) => this.symbolCache.setFunctionCache(name, ws, ext),
            (node, name) => {
                if (!isFunction(node)) return false;
                return node.name === name;
            }
        );
    }

    /**
     * Find all global variable definitions across all loaded files
     * Uses two-tier caching: workspace cache and external cache
     */
    findAllGlobalVariableDefinitions(variableName: string): VarDeclNode[] {
        return this.findSymbols<VarDeclNode>(
            variableName,
            'variable',
            (name) => this.symbolCache.getVariableCache(name),
            (name, ws, ext) => this.symbolCache.setVariableCache(name, ws, ext),
            (node, name) => isVarDecl(node) && node.name === name
        );
    }

    /**
     * Find all typedef definitions across all loaded files
     * Uses two-tier caching: workspace cache and external cache
     */
    findAllTypedefDefinitions(typedefName: string): TypedefDeclNode[] {
        return this.findSymbols<TypedefDeclNode>(
            typedefName,
            'typedef',
            (name) => this.symbolCache.getTypedefCache(name),
            (name, ws, ext) => this.symbolCache.setTypedefCache(name, ws, ext),
            (node, name) => isTypedef(node) && node.name === name
        );
    }

    /**
     * Find all enum definitions across all loaded files
     */
    findAllEnumDefinitions(enumName: string): EnumDeclNode[] {
        return this.findSymbols<EnumDeclNode>(
            enumName,
            'enum',
            (name) => this.symbolCache.getEnumCache(name),
            (name, workspace, external) => this.symbolCache.setEnumCache(name, workspace, external),
            (node, name) => isEnum(node) && node.name === name
        );
    }

    /**
     * Get all available class names without URI information
     */
    getAllAvailableClassNames(): string[] {
        const classNames = new Set<string>();
        for (const [_uri, ast] of this.docCache.entries()) {
            for (const node of ast.body) {
                if (isClass(node) && node.name) {
                    classNames.add(node.name);
                }
            }
        }
        return Array.from(classNames);
    }

    /**
     * Get all available enum names
     */
    getAllAvailableEnumNames(): string[] {
        const enumNames = new Set<string>();
        for (const [_uri, ast] of this.docCache.entries()) {
            for (const node of ast.body) {
                if (isEnum(node) && node.name) {
                    enumNames.add(node.name);
                }
            }
        }
        return Array.from(enumNames);
    }

    /**
     * Get all available typedef names
     */
    getAllAvailableTypedefNames(): string[] {
        const typedefNames = new Set<string>();
        for (const [_uri, ast] of this.docCache.entries()) {
            for (const node of ast.body) {
                if (isTypedef(node) && node.name) {
                    typedefNames.add(node.name);
                }
            }
        }
        return Array.from(typedefNames);
    }

    /**
     * Get the return type of a global function
     * Now uses cached function lookup for performance
     */
    getGlobalFunctionReturnType(functionName: string, _doc: TextDocument): string | null {
        // Use cached function lookup instead of scanning all documents
        const functions = this.findAllGlobalFunctionDefinitions(functionName);
        if (functions.length > 0) {
            return getTypeName(functions[0].returnType);
        }
        return null;
    }

    /**
     * Get the return type of a method in a specific class
     * Now with full inheritance support!
     */
    getMethodReturnType(className: string, methodName: string, _doc: TextDocument): string | null {
        const classDefinitions = this.findAllClassDefinitions(className);

        for (const classDef of classDefinitions) {
            // Use core function to search with full inheritance support
            const member = findMemberInClassWithInheritance(
                classDef,
                methodName,
                (name) => {
                    const defs = this.findAllClassDefinitions(name);
                    // IMPORTANT: Merge all class definitions to include modded classes
                    return mergeClassDefinitions(defs);
                },
                false, // Don't include private
                new Set()
            );

            if (member && isMethod(member)) {
                return getTypeName(member.returnType);
            }
        }

        return null;
    }

    /**
     * Get the return type of a method in a specific class, with support for generic type resolution
     * @param className The class name (may include generic args like "array<ref PlayerBase>")
     * @param methodName The method name to look up
     * @param doc The document context
     * @param genericContext Optional generic type mapping for resolving generic return types
     */
    getMethodReturnTypeWithContext(
        className: string,
        methodName: string,
        _doc: TextDocument,
        _genericContext: Map<string, string> | null
    ): string | null {
        // Parse generic arguments from className (e.g., "array<ref PlayerBase>" -> baseType: "array", args: ["ref PlayerBase"])
        const genericInfo = parseGenericType(className);
        const baseClassName = genericInfo.baseType;
        const genericArgs = genericInfo.typeArguments;

        // Get the method return type from the base class
        const baseReturnType = this.getMethodReturnType(baseClassName, methodName, _doc);
        if (!baseReturnType) {
            return null;
        }

        // If no generic arguments or the return type is not a generic parameter, return as-is
        if (genericArgs.length === 0) {
            return baseReturnType;
        }

        // Find the class definition to get generic parameter names
        const classDefinitions = this.findAllClassDefinitions(baseClassName);
        if (classDefinitions.length === 0) {
            return baseReturnType;
        }

        const classDecl = classDefinitions[0];

        // Apply generic type substitution
        const substitutedType = this.substituteGenericTypes(baseReturnType, classDecl, genericArgs);

        Logger.debug(`🔄 Generic substitution: ${className}.${methodName}() -> ${baseReturnType} -> ${substitutedType}`);

        return substitutedType;
    }

    /**
     * Get the type of a property in a specific class
     * Now with full inheritance support!
     */
    getPropertyType(className: string, propertyName: string, _doc: TextDocument): string | null {
        const classDefinitions = this.findAllClassDefinitions(className);

        for (const classDef of classDefinitions) {
            // Use core function to search with full inheritance support
            const member = findMemberInClassWithInheritance(
                classDef,
                propertyName,
                (name) => {
                    const defs = this.findAllClassDefinitions(name);
                    return defs[0] || null;
                },
                false, // Don't include private
                new Set()
            );

            if (member && isVarDecl(member)) {
                return getTypeName(member.type);
            }
        }

        return null;
    }
}

/**
 * AST visitor to find assignment expressions to a specific variable
 */
class AssignmentFinder extends BaseASTVisitor<void> {
    constructor(
        private targetVariable: string,
        private assignments: AssignmentExpression[]
    ) {
        super();
    }

    protected defaultResult(): void {
        // No default result needed for void visitor
    }

    protected visitAssignmentExpression(node: AssignmentExpression): void {
        // Check if this assignment is to our target variable
        if (isIdentifier(node.left)) {
            if (node.left.name === this.targetVariable) {
                this.assignments.push(node);
            }
        }
        super.visitAssignmentExpression(node);
    }
}