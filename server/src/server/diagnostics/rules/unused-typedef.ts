import {
    BaseDiagnosticRule,
    DiagnosticCategory,
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult
} from '../rules';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { ASTNode, TypedefDeclNode, TypeNode } from '../../ast';
import { isTypedef, isVarDecl, isParameterDecl } from '../../../util';

/**
 * Rule for detecting unused typedef declarations
 */
export class UnusedTypedefRule extends BaseDiagnosticRule {
    readonly id = 'unused-typedef';
    readonly name = 'Unused Typedef';
    readonly description = 'Detects typedef declarations that are never used';
    readonly category = DiagnosticCategory.STYLE;
    readonly defaultSeverity: DiagnosticSeverity = DiagnosticSeverity.Warning;

    appliesToNode(node: ASTNode): boolean {
        return isTypedef(node);
    }

    async check(
        node: ASTNode,
        context: DiagnosticRuleContext,
        config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        if (!isTypedef(node)) {
            return [];
        }

        // Skip typedef checking for opened files (proto/declaration files)
        // These files define typedefs for external use (C++ interop, other files)
        if (context.openedDocumentUris?.has(context.document.uri)) {
            return [];
        }

        // Check if the typedef is actually used in the file
        const typedefDecl = node as TypedefDeclNode;
        const isUsed = this.isTypedefUsedInDocument(typedefDecl.name, context);

        if (isUsed) {
            return [];
        }

        const message = `Typedef '${node.name}' is never used`;

        return [
            this.createDiagnostic(
                message,
                node.start,
                node.end,
                config.severity
            )
        ];
    }

    /**
     * Check if a typedef name is referenced anywhere in the document
     */
    private isTypedefUsedInDocument(typedefName: string, context: DiagnosticRuleContext): boolean {
        const ast = context.ast;

        // Recursively search for type references matching the typedef name
        return this.searchForTypeUsage(ast.body, typedefName);
    }

    /**
     * Recursively search AST nodes for usage of a type name
     */
    private searchForTypeUsage(nodes: ASTNode[], typeName: string): boolean {
        for (const node of nodes) {
            // Check variable/parameter declarations for type references
            if ((isVarDecl(node) || isParameterDecl(node)) && node.type) {
                if (this.typeMatchesName(node.type, typeName)) {
                    return true;
                }
            }

            // Recursively search child nodes
            if ('body' in node && Array.isArray(node.body)) {
                if (this.searchForTypeUsage(node.body as ASTNode[], typeName)) {
                    return true;
                }
            }

            // Check class members
            if ('members' in node && Array.isArray(node.members)) {
                if (this.searchForTypeUsage(node.members as ASTNode[], typeName)) {
                    return true;
                }
            }

            // Check function/method parameters
            if ('parameters' in node && Array.isArray(node.parameters)) {
                if (this.searchForTypeUsage(node.parameters as ASTNode[], typeName)) {
                    return true;
                }
            }

            // Check function/method locals
            if ('locals' in node && Array.isArray(node.locals)) {
                if (this.searchForTypeUsage(node.locals as ASTNode[], typeName)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Check if a type node matches the given type name
     */
    private typeMatchesName(typeNode: TypeNode | null | undefined, typeName: string): boolean {
        if (!typeNode) return false;

        // Handle TypeReference
        if (typeNode.kind === 'TypeReference' && typeNode.name === typeName) {
            return true;
        }

        // Handle GenericType with type arguments
        if (typeNode.kind === 'GenericType') {
            // Check the base type
            if (typeNode.baseType && this.typeMatchesName(typeNode.baseType, typeName)) {
                return true;
            }
            // Check type arguments
            if (typeNode.typeArguments && Array.isArray(typeNode.typeArguments)) {
                for (const arg of typeNode.typeArguments) {
                    if (this.typeMatchesName(arg, typeName)) {
                        return true;
                    }
                }
            }
        }

        // Handle ArrayType
        if (typeNode.kind === 'ArrayType' && typeNode.elementType) {
            return this.typeMatchesName(typeNode.elementType, typeName);
        }

        return false;
    }

    getDocumentation(): string {
        return `
# Unused Typedef Rule

This rule detects typedef declarations that are never referenced in the codebase.

## Examples

**❌ Bad:**
\`\`\`c
typedef int MyInt; // Never used
\`\`\`

**✅ Good:**
\`\`\`c
typedef int MyInt;
MyInt value = 42; // Typedef is used
\`\`\`

## Configuration

- \`enabled\`: Enable or disable this rule (default: true)
- \`severity\`: Diagnostic severity level (default: WARNING)
    `;
    }
}
