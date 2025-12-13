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
    Literal
} from '../../ast';
import {
    isAssignmentExpression,
    isVarDecl,
    isBinaryExpression,
    isCallExpression,
    isReturnStatement,
    isIdentifier,
    isMemberExpression,
    isLiteral
} from '../../util/ast-class-utils';
import {
    AssignmentExpression,
    BinaryExpression,
    ReturnStatement,
    FunctionDeclNode,
    MethodDeclNode
} from '../../ast/node-types';
import { Logger } from '../../../util/logger';
import {
    extractTypeName,
    findContainingClass,
    findContainingFunctionOrMethod,
    isClassDerivedFrom,
    findFunctionInFile,
    findAllMethodsInClass,
    resolveMethodsFromMemberExpression
} from '../../util/symbol-resolution-utils';
import {
    parseGenericType,
    isPrimitiveType,
    isPrimitiveBuiltInType,
    normalizeTypeName,
    isGenericTypeParameter,
    areNumericTypesCompatible
} from '../../util/type-utils';

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

            // Check for special implicit conversions
            const conversionResult = this.checkImplicitConversion(targetType, valueType, node.right);
            if (conversionResult) {
                results.push(conversionResult);
                return results;
            }

            if (!this.isTypeCompatible(targetType, valueType, context, node.right)) {
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

            // Check for special implicit conversions
            const conversionResult = this.checkImplicitConversion(declaredType, initializerType, node.initializer);
            if (conversionResult) {
                results.push(conversionResult);
                return results;
            }

            if (!this.isTypeCompatible(declaredType, initializerType, context, node.initializer)) {
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
            const containingFunction = findContainingFunctionOrMethod(node);
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

            // Check for special implicit conversions
            const conversionResult = this.checkImplicitConversion(declaredReturnType, returnedType, node.argument);
            if (conversionResult) {
                results.push(conversionResult);
                return results;
            }

            if (!this.isTypeCompatible(declaredReturnType, returnedType, context, node.argument)) {
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
        node: CallExpression,
        context: DiagnosticRuleContext
    ): Promise<DiagnosticRuleResult[]> {
        const results: DiagnosticRuleResult[] = [];

        try {
            // Get the function/method declaration(s) - may have overloads
            const functionDecls = await this.resolveFunctionDeclarations(node, context);
            if (functionDecls.length === 0) {
                return results;
            }

            // Pick the best matching overload based on argument types
            const functionDecl = this.pickBestOverload(functionDecls, node.arguments, context);
            if (!functionDecl || !functionDecl.parameters) {
                return results;
            }

            const parameters = functionDecl.parameters;
            const args = node.arguments;

            // Check each argument against its corresponding parameter
            const minLength = Math.min(parameters.length, args.length);
            for (let i = 0; i < minLength; i++) {
                const param = parameters[i];
                const arg = args[i];

                const paramType = extractTypeName(param.type);
                if (!paramType || paramType === 'auto') {
                    continue;
                }

                // Special case: void and typename parameters are treated as 'any' - accept any argument type
                // void: used in functions like Write(void value_out) which accepts any type
                // typename: used for type-agnostic parameters that can accept any type
                if (paramType === 'void' || paramType === 'typename') {
                    continue;
                }

                const argType = this.resolveExpressionType(arg, context);
                if (!argType) {
                    continue;
                }

                // Special case: null can be assigned to 'out' parameters
                // out parameters are used for output values and can accept null
                // Example: RayCastBullet(..., out Object hitObject, out vector hitPosition, ...)
                if (argType === 'null' && param.modifiers && param.modifiers.includes('out')) {
                    continue;
                }

                // Check for special implicit conversions
                const conversionResult = this.checkImplicitConversion(paramType, argType, arg);
                if (conversionResult) {
                    results.push(conversionResult);
                    continue;
                }

                // Check type compatibility
                if (!this.isTypeCompatible(paramType, argType, context, arg)) {
                    results.push(
                        this.createTypeMismatchDiagnostic(
                            `Argument of type '${argType}' is not assignable to parameter of type '${paramType}'`,
                            arg,
                            DiagnosticSeverity.Error
                        )
                    );
                }
            }

            // Check if too many arguments provided (only if no variadic parameters)
            // Note: EnScript may support variadic parameters, but we don't check for that here
            // This is a simple check that can be enhanced later

        } catch (error) {
            Logger.error(`TypeMismatchRule: Error checking function call: ${error}`);
        }

        return results;
    }

    /**
     * Check for implicit conversions that should generate warnings
     * @returns DiagnosticRuleResult if a warning should be generated, null otherwise
     */
    /**
     * Check if an expression is a string literal that looks like a vector ("x y z")
     * DayZ/EnScript implicitly converts strings like "1 2 3" to vectors
     */
    private isVectorLikeStringLiteral(expr: Expression): boolean {
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

    private checkImplicitConversion(
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
     * Resolve all function or method declarations for a call expression (handles overloading)
     */
    private async resolveFunctionDeclarations(
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
            Logger.debug(`TypeMismatchRule: Error resolving function declarations: ${error}`);
        }

        return results;
    }

    /**
     * Resolve the function or method declaration for a call expression
     * @deprecated Use resolveFunctionDeclarations for overload support
     */
    private async resolveFunctionDeclaration(
        node: CallExpression,
        context: DiagnosticRuleContext
    ): Promise<FunctionDeclNode | MethodDeclNode | null> {
        const decls = await this.resolveFunctionDeclarations(node, context);
        return decls.length > 0 ? decls[0] : null;
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

                // Vector-string operations: vector +- string (where string is vector-like "x y z")
                if ((operator === '+' || operator === '-')) {
                    if (leftType === 'vector' && rightType === 'string' && this.isVectorLikeStringLiteral(node.right)) {
                        return results;
                    }
                    if (leftType === 'string' && rightType === 'vector' && this.isVectorLikeStringLiteral(node.left)) {
                        return results;
                    }
                }

                // vector * scalar, scalar * vector (scaling)
                // Scalars can be numeric types (int, float) or enums (implicitly cast to int)
                if (operator === '*') {
                    const leftIsNumericOrEnum = this.isNumericType(leftType) || this.isIntegerOrEnumType(leftType, context);
                    const rightIsNumericOrEnum = this.isNumericType(rightType) || this.isIntegerOrEnumType(rightType, context);

                    if ((leftType === 'vector' && rightIsNumericOrEnum) ||
                        (leftIsNumericOrEnum && rightType === 'vector')) {
                        return results;
                    }
                    
                    // Vector-string multiplication: vector * "x y z"
                    if (leftType === 'vector' && rightType === 'string' && this.isVectorLikeStringLiteral(node.right)) {
                        return results;
                    }
                    if (leftType === 'string' && rightType === 'vector' && this.isVectorLikeStringLiteral(node.left)) {
                        return results;
                    }
                }

                // vector / scalar (scaling)
                // Scalars can be numeric types (int, float) or enums (implicitly cast to int)
                if (operator === '/') {
                    if (leftType === 'vector') {
                        const rightIsNumericOrEnum = this.isNumericType(rightType) || this.isIntegerOrEnumType(rightType, context);
                        if (rightIsNumericOrEnum) {
                            return results;
                        }
                        // Vector-string division: vector / "x y z"
                        if (rightType === 'string' && this.isVectorLikeStringLiteral(node.right)) {
                            return results;
                        }
                    }
                }

                // Numeric operations require numeric types or enums (if not vector operations)
                // Enums are allowed as they can be implicitly cast to integers
                const isValidLeftType = this.isNumericType(leftType) || this.isIntegerOrEnumType(leftType, context) || leftType === 'vector';
                const isValidRightType = this.isNumericType(rightType) || this.isIntegerOrEnumType(rightType, context) || rightType === 'vector';

                if (!isValidLeftType) {
                    results.push(this.createTypeMismatchDiagnostic(
                        `Operator '${operator}' cannot be applied to type '${leftType}'`,
                        node.left,
                        DiagnosticSeverity.Error
                    ));
                }
                if (!isValidRightType) {
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

    /**
     * Pick the best matching overload based on argument types
     * Returns the first overload where all arguments match their parameter types
     */
    private pickBestOverload(
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
