import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult,
    DiagnosticCategory
} from '../../rules';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { ASTNode } from '../../../ast';
import { isAssignmentExpression } from '../../../util/ast-class-utils';
import { AssignmentExpression } from '../../../ast/node-types';
import { Logger } from '../../../../util/logger';
import { TypeMissmatchBase } from './type-missmatch-base';

/**
 * Rule for detecting type mismatches in assignment expressions.
 * 
 * This rule checks for type compatibility when assigning values to variables.
 * 
 * Example issues detected:
 * ```
 * int x;
 * x = "string";                  // Error: cannot assign string to int
 * 
 * MyClass obj;
 * obj = 42;                      // Error: cannot assign int to MyClass
 * ```
 * 
 * Example valid code:
 * ```
 * int x;
 * x = 42;                        // OK: int to int
 * 
 * string s;
 * s = "hello";                   // OK: string to string
 * ```
 */
export class AssignmentTypeMismatchRule extends TypeMissmatchBase {
    readonly id = 'assignment-type-mismatch';
    readonly name = 'Assignment Type Mismatch';
    readonly description = 'Detects type mismatches in assignment expressions';
    readonly category = DiagnosticCategory.TYPE;
    readonly defaultSeverity: DiagnosticSeverity = DiagnosticSeverity.Error;

    appliesToNode(node: ASTNode): boolean {
        return isAssignmentExpression(node);
    }

    async check(
        node: AssignmentExpression,
        context: DiagnosticRuleContext,
        _config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        const results: DiagnosticRuleResult[] = [];

        try {
            results.push(...await this.checkAssignment(node, context));
        } catch (error) {
            Logger.error(`AssignmentTypeMismatchRule: Error checking node: ${error}`);
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
            const conversionResult = this.checkImplicitConversion(
                targetType,
                valueType,
                node.right
            );
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
            Logger.error(`AssignmentTypeMismatchRule: Error checking assignment: ${error}`);
        }

        return results;
    }
}
