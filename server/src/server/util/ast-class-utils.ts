/**
 * Utility functions for working with AST class members and access modifiers
 */

import { 
    ClassDeclNode, 
    FunctionDeclNode, 
    Declaration,
    MethodDeclNode,
    EnumDeclNode,
    TypedefDeclNode,
    VarDeclNode,
    Identifier,
    ASTNode,
    TypeReferenceNode,
    BlockStatement,
    MemberExpression,
    DeclarationStatement,
    CallExpression,
    ParameterDeclNode,
    ExpressionStatement,
    AutoTypeNode,
    BinaryExpression,
    AssignmentExpression,
    WhileStatement,
    ForStatement,
    ForEachStatement,
    IfStatement,
    ReturnStatement,
    ThisExpression,
    NewExpression,
    ConditionalExpression,
    CastExpression,
    Literal,
    ArrayLiteralExpression,
    VectorLiteral,
    GenericTypeNode,
    TypeNode
} from '../ast/node-types';
import { Logger } from '../../util/logger';
import { extractTypeName } from './symbol-resolution-utils';

/**
 * Checks if a method is public based on its modifiers.
 * 
 * A method is considered public if:
 * 1. It has no access modifiers (private/protected), OR
 * 2. It explicitly has the 'public' modifier
 * 
 * @param method The method AST node to check
 * @returns True if the method is public, false otherwise
 */
export function isPublicDeclaration(method?: Declaration): boolean {
    return (!isPrivateDeclaration(method) && !isProtectedDeclaration(method));
}

/**
 * Checks if a method is private based on its modifiers.
 * 
 * @param method The method AST node to check
 * @returns True if the method is private, false otherwise
 */
export function isPrivateDeclaration(method?: Declaration): boolean {
    return method?.modifiers.includes('private') ?? false;
}

/**
 * Checks if a method is protected based on its modifiers.
 * 
 * @param decl The method AST node to check
 * @returns True if the method is protected, false otherwise
 */
export function isProtectedDeclaration(decl?: Declaration): boolean {
    return decl?.modifiers.includes('protected') ?? false;
}

/**
 * Checks if a method is static based on its modifiers.
 * 
 * @param decl The method AST node to check
 * @returns True if the method is static, false otherwise
 */
export function isStaticDeclaration(decl?: Declaration): boolean {
    return decl?.modifiers.includes('static') ?? false;
}

/**
 * Checks if a method is const based on its modifiers.
 * 
 * @param decl The method AST node to check
 * @returns True if the method is const, false otherwise
 */
export function isConstDeclaration(decl?: Declaration): boolean {
    return decl?.modifiers.includes('const') ?? false;
}

export function isLiteral(node?: ASTNode): node is Literal {
    return node != null && node.kind === 'Literal';
}

export function isVectorLiteral(node?: ASTNode): node is VectorLiteral {
    return node != null && node.kind === 'VectorLiteral';
}

export function isArrayLiteral(node?: ASTNode): node is ArrayLiteralExpression {
    return node != null && node.kind === 'ArrayLiteralExpression';
}

export function isIdentifier(node?: ASTNode): node is Identifier {
    return node != null && node.kind === 'Identifier';
}

export function isBlockStatement(node?: ASTNode): node is BlockStatement {
    return node != null && node.kind === 'BlockStatement';
}

export function isWhileStatement(node?: ASTNode): node is WhileStatement {
    return node != null && node.kind === 'WhileStatement';
}

export function isForStatement(node?: ASTNode): node is ForStatement {
    return node != null && node.kind === 'ForStatement';
}

export function isForEachStatement(node?: ASTNode): node is ForEachStatement {
    return node != null && node.kind === 'ForEachStatement';
}

export function isIfStatement(node?: ASTNode): node is IfStatement {
    return node != null && node.kind === 'IfStatement';
}

export function isReturnStatement(node?: ASTNode): node is ReturnStatement {
    return node != null && node.kind === 'ReturnStatement';
}

export function isDeclaration(node?: ASTNode): node is DeclarationStatement {
    return node != null && node.kind === 'DeclarationStatement';
}

export function isAutoType(node?: ASTNode) : node is AutoTypeNode {
    return node != null && node.kind === 'AutoType';
}

export function isExpression(node?: ASTNode): node is ExpressionStatement {
    return node != null && node.kind === 'ExpressionStatement';
}

export function isMemberExpression(node?: ASTNode): node is MemberExpression {
    return node != null && node.kind === 'MemberExpression';
}

export function isCallExpression(node?: ASTNode): node is CallExpression {
    return node != null && node.kind === 'CallExpression';
}

export function isBinaryExpression(node?: ASTNode): node is BinaryExpression {
    return node != null && (node.kind === 'BinaryExpression');
}

export function isAssignmentExpression(node?: ASTNode): node is AssignmentExpression {
    return node != null && (node.kind === 'AssignmentExpression');
}

export function isConditionalExpression(node?: ASTNode): node is ConditionalExpression {
    return node != null && node.kind === 'ConditionalExpression';
}

export function isCastExpression(node?: ASTNode): node is CastExpression {
    return node != null && node.kind === 'CastExpression';
}

export function isThisExpression(node?: ASTNode): node is ThisExpression {
    return node != null && node.kind === 'ThisExpression';
}

export function isNewExpression(node?: ASTNode): node is NewExpression {
    return node != null && node.kind === 'NewExpression';
}

export function isTypeReference(node?: ASTNode): node is TypeReferenceNode {
    return node != null && node.kind === 'TypeReference';
}

export function isGenericType(node?: ASTNode): node is GenericTypeNode {
    return node != null && node.kind === 'GenericType';
}

export function isMethod(member?: ASTNode): member is MethodDeclNode {
    return member != null && (member.kind === 'MethodDecl' || member.kind === 'ProtoMethodDecl');
}

export function isFunction(member?: ASTNode): member is FunctionDeclNode {
    return member != null && member.kind === 'FunctionDecl';
}

export function isClass(member?: ASTNode): member is ClassDeclNode {
    return member != null && member.kind === 'ClassDecl';
}

export function isEnum(member?: ASTNode): member is EnumDeclNode {
    return member != null && member.kind === 'EnumDecl';
}

export function isTypedef(member?: ASTNode): member is TypedefDeclNode {
    return member != null && member.kind === 'TypedefDecl';
}

export function isVarDecl(member?: ASTNode): member is VarDeclNode {
    return member != null && member.kind === 'VarDecl';
}

export function isParameterDecl(member?: ASTNode): member is ParameterDeclNode {
    return member != null && member.kind === 'ParameterDecl';
}

/**
 * Checks if a type node has a ref modifier
 * This handles both TypeReferenceNode and GenericTypeNode (which wraps a TypeReference with ref)
 */
export function hasRefModifier(type?: TypeNode): boolean {
    if (!type) {
        return false;
    }
    
    if (isTypeReference(type)) {
        return type.modifiers?.includes('ref') ?? false;
    }

    if (isGenericType(type)) {
        return hasRefModifier(type.baseType);
    }
    
    return false;
}

/**
 * Gets all public members (not just methods) from a class.
 * 
 * @param classNode The class AST node to analyze
 * @returns Array of public member nodes
 */
export function getPublicMembers(classNode: ClassDeclNode): Declaration[] {
    return classNode.members.filter(member => {

        return isPublicDeclaration(member);
    });
}

/**
 * Gets all private methods from a class AST node.
 * 
 * @param classNode The class AST node to analyze
 * @returns Array of private function declaration nodes
 */
export function getPrivateMethods(classNode: ClassDeclNode): MethodDeclNode[] {
    return classNode.members
        .filter(member => isMethod(member))
        .map(member => member as MethodDeclNode)
        .filter(isPrivateDeclaration);
}

/**
 * Gets all protected methods from a class AST node.
 * 
 * @param classNode The class AST node to analyze
 * @returns Array of protected function declaration nodes
 */
export function getProtectedMethods(classNode: ClassDeclNode): MethodDeclNode[] {
    return classNode.members
        .filter(member => isMethod(member))
        .map(member => member as MethodDeclNode)
        .filter(isProtectedDeclaration);
}

/**
 * Gets all public members from a class including inherited members from base classes.
 * 
 * @param classNode The class AST node to analyze
 * @param findClassFn Function to find a class definition by name
 * @param visitedClasses Set to track visited classes to prevent infinite recursion
 * @returns Array of public member nodes including inherited ones
 */
export function getPublicMembersWithInheritance(
    classNode: ClassDeclNode,
    findClassFn: (className: string) => ClassDeclNode | null,
    visitedClasses: Set<string> = new Set()
): Declaration[] {
    // Prevent infinite recursion in case of circular inheritance
    if (visitedClasses.has(classNode.name)) {
        return [];
    }
    visitedClasses.add(classNode.name);

    // Get public members from current class
    const currentMembers = getPublicMembers(classNode);

    // Get public members from base class if it exists
    let inheritedMembers: Declaration[] = [];
    if (classNode.baseClass) {
        const baseClassName = extractTypeName(classNode.baseClass);
        if (baseClassName) {
            const baseClass = findClassFn(baseClassName);
            if (baseClass) {
                inheritedMembers = getPublicMembersWithInheritance(baseClass, findClassFn, visitedClasses);
            }
        }
    }

    // Combine current and inherited members
    // Note: Current class members override inherited ones with the same name
    const memberMap = new Map<string, Declaration>();

    // Add inherited members first
    for (const member of inheritedMembers) {
        memberMap.set(member.name, member);
    }

    // Add current class members (overriding inherited ones with same name)
    for (const member of currentMembers) {
        memberMap.set(member.name, member);
    }

    return Array.from(memberMap.values());
}


/**
 * Gets all public methods from a class including inherited methods from base classes.
 * 
 * @param classNode The class AST node to analyze
 * @param findClassFn Function to find a class definition by name
 * @returns Array of public function declaration nodes including inherited ones
 */
export function getPublicMethodsWithInheritance(
    classNode: ClassDeclNode,
    findClassFn: (className: string) => ClassDeclNode | null
): MethodDeclNode[] {
    const allPublicMembers = getPublicMembersWithInheritance(classNode, findClassFn);
    return allPublicMembers
        .filter(member => isMethod(member))
        .map(member => member as MethodDeclNode);
}

/**
 * Finds a specific member by name in a class and its inheritance chain.
 * Returns the first matching member found (searching current class first, then base classes).
 * 
 * @param classNode The class AST node to search in
 * @param memberName The name of the member to find
 * @param findClassFn Function to find a class definition by name
 * @param includePrivate Whether to include private members (default: false)
 * @param visitedClasses Set to track visited classes to prevent infinite recursion
 * @returns The found member declaration or null if not found
 */
export function findMemberInClassWithInheritance(
    classNode: ClassDeclNode,
    memberName: string,
    findClassFn: (className: string) => ClassDeclNode | null,
    includePrivate: boolean = false,
    visitedClasses: Set<string> = new Set()
): Declaration | null {
    // Prevent infinite recursion
    if (visitedClasses.has(classNode.name)) {
        return null;
    }
    visitedClasses.add(classNode.name);

    // First, search in current class
    for (const member of classNode.members) {
        if (member.name === memberName) {
            // Check if private and if we should include it
            const isPrivate = isPrivateDeclaration(member);
            if (!isPrivate || includePrivate) {
                return member;
            }
        }
    }

    // Not found in current class, search base class
    if (classNode.baseClass) {
        const baseClassName = extractTypeName(classNode.baseClass);
        if (baseClassName) {
            const baseClass = findClassFn(baseClassName);
            if (baseClass) {
                // Don't include private members from base classes
                return findMemberInClassWithInheritance(baseClass, memberName, findClassFn, false, visitedClasses);
            }
        }
    }

    return null;
}

/**
 * Merges multiple class definitions (e.g., original + modded classes) into a single virtual class
 * with all members combined. Members from later classes override members with the same name
 * from earlier classes.
 * 
 * @param classDefinitions Array of class definitions to merge (order matters: later overrides earlier)
 * @returns Virtual merged class node, or null if no definitions provided
 */
export function mergeClassDefinitions(classDefinitions: ClassDeclNode[]): ClassDeclNode | null {
    if (classDefinitions.length === 0) {
        return null;
    }

    if (classDefinitions.length === 1) {
        return classDefinitions[0];
    }

    Logger.info(`🔄 Merging ${classDefinitions.length} class definitions for ${classDefinitions[0].name}`);

    // Find the best base class to use for the merged result
    // Prefer: 1) non-modded class, 2) class with baseClass defined, 3) first class
    const baseClass = classDefinitions.find(c => !c.modifiers.includes('modded'))
        || classDefinitions.find(c => c.baseClass != null)
        || classDefinitions[0];

    const mergedMembers = new Map<string, Declaration>();

    // Add all members from all class definitions
    // Later definitions override earlier ones with the same name
    for (const classDef of classDefinitions) {
        Logger.debug(`  📝 Adding ${classDef.members?.length || 0} members from ${classDef.modifiers.includes('modded') ? 'modded' : 'original'} class`);

        if (classDef.members) {
            for (const member of classDef.members) {
                if (member.name) {
                    mergedMembers.set(member.name, member);
                }
            }
        }
    }

    Logger.info(`  ✅ Merged into ${mergedMembers.size} unique members`);

    // Create a virtual merged class
    const mergedClass: ClassDeclNode = {
        ...baseClass,
        members: Array.from(mergedMembers.values())
    };

    return mergedClass;
}
