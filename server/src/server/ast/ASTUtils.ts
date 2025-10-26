import { CollectingASTVisitor, VoidASTVisitor } from './ast-visitor';
import { ASTNode } from './node-types';

/**
 * Utility functions for AST traversal
 */

export class ASTUtils {
    /**
     * Find all nodes of a specific kind in the AST
     */
    static findNodesByKind<T extends ASTNode>(
        root: ASTNode,
        kind: T['kind']
    ): T[] {
        const collector = new (class extends CollectingASTVisitor<T> {
            visit(node: ASTNode): T[] {
                const results = super.visit(node);
                if (node.kind === kind) {
                    results.push(node as T);
                }
                return results;
            }
        })();

        return collector.visit(root);
    }

    /**
     * Find the first node that matches a predicate
     */
    static findFirst<T extends ASTNode>(
        root: ASTNode,
        predicate: (node: ASTNode) => node is T
    ): T | undefined {
        let found: T | undefined;

        const finder = new (class extends VoidASTVisitor {
            visit(node: ASTNode): void {
                if (!found && predicate(node)) {
                    found = node;
                    return;
                }
                super.visit(node);
            }
        })();

        finder.visit(root);
        return found;
    }

    /**
     * Get all child nodes of a node
     */
    static getChildren(node: ASTNode): ASTNode[] {
        const children: ASTNode[] = [];

        const collector = new (class extends VoidASTVisitor {
            visit(child: ASTNode): void {
                if (child !== node) {
                    children.push(child);
                }
                // Don't traverse deeper - we only want direct children
            }
        })();

        collector.visit(node);
        return children;
    }

    /**
     * Check if a node contains another node
     */
    static contains(parent: ASTNode, target: ASTNode): boolean {
        return this.findFirst(parent, (node): node is ASTNode => node === target) !== undefined;
    }
}
