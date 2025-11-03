/**
 * Symbol lookup utilities for finding definitions at specific positions
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import { FileNode, Declaration, ASTNode, MemberExpression, Identifier, Expression, CallExpression } from '../ast/node-types';
import { getTokenAtPosition } from './token-utils';
import { Logger } from '../../util/logger';
import { normalizeUri } from '../../util/uri';
import { IASTScopeResolver } from '../scopes/ast-scope-resolver-interfaces';
import { isEnum, isFunction, isClass, isMethod, isMemberExpression } from '../../util';
import { findMemberInClassWithInheritance } from '../util/ast-class-utils';
import {
    stripGenericArguments,
    findMemberInClassHierarchy,
    SymbolResolutionContext
} from '../util/symbol-resolution-utils';
import { isPositionInNode } from '../util/utils';
import { ITypeResolver } from '../types/type-resolver-interfaces';

/**
 * Result of a symbol lookup with extended information
 */
export interface SymbolLookupResult extends Declaration {
    uri: string;
}

/**
 * Find all symbols (declarations) at a given position
 */
export function findSymbolsAtPosition(
    doc: TextDocument,
    position: Position,
    docCache: Map<string, FileNode>
): SymbolLookupResult[] {
    const text = doc.getText();
    const offset = doc.offsetAt(position);

    // Get the token at this position
    const token = getTokenAtPosition(text, offset);
    if (!token || token.kind !== 0) { // TokenKind.Identifier = 0
        Logger.debug(`No identifier token found at position ${position.line}:${position.character}`);
        return [];
    }

    const symbolName = token.value;
    Logger.debug(`🔍 Looking up symbol: "${symbolName}" at ${position.line}:${position.character}`);

    const results: SymbolLookupResult[] = [];
    const currentUri = normalizeUri(doc.uri);

    // Search in current document first
    const currentAst = docCache.get(currentUri);
    if (currentAst) {
        results.push(...findSymbolInFile(symbolName, currentAst, currentUri));
    }

    // Then search in all other documents
    for (const [uri, ast] of docCache.entries()) {
        if (uri === currentUri) continue; // Already searched
        results.push(...findSymbolInFile(symbolName, ast, uri));
    }

    Logger.debug(`Found ${results.length} definition(s) for symbol "${symbolName}"`);
    return results;
}

/**
 * Find a symbol by name within a single file
 */
export function findSymbolInFile(symbolName: string, ast: FileNode, uri: string): SymbolLookupResult[] {
    const results: SymbolLookupResult[] = [];

    for (const decl of ast.body) {
        // Check top-level declarations
        if (decl.name === symbolName) {
            results.push({ ...decl, uri });
        }

        // Check class members
        if (isClass(decl)) {
            for (const member of decl.members) {
                if (member.name === symbolName) {
                    results.push({ ...member, uri });
                }

                // Check method parameters and locals
                if (isMethod(member)) {

                    // Check parameters
                    for (const param of member.parameters) {
                        if (param.name === symbolName) {
                            results.push({ ...param, uri });
                        }
                    }

                    // Check locals
                    if (member.locals) {
                        for (const local of member.locals) {
                            if (local.name === symbolName) {
                                results.push({ ...local, uri });
                            }
                        }
                    }
                }
            }
        }

        // Check enum members
        if (isEnum(decl)) {
            for (const member of decl.members) {
                if (member.name === symbolName) {
                    results.push({ ...member, uri });
                }
            }
        }

        // Check function parameters and locals
        if (isFunction(decl)) {
            // Check parameters
            for (const param of decl.parameters) {
                if (param.name === symbolName) {
                    results.push({ ...param, uri });
                }
            }

            // Check locals
            if (decl.locals) {
                for (const local of decl.locals) {
                    if (local.name === symbolName) {
                        results.push({ ...local, uri });
                    }
                }
            }
        }
    }

    return results;
}

/**
 * Find the exact definition of a symbol at a position using scope-aware resolution.
 * This resolves to the actual declaration following proper scoping rules:
 * 1. Local variables in the current function (only if not a type/class name)
 * 2. Function parameters (only if not a type/class name)
 * 3. Class members when accessing 'this.member' (only if not a type/class name)
 * 4. Global classes (returns ALL for modded classes)
 * 5. Global functions, enums, typedefs
 * 6. Inherited class members (fallback)
 * 
 * @param includePaths Optional include paths for loading external classes
 * @param loadClassFromIncludePaths Optional function to load missing classes from include paths
 */
export async function findExactDefinition(
    doc: TextDocument,
    position: Position,
    docCache: Map<string, FileNode>,
    scopeResolver: IASTScopeResolver,
    typeResolver: ITypeResolver,
    includePaths?: string[],
    loadClassFromIncludePaths?: (className: string) => Promise<void>
): Promise<SymbolLookupResult[]> {
    const text = doc.getText();
    const offset = doc.offsetAt(position);

    // Get the token at this position
    const token = getTokenAtPosition(text, offset);
    if (!token || token.kind !== 0) { // TokenKind.Identifier = 0
        Logger.debug(`No identifier token found at position ${position.line}:${position.character}`);
        return [];
    }

    const symbolName = token.value;
    Logger.debug(`🎯 Finding exact definition for: "${symbolName}" at ${position.line}:${position.character}`);

    const currentUri = normalizeUri(doc.uri);
    const currentAst = docCache.get(currentUri);
    if (!currentAst) {
        Logger.warn('No AST found for current document');
        return [];
    }

    // Check if this is a member access using AST (e.g., "obj.method")
    const memberContext = detectMemberAccess(currentAst, position);
    if (memberContext) {
        Logger.debug(`🔍 Detected member access from AST: ${memberContext.objectExpression}.${symbolName}`);
        const memberResults = await findMemberDefinitionAsync(
            memberContext.objectExpression,
            symbolName,
            doc,
            position,
            docCache,
            typeResolver,
            includePaths,
            loadClassFromIncludePaths
        );
        if (memberResults.length > 0) {
            Logger.debug(`✅ Found ${memberResults.length} member definition(s) for ${symbolName}`);
            return memberResults;
        }

        // Before falling back to global search, check if the object is a known class
        // If it is, don't fall back - the member truly doesn't exist or is incomplete
        const objectType = typeResolver.resolveObjectType(memberContext.objectExpression, doc, position);
        if (objectType) {
            const baseTypeName = stripGenericArguments(objectType);
            const classDefinitions = typeResolver.findAllClassDefinitions(baseTypeName);
            if (classDefinitions.length > 0) {
                Logger.debug(`⚠️ Member '${symbolName}' not found on class '${baseTypeName}', not falling back to global search`);
                return []; // Don't fall back to global search for explicit class member access
            }
        }

        // Also check if the object expression itself is directly a class name (e.g., "string" in "string.Empty")
        const directClassDefs = typeResolver.findAllClassDefinitions(memberContext.objectExpression);
        if (directClassDefs.length > 0) {
            Logger.debug(`⚠️ Member '${symbolName}' not found on class '${memberContext.objectExpression}', not falling back to global search`);
            return []; // Don't fall back to global search for explicit class member access
        }

        Logger.debug(`⚠️ Member access detected but member not found and not a class, falling back to global search`);
    } else {
        Logger.debug(`❌ No member access detected for symbol "${symbolName}"`);
    }

    // Get scope context to understand where we are
    const scopeContext = scopeResolver.getScopeContext(doc, position);

    // Priority order for non-member access:
    // 1. Local variables in the current function
    if (scopeContext.containingFunction) {
        const locals = scopeContext.containingFunction.locals || [];
        for (const local of locals) {
            if (local.name === symbolName) {
                Logger.debug(`✅ Found local variable definition: ${symbolName}`);
                return [{ ...local, uri: currentUri }];
            }
        }

        // 2. Check function parameters
        const params = scopeContext.containingFunction.parameters || [];
        for (const param of params) {
            if (param.name === symbolName) {
                Logger.debug(`✅ Found parameter definition: ${symbolName}`);
                return [{ ...param, uri: currentUri }];
            }
        }
    }

    // 3. Check class members (if in a class) - now with full inheritance chain support!
    if (scopeContext.containingClass) {
        // Use core function to search with full inheritance support
        const member = findMemberInClassWithInheritance(
            scopeContext.containingClass,
            symbolName,
            (className) => {
                // Use typeResolver which automatically resolves typedefs
                const classDefs = typeResolver.findAllClassDefinitions(className);
                return classDefs.length > 0 ? classDefs[0] : null;
            },
            false, // Don't include private members from base classes
            new Set()
        );

        if (member) {
            // Find which document contains this member (current or base class)
            let memberUri = currentUri;

            // If member is from base class, find its URI
            if (!scopeContext.containingClass.members.includes(member)) {
                // Search for the class that contains this member
                for (const [uri, ast] of docCache.entries()) {
                    for (const decl of ast.body) {
                        if (isClass(decl) && decl.members.includes(member)) {
                            memberUri = uri;
                            break;
                        }
                    }
                }
            }

            Logger.debug(`✅ Found class member definition: ${symbolName} (with inheritance)`);
            return [{ ...member, uri: memberUri }];
        }
    }

    // 5. Finally, check global symbols (classes, functions, enums, typedefs)
    // Only after local scope has been checked
    const globalResults = findGlobalSymbol(symbolName, currentUri, docCache);

    if (globalResults.length > 0) {
        // Found global definition(s)
        if (globalResults.length > 1) {
            Logger.info(`📦 Found ${globalResults.length} modded class definitions for: ${symbolName}`);
        } else {
            Logger.debug(`✅ Found global definition: ${symbolName} (${globalResults[0].kind})`);
        }
        return globalResults;
    }
    return [];
}

/**
 * Find global symbols (classes, functions, enums, typedefs)
 * Returns all modded class definitions if multiple exist, single result otherwise
 */
function findGlobalSymbol(
    symbolName: string,
    currentUri: string,
    docCache: Map<string, FileNode>
): SymbolLookupResult[] {
    const classMatches: SymbolLookupResult[] = [];
    const otherMatches: SymbolLookupResult[] = [];

    // FIRST: Search ALL files for classes with this name
    // This ensures we find all modded class versions, regardless of which file we're in
    for (const [uri, ast] of docCache.entries()) {
        for (const decl of ast.body) {
            if (decl.name === symbolName) {
                if (isClass(decl)) {
                    classMatches.push({ ...decl, uri });
                } else {
                    // Store non-class matches (functions, typedefs, etc.)
                    otherMatches.push({ ...decl, uri });
                }
            }

            // Check enum members
            if (isEnum(decl)) {
                for (const member of decl.members) {
                    if (member.name === symbolName) {
                        // Enum members are unique, return immediately
                        return [{ ...member, uri }];
                    }
                }
            }
        }
    }

    // If we found any classes, return ALL of them (base class + all modded versions)
    if (classMatches.length > 0) {
        if (classMatches.length > 1) {
            Logger.info(`📦 Found ${classMatches.length} class definitions (base + modded) for: ${symbolName}`);
        } else {
            Logger.debug(`✅ Found class definition: ${symbolName}`);
        }
        return classMatches;
    }

    // If no classes found, return the first non-class match (function, typedef, etc.)
    if (otherMatches.length > 0) {
        Logger.debug(`✅ Found global ${otherMatches[0].kind} definition: ${symbolName}`);
        return [otherMatches[0]];
    }

    return []; // No global symbol found
}

function detectMemberAccess(ast: ASTNode, position: Position): { objectExpression: string } | null {

    // Recursively traverse AST to find MemberExpression at position
    function findMemberExpression(node: ASTNode): MemberExpression | null {
        if (!node) {
            return null;
        }

        // Check if this is a MemberExpression and cursor is on the property
        if (isMemberExpression(node)) {
            // Check if position is specifically on the property identifier
            if (node.property && isPositionInNode(position, node.property)) {
                return node;
            }
            // Even if not on property, continue searching in children (for nested member expressions)
        }

        // Check common child node properties (including body, members, statements, etc.)
        const childKeys = ['body', 'members', 'statements', 'declarations', 'declaration', 'expression',
            'init', 'test', 'update', 'consequent', 'alternate',
            'left', 'right', 'object', 'property',
            'callee', 'arguments', 'params', 'parameters', 'returnType', 'initializer'];

        for (const key of childKeys) {
            if (key in node) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const child = (node as any)[key];
                if (child && typeof child === 'object') {
                    if (Array.isArray(child)) {
                        for (const item of child) {
                            if (item && typeof item === 'object' && 'kind' in item) {
                                const found = findMemberExpression(item);
                                if (found) return found;
                            }
                        }
                    } else if ('kind' in child) {
                        const found = findMemberExpression(child);
                        if (found) return found;
                    }
                }
            }
        }

        return null;
    }

    const memberExpr = findMemberExpression(ast);
    if (!memberExpr) {
        return null;
    }

    // Extract object expression text
    const objectExpr = buildObjectExpression(memberExpr.object);
    if (objectExpr) {
        return { objectExpression: objectExpr };
    }

    return null;
}

/**
 * Build a string representation of an expression for type resolution
 * Handles identifiers, member chains, and call expressions
 */
function buildObjectExpression(expr: Expression): string | null {
    switch (expr.kind) {
        case 'Identifier':
            return (expr as Identifier).name;

        case 'MemberExpression':
            return buildMemberChain(expr as MemberExpression);

        case 'CallExpression': {
            // For call expressions like GetGame(), build the callee expression
            const callExpr = expr as CallExpression;
            const callee = buildObjectExpression(callExpr.callee);
            if (callee) {
                return `${callee}()`;
            }
            return null;
        }
        case 'ThisExpression':
            return 'this';
        case 'SuperExpression':
            return 'super';
        default:
            return null;
    }
}

/**
 * Helper to build a member access chain from nested MemberExpression nodes
 * e.g., a.b.c becomes "a.b"
 * Also handles call expressions in the chain like a().b
 */
function buildMemberChain(memberExpr: MemberExpression): string | null {
    const parts: string[] = [];

    // Traverse to the root
    let current: Expression = memberExpr;
    while (isMemberExpression(current)) {
        const memberNode = current as MemberExpression;
        if (memberNode.property.kind === 'Identifier') {
            parts.unshift(memberNode.property.name);
        } else {
            return null; // Can't handle computed properties
        }
        current = memberNode.object;
    }

    // Handle the base object (could be Identifier, CallExpression, etc.)
    const baseExpr = buildObjectExpression(current);
    if (baseExpr) {
        parts.unshift(baseExpr);
        return parts.join('.');
    }

    return null;
}

/**
 * Find the definition of a member (method or field) given the object name
 * Uses shared member-utils for consistent member lookup with inheritance support
 */
async function findMemberDefinitionAsync(
    objectName: string,
    memberName: string,
    doc: TextDocument,
    position: Position,
    docCache: Map<string, FileNode>,
    typeResolver: ITypeResolver,
    includePaths?: string[],
    loadClassFromIncludePaths?: (className: string) => Promise<void>
): Promise<SymbolLookupResult[]> {
    // Get opened document URIs from docCache keys
    const openedDocumentUris = new Set(docCache.keys());

    // First check if objectName is directly a class name (for static member access)
    const directClassCheck = typeResolver.findAllClassDefinitions(objectName);
    if (directClassCheck.length > 0) {
        // For static access, use the new async member finder
        const context: SymbolResolutionContext = {
            document: doc,
            typeResolver,
            includePaths: includePaths || [],
            loadClassFromIncludePaths,
            openedDocumentUris
        };

        const memberResult = await findMemberInClassHierarchy(
            objectName,
            memberName,
            true, // static
            context,
            false // don't allow private
        );

        if (memberResult) {
            Logger.debug(`✅ Found static member '${memberName}' in class '${memberResult.foundInClass}'`);
            return [{
                ...memberResult.member,
                uri: memberResult.uri
            }];
        }
        return [];
    }

    // Use type-resolver to determine the object's type (for instance member access)
    const objectType = typeResolver.resolveObjectType(objectName, doc, position);

    if (!objectType) {
        Logger.debug(`❌ Could not resolve type for object: ${objectName}`);
        return [];
    }

    Logger.debug(`🔍 Resolved ${objectName} to type: ${objectType}`);

    // Strip generic arguments (e.g., "array<int>" -> "array")
    const baseTypeName = stripGenericArguments(objectType);

    // Check if this is a 'super' access - if so, exclude modded classes
    const isSuperAccess = objectName === 'super';
    if (isSuperAccess) {
        Logger.debug(`🔍 Super access detected - will exclude modded classes from search`);
    }

    // Use the new async member finder with inheritance and include path support
    const context: SymbolResolutionContext = {
        document: doc,
        typeResolver,
        includePaths: includePaths || [],
        loadClassFromIncludePaths,
        openedDocumentUris
    };

    const memberResult = await findMemberInClassHierarchy(
        baseTypeName,
        memberName,
        false, // instance member
        context,
        false, // don't allow private
        isSuperAccess // exclude modded classes for super access
    );

    if (memberResult) {
        Logger.debug(`✅ Found instance member '${memberName}' in class '${memberResult.foundInClass}'`);
        return [{
            ...memberResult.member,
            uri: memberResult.uri
        }];
    }

    Logger.debug(`⚠️ Member '${memberName}' not found in class '${baseTypeName}' hierarchy`);
    return [];
}
