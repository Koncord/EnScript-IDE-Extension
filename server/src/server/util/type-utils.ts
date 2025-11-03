/**
 * Type Utility Functions
 * 
 * Shared utilities for parsing and manipulating EnScript type strings.
 */

import { Logger } from '../../util/logger';

/**
 * Type modifiers that can appear before a type name
 */
const TYPE_MODIFIERS = ['ref', 'const', 'static'] as const;

/**
 * Parsed generic type information
 */
export interface GenericTypeInfo {
    /** Base type name without generic arguments (e.g., "array" from "array<T>") */
    baseType: string;
    /** Generic type arguments (e.g., ["PlayerBase"] from "array<PlayerBase>") */
    typeArguments: string[];
}

/**
 * Extract base class name from a type string, removing modifiers
 * 
 * @example
 * extractBaseClassName("ref PlayerBase") // => "PlayerBase"
 * extractBaseClassName("ref const array<int>") // => "array<int>"
 * extractBaseClassName("PlayerBase") // => "PlayerBase"
 */
export function extractBaseClassName(typeName: string): string {
    let remaining = typeName.trim();

    // Keep stripping modifiers until we find the base type
    let foundModifier = true;
    while (foundModifier) {
        foundModifier = false;

        for (const modifier of TYPE_MODIFIERS) {
            // Check if the type starts with this modifier followed by a space
            if (remaining.startsWith(modifier + ' ')) {
                remaining = remaining.substring(modifier.length).trim();
                foundModifier = true;
                break;
            }
        }
    }

    return remaining;
}

/**
 * Extract base class name without generic arguments
 * 
 * @example
 * extractBaseClassNameWithoutGenerics("array<PlayerBase>") // => "array"
 * extractBaseClassNameWithoutGenerics("map<string, int>") // => "map"
 * extractBaseClassNameWithoutGenerics("PlayerBase") // => "PlayerBase"
 */
export function extractBaseClassNameWithoutGenerics(typeName: string): string {
    const trimmed = typeName.trim();

    // Find the opening bracket of generic arguments
    for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i] === '<') {
            // Check if this might be a comparison operator
            if (i > 0 && /[a-zA-Z0-9_]/.test(trimmed[i - 1])) {
                // This is likely a generic type, not a comparison
                return trimmed.substring(0, i).trim();
            }
        }
    }

    // No generic arguments found
    return trimmed;
}

/**
 * Parse a generic type string into base type and type arguments
 * 
 * @example
 * parseGenericType("array<PlayerBase>") 
 * // => { baseType: "array", typeArguments: ["PlayerBase"] }
 * 
 * parseGenericType("map<string, int>") 
 * // => { baseType: "map", typeArguments: ["string", "int"] }
 * 
 * parseGenericType("Container<array<int>>") 
 * // => { baseType: "Container", typeArguments: ["array<int>"] }
 */
export function parseGenericType(typeName: string): GenericTypeInfo {
    const trimmed = typeName.trim();
    const genericStart = trimmed.indexOf('<');

    if (genericStart < 0) {
        // No generic arguments, but still strip modifiers
        return {
            baseType: stripTypeModifiers(trimmed),
            typeArguments: []
        };
    }

    let baseType = trimmed.substring(0, genericStart).trim();
    // Strip modifiers like 'ref', 'const', etc. from the base type
    baseType = stripTypeModifiers(baseType);
    const genericEnd = trimmed.lastIndexOf('>');

    if (genericEnd < 0) {
        // Malformed generic type
        Logger.warn(`Malformed generic type: ${typeName}`);
        return {
            baseType: trimmed,
            typeArguments: []
        };
    }

    const genericPart = trimmed.substring(genericStart + 1, genericEnd);
    const typeArguments = parseGenericArguments(genericPart);

    return { baseType, typeArguments };
}

/**
 * Parse generic type arguments, handling nested generics and commas
 * 
 * @example
 * parseGenericArguments("PlayerBase") // => ["PlayerBase"]
 * parseGenericArguments("string, int") // => ["string", "int"]
 * parseGenericArguments("array<string>, int") // => ["array<string>", "int"]
 * parseGenericArguments("map<string, int>, PlayerBase") // => ["map<string, int>", "PlayerBase"]
 */
export function parseGenericArguments(genericPart: string): string[] {
    const args: string[] = [];
    let current = '';
    let depth = 0;

    for (let i = 0; i < genericPart.length; i++) {
        const char = genericPart[i];

        if (char === '<') {
            depth++;
            current += char;
        } else if (char === '>') {
            depth--;
            current += char;
        } else if (char === ',' && depth === 0) {
            // Top-level comma - this separates arguments
            if (current.trim()) {
                args.push(current.trim());
            }
            current = '';
        } else {
            current += char;
        }
    }

    // Don't forget the last argument
    if (current.trim()) {
        args.push(current.trim());
    }

    return args;
}

/**
 * Strip type modifiers (ref, const, out) from a type name
 * @example
 * stripTypeModifiers("ref Param2") // => "Param2"
 * stripTypeModifiers("const string") // => "string"
 * stripTypeModifiers("out int") // => "int"
 * stripTypeModifiers("PlayerBase") // => "PlayerBase"
 */
export function stripTypeModifiers(typeName: string): string {
    const trimmed = typeName.trim();
    const modifiers = ['ref', 'const', 'out', 'inout'];

    let result = trimmed;
    for (const modifier of modifiers) {
        const prefix = modifier + ' ';
        if (result.startsWith(prefix)) {
            result = result.substring(prefix.length).trim();
            break; // Only strip one modifier at a time to avoid issues with nested refs
        }
    }

    return result;
}

export function isPrimitiveBuiltInType(typeName: string): boolean {
    const primitiveTypes = ['int', 'float', 'bool', 'string', 'void', 'vector'];
    return primitiveTypes.includes(typeName);
}

/**
 * Check if a type name is a built-in type
 */
export function isBuiltInType(typeName: string): boolean {
    const builtInTypes = [
        // Built-in generic types
        'array', 'map', 'set'
    ];
    return builtInTypes.includes(typeName) || isPrimitiveBuiltInType(typeName);
}

/**
 * Check if a type name represents a primitive type
 * Primitive types: int, float, string, bool, void, vector
 * 
 * @example
 * isPrimitiveType("int") // => true
 * isPrimitiveType("ref int") // => true
 * isPrimitiveType("const string") // => true
 * isPrimitiveType("PlayerBase") // => false
 * isPrimitiveType("array<int>") // => false
 */
export function isPrimitiveType(typeName: string): boolean {
    // Extract base type name without modifiers and generics
    const baseType = extractBaseClassName(typeName);
    const withoutGenerics = extractBaseClassNameWithoutGenerics(baseType);

    return isPrimitiveBuiltInType(withoutGenerics);
}

/**
 * Normalize a type name by removing extra whitespace around generic brackets
 * 
 * @example
 * normalizeTypeName("array < int >") // => "array<int>"
 * normalizeTypeName("map<string , int>") // => "map<string,int>"
 * normalizeTypeName("ref PlayerBase") // => "PlayerBase"
 */
export function normalizeTypeName(typeName: string): string {
    let normalized = extractBaseClassName(typeName);
    normalized = normalized.replace(/\s*<\s*/g, '<');
    normalized = normalized.replace(/\s*>\s*/g, '>');
    normalized = normalized.replace(/\s*,\s*/g, ',');

    return normalized.trim();
}

/**
 * Check if a type name represents a generic type parameter
 * Generic parameters typically:
 * - Start with 'T' followed by uppercase (TValue, TKey, TData)
 * - Are single uppercase letters (T, K, V)
 * - Start with 'Class' (legacy EnScript syntax)
 * 
 * @example
 * isGenericTypeParameter("T") // => true
 * isGenericTypeParameter("TValue") // => true
 * isGenericTypeParameter("Class T") // => true
 * isGenericTypeParameter("PlayerBase") // => false
 */
export function isGenericTypeParameter(typeName: string): boolean {
    // Remove any 'Class' prefix (EnScript generic syntax)
    const cleanType = typeName.replace(/^Class\s+/, '').trim();

    // Single uppercase letter (T, K, V, etc.)
    if (/^[A-Z]$/.test(cleanType)) {
        return true;
    }

    // Starts with T followed by uppercase (TValue, TKey, TData, etc.)
    if (/^T[A-Z][a-zA-Z]*$/.test(cleanType)) {
        return true;
    }

    return false;
}

/**
 * Check if two numeric types are compatible (considering implicit conversions)
 * In EnScript, int can be implicitly converted to float
 * 
 * @example
 * areNumericTypesCompatible("float", "int") // => true (int -> float)
 * areNumericTypesCompatible("int", "float") // => false (requires explicit cast)
 * areNumericTypesCompatible("int", "int") // => false (use direct equality check)
 */
export function areNumericTypesCompatible(targetType: string, sourceType: string): boolean {
    const numericTypes = ['int', 'float'];

    if (!numericTypes.includes(targetType) || !numericTypes.includes(sourceType)) {
        return false;
    }

    // int can be implicitly converted to float
    if (targetType === 'float' && sourceType === 'int') {
        return true;
    }

    return false;
}
