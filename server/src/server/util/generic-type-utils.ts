/**
 * Generic Type Utilities
 */

import { Declaration, ClassDeclNode, MethodDeclNode, GenericTypeNode, ArrayTypeNode, TypeNode } from '../ast/node-types';
import { Logger } from '../../util/logger';
import { isMethod, isTypeReference, isVarDecl } from './ast-class-utils';
import { parseGenericArguments } from './type-utils';

/**
 * Apply generic type substitution to member declarations
 * e.g., for "array<PlayerBase>", substitute all occurrences of "T" with "PlayerBase"
 * e.g., for "map<string, int>", substitute K->string, V->int
 * e.g., for "Container<array<PlayerBase>>", substitute T->array<PlayerBase> recursively
 */
export function applyGenericSubstitution(members: Declaration[], fullType: string, classDecl: ClassDeclNode): Declaration[] {
    // Parse generic arguments from fullType
    // e.g., "array<PlayerBase>" -> { baseType: "array", typeArguments: ["PlayerBase"] }
    const genericStart = fullType.indexOf('<');
    if (genericStart < 0) {
        // No generic arguments, return as is
        return members;
    }
    
    // Extract generic arguments with proper nested bracket handling
    const genericPart = fullType.substring(genericStart + 1, fullType.lastIndexOf('>'));
    const typeArguments = parseGenericArguments(genericPart);
    
    // Get generic parameter names from class declaration
    const genericParams = classDecl.genericParameters || [];
    if (genericParams.length === 0 || typeArguments.length === 0) {
        return members;
    }
    
    // Create substitution map (e.g., T -> PlayerBase, or K -> string, V -> int)
    const substitutionMap = new Map<string, string>();
    for (let i = 0; i < Math.min(genericParams.length, typeArguments.length); i++) {
        substitutionMap.set(genericParams[i].name, typeArguments[i]);
    }
    
    Logger.debug(`🔄 Applying generic substitution: ${Array.from(substitutionMap.entries()).map(([k, v]) => `${k}->${v}`).join(', ')}`);
    
    // Substitute types in member declarations (recursively handles nested generics)
    return members.map(member => substituteTypeInDeclaration(member, substitutionMap));
}

/**
 * Recursively substitute generic type parameters in a declaration
 * Handles nested generics like Container<array<T>> where T needs to be substituted
 */
export function substituteTypeInDeclaration(member: Declaration, substitutionMap: Map<string, string>): Declaration {
    // Handle method return types and parameters (not FunctionDecl - those are global only)
    if (isMethod(member) || member.kind === 'ProtoMethodDecl') {
        const funcMember = member as MethodDeclNode;
        
        // Substitute return type
        const newReturnType = funcMember.returnType 
            ? substituteTypeNode(funcMember.returnType, substitutionMap)
            : funcMember.returnType;
        
        // Substitute parameter types
        const newParameters = funcMember.parameters?.map(param => ({
            ...param,
            type: param.type ? substituteTypeNode(param.type, substitutionMap) : param.type
        }));
        
        // Only create new object if something changed
        if (newReturnType !== funcMember.returnType || newParameters !== funcMember.parameters) {
            return {
                ...funcMember,
                returnType: newReturnType,
                parameters: newParameters
            } as unknown as Declaration;
        }
    }
    
    // Handle variable types
    if (isVarDecl(member)) {
        const newType = member.type 
            ? substituteTypeNode(member.type, substitutionMap)
            : member.type;
        
        if (newType !== member.type) {
            return {
                ...member,
                type: newType
            } as unknown as Declaration;
        }
    }
    
    return member;
}

/**
 * Recursively substitute generic type parameters in a TypeNode
 * Handles TypeReference, GenericType, RefType, etc.
 */
export function substituteTypeNode(typeNode: TypeNode, substitutionMap: Map<string, string>): TypeNode {
    // Handle TypeReference - this is where substitution happens
    if (isTypeReference(typeNode) && 'name' in typeNode) {
        const typeName = typeNode.name as string;
        if (substitutionMap.has(typeName)) {
            // Parse the substituted type string back into a type structure
            const substitutedTypeStr = substitutionMap.get(typeName)!;
            return parseTypeString(substitutedTypeStr);
        }
        return typeNode;
    }
    
    // Handle GenericType - recursively substitute type arguments
    if (typeNode.kind === 'GenericType' && 'baseType' in typeNode && 'typeArguments' in typeNode) {
        const genericNode = typeNode as GenericTypeNode;
        const newBaseType = substituteTypeNode(genericNode.baseType, substitutionMap);
        const newTypeArgs = genericNode.typeArguments.map(arg => substituteTypeNode(arg, substitutionMap));
        
        // Only create new object if something changed
        if (newBaseType !== genericNode.baseType || 
            newTypeArgs.some((arg, i) => arg !== genericNode.typeArguments[i])) {
            return {
                ...genericNode,
                baseType: newBaseType,
                typeArguments: newTypeArgs
            };
        }
        return typeNode;
    }
    
    // Note: RefType no longer exists - ref is now a modifier on TypeReference
    // TypeReference substitution above already handles this case
    
    // Handle ArrayType - recursively substitute element type
    if (typeNode.kind === 'ArrayType' && 'elementType' in typeNode) {
        const arrayNode = typeNode as ArrayTypeNode;
        const newElementType = substituteTypeNode(arrayNode.elementType, substitutionMap);
        
        if (newElementType !== arrayNode.elementType) {
            return {
                ...arrayNode,
                elementType: newElementType
            } as ArrayTypeNode;
        }
        return typeNode;
    }
    
    // For other types (AutoType, etc.), return as is
    return typeNode;
}

/**
 * Parse a type string into a TypeNode structure
 * Handles simple types, generic types, and nested generics
 * e.g., "PlayerBase" -> TypeReference
 * e.g., "array<int>" -> GenericType with TypeReference base and TypeReference arg
 */
export function parseTypeString(typeStr: string): TypeNode {
    const trimmed = typeStr.trim();
    
    // Check if it's a generic type
    const genericStart = trimmed.indexOf('<');
    if (genericStart > 0) {
        const baseName = trimmed.substring(0, genericStart).trim();
        const genericPart = trimmed.substring(genericStart + 1, trimmed.lastIndexOf('>'));
        const typeArgStrs = parseGenericArguments(genericPart);
        
        // Recursively parse type arguments
        const typeArgs = typeArgStrs.map(argStr => parseTypeString(argStr));
        
        return {
            kind: 'GenericType',
            baseType: { kind: 'TypeReference', name: baseName },
            typeArguments: typeArgs
        } as GenericTypeNode
    }
    
    // Handle ref types - store as modifier on TypeReference
    if (trimmed.startsWith('ref ')) {
        const innerType = trimmed.substring(4).trim();
        
        // If the inner type is also complex, parse it recursively
        if (innerType.includes('<')) {
            const innerNode = parseTypeString(innerType);
            
            // Add 'ref' as a modifier to the inner type
            if (isTypeReference(innerNode)) {
                return {
                    ...innerNode,
                    modifiers: ['ref', ...(innerNode.modifiers || [])]
                } as TypeNode;
            }
            
            // For other types (GenericType, ArrayType), we can't add modifiers directly
            // Wrap in a TypeReference with the stringified type name
            return {
                kind: 'TypeReference',
                name: innerType,
                modifiers: ['ref']
            } as TypeNode;
        }
        
        // Simple ref type
        return {
            kind: 'TypeReference',
            name: innerType,
            modifiers: ['ref']
        } as TypeNode;
    }
    
    // Simple type reference
    return {
        kind: 'TypeReference',
        name: trimmed
    } as TypeNode;
}