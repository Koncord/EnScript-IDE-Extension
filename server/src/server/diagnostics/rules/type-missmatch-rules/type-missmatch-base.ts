import { DiagnosticSeverity } from 'vscode-languageserver';
import { ASTNode, Expression, Literal, CallExpression, FunctionDeclNode, MethodDeclNode } from '../../../ast';
import { BaseDiagnosticRule, DiagnosticCategory, DiagnosticRuleContext, DiagnosticRuleResult } from '../../rules';
import { Logger } from '../../../../util/logger';
import {
    extractTypeName,
    isClassDerivedFrom,
    findFunctionInFile,
    findAllMethodsInClass,
    resolveMethodsFromMemberExpression,
    findContainingClass
} from '../../../util/symbol-resolution-utils';
import {
    parseGenericType,
    isPrimitiveBuiltInType,
    normalizeTypeName,
    isGenericTypeParameter,
    areNumericTypesCompatible
} from '../../../util/type-utils';
import { isIdentifier, isMemberExpression, isLiteral } from '../../../util/ast-class-utils';

/**
 * Shared helper methods for type checking across multiple diagnostic rules
 */
export abstract class TypeMissmatchBase extends BaseDiagnosticRule {
    id = 'type-mismatch';
    name = 'Type Mismatch';
    description = 'Detects type mismatches in assignments, returns, and function calls';
    category = DiagnosticCategory.TYPE;
    defaultSeverity: DiagnosticSeverity = DiagnosticSeverity.Error;

    /**
     * Check if two types are compatible (can be assigned)
     */
    protected isTypeCompatible(
        targetType: string | null,
        sourceType: string | null,
        context: DiagnosticRuleContext,
        sourceExpr?: Expression
    ): boolean {
        if (!targetType || !sourceType) {
            return true;
        }

        let normalizedTarget = normalizeTypeName(targetType);
        let normalizedSource = normalizeTypeName(sourceType);

        // Resolve typedefs to their underlying types
        if (context.typeResolver) {
            const resolvedTarget = context.typeResolver.resolveTypedefToFullType(normalizedTarget);
            if (resolvedTarget) {
                normalizedTarget = resolvedTarget;
            }
            const resolvedSource = context.typeResolver.resolveTypedefToFullType(normalizedSource);
            if (resolvedSource) {
                normalizedSource = resolvedSource;
            }
        }

        if (normalizedTarget === normalizedSource) {
            return true;
        }

        // Special case: func types are compatible with methods and functions
        if (normalizedTarget === 'func') {
            return true;
        }

        if (normalizedTarget === 'auto' || normalizedSource === 'auto') {
            return true;
        }

        if (normalizedTarget === 'void' || normalizedSource === 'void') {
            return normalizedTarget === normalizedSource;
        }

        // Special case: vector can accept vector-like string literals (parsed as "x y z")
        // Only allow if the source is actually a vector-like string literal
        if (normalizedTarget === 'vector' && normalizedSource === 'string') {
            if (sourceExpr && this.isVectorLikeStringLiteral(sourceExpr)) {
                return true;
            }
            return false;
        }

        // Special case: enums can accept int (for bitwise operations and direct assignment)
        if (normalizedSource === 'int') {
            if (context.typeResolver) {
                const enumDefs = context.typeResolver.findAllEnumDefinitions(normalizedTarget);
                if (enumDefs.length > 0) {
                    return true;
                }
            }
        }

        // Special case: int can be assigned to enums
        if (normalizedTarget === 'int') {
            if (context.typeResolver) {
                const enumDefs = context.typeResolver.findAllEnumDefinitions(normalizedSource);
                if (enumDefs.length > 0) {
                    return true;
                }
            }
        }

        if (normalizedSource === 'null') {
            const targetBase = parseGenericType(normalizedTarget).baseType;
            // null can be assigned to reference types (classes, arrays, etc.)
            // but not to value types (int, float, bool, string, vector, void)
            return !isPrimitiveBuiltInType(targetBase);
        }

        // Check if either type is a generic type parameter (e.g., T, TValue, TKey)
        // Generic type parameters should be considered compatible with any type
        // as they will be resolved at instantiation time
        if (isGenericTypeParameter(normalizedTarget) || isGenericTypeParameter(normalizedSource)) {
            return true;
        }

        const targetBase = parseGenericType(normalizedTarget).baseType;
        const sourceBase = parseGenericType(normalizedSource).baseType;
        if (areNumericTypesCompatible(targetBase, sourceBase)) {
            return true;
        }

        if (isClassDerivedFrom(sourceBase, targetBase, context)) {
            return true;
        }

        if (this.areGenericTypesCompatible(normalizedTarget, normalizedSource, context)) {
            return true;
        }

        return false;
    }

    /**
     * Check for implicit conversions that should generate warnings
     * @returns DiagnosticRuleResult if a warning should be generated, null otherwise
     */
    protected checkImplicitConversion(
        targetType: string,
        sourceType: string,
        node: ASTNode
    ): DiagnosticRuleResult | null {
        // int to bool conversion
        if (targetType === 'bool' && sourceType === 'int') {
            return this.createTypeMismatchDiagnostic(
                `Implicit conversion from '${sourceType}' to 'bool' may truncate value`,
                node,
                DiagnosticSeverity.Warning
            );
        }

        // bool to int conversion
        if (targetType === 'int' && sourceType === 'bool') {
            return this.createTypeMismatchDiagnostic(
                `Implicit conversion from '${sourceType}' to '${targetType}'`,
                node,
                DiagnosticSeverity.Warning
            );
        }

        // float to int conversion
        if (targetType === 'int' && sourceType === 'float') {
            return this.createTypeMismatchDiagnostic(
                `Implicit conversion from '${sourceType}' to '${targetType}' may lose precision`,
                node,
                DiagnosticSeverity.Warning
            );
        }

        return null;
    }

    /**
     * Check if an expression is a string literal that looks like a vector ("x y z")
     * DayZ/EnScript implicitly converts strings like "1 2 3" to vectors
     */
    protected isVectorLikeStringLiteral(expr: Expression): boolean {
        if (!isLiteral(expr)) {
            return false;
        }
        const literal = expr as Literal;
        if (literal.literalType !== 'string' || typeof literal.value !== 'string') {
            return false;
        }
        // Match pattern: "number number number" where numbers can be int or float, positive or negative
        // Examples: "1 2 3", "1.5 -2.3 0", "-10 5 3.14"
        const vectorPattern = /^\s*-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?\s*$/;
        return vectorPattern.test(literal.value);
    }

    /**
     * Resolve the type of an expression using the type resolver
     */
    protected resolveExpressionType(
        expr: Expression,
        context: DiagnosticRuleContext
    ): string | null {
        if (context.typeResolver) {
            try {
                const type = context.typeResolver.resolveExpressionType(
                    expr,
                    context.ast,
                    context.document
                );

                if (type && type !== 'unknown') {
                    return type;
                }
            } catch (error) {
                Logger.debug(`TypeCheckingHelpers: Error resolving expression type: ${error}`);
            }
        }

        return null;
    }

    /**
     * Resolve all function or method declarations for a call expression (handles overloading)
     */
    protected async resolveFunctionDeclarations(
        node: CallExpression,
        context: DiagnosticRuleContext
    ): Promise<(FunctionDeclNode | MethodDeclNode)[]> {
        const results: (FunctionDeclNode | MethodDeclNode)[] = [];

        try {
            // Handle direct function calls (callee is an Identifier)
            if (isIdentifier(node.callee)) {
                const funcName = node.callee.name;

                // Check if we're inside a class - might be a method call
                const containingClass = findContainingClass(node, context.ast);
                if (containingClass) {
                    // Look for all methods in the class (handles overloading)
                    const methods = findAllMethodsInClass(
                        containingClass,
                        funcName,
                        {
                            document: context.document,
                            typeResolver: context.typeResolver
                        }
                    );
                    results.push(...methods);
                    if (results.length > 0) {
                        return results;
                    }
                }

                // Check for global function in current file
                const fileFunc = findFunctionInFile(funcName, context.ast);
                if (fileFunc) {
                    results.push(fileFunc);
                }

                // Check for global function across workspace using typeResolver
                if (context.typeResolver) {
                    const globalFuncs = context.typeResolver.findAllGlobalFunctionDefinitions(funcName);
                    results.push(...globalFuncs);
                }

                return results;
            }

            // Handle method calls (callee is a MemberExpression)
            if (isMemberExpression(node.callee)) {
                const methods = await resolveMethodsFromMemberExpression(
                    node.callee,
                    context.ast,
                    {
                        document: context.document,
                        typeResolver: context.typeResolver
                    }
                );
                results.push(...methods);
            }

        } catch (error) {
            Logger.debug(`TypeCheckingHelpers: Error resolving function declarations: ${error}`);
        }

        return results;
    }

    /**
     * Pick the best matching overload based on argument types
     * Returns the first overload where all arguments match their parameter types
     */
    protected pickBestOverload(
        overloads: (FunctionDeclNode | MethodDeclNode)[],
        args: Expression[],
        context: DiagnosticRuleContext
    ): FunctionDeclNode | MethodDeclNode | null {
        if (overloads.length === 0) {
            return null;
        }

        if (overloads.length === 1) {
            return overloads[0];
        }

        // Try to find an overload where all parameters match
        for (const overload of overloads) {
            if (!overload.parameters) {
                continue;
            }

            // Check if parameter count matches (considering that all parameters might be optional in EnScript)
            if (args.length > overload.parameters.length) {
                continue; // Too many arguments
            }

            // Check if all argument types match the parameter types
            let allMatch = true;
            for (let i = 0; i < args.length; i++) {
                const param = overload.parameters[i];
                const arg = args[i];

                const paramType = extractTypeName(param.type);
                if (!paramType || paramType === 'auto' || paramType === 'void' || paramType === 'typename') {
                    continue; // These accept any type
                }

                const argType = this.resolveExpressionType(arg, context);
                if (!argType) {
                    continue; // Can't determine type, skip check
                }

                // Check if types are compatible
                if (!this.isTypeCompatible(paramType, argType, context, arg)) {
                    allMatch = false;
                    break;
                }
            }

            if (allMatch) {
                return overload;
            }
        }

        // If no perfect match, return the first overload
        return overloads[0];
    }

    /**
     * Check if a type is a numeric type (int or float)
     */
    protected isNumericType(type: string): boolean {
        return ['int', 'float'].includes(type);
    }

    /**
     * Check if a type is an integer type or an enum type
     * Enums are allowed in bitwise operations as they are backed by integers
     */
    protected isIntegerOrEnumType(type: string, context: DiagnosticRuleContext): boolean {
        // Check if it's a basic integer type
        if (type === 'int') {
            return true;
        }

        // Check if it's an enum type
        if (context.typeResolver) {
            const enumDefs = context.typeResolver.findAllEnumDefinitions(type);
            if (enumDefs.length > 0) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if a type node has a specific modifier (e.g., 'ref', 'owned')
     */
    protected hasTypeModifier(typeNode: ASTNode, modifier: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const typeNodeAny = typeNode as any;

        if ('modifiers' in typeNodeAny && Array.isArray(typeNodeAny.modifiers)) {
            return typeNodeAny.modifiers.includes(modifier);
        }

        return false;
    }

    /**
     * Create a diagnostic result for type mismatch
     */
    protected createTypeMismatchDiagnostic(
        message: string,
        node: ASTNode,
        severity: DiagnosticSeverity = DiagnosticSeverity.Error
    ): DiagnosticRuleResult {
        return {
            severity,
            message,
            range: {
                start: { line: node.start.line, character: node.start.character },
                end: { line: node.end.line, character: node.end.character }
            },
            code: this.id,
            source: 'enscript'
        };
    }

    /**
     * Check if generic types are compatible
     */
    protected areGenericTypesCompatible(
        targetType: string,
        sourceType: string,
        context: DiagnosticRuleContext
    ): boolean {
        // Parse generic type information
        const targetInfo = parseGenericType(targetType);
        const sourceInfo = parseGenericType(sourceType);

        // Base types must match
        if (targetInfo.baseType !== sourceInfo.baseType) {
            return false;
        }

        // If either has no type arguments, can't check further
        if (targetInfo.typeArguments.length === 0 || sourceInfo.typeArguments.length === 0) {
            return false;
        }

        // Type arguments must match in count
        if (targetInfo.typeArguments.length !== sourceInfo.typeArguments.length) {
            return false;
        }

        // For simplicity, check if each type argument is compatible
        // Note: Full covariance/contravariance would require more sophisticated analysis
        for (let i = 0; i < targetInfo.typeArguments.length; i++) {
            const targetArg = targetInfo.typeArguments[i];
            const sourceArg = sourceInfo.typeArguments[i];

            // Check if the type arguments are compatible
            if (!this.isTypeCompatible(targetArg, sourceArg, context)) {
                return false;
            }
        }

        return true;
    }
}
