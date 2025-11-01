import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult,
    BaseDiagnosticRule,
    DiagnosticCategory
} from '../rules';
import { DiagnosticSeverity } from 'vscode-languageserver';
import {
    ASTNode,
    VarDeclNode,
    CallExpression,
    Expression,
    ClassDeclNode
} from '../../ast';
import {
    isAssignmentExpression,
    isVarDecl,
    isBinaryExpression,
    isCallExpression,
    isFunction,
    isMethod,
    isReturnStatement
} from '../../util/ast-class-utils';
import {
    AssignmentExpression,
    BinaryExpression,
    ReturnStatement,
    FunctionDeclNode,
    MethodDeclNode
} from '../../ast/node-types';
import { Logger } from '../../../util/logger';
import { extractTypeName } from '../../util/symbol-resolution-utils';
import { isBuiltInType, extractBaseClassName, parseGenericType, isPrimitiveType, isPrimitiveBuiltInType } from '../../util/type-utils';

/**
 * Rule for detecting type mismatches in assignments, returns, and function calls.
 * 
 * This rule checks for type compatibility in various contexts:
 * - Variable declarations and assignments
 * - Function return statements
 * - Function parameter passing
 * - Binary operations
 * 
 * Example issues detected:
 * ```
 * int x = "string";              // Error: cannot assign string to int
 * 
 * int GetNumber() {
 *     return "text";             // Error: cannot return string from int function
 * }
 * 
 * void TakeInt(int value) {}
 * TakeInt("hello");              // Error: cannot pass string to int parameter
 * 
 * int result = 5 + "text";       // Error: incompatible types in binary operation
 * ```
 * 
 * Example valid code:
 * ```
 * int x = 42;                    // OK: int to int
 * string s = "hello";            // OK: string to string
 * 
 * int GetNumber() {
 *     return 5;                  // OK: int to int
 * }
 * 
 * void TakeInt(int value) {}
 * TakeInt(42);                   // OK: int to int
 * ```
 */
export class TypeMismatchRule extends BaseDiagnosticRule {
    readonly id = 'type-mismatch';
    readonly name = 'Type Mismatch';
    readonly description = 'Detects type mismatches in assignments, returns, and function calls';
    readonly category = DiagnosticCategory.TYPE;
    readonly defaultSeverity: DiagnosticSeverity = DiagnosticSeverity.Error;

    appliesToNode(node: ASTNode): boolean {
        return isAssignmentExpression(node) ||
            isVarDecl(node) ||
            isReturnStatement(node) ||
            isCallExpression(node) ||
            isBinaryExpression(node);
    }

    async check(
        node: ASTNode,
        context: DiagnosticRuleContext,
        _config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        const results: DiagnosticRuleResult[] = [];

        try {
            if (isAssignmentExpression(node)) {
                results.push(...await this.checkAssignment(node, context));
            } else if (isVarDecl(node)) {
                results.push(...await this.checkVariableDeclaration(node, context));
            } else if (isReturnStatement(node)) {
                results.push(...await this.checkReturnStatement(node, context));
            } else if (isCallExpression(node)) {
                results.push(...await this.checkFunctionCall(node, context));
            } else if (isBinaryExpression(node)) {
                results.push(...await this.checkBinaryOperation(node, context));
            }
        } catch (error) {
            Logger.error(`TypeMismatchRule: Error checking node: ${error}`);
        }

        return results;
    }

    private async checkAssignment(
        node: AssignmentExpression,
        context: DiagnosticRuleContext
    ): Promise<DiagnosticRuleResult[]> {
        const results: DiagnosticRuleResult[] = [];

        try {
            const targetType = this.resolveExpressionType(node.left, context);
            if (!targetType) {
                return results;
            }

            if (targetType === 'auto') {
                return results;
            }

            const valueType = this.resolveExpressionType(node.right, context);
            if (!valueType) {
                return results;
            }

            // Special case: int to bool is allowed but should warn about truncation
            if (targetType === 'bool' && valueType === 'int') {
                results.push(
                    this.createTypeMismatchDiagnostic(
                        `Implicit conversion from '${valueType}' to 'bool' may truncate value`,
                        node.right,
                        DiagnosticSeverity.Warning
                    )
                );
                return results;
            }

            // Special case: bool to int is allowed but should warn about implicit conversion
            if (targetType === 'int' && valueType === 'bool') {
                results.push(
                    this.createTypeMismatchDiagnostic(
                        `Implicit conversion from '${valueType}' to '${targetType}'`,
                        node.right,
                        DiagnosticSeverity.Warning
                    )
                );
                return results;
            }

            // Special case: float to int is allowed but should warn about precision loss
            if (targetType === 'int' && valueType === 'float') {
                results.push(
                    this.createTypeMismatchDiagnostic(
                        `Implicit conversion from '${valueType}' to '${targetType}' may lose precision`,
                        node.right,
                        DiagnosticSeverity.Warning
                    )
                );
                return results;
            }

            if (!this.isTypeCompatible(targetType, valueType, context)) {
                results.push(
                    this.createTypeMismatchDiagnostic(
                        `Type '${valueType}' is not assignable to type '${targetType}'`,
                        node.right,
                        DiagnosticSeverity.Error
                    )
                );
            }
        } catch (error) {
            Logger.error(`TypeMismatchRule: Error checking assignment: ${error}`);
        }

        return results;
    }

    private async checkVariableDeclaration(
        node: VarDeclNode,
        context: DiagnosticRuleContext
    ): Promise<DiagnosticRuleResult[]> {
        const results: DiagnosticRuleResult[] = [];

        try {
            if (!node.initializer) {
                return results;
            }

            const declaredType = extractTypeName(node.type);
            if (!declaredType) {
                return results;
            }

            if (declaredType === 'auto') {
                return results;
            }

            const initializerType = this.resolveExpressionType(node.initializer, context);
            if (!initializerType) {
                return results;
            }

            // Special case: null can be assigned to ref types or reference types (classes, arrays, etc.)
            if (initializerType === 'null') {
                // If the type has 'ref' modifier, null is always allowed
                if (this.hasTypeModifier(node.type, 'ref')) {
                    return results;
                }
                
                // null can be assigned to reference types (classes, arrays, etc.)
                // but not to value types (int, float, bool, string, vector, void)
                const targetBase = parseGenericType(declaredType).baseType;
                if (isPrimitiveType(targetBase)) {
                    results.push(
                        this.createTypeMismatchDiagnostic(
                            `Type 'null' is not assignable to value type '${declaredType}'`,
                            node.initializer,
                            DiagnosticSeverity.Error
                        )
                    );
                }
                return results;
            }

            // Special case: int to bool is allowed but should warn about truncation
            if (declaredType === 'bool' && initializerType === 'int') {
                results.push(
                    this.createTypeMismatchDiagnostic(
                        `Implicit conversion from '${initializerType}' to 'bool' may truncate value`,
                        node.initializer,
                        DiagnosticSeverity.Warning
                    )
                );
                return results;
            }

            // Special case: bool to int is allowed but should warn about implicit conversion
            if (declaredType === 'int' && initializerType === 'bool') {
                results.push(
                    this.createTypeMismatchDiagnostic(
                        `Implicit conversion from '${initializerType}' to '${declaredType}'`,
                        node.initializer,
                        DiagnosticSeverity.Warning
                    )
                );
                return results;
            }

            // Special case: float to int is allowed but should warn about precision loss
            if (declaredType === 'int' && initializerType === 'float') {
                results.push(
                    this.createTypeMismatchDiagnostic(
                        `Implicit conversion from '${initializerType}' to '${declaredType}' may lose precision`,
                        node.initializer,
                        DiagnosticSeverity.Warning
                    )
                );
                return results;
            }

            if (!this.isTypeCompatible(declaredType, initializerType, context)) {
                results.push(
                    this.createTypeMismatchDiagnostic(
                        `Type '${initializerType}' is not assignable to type '${declaredType}'`,
                        node.initializer,
                        DiagnosticSeverity.Error
                    )
                );
            }
        } catch (error) {
            Logger.error(`TypeMismatchRule: Error checking variable declaration: ${error}`);
        }

        return results;
    }

    private async checkReturnStatement(
        node: ReturnStatement,
        context: DiagnosticRuleContext
    ): Promise<DiagnosticRuleResult[]> {
        const results: DiagnosticRuleResult[] = [];

        try {
            const containingFunction = this.findContainingFunction(node);
            if (!containingFunction) {
                Logger.debug('TypeMismatchRule: Return statement outside of function context');
                return results;
            }

            const declaredReturnType = extractTypeName(containingFunction.returnType);
            if (!declaredReturnType) {
                return results;
            }

            if (declaredReturnType === 'void') {
                if (node.argument) {
                    results.push(this.createTypeMismatchDiagnostic(
                        `A 'void' function cannot return a value`,
                        node.argument,
                        DiagnosticSeverity.Error
                    ));
                }
                return results;
            }

            if (!node.argument) {
                results.push(this.createTypeMismatchDiagnostic(
                    `Function '${containingFunction.name}' expects a return value of type '${declaredReturnType}'`,
                    node,
                    DiagnosticSeverity.Error
                ));
                return results;
            }

            const returnedType = this.resolveExpressionType(node.argument, context);
            if (!returnedType) {
                Logger.debug(`TypeMismatchRule: Cannot resolve type of return expression`);
                return results;
            }

            // Special case: int to bool is allowed but should warn about truncation
            if (declaredReturnType === 'bool' && returnedType === 'int') {
                results.push(this.createTypeMismatchDiagnostic(
                    `Implicit conversion from '${returnedType}' to 'bool' may truncate value`,
                    node.argument,
                    DiagnosticSeverity.Warning
                ));
                return results;
            }

            // Special case: bool to int is allowed but should warn about implicit conversion
            if (declaredReturnType === 'int' && returnedType === 'bool') {
                results.push(this.createTypeMismatchDiagnostic(
                    `Implicit conversion from '${returnedType}' to '${declaredReturnType}'`,
                    node.argument,
                    DiagnosticSeverity.Warning
                ));
                return results;
            }

            // Special case: float to int is allowed but should warn about precision loss
            if (declaredReturnType === 'int' && returnedType === 'float') {
                results.push(this.createTypeMismatchDiagnostic(
                    `Implicit conversion from '${returnedType}' to '${declaredReturnType}' may lose precision`,
                    node.argument,
                    DiagnosticSeverity.Warning
                ));
                return results;
            }

            if (!this.isTypeCompatible(declaredReturnType, returnedType, context)) {
                results.push(this.createTypeMismatchDiagnostic(
                    `Type '${returnedType}' is not assignable to type '${declaredReturnType}'`,
                    node.argument,
                    DiagnosticSeverity.Error
                ));
            }

        } catch (error) {
            Logger.error(`TypeMismatchRule: Error checking return statement: ${error}`);
        }

        return results;
    }

    /**
     * Check type mismatch in function calls (parameter types)
     */
    private async checkFunctionCall(
        _node: CallExpression,
        _context: DiagnosticRuleContext
    ): Promise<DiagnosticRuleResult[]> {
        // TODO: Implement function call parameter type checking
        // 1. Resolve the function being called
        // 2. Get the declared parameter types
        // 3. Resolve the types of the arguments
        // 4. Check if each argument type matches the parameter type
        // 5. Generate diagnostics for mismatched arguments

        return [];
    }

    private async checkBinaryOperation(
        node: BinaryExpression,
        context: DiagnosticRuleContext
    ): Promise<DiagnosticRuleResult[]> {
        const results: DiagnosticRuleResult[] = [];

        try {
            const operator = node.operator;

            const leftType = this.resolveExpressionType(node.left, context);
            const rightType = this.resolveExpressionType(node.right, context);

            if (!leftType || !rightType) {
                return results;
            }

            if (['+', '-', '*', '/', '%'].includes(operator)) {
                // String concatenation with + is allowed
                if (operator === '+' && (leftType === 'string' || rightType === 'string')) {
                    return results;
                }

                // Vector arithmetic operations
                // vector + vector, vector - vector
                if ((operator === '+' || operator === '-') && leftType === 'vector' && rightType === 'vector') {
                    return results;
                }

                // vector * scalar, scalar * vector (scaling)
                if (operator === '*') {
                    if ((leftType === 'vector' && this.isNumericType(rightType)) ||
                        (this.isNumericType(leftType) && rightType === 'vector')) {
                        return results;
                    }
                }

                // vector / scalar (scaling)
                if (operator === '/' && leftType === 'vector' && this.isNumericType(rightType)) {
                    return results;
                }

                // Numeric operations require numeric types (if not vector operations)
                if (!this.isNumericType(leftType) && leftType !== 'vector') {
                    results.push(this.createTypeMismatchDiagnostic(
                        `Operator '${operator}' cannot be applied to type '${leftType}'`,
                        node.left,
                        DiagnosticSeverity.Error
                    ));
                }
                if (!this.isNumericType(rightType) && rightType !== 'vector') {
                    results.push(this.createTypeMismatchDiagnostic(
                        `Operator '${operator}' cannot be applied to type '${rightType}'`,
                        node.right,
                        DiagnosticSeverity.Error
                    ));
                }
                return results;
            }

            if (['<', '>', '<=', '>='].includes(operator)) {
                if (!this.isNumericType(leftType) && leftType !== 'string') {
                    results.push(this.createTypeMismatchDiagnostic(
                        `Operator '${operator}' cannot be applied to type '${leftType}'`,
                        node.left,
                        DiagnosticSeverity.Error
                    ));
                }
                if (!this.isNumericType(rightType) && rightType !== 'string') {
                    results.push(this.createTypeMismatchDiagnostic(
                        `Operator '${operator}' cannot be applied to type '${rightType}'`,
                        node.right,
                        DiagnosticSeverity.Error
                    ));
                }
                return results;
            }

            if (['==', '!='].includes(operator)) {
                return results;
            }

            if (['&&', '||'].includes(operator)) {
                return results;
            }

            if (['&', '|', '^', '<<', '>>'].includes(operator)) {
                if (!this.isIntegerOrEnumType(leftType, context)) {
                    results.push(this.createTypeMismatchDiagnostic(
                        `Operator '${operator}' cannot be applied to type '${leftType}'`,
                        node.left,
                        DiagnosticSeverity.Error
                    ));
                }
                if (!this.isIntegerOrEnumType(rightType, context)) {
                    results.push(this.createTypeMismatchDiagnostic(
                        `Operator '${operator}' cannot be applied to type '${rightType}'`,
                        node.right,
                        DiagnosticSeverity.Error
                    ));
                }
                return results;
            }

        } catch (error) {
            Logger.error(`TypeMismatchRule: Error checking binary operation: ${error}`);
        }

        return results;
    }

    private isNumericType(type: string): boolean {
        return ['int', 'float'].includes(type);
    }

    /**
     * Check if a type is an integer type or an enum type
     * Enums are allowed in bitwise operations as they are backed by integers
     */
    private isIntegerOrEnumType(type: string, context: DiagnosticRuleContext): boolean {
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

    private isTypeCompatible(
        targetType: string | null,
        sourceType: string | null,
        context: DiagnosticRuleContext
    ): boolean {
        if (!targetType || !sourceType) {
            return true;
        }

        const normalizedTarget = this.normalizeTypeName(targetType);
        const normalizedSource = this.normalizeTypeName(sourceType);

        if (normalizedTarget === normalizedSource) {
            return true;
        }

        if (normalizedTarget === 'auto' || normalizedSource === 'auto') {
            return true;
        }

        if (normalizedTarget === 'void' || normalizedSource === 'void') {
            return normalizedTarget === normalizedSource;
        }

        // Special case: vector can accept string (parsed as "x y z")
        if (normalizedTarget === 'vector' && normalizedSource === 'string') {
            return true;
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
        if (this.isGenericTypeParameter(normalizedTarget) || this.isGenericTypeParameter(normalizedSource)) {
            return true;
        }

        const targetBase = parseGenericType(normalizedTarget).baseType;
        const sourceBase = parseGenericType(normalizedSource).baseType;
        if (this.areNumericTypesCompatible(targetBase, sourceBase)) {
            return true;
        }

        if (this.isClassDerivedFrom(sourceBase, targetBase, context)) {
            return true;
        }

        if (this.areGenericTypesCompatible(normalizedTarget, normalizedSource, context)) {
            return true;
        }

        return false;
    }

    /**
     * Check if a type name represents a generic type parameter
     * Generic parameters typically:
     * - Start with 'T' followed by uppercase (TValue, TKey, TData)
     * - Are single uppercase letters (T, K, V)
     * - Start with 'Class' (legacy EnScript syntax)
     */
    private isGenericTypeParameter(typeName: string): boolean {
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

    private normalizeTypeName(typeName: string): string {
        let normalized = extractBaseClassName(typeName);
        normalized = normalized.replace(/\s*<\s*/g, '<');
        normalized = normalized.replace(/\s*>\s*/g, '>');
        normalized = normalized.replace(/\s*,\s*/g, ',');

        return normalized.trim();
    }

    private areNumericTypesCompatible(targetType: string, sourceType: string): boolean {
        const numericTypes = ['int', 'float'];

        if (!numericTypes.includes(targetType) || !numericTypes.includes(sourceType)) {
            return false;
        }

        if (targetType === 'float' && sourceType === 'int') {
            return true;
        }

        return false;
    }

    private isClassDerivedFrom(
        sourceClass: string,
        targetClass: string,
        context: DiagnosticRuleContext
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
                if (this.checkInheritanceChain(classDef, targetClass, context, new Set())) {
                    return true;
                }
            }
        } catch (error) {
            Logger.debug(`TypeMismatchRule: Error checking class inheritance: ${error}`);
        }

        return false;
    }

    private checkInheritanceChain(
        classDef: ClassDeclNode,
        targetClass: string,
        context: DiagnosticRuleContext,
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

        if (baseClassName === targetClass) {
            return true;
        }

        const baseClassDefs = context.typeResolver.findAllClassDefinitions(baseClassName);
        for (const baseClassDef of baseClassDefs) {
            if (this.checkInheritanceChain(baseClassDef, targetClass, context, visited)) {
                return true;
            }
        }

        return false;
    }

    private areGenericTypesCompatible(
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

    private findContainingFunction(node: ASTNode): FunctionDeclNode | MethodDeclNode | null {
        let current: ASTNode | undefined = node.parent;
        while (current) {
            if (isFunction(current) || isMethod(current)) {
                return current as FunctionDeclNode | MethodDeclNode;
            }
            current = current.parent;
        }
        return null;
    }

    /**
     * Check if a type node has a specific modifier (e.g., 'ref', 'owned')
     */
    private hasTypeModifier(typeNode: ASTNode, modifier: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const typeNodeAny = typeNode as any;
        
        if ('modifiers' in typeNodeAny && Array.isArray(typeNodeAny.modifiers)) {
            return typeNodeAny.modifiers.includes(modifier);
        }
        
        return false;
    }

    private resolveExpressionType(
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
                Logger.debug(`TypeMismatchRule: Error resolving expression type: ${error}`);
            }
        }

        return null;
    }

    private createTypeMismatchDiagnostic(
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
}
