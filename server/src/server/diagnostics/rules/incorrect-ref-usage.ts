import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult,
    DiagnosticRule,
    DiagnosticCategory
} from '../rules';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { ASTNode, MethodDeclNode, FunctionDeclNode, TypeNode, VarDeclNode } from '../../ast';
import { isMethod, isFunction, isTypeReference, isGenericType, hasRefModifier } from '../../../util';

/**
 * Checks if a type is a generic type with nested ref modifiers
 * For example: array<ref TestObject> or map<string, ref TestObject>
 */
function hasNestedRefInGeneric(type: TypeNode | undefined): boolean {
    if (!type) {
        return false;
    }

    // For GenericTypeNode, check its type arguments
    if (isGenericType(type)) {
        for (const typeArg of type.typeArguments) {
            if (hasRefModifier(typeArg)) {
                return true;
            }
            // Recursively check nested generics
            if (hasNestedRefInGeneric(typeArg)) {
                return true;
            }
        }
    }

    // For TypeReferenceNode with typeArguments (should be rare, but handle it)
    if (isTypeReference(type)) {
        if (type.typeArguments) {
            for (const typeArg of type.typeArguments) {
                if (hasRefModifier(typeArg)) {
                    return true;
                }
            }
        }
    }

    return false;
}

/**
 * Rule for detecting incorrect usage of ref modifier in return types, parameters, and local variables
 * 
 * The ref modifier should not be used on:
 * - Return types of methods/functions (leads to undefined behavior)
 * - Parameters of methods/functions (leads to undefined behavior)
 * - Local variables in method/function scopes (leads to undefined behavior)
 * 
 * Valid usage includes:
 * - Class member variables: ref array<int> m_arr;
 * - Global variables: ref array<int> g_arr;
 * - Types within generics: array<ref TestObject> (ref inside the generic, not on the outer type)
 */
export class IncorrectRefUsageRule implements DiagnosticRule {
    readonly id = 'incorrect-ref-usage';
    readonly name = 'Incorrect Ref Modifier Usage';
    readonly description = 'Detects incorrect usage of ref modifier in return types, parameters, and local variables';
    readonly category = DiagnosticCategory.BEST_PRACTICE;
    readonly defaultSeverity: DiagnosticSeverity = DiagnosticSeverity.Warning;

    get defaultConfig(): DiagnosticRuleConfig {
        return {
            enabled: true,
            severity: this.defaultSeverity
        };
    }

    appliesToNode(node: ASTNode): boolean {
        return isMethod(node) || isFunction(node);
    }

    async check(
        node: MethodDeclNode | FunctionDeclNode,
        _context: DiagnosticRuleContext,
        config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        const diagnostics: DiagnosticRuleResult[] = [];

        const hasRefModifierOnReturn = node.modifiers?.includes('ref') ?? false;
        if (hasRefModifierOnReturn && hasNestedRefInGeneric(node.returnType)) {
            diagnostics.push({
                severity: config.severity ?? this.defaultSeverity,
                message: 'Using ref modifier on return types with ref-counted generic arguments leads to undefined behavior. Remove the outer ref modifier.',
                range: {
                    start: node.returnType.start,
                    end: node.returnType.end
                },
                code: this.id,
                source: 'enscript'
            });
        }

        for (const param of node.parameters) {
            const hasRefModifierOnParam = param.modifiers?.includes('ref') ?? false;
            if (hasRefModifierOnParam && hasNestedRefInGeneric(param.type)) {
                diagnostics.push({
                    severity: config.severity ?? this.defaultSeverity,
                    message: `Using ref modifier on parameter '${param.name}' with ref-counted generic arguments leads to undefined behavior. Remove the outer ref modifier.`,
                    range: {
                        start: param.type.start,
                        end: param.type.end
                    },
                    code: this.id,
                    source: 'enscript'
                });
            }
        }

        const localVariables: VarDeclNode[] = node.locals || [];
        for (const local of localVariables) {
            const hasRefModifierOnLocal = local.modifiers?.includes('ref') ?? false;
            if (hasRefModifierOnLocal && hasNestedRefInGeneric(local.type)) {
                diagnostics.push({
                    severity: config.severity ?? this.defaultSeverity,
                    message: `Using ref modifier on local variable '${local.name}' with ref-counted generic arguments leads to undefined behavior. Remove the outer ref modifier.`,
                    range: {
                        start: local.type.start,
                        end: local.type.end
                    },
                    code: this.id,
                    source: 'enscript'
                });
            }
        }

        return diagnostics;
    }

    getDocumentation(): string {
        return `
**Incorrect Ref Modifier Usage**

This rule detects when the ref modifier is incorrectly used on return types, parameters, or local variables with ref-counted generic arguments. This pattern leads to undefined behavior in EnScript.

**Bad:**
\`\`\`enscript
class TestObject {}

class TestClass {
    // ❌ Incorrect: ref on return type with ref-counted generic arguments
    ref array<ref TestObject> MethodInvalidA();
    
    // ❌ Incorrect: ref on parameter with ref-counted generic arguments
    void MethodInvalidB(ref array<ref TestObject> arg);
    
    void MethodInvalidC() {
        // ❌ Incorrect: ref on local variable with ref-counted generic arguments
        ref array<ref TestObject> variable;
    }
}

void FuncInvalidC() {
    // ❌ Incorrect: ref on local variable with ref-counted generic arguments
    ref array<ref TestObject> variable;
}
\`\`\`

**Good:**
\`\`\`enscript
class TestObject{}

ref array<int> g_arr; // ✓ Valid: ref on global variable

class TestClass {
    ref array<TestObject> m_arr; // ✓ Valid: ref on class member
    ref array<ref TestObject> m_arr2; // ✓ Valid: ref on class member
    
    // ✓ Valid: No ref on return type, ref inside generic
    array<ref TestObject> MethodValidA();
    
    // ✓ Valid: No ref on parameter, ref inside generic
    void MethodValidB(array<ref TestObject> arg);
    
    void MethodValidC() {
        // ✓ Valid: No ref on local variable, ref inside generic
        array<ref TestObject> local;
    }
}
\`\`\`

**Why this matters:**
Using ref counting on return types, parameters, or local variables with ref-counted generic arguments causes memory management issues and undefined behavior at runtime.
`;
    }
}
