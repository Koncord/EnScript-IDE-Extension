import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult,
    DiagnosticCategory
} from '../../rules';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { ASTNode } from '../../../ast';
import { isBinaryExpression } from '../../../util/ast-class-utils';
import { BinaryExpression } from '../../../ast/node-types';
import { Logger } from '../../../../util/logger';
import { TypeMissmatchBase } from './type-missmatch-base';

/**
 * Rule for detecting type mismatches in binary operations.
 * 
 * This rule checks for type compatibility in binary operations like arithmetic,
 * comparison, and bitwise operations.
 * 
 * Example issues detected:
 * ```
 * int result = 5 + "text";       // Error: incompatible types in binary operation
 * 
 * bool flag = "abc" < 123;       // Error: cannot compare string with int
 * 
 * int mask = "text" | 5;         // Error: bitwise operation requires integer types
 * 
 * vector v = vector(1,2,3) + 5;  // Error: cannot add scalar to vector directly
 * ```
 * 
 * Example valid code:
 * ```
 * int result = 5 + 10;           // OK: int + int
 * string s = "hello" + "world";  // OK: string concatenation
 * vector v = vector(1,2,3) + vector(4,5,6);  // OK: vector + vector
 * int mask = 0x01 | 0x02;        // OK: int | int
 * ```
 */
export class BinaryOperationTypeMismatchRule extends TypeMissmatchBase {
    readonly id = 'binary-operation-type-mismatch';
    readonly name = 'Binary Operation Type Mismatch';
    readonly description = 'Detects type mismatches in binary operations';
    readonly category = DiagnosticCategory.TYPE;
    readonly defaultSeverity: DiagnosticSeverity = DiagnosticSeverity.Error;

    appliesToNode(node: ASTNode): boolean {
        return isBinaryExpression(node);
    }

    async check(
        node: BinaryExpression,
        context: DiagnosticRuleContext,
        _config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        const results: DiagnosticRuleResult[] = [];

        try {
            results.push(...await this.checkBinaryOperation(node, context));
        } catch (error) {
            Logger.error(`BinaryOperationTypeMismatchRule: Error checking node: ${error}`);
        }

        return results;
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
            Logger.error(`BinaryOperationTypeMismatchRule: Error checking binary operation: ${error}`);
        }

        return results;
    }
}
