import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult,
    DiagnosticCategory
} from '../../rules';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { ASTNode, VarDeclNode } from '../../../ast';
import { isVarDecl } from '../../../util/ast-class-utils';
import { Logger } from '../../../../util/logger';
import { extractTypeName } from '../../../util/symbol-resolution-utils';
import { parseGenericType, isPrimitiveType } from '../../../util/type-utils';
import { TypeMissmatchBase } from './type-missmatch-base';

/**
 * Rule for detecting type mismatches in variable declarations.
 * 
 * This rule checks for type compatibility when initializing variables with values.
 * 
 * Example issues detected:
 * ```
 * int x = "string";              // Error: cannot assign string to int
 * 
 * bool flag = 3.14;              // Error: cannot assign float to bool
 * 
 * int value = null;              // Error: cannot assign null to value type
 * ```
 * 
 * Example valid code:
 * ```
 * int x = 42;                    // OK: int to int
 * string s = "hello";            // OK: string to string
 * MyClass obj = null;            // OK: null to reference type
 * ```
 */
export class VariableDeclarationTypeMismatchRule extends TypeMissmatchBase {
    readonly id = 'variable-declaration-type-mismatch';
    readonly name = 'Variable Declaration Type Mismatch';
    readonly description = 'Detects type mismatches in variable declarations';
    readonly category = DiagnosticCategory.TYPE;
    readonly defaultSeverity: DiagnosticSeverity = DiagnosticSeverity.Error;

    appliesToNode(node: ASTNode): boolean {
        return isVarDecl(node);
    }

    async check(
        node: ASTNode,
        context: DiagnosticRuleContext,
        _config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        const results: DiagnosticRuleResult[] = [];

        try {
            if (isVarDecl(node)) {
                results.push(...await this.checkVariableDeclaration(node, context));
            }
        } catch (error) {
            Logger.error(`VariableDeclarationTypeMismatchRule: Error checking node: ${error}`);
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
            const conversionResult = this.checkImplicitConversion(
                declaredType,
                initializerType,
                node.initializer
            );
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
            Logger.error(`VariableDeclarationTypeMismatchRule: Error checking variable declaration: ${error}`);
        }

        return results;
    }
}
