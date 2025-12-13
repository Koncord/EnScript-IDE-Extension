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
 * Rule for detecting variable shadowing and redeclarations
 * - Warns when a local variable shadows a global variable or class member (Warning)
 * - Errors when a variable is redeclared in the same function scope (Error)
 */
export class VariableShadowingRule extends UndeclaredEntityRule {
    readonly id = 'variable-shadowing';
    readonly name = 'Variable Shadowing and Redeclaration';
    readonly description = 'Detects local variables that shadow global variables or class members, and redeclarations within the same scope';

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

        // Create diagnostics for shadowed variables (warnings)
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

        // Create diagnostics for redeclared variables (errors)
        for (const redeclaration of visitor.getRedeclaredVariables()) {
            const diagnostic: DiagnosticRuleResult = {
                message: redeclaration.message,
                range: {
                    start: redeclaration.start,
                    end: redeclaration.end
                },
                severity: DiagnosticSeverity.Error,
                code: 'variable-redeclaration',
                relatedInformation: redeclaration.firstDeclaration.uri ? [
                    {
                        message: `First declaration of '${redeclaration.varName}'`,
                        location: {
                            uri: redeclaration.firstDeclaration.uri,
                            range: {
                                start: redeclaration.firstDeclaration.start,
                                end: redeclaration.firstDeclaration.nameEnd || redeclaration.firstDeclaration.end
                            }
                        }
                    }
                ] : undefined
            };

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
    
    private redeclaredVariables: Array<{
        message: string;
        varName: string;
        start: { line: number; character: number };
        end: { line: number; character: number };
        firstDeclaration: VarDeclNode;
    }> = [];
    
    // Track all local variable declarations (for redeclaration detection)
    private declaredVariables = new Map<string, VarDeclNode>();

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

    private checkDeclaration(decl: VarDeclNode): void {
        // First, check for redeclarations (highest priority - this is an error)
        const existing = this.declaredVariables.get(decl.name);
        if (existing) {
            this.redeclaredVariables.push({
                message: `Variable '${decl.name}' is already declared in this scope`,
                varName: decl.name,
                start: decl.start,
                end: decl.nameEnd || decl.end,
                firstDeclaration: existing
            });
            return; // Don't check for shadowing if it's a redeclaration
        }

        // Track this declaration
        this.declaredVariables.set(decl.name, decl);

        // Then check for shadowing (lower priority - this is a warning)
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
                this.checkDeclaration(decl);
                // Visit initializer if present
                if (decl.initializer) {
                    this.visit(decl.initializer);
                }
            }
        }

        // Don't call super - we already handled the declarations above
    }

    protected visitForEachStatement(node: any): void {
        // Add foreach loop variables (they are function-scoped in EnScript)
        if (Array.isArray(node.variables)) {
            for (const variable of node.variables) {
                this.checkDeclaration(variable);
            }
        }

        // Visit iterable
        if (node.iterable) {
            this.visit(node.iterable);
        }

        // Visit body
        if (node.body) {
            this.visit(node.body);
        }
    }

    protected visitForStatement(node: any): void {
        // Visit initializer - for loop variables are function-scoped
        if (node.init) {
            // The init can be either a VarDeclNode or a DeclarationStatement
            if (isVarDecl(node.init)) {
                this.checkDeclaration(node.init);
                if (node.init.initializer) {
                    this.visit(node.init.initializer);
                }
            } else {
                // It's a DeclarationStatement or expression
                this.visit(node.init);
            }
        }

        // Visit condition
        if (node.test) {
            this.visit(node.test);
        }

        // Visit update
        if (node.update) {
            this.visit(node.update);
        }

        // Visit body
        if (node.body) {
            this.visit(node.body);
        }
    }

    getShadowedVariables(): Array<{ 
        message: string; 
        start: { line: number; character: number };
        end: { line: number; character: number };
    }> {
        return this.shadowedVariables;
    }

    getRedeclaredVariables(): Array<{
        message: string;
        varName: string;
        start: { line: number; character: number };
        end: { line: number; character: number };
        firstDeclaration: VarDeclNode;
    }> {
        return this.redeclaredVariables;
    }
}
