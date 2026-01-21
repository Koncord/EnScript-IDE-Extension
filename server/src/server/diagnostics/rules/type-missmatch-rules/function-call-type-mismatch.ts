import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult,
    DiagnosticCategory
} from '../../rules';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { ASTNode, CallExpression } from '../../../ast';
import { isCallExpression } from '../../../util/ast-class-utils';
import { Logger } from '../../../../util/logger';
import { extractTypeName } from '../../../util/symbol-resolution-utils';
import { TypeMissmatchBase } from './type-missmatch-base';

/**
 * Rule for detecting type mismatches in function call arguments.
 * 
 * This rule checks for type compatibility when passing arguments to functions/methods.
 * 
 * Example issues detected:
 * ```
 * void TakeInt(int value) {}
 * TakeInt("hello");              // Error: cannot pass string to int parameter
 * 
 * void Process(MyClass obj) {}
 * Process(42);                   // Error: cannot pass int to MyClass parameter
 * ```
 * 
 * Example valid code:
 * ```
 * void TakeInt(int value) {}
 * TakeInt(42);                   // OK: int to int
 * 
 * void Process(MyClass obj) {}
 * Process(new MyClass());        // OK: MyClass to MyClass
 * ```
 */
export class FunctionCallTypeMismatchRule extends TypeMissmatchBase {
    readonly id = 'function-call-type-mismatch';
    readonly name = 'Function Call Type Mismatch';
    readonly description = 'Detects type mismatches in function call arguments';
    readonly category = DiagnosticCategory.TYPE;
    readonly defaultSeverity: DiagnosticSeverity = DiagnosticSeverity.Error;

    appliesToNode(node: ASTNode): boolean {
        return isCallExpression(node);
    }

    async check(
        node: ASTNode,
        context: DiagnosticRuleContext,
        _config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        const results: DiagnosticRuleResult[] = [];

        try {
            if (isCallExpression(node)) {
                results.push(...await this.checkFunctionCall(node, context));
            }
        } catch (error) {
            Logger.error(`FunctionCallTypeMismatchRule: Error checking node: ${error}`);
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
                const conversionResult = this.checkImplicitConversion(
                    paramType,
                    argType,
                    arg
                );
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
            Logger.error(`FunctionCallTypeMismatchRule: Error checking function call: ${error}`);
        }

        return results;
    }
}
