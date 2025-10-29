import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult
} from '../rules';
import { ASTNode, ClassDeclNode, FunctionDeclNode, MethodDeclNode, VarDeclNode } from '../../ast';
import { DeclarationStatement, BlockStatement, ForEachStatement, ForStatement, SwitchStatement, Identifier, MemberExpression, CallExpression } from '../../ast/node-types';
import { UndeclaredEntityRule } from './undeclared-entity-base';
import { isFunction, isMethod, isClass, isVarDecl } from '../../../util';
import { BaseASTVisitor } from '../../ast/ast-visitor';
import { findMemberInClassWithInheritance } from '../../util/ast-class-utils';

/**
 * Rule for detecting usage of undeclared variables
 */
export class UndeclaredVariableRule extends UndeclaredEntityRule {
    readonly id = 'undeclared-variable';
    readonly name = 'Undeclared Variable';
    readonly description = 'Detects usage of variables that are not declared in the current scope';

    appliesToNode(node: ASTNode): boolean {
        return isFunction(node) || isMethod(node);
    }

    async check(
        node: ASTNode,
        context: DiagnosticRuleContext,
        config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        if (!isFunction(node) && !isMethod(node)) {
            return [];
        }

        // Skip checking proto/native methods
        if (node.modifiers?.includes('proto') || node.modifiers?.includes('native') || !node.body) {
            return [];
        }

        // Build initial scope (parameters, class members, globals)
        // IMPORTANT: Don't include functionNode.locals here because those are block-scoped
        // and will be tracked during visitor traversal
        const initialScope = this.buildInitialScope(node, context);

        // Find containing class for inherited member checking
        const containingClass = this.findContainingClass(node, context);

        // Use lightweight visitor to filter and check identifiers
        const visitor = new IdentifierFilterVisitor(
            initialScope,
            containingClass,
            context,
            config,
            this
        );
        
        if (node.body) {
            visitor.visit(node.body);
        }

        return visitor.getDiagnostics();
    }

    /**
     * Build initial scope WITHOUT local variables (those are block-scoped)
     * Includes: parameters, class members, globals, builtins, known classes
     */
    private buildInitialScope(functionNode: FunctionDeclNode | MethodDeclNode, context: DiagnosticRuleContext): Set<string> {
        const variables = new Set<string>();

        // Add function parameters (these are function-scoped)
        for (const param of functionNode.parameters) {
            variables.add(param.name);
        }

        // NOTE: Do NOT add functionNode.locals here!
        // Local variables are block-scoped and tracked by the visitor

        // Add global variables/constants from the current file
        const currentAst = context.ast;
        for (const node of currentAst.body) {
            if (isVarDecl(node)) {
                const varNode = node as VarDeclNode;
                variables.add(varNode.name);
            }
        }

        // Add class member variables if this is a method
        const currentClass = this.findContainingClass(functionNode, context);
        if (currentClass) {
            for (const member of currentClass.members) {
                // Add both variables and methods (methods can be used as function pointers in EnScript)
                if (isVarDecl(member) || isMethod(member)) {
                    variables.add(member.name);
                }
            }
        }

        // Add builtins
        const builtins = ['this', 'super', 'base', 'null', 'true', 'false'];
        for (const builtin of builtins) {
            variables.add(builtin);
        }

        // Add known class names
        this.addKnownClassesToScope(variables, context);

        return variables;
    }

    /**
     * Check if an identifier is an inherited member from include paths
     * Uses findMemberInClassWithInheritance - reusing existing code!
     * 
     * Note: In EnScript, methods can be used as variables (function pointers/delegates),
     * so we accept both variable declarations and method declarations.
     */
    public checkInheritedMember(
        name: string,
        containingClass: ClassDeclNode | null,
        context: DiagnosticRuleContext
    ): boolean {
        if (!containingClass) {
            return false;
        }

        const findClassFn = (className: string): ClassDeclNode | null => {
            const currentAst = context.ast;
            for (const astNode of currentAst.body) {
                if (isClass(astNode) && astNode.name === className) {
                    return astNode;
                }
            }
            
            if (context.typeResolver) {
                const classDefs = context.typeResolver.findAllClassDefinitions(className);
                if (classDefs.length > 0) {
                    return classDefs[0];
                }
            }
            
            return null;
        };

        const member = findMemberInClassWithInheritance(
            containingClass,
            name,
            findClassFn,
            false
        );

        // Accept both variables and methods (methods can be used as function pointers in EnScript)
        return member !== null && (isVarDecl(member) || isMethod(member));
    }

    public checkLanguageKeyword(name: string): boolean {
        return this.isLanguageKeyword(name);
    }

    public createVariableDiagnostic(
        name: string,
        start: { line: number; character: number },
        end: { line: number; character: number },
        config: DiagnosticRuleConfig
    ): DiagnosticRuleResult {
        return this.createUndeclaredDiagnostic('Variable', name, start, end, config);
    }

    getDocumentation(): string {
        return this.getUndeclaredDocumentation('Variable', {
            bad: `void MyFunction() {
    int myVar = 1;
    undVar = 2; // Error: 'undVar' is not declared
}`,
            good: `void MyFunction() {
    int myVar = 1;
    myVar = 2; // OK: 'myVar' is declared
}`
        });
    }

    getSuggestions(node: ASTNode, _context: DiagnosticRuleContext): string[] {
        if (!isFunction(node) && !isMethod(node)) {
            return [];
        }

        const baseSuggestions = this.getUndeclaredSuggestions('Variable', 'variable_name');
        return [
            ...baseSuggestions,
            'Check if the variable should be a function parameter',
            'Verify if the variable should be a class member'
        ];
    }
}

/**
 * Lightweight visitor that filters which identifiers to check
 * 
 * SCOPE MANAGEMENT:
 * - Initial scope (buildVariableScope): parameters, class members, globals (function-level)
 * - Block scopes (tracked during traversal): local variables with proper block scoping
 * 
 * Why track block scopes?
 * The parser's functionNode.locals contains ALL variables in the function body,
 * but doesn't track WHICH block they're declared in. We need proper block scoping:
 *   if (true) { int x; }  // x only visible inside this block
 *   x = 5;  // ERROR: x is out of scope
 */
class IdentifierFilterVisitor extends BaseASTVisitor<void> {
    private diagnostics: DiagnosticRuleResult[] = [];
    private blockScopes: Array<Set<string>> = []; // Stack of block-scoped variables
    
    constructor(
        private initialScope: Set<string>, // Function-level scope from buildVariableScope
        private containingClass: ClassDeclNode | null,
        private context: DiagnosticRuleContext,
        private config: DiagnosticRuleConfig,
        private rule: UndeclaredVariableRule
    ) {
        super();
    }

    protected defaultResult(): void {}

    getDiagnostics(): DiagnosticRuleResult[] {
        return this.diagnostics;
    }

    /**
     * Check if a variable is in scope (initial scope + block-scoped variables)
     */
    private isInScope(name: string): boolean {
        // Check initial function-level scope (parameters, class members, globals)
        if (this.initialScope.has(name)) {
            return true;
        }

        // Check block-scoped variables (most recent first)
        for (let i = this.blockScopes.length - 1; i >= 0; i--) {
            if (this.blockScopes[i].has(name)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Add a variable to the current block scope
     */
    private addToCurrentBlockScope(name: string): void {
        if (this.blockScopes.length > 0) {
            this.blockScopes[this.blockScopes.length - 1].add(name);
        }
    }

    /**
     * Enter a new block scope
     */
    private enterBlockScope(): void {
        this.blockScopes.push(new Set<string>());
    }

    /**
     * Exit the current block scope
     */
    private exitBlockScope(): void {
        if (this.blockScopes.length > 0) {
            this.blockScopes.pop();
        }
    }

    // Handle block statements (create new scope for local variables)
    protected visitBlockStatement(node: BlockStatement): void {
        this.enterBlockScope();
        
        if (Array.isArray(node.body)) {
            for (const stmt of node.body) {
                this.visit(stmt);
            }
        }

        this.exitBlockScope();
    }

    // Handle variable declarations (add to current block scope)
    protected visitVariableDeclaration(node: VarDeclNode): void {
        this.addToCurrentBlockScope(node.name);

        // Visit the initializer if present
        if (node.initializer) {
            this.visit(node.initializer);
        }
    }

    // Handle declaration statements (may contain multiple comma-separated declarations)
    protected visitDeclarationStatement(node: DeclarationStatement): void {
        // For multi-variable declarations like: int x, y, z;
        // The declarations array contains all variables
        if (Array.isArray(node.declarations)) {
            for (const decl of node.declarations) {
                if (!isVarDecl(decl)) continue;
                 this.addToCurrentBlockScope(decl.name);
                // Visit initializer if present
                if (decl.initializer) {
                    this.visit(decl.initializer);
                }
            }
        } else if (node.declaration) {
            // Single declaration - visit it
            this.visit(node.declaration);
        }
    }

    // Handle foreach statements (add loop variables to scope)
    protected visitForEachStatement(node: ForEachStatement): void {
        this.enterBlockScope();
        
        // Add foreach loop variables
        if (Array.isArray(node.variables)) {
            for (const variable of node.variables) {
                this.addToCurrentBlockScope(variable.name);
            }
        }
        
        // Visit iterable
        if (node.iterable) {
            this.visit(node.iterable as ASTNode);
        }
        
        // Visit body
        if (node.body) {
            this.visit(node.body as ASTNode);
        }

        this.exitBlockScope();
    }

    // Handle for statements (add loop variable to scope)
    protected visitForStatement(node: ForStatement): void {
        this.enterBlockScope();
        
        // Visit initializer (may contain variable declaration)
        if (node.init) {
            this.visit(node.init as ASTNode);
        }
        
        // Visit condition
        if (node.test) {
            this.visit(node.test as ASTNode);
        }
        
        // Visit update
        if (node.update) {
            this.visit(node.update as ASTNode);
        }
        
        // Visit body
        if (node.body) {
            this.visit(node.body as ASTNode);
        }
        
        this.exitBlockScope();
    }

    // Handle switch statements (entire switch body is one scope)
    protected visitSwitchStatement(node: SwitchStatement): void {
        // Visit discriminant
        if (node.discriminant) {
            this.visit(node.discriminant as ASTNode);
        }
        
        // Create a scope for the entire switch body (all cases share scope)
        this.enterBlockScope();
        
        // Visit all cases
        if (node.cases && Array.isArray(node.cases)) {
            for (const caseNode of node.cases) {
                this.visit(caseNode);
            }
        }
        
        this.exitBlockScope();
    }

    // Check identifiers in expression contexts
    protected visitIdentifier(node: Identifier): void {
        if (this.rule.checkLanguageKeyword(node.name)) {
            return;
        }

        // Check if variable is in scope (function-level + block-scoped)
        if (this.isInScope(node.name)) {
            return;
        }

        if (this.containingClass && this.containingClass.genericParameters) {
            for (const genericParam of this.containingClass.genericParameters) {
                if (genericParam.name === node.name) {
                    return; // It's a generic parameter, not an undeclared variable
                }
            }
        }

        // Check global variables
        if (this.context.typeResolver) {
            const globalVars = this.context.typeResolver.findAllGlobalVariableDefinitions(node.name);
            if (globalVars && globalVars.length > 0) {
                return;
            }
        }

        // Check inherited members (reuses findMemberInClassWithInheritance!)
        if (this.rule.checkInheritedMember(node.name, this.containingClass, this.context)) {
            return;
        }

        // Undeclared variable
        this.diagnostics.push(
            this.rule.createVariableDiagnostic(
                node.name,
                node.start,
                node.end,
                this.config
            )
        );
    }

    // Don't visit member expression properties (right side of dot)
    protected visitMemberExpression(node: MemberExpression): void {
        if (node.object) {
            this.visit(node.object as ASTNode);
        }
        // Skip property - it's not a variable reference
    }

    // Don't visit function names in call expressions
    protected visitCallExpression(node: CallExpression): void {
        if (node.callee) {
            const callee = node.callee as ASTNode;
            if (callee.kind === 'MemberExpression') {
                this.visit(callee); // Check object in obj.method()
            }
            // Skip simple identifier callees (function names)
        }

        if (Array.isArray(node.arguments)) {
            for (const arg of node.arguments) {
                this.visit(arg);
            }
        }
    }
}
