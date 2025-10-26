import { CollectingASTVisitor } from './ast-visitor';
import { VarDeclNode, BlockStatement, ForEachStatement, DeclarationStatement, IfStatement, WhileStatement, ForStatement } from './node-types';

/**
 * Find all variable declarations
 */
export class VariableDeclarationCollector extends CollectingASTVisitor<VarDeclNode> {
    protected visitVariableDeclaration(node: VarDeclNode): VarDeclNode[] {
        // Visit children first
        super.visitVariableDeclaration(node);

        // Return this variable declaration
        return [node];
    }

    protected visitBlockStatement(node: BlockStatement): VarDeclNode[] {
        // Collect results from all child statements
        const results: VarDeclNode[] = [];
        for (const stmt of node.body) {
            const stmtResults = this.visit(stmt);
            results.push(...stmtResults);
        }
        return results;
    }

    protected visitForEachStatement(node: ForEachStatement): VarDeclNode[] {
        // Collect foreach loop variables (e.g., foreach (int i, string s : items))
        const results: VarDeclNode[] = [];

        // Add the foreach variables themselves
        for (const variable of node.variables) {
            results.push(variable);
        }

        // Visit the loop body to collect any nested variables
        const bodyResults = this.visit(node.body);
        results.push(...bodyResults);

        return results;
    }

    protected visitDeclarationStatement(node: DeclarationStatement): VarDeclNode[] {
        // Visit children first to collect any nested variables
        const childResults = super.visitDeclarationStatement(node);

        // Collect all declarations (handles multiple comma-separated declarations like: int low, high;)
        if (node.declarations && node.declarations.length > 0) {
            // Multiple declarations - collect all variable declarations
            for (const decl of node.declarations) {
                if (decl.kind === 'VarDecl') {
                    childResults.push(decl as VarDeclNode);
                }
            }
        } else if (node.declaration && node.declaration.kind === 'VarDecl') {
            // Single declaration (backwards compatibility)
            childResults.push(node.declaration as VarDeclNode);
        }

        return childResults;
    }

    // Override if/while/for statements to collect variables from their bodies
    protected visitIfStatement(node: IfStatement): VarDeclNode[] {
        const results: VarDeclNode[] = [];

        // Visit test expression (in case there are inline declarations)
        results.push(...this.visit(node.test));

        // Collect from consequent (then branch)
        results.push(...this.visit(node.consequent));

        // Collect from alternate (else branch) if present
        if (node.alternate) {
            results.push(...this.visit(node.alternate));
        }

        return results;
    }

    protected visitWhileStatement(node: WhileStatement): VarDeclNode[] {
        const results: VarDeclNode[] = [];
        results.push(...this.visit(node.test));
        results.push(...this.visit(node.body));
        return results;
    }

    protected visitForStatement(node: ForStatement): VarDeclNode[] {
        const results: VarDeclNode[] = [];

        // Collect from initializer (e.g., for (int i = 0; ...))
        if (node.init) {
            results.push(...this.visit(node.init));
        }

        // Visit test and update expressions
        if (node.test) {
            results.push(...this.visit(node.test));
        }
        if (node.update) {
            results.push(...this.visit(node.update));
        }

        // Collect from body
        results.push(...this.visit(node.body));

        return results;
    }
}
