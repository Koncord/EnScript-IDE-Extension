import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult
} from '../rules';
import { ASTNode, ClassDeclNode, FunctionDeclNode, MethodDeclNode, VarDeclNode } from '../../ast';
import { DeclarationStatement } from '../../ast/node-types';
import { UndeclaredEntityRule } from './undeclared-entity-base';
import { isFunction, isMethod, isVarDecl } from '../../../util';
import { BaseASTVisitor } from '../../ast/ast-visitor';
import { DiagnosticSeverity } from 'vscode-languageserver';

/**
 * Rule for detecting variable shadowing
 * Warns when a local variable shadows a global variable or class member
 */
export class VariableShadowingRule extends UndeclaredEntityRule {
    readonly id = 'variable-shadowing';
    readonly name = 'Variable Shadowing';
    readonly description = 'Detects local variables that shadow global variables or class members';

    appliesToNode(node: ASTNode): boolean {
        return isFunction(node) || isMethod(node);
    }

    async check(
        node: FunctionDeclNode | MethodDeclNode,
        context: DiagnosticRuleContext,
        _config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        // Skip checking proto/native methods
        if (node.modifiers?.includes('proto') || node.modifiers?.includes('native') || !node.body) {
            return [];
        }

        const results: DiagnosticRuleResult[] = [];

        // Get global variables from current file
        const globalVars = this.getGlobalVariables(context);

        // Get class members if this is a method
        const containingClass = this.findContainingClass(node, context);
        const classMembers = containingClass ? this.getClassMembers(containingClass) : new Set<string>();

        // Get function/method parameters
        const parameters = new Set<string>();
        for (const param of node.parameters || []) {
            parameters.add(param.name);
        }

        // Check all local variables in the function/method
        const visitor = new LocalVariableVisitor(globalVars, classMembers, parameters, containingClass?.name || null);
        if (node.body) {
            visitor.visit(node.body);
        }

        // Create diagnostics for shadowed variables
        for (const shadowing of visitor.getShadowedVariables()) {
            const diagnostic = this.createDiagnostic(
                shadowing.message,
                shadowing.start,
                shadowing.end,
                DiagnosticSeverity.Warning,
                this.id
            );

            results.push(diagnostic);
        }

        return results;
    }

    private getGlobalVariables(context: DiagnosticRuleContext): Set<string> {
        const globalVars = new Set<string>();

        // Get variables from current document only
        if (context.ast?.body) {
            for (const node of context.ast.body) {
                if (isVarDecl(node)) {
                    globalVars.add(node.name);
                }
            }
        }

        return globalVars;
    }

    /**
     * Get all class members from a class declaration
     */
    private getClassMembers(classDecl: ClassDeclNode): Set<string> {
        const members = new Set<string>();

        for (const member of classDecl.members || []) {
            if (isVarDecl(member)) {
                members.add(member.name);
            }
        }

        return members;
    }
}

class LocalVariableVisitor extends BaseASTVisitor<void> {
    private shadowedVariables: Array<{ 
        message: string; 
        start: { line: number; character: number };
        end: { line: number; character: number };
    }> = [];

    constructor(
        private globalVars: Set<string>,
        private classMembers: Set<string>,
        private parameters: Set<string>,
        private className: string | null
    ) {
        super();
    }

    protected defaultResult(): void {
        return undefined;
    }

    visitDeclarationStatement(node: DeclarationStatement): void {
        // Check all declarations in the statement
        const declarationsToCheck: VarDeclNode[] = [];

        if (node.declarations && node.declarations.length > 0) {
            declarationsToCheck.push(...node.declarations.filter(isVarDecl) as VarDeclNode[]);
        } else if (node.declaration && isVarDecl(node.declaration)) {
            declarationsToCheck.push(node.declaration as VarDeclNode);
        }

        for (const decl of declarationsToCheck) {
            if (isVarDecl(decl)) {
                // Check if this variable shadows a parameter (highest priority)
                if (this.parameters.has(decl.name)) {
                    this.shadowedVariables.push({
                        message: `Local variable '${decl.name}' shadows parameter with the same name`,
                        start: decl.start,
                        end: decl.nameEnd || decl.end
                    });
                }
                // Check if this variable shadows a class member
                else if (this.classMembers.has(decl.name)) {
                    this.shadowedVariables.push({
                        message: `Local variable '${decl.name}' shadows class member '${this.className}.${decl.name}'`,
                        start: decl.start,
                        end: decl.nameEnd || decl.end
                    });
                }
                // Check if this variable shadows a global
                else if (this.globalVars.has(decl.name)) {
                    this.shadowedVariables.push({
                        message: `Local variable '${decl.name}' shadows global variable with the same name`,
                        start: decl.start,
                        end: decl.nameEnd || decl.end
                    });
                }
            }
        }

        // Continue traversing
        super.visitDeclarationStatement(node);
    }

    getShadowedVariables(): Array<{ 
        message: string; 
        start: { line: number; character: number };
        end: { line: number; character: number };
    }> {
        return this.shadowedVariables;
    }
}
