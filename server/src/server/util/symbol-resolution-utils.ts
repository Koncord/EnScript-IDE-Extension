/**
 * Shared utilities for symbol resolution, type checking, and class hierarchy traversal.
 * Used by both diagnostics rules and symbol lookup functionality.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import {
    ClassDeclNode,
    FunctionDeclNode,
    VarDeclNode,
    Declaration,
    ASTNode,
    FileNode,
    TypeNode,
    MethodDeclNode,
    MemberExpression
} from '../ast';
import {
    isClass,
    isEnum,
    isTypedef,
    isFunction,
    isMethod,
    isVarDecl,
    findMemberInClassWithInheritance,
    isStaticDeclaration,
    isConstDeclaration,
    isIdentifier,
    isThisExpression
} from './ast-class-utils';
import { keywords } from '../lexer/rules';
import { Logger } from '../../util/logger';
import { TypeResolver } from '../types/type-resolver';
import { isBuiltInType, parseGenericType } from './type-utils';
import { applyGenericSubstitution } from './generic-type-utils';
import { ITypeResolver } from '../types/type-resolver-interfaces';

/**
 * Context needed for symbol resolution operations
 */
export interface SymbolResolutionContext {
    document: TextDocument;
    typeResolver?: ITypeResolver;
    includePaths?: string[];
    loadClassFromIncludePaths?: (className: string) => Promise<void>;
    openedDocumentUris?: Set<string>;
}

/**
 * Result of type resolution with static access information
 */
export interface ResolvedType {
    typeName: string;
    isStaticAccess: boolean;
}

/**
 * Check if a name is a language keyword or built-in construct
 */
export function isLanguageKeyword(name: string): boolean {
    return keywords.has(name);
}

/**
 * Check if a name is an enum name
 */
export function isEnumName(name: string, ast: FileNode, typeResolver?: ITypeResolver): boolean {
    // Check in provided AST
    for (const node of ast.body) {
        if (isEnum(node) && node.name === name) {
            return true;
        }
    }

    // Check with type resolver if available
    if (typeResolver) {
        try {
            const availableEnumNames = typeResolver.getAllAvailableEnumNames();
            return availableEnumNames.includes(name);
        } catch (error) {
            Logger.warn(`Error checking if '${name}' is an enum:`, error);
        }
    }

    return false;
}

/**
 * Check if a function is declared globally or in the current class
 */
export function isFunctionDeclared(
    functionName: string,
    currentAst: FileNode,
    currentClassName: string | null,
    typeResolver?: TypeResolver,
    document?: TextDocument
): boolean {
    // Check in current document for top-level functions
    for (const node of currentAst.body) {
        if (isFunction(node) && node.name === functionName) {
            return true;
        }
    }

    // Check if this is a method of the current class
    if (currentClassName && typeResolver) {
        // Find all class definitions for the current class (including original + modded)
        const classDefinitions = typeResolver.findAllClassDefinitions(currentClassName);

        // Check if method exists in any class definition
        for (const classDef of classDefinitions) {
            for (const member of classDef.members || []) {
                if (isMethod(member) && member.name === functionName) {
                    return true;
                }
            }
        }

        const globalFunctions = typeResolver.findAllGlobalFunctionDefinitions(functionName);
        if (globalFunctions.length > 0) {
            return true;
        }
    }

    // Use TypeResolver to check for global functions (if available)
    if (typeResolver && document) {
        const returnType = typeResolver.getGlobalFunctionReturnType(functionName, document);
        if (returnType) {
            return true;
        }
    }

    return false;
}

/**
 * Check if a class/type is declared
 */
export function isTypeDeclared(
    typeName: string,
    currentAst: FileNode,
    typeResolver?: ITypeResolver,
    containingClass?: ClassDeclNode
): boolean {
    // Skip built-in types
    if (isBuiltInType(typeName)) {
        return true;
    }

    // Check if it's a generic type parameter of the containing class
    if (containingClass && containingClass.genericParameters) {
        for (const genericParam of containingClass.genericParameters) {
            if (genericParam.name === typeName) {
                return true;
            }
        }
    }

    // Check if it's declared in the current document
    for (const astNode of currentAst.body) {
        if ((isClass(astNode) || isTypedef(astNode) || isEnum(astNode)) && astNode.name === typeName) {
            return true;
        }
    }

    // Use TypeResolver to check for types (if available)
    if (typeResolver) {
        const classDefinitions = typeResolver.findAllClassDefinitions(typeName);
        if (classDefinitions.length > 0) {
            return true;
        }

        const typedefDefinitions = typeResolver.findAllTypedefDefinitions(typeName);
        if (typedefDefinitions.length > 0) {
            return true;
        }

        const enumDefinitions = typeResolver.findAllEnumDefinitions(typeName);
        if (enumDefinitions.length > 0) {
            return true;
        }
    }

    return false;
}

/**
 * Check if a class definition appears to be an incomplete stub
 */
export function isLikelyIncompleteStub(
    className: string,
    classDefinitions: ClassDeclNode[],
    includePaths: string[],
    openedDocumentUris?: Set<string>
): boolean {
    // If no class definitions found, it's not a stub - it's missing entirely
    if (classDefinitions.length === 0) {
        return false;
    }

    // If the file containing this class is currently opened in the editor,
    // treat it as complete (unstubbed) regardless of its content
    if (openedDocumentUris && classDefinitions.length > 0) {
        const isAnyDefinitionInOpenedFile = classDefinitions.some(classDef => {
            const sourceUri = classDef.uri;
            return sourceUri && openedDocumentUris.has(sourceUri);
        });

        if (isAnyDefinitionInOpenedFile) {
            return false;
        }
    }

    // If we have include paths configured, we can be more conservative
    if (includePaths.length > 0) {
        return false;
    }

    // If no include paths configured, be very conservative - only reload truly minimal stubs
    const allAreMinimalStubs = classDefinitions.every(classDef => {
        const methods = classDef.members?.filter((member: Declaration) => isMethod(member)) || [];

        // If no methods at all, it might be a stub, but could also be a valid empty class
        if (methods.length === 0) {
            return false;
        }

        // If more than 2 methods, assume it's complete enough
        if (methods.length > 2) {
            return false;
        }

        // Check if all methods are empty (but exclude native/proto which are complete)
        const allMethodsAreEmptyStubs = methods.every((methodBase: Declaration) => {
            const method = methodBase as FunctionDeclNode;
            const isNativeOrProto = (
                method.modifiers?.includes('native') ||
                method.modifiers?.includes('proto')
            ) || false;

            // Native/proto methods are complete implementations
            if (isNativeOrProto) {
                return false;
            }

            // Check if method has no body or empty body
            return !method.body || method.body.body.length === 0;
        });

        return allMethodsAreEmptyStubs;
    });

    return allAreMinimalStubs;
}

/**
 * Load class definitions from include paths if available
 */
export async function tryLoadClassFromIncludes(
    className: string,
    context: SymbolResolutionContext
): Promise<ClassDeclNode[]> {
    if (!context.typeResolver) {
        Logger.warn(`🔍 No type resolver available for class '${className}'`);
        return [];
    }

    let classDefinitions = context.typeResolver.findAllClassDefinitions(className);

    // Check if we should attempt to load from include paths
    let shouldLoadFromIncludePaths = false;

    if (classDefinitions.length === 0) {
        // No definitions found - definitely try to load
        shouldLoadFromIncludePaths = true;
    } else {
        // We have definitions, but check if they might be incomplete stubs
        const isLikelyStub = isLikelyIncompleteStub(
            className,
            classDefinitions,
            context.includePaths || [],
            context.openedDocumentUris
        );
        if (isLikelyStub) {
            shouldLoadFromIncludePaths = true;
        }
    }

    if (shouldLoadFromIncludePaths && context.loadClassFromIncludePaths) {
        try {
            await context.loadClassFromIncludePaths(className);
            classDefinitions = context.typeResolver.findAllClassDefinitions(className);
        } catch (error) {
            Logger.warn(`Failed to load class '${className}' from include paths:`, error);
        }
    }

    return classDefinitions;
}

/**
 * Extract type name from a TypeNode
 * Handles different TypeNode structures (name, identifier properties)
 * Also handles GenericType to get the base type name
 * Always trims whitespace from type names
 */
export function extractTypeName(typeNode: ASTNode): string | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const typeNodeAny = typeNode as any;

    // Handle GenericType - get the base type name
    if ('kind' in typeNodeAny && typeNodeAny.kind === 'GenericType' && 'baseType' in typeNodeAny) {
        return extractTypeName(typeNodeAny.baseType);
    }

    // Try 'name' property first (most common)
    if ('name' in typeNodeAny && typeof typeNodeAny.name === 'string') {
        return typeNodeAny.name.trim();
    }

    // Try 'identifier' property (alternative structure)
    if ('identifier' in typeNodeAny && typeof typeNodeAny.identifier === 'string') {
        return typeNodeAny.identifier.trim();
    }

    return null;
}

/**
 * Get generic type arguments from a TypeNode
 */
export function extractTypeArguments(typeNode: ASTNode): ASTNode[] | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const typeNodeAny = typeNode as any;

    // Try 'typeArguments' property first
    if ('typeArguments' in typeNodeAny && Array.isArray(typeNodeAny.typeArguments)) {
        return typeNodeAny.typeArguments;
    }

    // Try 'genericArgs' property (alternative structure)
    if ('genericArgs' in typeNodeAny && Array.isArray(typeNodeAny.genericArgs)) {
        return typeNodeAny.genericArgs;
    }

    return null;
}

/**
 * Strip generic type arguments from a type name
 * E.g., "array<PlayerBase>" -> "array", "map<string, int>" -> "map"
 */
export function stripGenericArguments(typeName: string): string {
    const genericStart = typeName.indexOf('<');
    if (genericStart === -1) {
        return typeName;
    }
    return typeName.substring(0, genericStart);
}

/**
 * Find a member in a class hierarchy and return the member with its URI
 * This is the async version that supports include path loading
 * 
 * @param excludeModded If true, skip modded class definitions (useful for 'super' lookups)
 * @returns Member info with optional staticMismatch flag indicating if there's a static/instance access mismatch
 */
export async function findMemberInClassHierarchy(
    className: string,
    memberName: string,
    isStatic: boolean,
    context: SymbolResolutionContext,
    allowPrivate: boolean = false,
    excludeModded: boolean = false
): Promise<{ member: Declaration; uri: string; foundInClass: string; staticMismatch?: boolean } | null> {
    Logger.debug(`🔍 Finding member '${memberName}' in class '${className}' hierarchy (static: ${isStatic}, allowPrivate: ${allowPrivate}, excludeModded: ${excludeModded})`);

    if (!context.typeResolver) {
        Logger.warn(`🔍 No type resolver available for member search`);
        return null;
    }

    // Parse generic arguments from className (e.g., "array<ref Param2<int,int>>" -> baseType: "array", args: ["ref Param2<int,int>"])
    const genericInfo = parseGenericType(className);
    const baseClassName = genericInfo.baseType;
    const genericArgs = genericInfo.typeArguments;

    // Handle built-in generic types for method lookups
    if (isBuiltInType(baseClassName) && !isStatic) {
        const builtInReturn = resolveBuiltInMethodReturnType(baseClassName, memberName, genericArgs);
        if (builtInReturn !== null) {
            Logger.debug(`🔍 Built-in method '${memberName}' found on '${className}'`);
            // Return a synthetic result indicating the built-in method exists
            return {
                member: {
                    kind: 'MethodDecl',
                    name: memberName,
                    returnType: { kind: 'TypeReference', name: builtInReturn } as TypeNode,
                    // Minimal required fields for a Declaration
                    start: 0, end: 0, nameStart: 0, nameEnd: 0,
                    modifiers: [], annotations: [], parent: undefined
                } as unknown as Declaration,
                uri: '<built-in>',
                foundInClass: baseClassName
            };
        }
    }

    // Load class definitions with include path support
    let classDefinitions = await tryLoadClassFromIncludes(baseClassName, context);

    if (classDefinitions.length === 0) {
        Logger.warn(`🔍 No class definitions found for '${baseClassName}' (from '${className}')`);
        return null;
    }

    // Filter out modded classes when checking 'super' expressions
    // This ensures that super.method() only checks the original class, not the modded version
    if (excludeModded) {
        // Check if we have any non-modded definitions BEFORE filtering
        const hasNonModdedDefinition = classDefinitions.some(classDef => {
            const isModded = classDef.modifiers?.includes('modded') || false;
            return !isModded;
        });

        // If we only have modded definitions, try loading the original from include paths first
        if (!hasNonModdedDefinition && context.includePaths && context.includePaths.length > 0 && context.loadClassFromIncludePaths) {
            Logger.debug(`🔍 Only modded classes found for '${baseClassName}', attempting to load original from include paths...`);
            try {
                await context.loadClassFromIncludePaths(baseClassName);
                // Reload all class definitions after loading from include paths
                classDefinitions = await tryLoadClassFromIncludes(baseClassName, context);
            } catch (error) {
                Logger.warn(`Failed to load class '${baseClassName}' from include paths:`, error);
            }
        }

        // Now filter to keep only non-modded classes
        classDefinitions = classDefinitions.filter(classDef => {
            const isModded = classDef.modifiers?.includes('modded') || false;
            return !isModded;
        });

        if (classDefinitions.length === 0) {
            Logger.warn(`🔍 No non-modded class definitions found for '${baseClassName}' after filtering and include path loading`);
            return null;
        }
    }

    // Use core function to check member in each class definition with full inheritance support
    for (const classDef of classDefinitions) {
        // Check all members with matching name (to handle overloads)
        const allMatchingMembers: Declaration[] = [];

        // Collect all members with the matching name from the class and its hierarchy
        const collectMembers = async (currentClass: ClassDeclNode, visited: Set<string> = new Set()) => {
            if (visited.has(currentClass.name)) {
                return;
            }
            visited.add(currentClass.name);

            // Collect from current class
            for (const member of currentClass.members) {
                if (member.name === memberName) {
                    const isPrivate = isStaticDeclaration(member) ? false :
                        member.modifiers?.includes('private') || false;
                    if (!isPrivate || allowPrivate) {
                        allMatchingMembers.push(member);
                    }
                }
            }

            // Recurse to base class - use tryLoadClassFromIncludes to handle stubs correctly
            if (currentClass.baseClass && context.typeResolver) {
                const baseClassName = extractTypeName(currentClass.baseClass);
                if (baseClassName) {
                    // Load base class with stub detection (will reload from include paths if stubbed)
                    const baseDefs = await tryLoadClassFromIncludes(baseClassName, context);
                    if (baseDefs[0]) {
                        await collectMembers(baseDefs[0], visited);
                    }
                }
            }
        };

        await collectMembers(classDef);

        if (allMatchingMembers.length === 0) {
            continue;
        }

        // Check if any member matches the static/instance requirement
        let exactMatch: Declaration | null = null;
        let mismatchMember: Declaration | null = null;

        for (const member of allMatchingMembers) {
            const isMemberMatch = (isMethod(member) || isVarDecl(member));
            if (!isMemberMatch) {
                continue;
            }

            // Determine if member is static
            const hasStaticModifier = isStaticDeclaration(member);
            const hasConstModifier = isConstDeclaration(member);
            const memberIsStatic = hasStaticModifier || hasConstModifier;

            // Check if this member matches the static/instance requirement
            if (isStatic === memberIsStatic) {
                exactMatch = member;
                break; // Found exact match, no need to continue
            } else {
                // Track mismatch for potential diagnostic
                mismatchMember = member;
            }
        }

        // If we found an exact match, return it (no mismatch)
        if (exactMatch) {
            const uri = exactMatch.uri || classDef.uri || '';
            Logger.info(`🔍 Found member '${memberName}' in class '${classDef.name}' at ${uri}`);

            return {
                member: exactMatch,
                uri,
                foundInClass: classDef.name,
                staticMismatch: false
            };
        }

        // If we only found mismatched members, return the first one with mismatch flag
        if (mismatchMember) {
            const memberIsStatic = isStaticDeclaration(mismatchMember) || isConstDeclaration(mismatchMember);
            if (isStatic && !memberIsStatic) {
                Logger.debug(`🔍 Found '${memberName}' - looking for static but found instance member (mismatch)`);
            } else {
                Logger.debug(`🔍 Found '${memberName}' - looking for instance but found static member (mismatch)`);
            }

            const uri = mismatchMember.uri || classDef.uri || '';
            Logger.info(`🔍 Found member '${memberName}' in class '${classDef.name}' at ${uri} (static mismatch)`);

            return {
                member: mismatchMember,
                uri,
                foundInClass: classDef.name,
                staticMismatch: true
            };
        }
    }

    Logger.debug(`🔍 Member '${memberName}' not found in class '${className}' hierarchy`);
    return null;
}

/**
 * Resolve the type of a property/field on a class
 */
export async function resolvePropertyType(
    className: string,
    propertyName: string,
    context: SymbolResolutionContext
): Promise<string | null> {
    if (!context.typeResolver) {
        return null;
    }

    // Strip generic arguments from class name
    const baseClassName = stripGenericArguments(className);

    // Load class definitions
    const classDefinitions = await tryLoadClassFromIncludes(baseClassName, context);
    if (classDefinitions.length === 0) {
        Logger.warn(`🔍 No class definitions found for '${baseClassName}' (from '${className}')`);
        return null;
    }

    // Use core function to search for property with full inheritance support
    for (const classDef of classDefinitions) {
        // First try sync lookup for already-loaded classes
        const member = findMemberInClassWithInheritance(
            classDef,
            propertyName,
            (name) => {
                if (!context.typeResolver) return null;
                const defs = context.typeResolver.findAllClassDefinitions(name);
                return defs[0] || null;
            },
            false, // Don't include private
            new Set()
        );

        if (member && isVarDecl(member)) {
            const varMember = member as VarDeclNode;
            const typeName = varMember.type ? extractTypeName(varMember.type) : null;
            Logger.debug(`🔍 Property '${propertyName}' on '${className}' has type: ${typeName}`);
            return typeName;
        }

        // If not found with sync lookup, try async with include paths
        if (!member && classDef.baseClass) {
            const baseClassName = extractTypeName(classDef.baseClass);
            if (baseClassName) {
                const basePropertyType = await resolvePropertyType(baseClassName, propertyName, context);
                if (basePropertyType) {
                    return basePropertyType;
                }
            }
        }
    }

    Logger.warn(`🔍 Property '${propertyName}' not found on class '${className}'`);
    return null;
}

/**
 * Resolve the return type of built-in methods on built-in generic types
 */
function resolveBuiltInMethodReturnType(
    baseClassName: string,
    methodName: string,
    genericArgs: string[]
): string | null {
    switch (baseClassName) {
        case 'array':
            switch (methodName) {
                case 'Get':
                    // array<T>.Get(int index) returns T
                    return genericArgs.length > 0 ? genericArgs[0] : null;
                case 'Insert':
                    // array<T>.Insert(T item) returns void
                    return 'void';
                case 'Count':
                    // array<T>.Count() returns int
                    return 'int';
                case 'Remove':
                    // array<T>.Remove(int index) returns void
                    return 'void';
                default:
                    return null;
            }

        case 'map':
            switch (methodName) {
                case 'Get':
                    // map<K,V>.Get(K key) returns V
                    return genericArgs.length > 1 ? genericArgs[1] : null;
                case 'Set':
                    // map<K,V>.Set(K key, V value) returns void
                    return 'void';
                case 'Contains':
                    // map<K,V>.Contains(K key) returns bool
                    return 'bool';
                case 'Remove':
                    // map<K,V>.Remove(K key) returns bool
                    return 'bool';
                case 'Count':
                    // map<K,V>.Count() returns int
                    return 'int';
                default:
                    return null;
            }

        case 'set':
            switch (methodName) {
                case 'Insert':
                    // set<T>.Insert(T item) returns bool
                    return 'bool';
                case 'Contains':
                    // set<T>.Contains(T item) returns bool
                    return 'bool';
                case 'Remove':
                    // set<T>.Remove(T item) returns bool
                    return 'bool';
                case 'Count':
                    // set<T>.Count() returns int
                    return 'int';
                default:
                    return null;
            }

        default:
            return null;
    }
}

/**
 * Resolve the return type of a method on a class
 */
export async function resolveMethodReturnType(
    className: string,
    methodName: string,
    context: SymbolResolutionContext
): Promise<string | null> {
    if (!context.typeResolver) {
        return null;
    }

    // Parse generic arguments from className (e.g., "array<ref Param2<int,int>>" -> baseType: "array", args: ["ref Param2<int,int>"])
    const genericInfo = parseGenericType(className);
    const baseClassName = genericInfo.baseType;
    const genericArgs = genericInfo.typeArguments;

    // Handle built-in generic types
    if (isBuiltInType(baseClassName)) {
        const builtInReturn = resolveBuiltInMethodReturnType(baseClassName, methodName, genericArgs);
        if (builtInReturn !== null) {
            Logger.debug(`🔍 Built-in method '${methodName}' on '${className}' returns: ${builtInReturn}`);
            return builtInReturn;
        }
    }

    // Load class definitions
    const classDefinitions = await tryLoadClassFromIncludes(baseClassName, context);
    if (classDefinitions.length === 0) {
        Logger.warn(`🔍 No class definitions found for '${baseClassName}' (from '${className}')`);
        return null;
    }

    // Use core function to search for method with full inheritance support
    for (const classDef of classDefinitions) {
        // First try sync lookup for already-loaded classes
        const member = findMemberInClassWithInheritance(
            classDef,
            methodName,
            (name) => {
                if (!context.typeResolver) return null;
                const defs = context.typeResolver.findAllClassDefinitions(name);
                return defs[0] || null;
            },
            false, // Don't include private
            new Set()
        );

        if (member && isMethod(member)) {
            // Special handling for Cast method inherited from Class base
            // Cast is a static method where the return type is the calling class, not the declared type (Class)
            if (methodName === 'Cast') {
                const declaredReturnType = member.returnType ? extractTypeName(member.returnType) : null;
                const isStaticMethod = isStaticDeclaration(member);

                // If it's a static Cast method that returns 'Class', apply special handling
                if (isStaticMethod && declaredReturnType === 'Class') {
                    Logger.debug(`🎯 Special Cast method from Class base detected - returning calling class type: "${className}"`);
                    return className;
                }
            }

            // Apply generic type substitution if needed
            if (genericArgs.length > 0) {
                Logger.debug(`🔍 Applying generic substitution for method '${methodName}' on '${className}'`);
                const substitutedMembers = applyGenericSubstitution([member], className, classDef);
                const substitutedMember = substitutedMembers[0];
                if (substitutedMember && isMethod(substitutedMember)) {
                    const returnType = substitutedMember.returnType ? extractTypeName(substitutedMember.returnType) : null;
                    Logger.debug(`🔍 Method '${methodName}' on '${className}' returns: ${returnType} (after generic substitution)`);
                    return returnType;
                }
            }

            // Fall back to original return type if no generics or substitution failed
            const returnType = member.returnType ? extractTypeName(member.returnType) : null;
            Logger.debug(`🔍 Method '${methodName}' on '${className}' returns: ${returnType}`);
            return returnType;
        }

        // If not found with sync lookup, try async with include paths
        if (!member && classDef.baseClass) {
            const baseClassName = extractTypeName(classDef.baseClass);
            if (baseClassName) {
                const baseMethodReturnType = await resolveMethodReturnType(baseClassName, methodName, context);
                if (baseMethodReturnType) {
                    return baseMethodReturnType;
                }
            }
        }
    }

    Logger.warn(`🔍 Method '${methodName}' not found on class '${className}'`);
    return null;
}

/**
 * Find the class that contains a node by walking up the parent chain
 */
export function findContainingClass(node: ASTNode, _ast: FileNode): ClassDeclNode | null {
    let current: ASTNode | undefined = node;
    while (current) {
        if (isClass(current)) {
            return current;
        }
        if (current.parent == null && current.kind !== 'File') {
            throw new Error(`Node of kind '${current.kind}' has no parent and is not a File node.`);
        }
        current = current.parent;
    }
    return null;
}

/**
 * Find the function or method that contains a node by walking up the parent chain
 * This finds the enclosing callable context (function or method) for a given node.
 * 
 * @param node The AST node to start searching from
 * @returns The containing FunctionDeclNode or MethodDeclNode, or null if not found
 */
export function findContainingFunctionOrMethod(node: ASTNode): FunctionDeclNode | null {
    let current: ASTNode | undefined = node.parent;
    while (current) {
        if (isFunction(current) || isMethod(current)) {
            return current as FunctionDeclNode;
        }
        current = current.parent;
    }
    return null;
}

/**
 * Check if a source class is derived from (extends) a target class.
 * Walks the inheritance chain and resolves typedefs.
 * 
 * @param sourceClass The class name to check (potential child class)
 * @param targetClass The base class name to check against (potential parent class)
 * @param context Symbol resolution context with typeResolver
 * @returns true if sourceClass is derived from targetClass, false otherwise
 */
export function isClassDerivedFrom(
    sourceClass: string,
    targetClass: string,
    context: SymbolResolutionContext
): boolean {
    if (!context.typeResolver) {
        return false;
    }

    if (sourceClass === targetClass) {
        return true;
    }

    if (isBuiltInType(sourceClass) || isBuiltInType(targetClass)) {
        return false;
    }

    try {
        const sourceClassDefs = context.typeResolver.findAllClassDefinitions(sourceClass);
        if (sourceClassDefs.length === 0) {
            return false;
        }

        for (const classDef of sourceClassDefs) {
            if (checkInheritanceChain(classDef, targetClass, context, new Set())) {
                return true;
            }
        }
    } catch (error) {
        Logger.debug(`isClassDerivedFrom: Error checking class inheritance: ${error}`);
    }

    return false;
}

/**
 * Check inheritance chain by walking up the class hierarchy.
 * Resolves typedefs to their underlying class types.
 * 
 * @param classDef The class definition to start from
 * @param targetClass The target base class name to find
 * @param context Symbol resolution context with typeResolver
 * @param visited Set of visited class names to prevent infinite loops
 * @returns true if targetClass is found in the inheritance chain
 */
export function checkInheritanceChain(
    classDef: ClassDeclNode,
    targetClass: string,
    context: SymbolResolutionContext,
    visited: Set<string>
): boolean {
    if (visited.has(classDef.name)) {
        return false;
    }
    visited.add(classDef.name);

    if (!classDef.baseClass || !context.typeResolver) {
        return false;
    }

    const baseClassName = extractTypeName(classDef.baseClass);
    if (!baseClassName) {
        return false;
    }

    // Resolve typedef to actual class name if needed
    let resolvedBaseClassName = baseClassName;
    const typedefResolved = context.typeResolver.resolveTypedefToClassName(baseClassName);
    if (typedefResolved) {
        resolvedBaseClassName = typedefResolved;
    }

    if (resolvedBaseClassName === targetClass) {
        return true;
    }

    // Also check if the original baseClassName matches (in case typedef itself is the target)
    if (baseClassName === targetClass) {
        return true;
    }

    const baseClassDefs = context.typeResolver.findAllClassDefinitions(resolvedBaseClassName);
    for (const baseClassDef of baseClassDefs) {
        if (checkInheritanceChain(baseClassDef, targetClass, context, visited)) {
            return true;
        }
    }

    return false;
}

/**
 * Find a function declaration in the current file's AST
 * @param funcName The name of the function to find
 * @param ast The file AST to search in
 * @returns The function declaration node if found, null otherwise
 */
export function findFunctionInFile(funcName: string, ast: FileNode): FunctionDeclNode | null {
    for (const decl of ast.body) {
        if (isFunction(decl) && decl.name === funcName) {
            return decl;
        }
    }
    return null;
}

/**
 * Find a method in a class (including inherited methods)
 * Returns the first matching method (does not handle overloads)
 * @param classDecl The class to search in
 * @param methodName The name of the method to find
 * @param context Symbol resolution context with typeResolver for inheritance lookup
 * @returns The method declaration node if found, null otherwise
 */
export function findMethodInClass(
    classDecl: ClassDeclNode,
    methodName: string,
    context: SymbolResolutionContext
): MethodDeclNode | null {
    const methods = findAllMethodsInClass(classDecl, methodName, context);
    return methods.length > 0 ? methods[0] : null;
}

/**
 * Find all methods with a given name in a class (including inherited methods)
 * Supports method overloading by returning all matching methods
 * @param classDecl The class to search in
 * @param methodName The name of the method to find
 * @param context Symbol resolution context with typeResolver for inheritance lookup
 * @returns Array of all matching method declaration nodes (may be empty)
 */
export function findAllMethodsInClass(
    classDecl: ClassDeclNode,
    methodName: string,
    context: SymbolResolutionContext
): MethodDeclNode[] {
    const methods: MethodDeclNode[] = [];

    // Check in current class
    for (const member of classDecl.members) {
        if (isMethod(member) && member.name === methodName) {
            methods.push(member);
        }
    }

    // Check in base class
    if (classDecl.baseClass && context.typeResolver) {
        const baseClassName = extractTypeName(classDecl.baseClass);
        if (baseClassName) {
            const baseClassDefs = context.typeResolver.findAllClassDefinitions(baseClassName);
            for (const baseClassDef of baseClassDefs) {
                const baseMethods = findAllMethodsInClass(baseClassDef, methodName, context);
                methods.push(...baseMethods);
            }
        }
    }

    return methods;
}

/**
 * Resolve all methods from a member expression (e.g., obj.method(), this.method(), ClassName.StaticMethod())
 * Supports method overloading by returning all matching methods
 * @param memberExpr The member expression to resolve (e.g., obj.method or this.method)
 * @param ast The file AST for context lookup
 * @param context Symbol resolution context with typeResolver
 * @returns Array of all matching method declaration nodes (may be empty)
 */
export async function resolveMethodsFromMemberExpression(
    memberExpr: MemberExpression,
    ast: FileNode,
    context: SymbolResolutionContext
): Promise<MethodDeclNode[]> {
    const methods: MethodDeclNode[] = [];

    try {
        if (!isIdentifier(memberExpr.property)) {
            return methods;
        }

        const methodName = memberExpr.property.name;

        // Handle 'this' keyword - get the containing class
        if (isThisExpression(memberExpr.object)) {
            const containingClass = findContainingClass(memberExpr, ast);
            if (containingClass) {
                return findAllMethodsInClass(containingClass, methodName, context);
            }
        }

        // Handle static method calls via class name (e.g., MyClass.StaticMethod)
        // Check if the object is a class name
        if (isIdentifier(memberExpr.object) && context.typeResolver) {
            const potentialClassName = memberExpr.object.name;
            const classDefs = context.typeResolver.findAllClassDefinitions(potentialClassName);
            if (classDefs.length > 0) {
                // It's a static method call
                for (const classDef of classDefs) {
                    const classMethods = findAllMethodsInClass(classDef, methodName, context);
                    methods.push(...classMethods);
                }
                return methods;
            }
        }

        // Regular instance method call - resolve the type of the object
        if (!context.typeResolver || !context.document) {
            return methods;
        }

        const objectType = context.typeResolver.resolveExpressionType(
            memberExpr.object,
            ast,
            context.document
        );

        if (!objectType) {
            return methods;
        }

        // Get the class definition
        const classBase = parseGenericType(objectType).baseType;
        const classDefs = context.typeResolver.findAllClassDefinitions(classBase);

        for (const classDef of classDefs) {
            const classMethods = findAllMethodsInClass(classDef, methodName, context);
            methods.push(...classMethods);
        }

    } catch (error) {
        Logger.debug(`resolveMethodsFromMemberExpression: Error resolving methods: ${error}`);
    }

    return methods;
}
