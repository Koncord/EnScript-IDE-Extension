import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult,
    DiagnosticCategory
} from '../../rules';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { ASTNode } from '../../../ast';
import { isReturnStatement } from '../../../util/ast-class-utils';
import { ReturnStatement } from '../../../ast/node-types';
import { Logger } from '../../../../util/logger';
import { extractTypeName, findContainingFunctionOrMethod } from '../../../util/symbol-resolution-utils';
import { TypeMissmatchBase } from './type-missmatch-base';

/**
 * Rule for detecting type mismatches in return statements.
 * 
 * This rule checks for type compatibility when returning values from functions/methods.
 * 
 * Example issues detected:
 * ```
 * int GetNumber() {
 *     return "text";             // Error: cannot return string from int function
 * }
 * 
 * void DoSomething() {
 *     return 5;                  // Error: void function cannot return a value
 * }
 * 
 * string GetText() {
 *     return;                    // Error: function expects a return value
 * }
 * ```
 * 
 * Example valid code:
 * ```
 * int GetNumber() {
 *     return 5;                  // OK: int to int
 * }
 * 
 * void DoSomething() {
 *     return;                    // OK: void return
 * }
 * ```
 */
export class ReturnTypeMismatchRule extends TypeMissmatchBase {
    readonly id = 'return-type-mismatch';
    readonly name = 'Return Type Mismatch';
    readonly description = 'Detects type mismatches in return statements';
    readonly category = DiagnosticCategory.TYPE;
    readonly defaultSeverity: DiagnosticSeverity = DiagnosticSeverity.Error;

    appliesToNode(node: ASTNode): boolean {
        return isReturnStatement(node);
    }

    async check(
        node: ReturnStatement,
        context: DiagnosticRuleContext,
        _config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        const results: DiagnosticRuleResult[] = [];

        try {
            results.push(...await this.checkReturnStatement(node, context));
        } catch (error) {
            Logger.error(`ReturnTypeMismatchRule: Error checking node: ${error}`);
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
                Logger.debug('ReturnTypeMismatchRule: Return statement outside of function context');
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
                Logger.debug(`ReturnTypeMismatchRule: Cannot resolve type of return expression`);
                return results;
            }

            // Check for special implicit conversions
            const conversionResult = this.checkImplicitConversion(
                declaredReturnType,
                returnedType,
                node.argument
            );
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
            Logger.error(`ReturnTypeMismatchRule: Error checking return statement: ${error}`);
        }

        return results;
    }
}
