import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { Logger } from '../../../util';
import { ASTNode } from '../../ast';
import { DiagnosticRuleRegistry } from '../registry';
import { DiagnosticRule, DiagnosticRuleContext, DiagnosticRuleResult } from '../rules';
import { isDiagnosticSuppressed } from '../suppression';

/**
 * Iterative traversal for running diagnostic rules on AST nodes
 * Uses explicit stack instead of recursion to avoid stack overflow and improve performance
 */
export class DiagnosticVisitor {
    private processingQueue: Array<{ node: ASTNode; rule: DiagnosticRule }> = [];
    private diagnosticKeys = new Set<string>();
    private readonly BATCH_SIZE = 100; // Process in batches to control memory
    private rulesByNodeKind: Map<string, DiagnosticRule[]> = new Map();
    private visitedNodeCount = 0;

    constructor(
        private rules: DiagnosticRule[],
        private context: DiagnosticRuleContext,
        private diagnostics: Diagnostic[],
        private ruleExecutionTimes: Array<{ ruleId: string; time: number; diagnosticCount: number; skippedCount?: number; }>,
        private diagnosticBreakdown: Array<{ ruleId: string; message: string; location: string; time: number; diagnostic: Diagnostic; }>,
        private enableTiming: boolean,
        private maxDiagnostics: number,
        private convertToDiagnostic: (result: DiagnosticRuleResult, rule: DiagnosticRule) => Diagnostic,
        private registry: DiagnosticRuleRegistry
    ) {
        this.indexRulesByNodeKind();
    }

    /**
     * Pre-index rules by node kind for O(1) lookup instead of O(rules × nodes)
     */
    private indexRulesByNodeKind(): void {
        // Get a sample of node kinds to pre-compute applicability
        const nodeKinds = [
            'VarDecl', 'ParameterDecl', 'ClassDecl', 'FunctionDecl', 'MethodDecl',
            'CallExpression', 'MemberExpression', 'Identifier', 'TypeReference',
            'EnumDecl', 'TypedefDecl', 'BlockStatement', 'ReturnStatement'
        ];

        // For each node kind, determine which rules apply
        for (const kind of nodeKinds) {
            const applicableRules: DiagnosticRule[] = [];
            const testNode = { kind } as ASTNode;
            
            for (const rule of this.rules) {
                const ruleConfig = this.registry.getRuleConfig(rule.id);
                if (ruleConfig?.enabled && rule.appliesToNode(testNode)) {
                    applicableRules.push(rule);
                }
            }
            
            if (applicableRules.length > 0) {
                this.rulesByNodeKind.set(kind, applicableRules);
            }
        }
    }

    /**
     * Get applicable rules for a node (using index if available)
     */
    private getApplicableRules(node: ASTNode): DiagnosticRule[] {
        const indexed = this.rulesByNodeKind.get(node.kind);
        if (indexed) {
            return indexed;
        }

        // Fallback to checking all rules if node kind not indexed
        const applicable: DiagnosticRule[] = [];
        for (const rule of this.rules) {
            if (rule.appliesToNode(node)) {
                const ruleConfig = this.registry.getRuleConfig(rule.id);
                if (ruleConfig?.enabled) {
                    applicable.push(rule);
                }
            }
        }
        return applicable;
    }

    /**
     * Iteratively traverse the AST and queue diagnostics
     * Uses explicit stack instead of recursion
     */
    traverse(rootNode: ASTNode): void {
        // Use an explicit stack for iterative traversal
        const stack: ASTNode[] = [rootNode];
        
        while (stack.length > 0 && this.diagnostics.length < this.maxDiagnostics) {
            const node = stack.pop()!;
            
            // Count this visited node
            this.visitedNodeCount++;

            // Get applicable rules using index
            const applicableRules = this.getApplicableRules(node);
            
            for (const rule of applicableRules) {
                this.processingQueue.push({ node, rule });
            }

            // Add child nodes to the stack (in reverse order to maintain left-to-right traversal)
            const children = this.getNodeChildren(node);
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push(children[i]);
            }
        }
    }

    /**
     * Extract all child nodes from a given AST node
     * Extracts children from known properties of each node type
     */
    private getNodeChildren(node: ASTNode): ASTNode[] {
        const children: ASTNode[] = [];

        // Iterate over all properties and collect child nodes
        for (const key in node) {
            if (key === 'parent' || key === 'kind' || key === 'uri' || key === 'start' || key === 'end') {
                continue; // Skip metadata properties
            }

            const value = (node as unknown as Record<string, unknown>)[key];
            
            if (value && typeof value === 'object') {
                // Check if it's an ASTNode (has 'kind' property)
                if ('kind' in value && typeof value.kind === 'string') {
                    children.push(value as ASTNode);
                }
                // Check if it's an array of nodes
                else if (Array.isArray(value)) {
                    for (const item of value) {
                        if (item && typeof item === 'object' && 'kind' in item && typeof item.kind === 'string') {
                            children.push(item as ASTNode);
                        }
                    }
                }
            }
        }

        return children;
    }

    /**
     * Process all queued diagnostics in batches
     */
    async waitForCompletion(): Promise<void> {
        const totalItems = this.processingQueue.length;
        
        for (let i = 0; i < totalItems; i += this.BATCH_SIZE) {
            if (this.diagnostics.length >= this.maxDiagnostics) {
                break;
            }

            const batch = this.processingQueue.slice(i, Math.min(i + this.BATCH_SIZE, totalItems));
            await Promise.all(batch.map(item => this.processNodeWithRule(item.node, item.rule)));
        }
    }

    /**
     * Process a single node with a specific rule
     */
    private async processNodeWithRule(node: ASTNode, rule: DiagnosticRule): Promise<void> {
        if (this.diagnostics.length >= this.maxDiagnostics) {
            return;
        }

        const ruleConfig = this.registry.getRuleConfig(rule.id);
        if (!ruleConfig || !ruleConfig.enabled) {
            return;
        }

        try {
            const ruleStartTime = this.enableTiming ? performance.now() : 0;

            const results = await rule.check(node, this.context, ruleConfig);

            // Track which rules found diagnostics for this node
            if (results.length > 0 && this.context.nodeDiagnostics) {
                if (!this.context.nodeDiagnostics.has(node)) {
                    this.context.nodeDiagnostics.set(node, new Set());
                }
                this.context.nodeDiagnostics.get(node)!.add(rule.id);
            }

            if (this.enableTiming) {
                const ruleTime = performance.now() - ruleStartTime;

                this.ruleExecutionTimes.push({
                    ruleId: rule.id,
                    time: ruleTime,
                    diagnosticCount: results.length,
                    skippedCount: this.context.ruleSkipCounts?.get(rule.id) || 0
                });

                // Track time per diagnostic (for breakdown reporting only)
                if (results.length > 0) {
                    const avgTimePerDiagnostic = ruleTime / results.length;
                    for (const result of results) {
                        const diagnostic = this.convertToDiagnostic(result, rule);
                        const location = `Line ${result.range.start.line + 1}:${result.range.start.character}`;
                        this.diagnosticBreakdown.push({
                            ruleId: rule.id,
                            message: result.message,
                            location,
                            time: avgTimePerDiagnostic,
                            diagnostic
                        });
                    }
                }
            }

            // Convert results to diagnostics with deduplication and suppression filtering
            for (const result of results) {
                const diagnostic = this.convertToDiagnostic(result, rule);
                
                // Check if this diagnostic should be suppressed
                const line = diagnostic.range.start.line;
                const isSuppressed = this.context.suppressionMap && 
                    isDiagnosticSuppressed(line, rule.id, this.context.suppressionMap);
                
                if (isSuppressed) {
                    continue; // Skip suppressed diagnostics
                }
                
                // Deduplicate during collection instead of after
                const key = this.getDiagnosticKey(diagnostic);
                if (!this.diagnosticKeys.has(key)) {
                    this.diagnosticKeys.add(key);
                    this.diagnostics.push(diagnostic);
                    
                    // Stop if we've reached the max diagnostics limit
                    if (this.diagnostics.length >= this.maxDiagnostics) {
                        break;
                    }
                }
            }

        } catch (error) {
            Logger.error(`Error executing diagnostic rule '${rule.id}':`, error);

            // Add a diagnostic about the rule failure
            this.diagnostics.push({
                severity: DiagnosticSeverity.Error,
                message: `Internal error in diagnostic rule '${rule.name}': ${error}`,
                range: {
                    start: this.context.document.positionAt(0),
                    end: this.context.document.positionAt(0)
                },
                source: 'enscript.engine'
            });
        }
    }

    /**
     * Generate a unique key for a diagnostic (faster than JSON.stringify)
     */
    private getDiagnosticKey(diagnostic: Diagnostic): string {
        return `${diagnostic.range.start.line}:${diagnostic.range.start.character}-${diagnostic.range.end.line}:${diagnostic.range.end.character}|${diagnostic.message}|${diagnostic.code || ''}|${diagnostic.source || ''}`;
    }

    /**
     * Get the total number of nodes actually visited by this visitor
     */
    getVisitedNodeCount(): number {
        return this.visitedNodeCount;
    }
}
