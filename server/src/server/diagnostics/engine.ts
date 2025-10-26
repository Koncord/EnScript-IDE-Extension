import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import {
    DiagnosticRule,
    DiagnosticRuleContext,
    DiagnosticRuleResult,
    DiagnosticCategory
} from './rules';
import { DiagnosticRuleRegistry, globalDiagnosticRegistry } from './registry';
import { ASTNode, FileNode, Declaration } from '../ast';
import type {
    FunctionDeclNode,
    MethodDeclNode,
    BlockStatement,
    WhileStatement,
    ForStatement,
    ClassDeclNode,
    EnumDeclNode
} from '../ast/node-types';
import { Logger } from '../../util/logger';
import { isAssignmentExpression, isBinaryExpression, isBlockStatement, isCallExpression, isClass, isEnum, isExpression, isForEachStatement, isForStatement, isFunction, isIfStatement, isMemberExpression, isMethod, isWhileStatement } from '../../util';
import {
    IDiagnosticEngine,
    DiagnosticEngineOptions,
    DiagnosticPerformanceMetrics
} from './engine-interfaces';

/**
 * Main diagnostic engine that executes rules against AST nodes
 */
export class DiagnosticEngine implements IDiagnosticEngine {
    private registry: DiagnosticRuleRegistry;
    private options: Required<DiagnosticEngineOptions>;

    constructor(options: DiagnosticEngineOptions = {}) {
        this.registry = options.registry ?? globalDiagnosticRegistry;
        this.options = {
            registry: this.registry,
            maxDiagnostics: options.maxDiagnostics ?? 1000,
            enabledCategories: options.enabledCategories ?? Object.values(DiagnosticCategory),
            enableTiming: options.enableTiming ?? false
        };
    }

    /**
     * Run diagnostics on a document
     */
    async runDiagnostics(
        document: TextDocument,
        ast: FileNode,
        context: Omit<DiagnosticRuleContext, 'document' | 'ast'>
    ): Promise<{
        diagnostics: Diagnostic[];
        metrics?: DiagnosticPerformanceMetrics;
    }> {
        const startTime = this.options.enableTiming ? performance.now() : 0;

        // Initialize node diagnostics tracking map
        const nodeDiagnostics = new Map<ASTNode, Set<string>>();
        const ruleSkipCounts = new Map<string, number>();
        const sharedCache = {
            containingClassCache: new Map(),
            expressionTypeCache: new Map(),
            enumNameCache: new Map()
        };
        const ruleContext: DiagnosticRuleContext = { ...context, document, ast, nodeDiagnostics, ruleSkipCounts, sharedCache };

        const diagnostics: Diagnostic[] = [];
        const ruleExecutionTimes: Array<{ ruleId: string; time: number; diagnosticCount: number; skippedCount?: number }> = [];
        const diagnosticBreakdown: Array<{ ruleId: string; message: string; location: string; time: number; diagnostic: Diagnostic }> = [];
        let nodeCount = 0;

        // Get applicable rules
        const rules = this.getApplicableRules();

        // Process all nodes in the AST
        await this.processNodes(ast.body, ruleContext, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
        nodeCount = this.countNodes(ast.body);

        // Diagnostic engine completed

        // Deduplicate diagnostics before limiting count
        const uniqueDiagnostics = this.deduplicateDiagnostics(diagnostics);
        diagnostics.length = 0;
        diagnostics.push(...uniqueDiagnostics);

        // Limit number of diagnostics
        if (diagnostics.length > this.options.maxDiagnostics) {
            diagnostics.splice(this.options.maxDiagnostics);
        }

        const result: {
            diagnostics: Diagnostic[];
            metrics?: DiagnosticPerformanceMetrics;
        } = { diagnostics };

        if (this.options.enableTiming) {
            const totalTime = performance.now() - startTime;
            
            // Aggregate diagnostics by unique diagnostic (deduplicating based on location and message)
            const diagnosticTimeMap = new Map<string, { ruleId: string; message: string; location: string; time: number }>();
            for (const item of diagnosticBreakdown) {
                const key = `${item.ruleId}|${item.location}|${item.message}`;
                const existing = diagnosticTimeMap.get(key);
                if (existing) {
                    existing.time += item.time;
                } else {
                    diagnosticTimeMap.set(key, {
                        ruleId: item.ruleId,
                        message: item.message,
                        location: item.location,
                        time: item.time
                    });
                }
            }
            
            result.metrics = {
                totalTime,
                ruleExecutionTimes,
                nodeCount,
                diagnosticBreakdown: Array.from(diagnosticTimeMap.values()).sort((a, b) => b.time - a.time)
            };
        }

        return result;
    }

    /**
     * Process nodes recursively
     */
    private async processNodes(
        nodes: ASTNode[],
        context: DiagnosticRuleContext,
        rules: DiagnosticRule[],
        diagnostics: Diagnostic[],
        ruleExecutionTimes: Array<{ ruleId: string; time: number; diagnosticCount: number; skippedCount?: number }>,
        diagnosticBreakdown: Array<{ ruleId: string; message: string; location: string; time: number; diagnostic: Diagnostic }>
    ): Promise<void> {
        for (const node of nodes) {
            await this.processNode(node, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);

            // Process child nodes if any
            await this.processChildNodes(node, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
        }
    }

    /**
     * Process child nodes based on node type
     */
    private async processChildNodes(
        node: ASTNode,
        context: DiagnosticRuleContext,
        rules: DiagnosticRule[],
        diagnostics: Diagnostic[],
        ruleExecutionTimes: Array<{ ruleId: string; time: number; diagnosticCount: number; skippedCount?: number }>,
        diagnosticBreakdown: Array<{ ruleId: string; message: string; location: string; time: number; diagnostic: Diagnostic }>
    ): Promise<void> {
        // Process different types of child nodes based on the NEW AST structure
        if (isClass(node) || isEnum(node)) {
            const symbolNode = node as ClassDeclNode | EnumDeclNode;
            if (symbolNode.members) {
                await this.processNodes(symbolNode.members, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
        } else if (isFunction(node) || isMethod(node)) {

            // Process function parameters (for type checking)
            if (node.parameters) {
                await this.processNodes(node.parameters, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }

            // Process function locals (variable declarations)
            if (node.locals) {
                await this.processNodes(node.locals, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }

            if (isBlockStatement(node.body)) {
                const blockStmt = node.body as BlockStatement;
                if (blockStmt.body && Array.isArray(blockStmt.body)) {
                    await this.processStatements(blockStmt.body, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                }
            }
        } else if (isBlockStatement(node)) {
            if (node.body && Array.isArray(node.body)) {
                await this.processStatements(node.body, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
        } else if (isExpression(node)) {
            if (node.expression) {
                await this.processNode(node.expression, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                await this.processChildNodes(node.expression, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
        } else if (isIfStatement(node)) {
            if (node.test) {
                await this.processNode(node.test, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                await this.processChildNodes(node.test, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
            if (node.consequent) {
                await this.processNode(node.consequent, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                await this.processChildNodes(node.consequent, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
            if (node.alternate) {
                await this.processNode(node.alternate, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                await this.processChildNodes(node.alternate, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
        } else if (isWhileStatement(node) || isForStatement(node)) {
            const loopStmt = node as WhileStatement | ForStatement;
            if (loopStmt.test) {
                await this.processNode(loopStmt.test, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                await this.processChildNodes(loopStmt.test, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
            if (loopStmt.body) {
                await this.processNode(loopStmt.body, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                await this.processChildNodes(loopStmt.body, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
            if (isForStatement(node)) {
                if (node.init) {
                    await this.processNode(node.init, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                    await this.processChildNodes(node.init, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                }
                if (node.update) {
                    await this.processNode(node.update, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                    await this.processChildNodes(node.update, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                }
            }
        } else if (isForEachStatement(node)) {
            if (node.variables && Array.isArray(node.variables)) {
                for (const variable of node.variables) {
                    await this.processNode(variable, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                    await this.processChildNodes(variable, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                }
            }
            if (node.iterable) {
                await this.processNode(node.iterable, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                await this.processChildNodes(node.iterable, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
            if (node.body) {
                await this.processNode(node.body, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                await this.processChildNodes(node.body, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
        } else if (isCallExpression(node)) {
            if (node.callee) {
                await this.processNode(node.callee, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                await this.processChildNodes(node.callee, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
            if (node.arguments && Array.isArray(node.arguments)) {
                for (const arg of node.arguments) {
                    await this.processNode(arg, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                    await this.processChildNodes(arg, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                }
            }
        } else if (isMemberExpression(node)) {
            if (node.object) {
                await this.processNode(node.object, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                await this.processChildNodes(node.object, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
            if (node.property) {
                await this.processNode(node.property, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                await this.processChildNodes(node.property, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
        } else if (isBinaryExpression(node) || isAssignmentExpression(node)) {
            if (node.left) {
                await this.processNode(node.left, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                await this.processChildNodes(node.left, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
            if (node.right) {
                await this.processNode(node.right, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
                await this.processChildNodes(node.right, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            }
        }
    }

    /**
     * Process an array of statements (NEW AST structure)
     */
    private async processStatements(
        statements: ASTNode[],
        context: DiagnosticRuleContext,
        rules: DiagnosticRule[],
        diagnostics: Diagnostic[],
        ruleExecutionTimes: Array<{ ruleId: string; time: number; diagnosticCount: number; skippedCount?: number }>,
        diagnosticBreakdown: Array<{ ruleId: string; message: string; location: string; time: number; diagnostic: Diagnostic }>
    ): Promise<void> {
        for (const stmt of statements) {
            await this.processNode(stmt, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
            await this.processChildNodes(stmt, context, rules, diagnostics, ruleExecutionTimes, diagnosticBreakdown);
        }
    }

    /**
     * Process a single node with all applicable rules
     */
    private async processNode(
        node: ASTNode,
        context: DiagnosticRuleContext,
        rules: DiagnosticRule[],
        diagnostics: Diagnostic[],
        ruleExecutionTimes: Array<{ ruleId: string; time: number; diagnosticCount: number; skippedCount?: number }>,
        diagnosticBreakdown: Array<{ ruleId: string; message: string; location: string; time: number; diagnostic: Diagnostic }>
    ): Promise<void> {
        for (const rule of rules) {
            if (!rule.appliesToNode(node)) {
                continue;
            }

            const ruleConfig = this.registry.getRuleConfig(rule.id);
            if (!ruleConfig || !ruleConfig.enabled) {
                continue;
            }

            try {
                const ruleStartTime = this.options.enableTiming ? performance.now() : 0;

                const results = await rule.check(node, context, ruleConfig);

                // Track which rules found diagnostics for this node
                if (results.length > 0 && context.nodeDiagnostics) {
                    if (!context.nodeDiagnostics.has(node)) {
                        context.nodeDiagnostics.set(node, new Set());
                    }
                    context.nodeDiagnostics.get(node)!.add(rule.id);
                }

                if (this.options.enableTiming) {
                    const ruleTime = performance.now() - ruleStartTime;
                    const avgTimePerDiagnostic = results.length > 0 ? ruleTime / results.length : ruleTime;

                    ruleExecutionTimes.push({
                        ruleId: rule.id,
                        time: ruleTime,
                        diagnosticCount: results.length,
                        skippedCount: context.ruleSkipCounts?.get(rule.id) || 0
                    });

                    // Track time per diagnostic
                    for (const result of results) {
                        const diagnostic = this.convertToDiagnostic(result, rule);
                        const location = `Line ${result.range.start.line + 1}:${result.range.start.character}`;
                        diagnosticBreakdown.push({
                            ruleId: rule.id,
                            message: result.message,
                            location,
                            time: avgTimePerDiagnostic,
                            diagnostic
                        });
                    }
                }

                // Convert results to diagnostics
                for (const result of results) {
                    diagnostics.push(this.convertToDiagnostic(result, rule));
                }

                // Stop if we've reached the max diagnostics limit
                if (diagnostics.length >= this.options.maxDiagnostics) {
                    break;
                }

            } catch (error) {
                Logger.error(`Error executing diagnostic rule '${rule.id}':`, error);

                // Add a diagnostic about the rule failure
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    message: `Internal error in diagnostic rule '${rule.name}': ${error}`,
                    range: {
                        start: context.document.positionAt(0),
                        end: context.document.positionAt(0)
                    },
                    source: 'enscript.engine'
                });
            }
        }
    }

    /**
     * Get rules that should run based on configuration
     */
    private getApplicableRules(): DiagnosticRule[] {
        return this.registry
            .getAllRules()
            .filter(rule => {
                // Check if rule category is enabled
                if (!this.options.enabledCategories.includes(rule.category)) {
                    return false;
                }

                // Check if rule is enabled
                const config = this.registry.getRuleConfig(rule.id);
                return config?.enabled ?? true;
            });
    }

    /**
     * Convert a rule result to a Language Server Protocol diagnostic
     */
    private convertToDiagnostic(result: DiagnosticRuleResult, rule: DiagnosticRule): Diagnostic {
        return {
            severity: result.severity,
            message: result.message,
            range: result.range,
            code: result.code,
            source: result.source || `enscript.${rule.category}`,
            relatedInformation: result.relatedInformation,
            tags: result.tags,
            data: result.data
        };
    }

    /**
     * Deduplicate diagnostics based on location, message, and code
     */
    private deduplicateDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
        const seen = new Set<string>();
        const unique: Diagnostic[] = [];

        for (const diagnostic of diagnostics) {
            // Create a unique key based on location, message, code, and source
            const key = JSON.stringify({
                line: diagnostic.range.start.line,
                character: diagnostic.range.start.character,
                endLine: diagnostic.range.end.line,
                endCharacter: diagnostic.range.end.character,
                message: diagnostic.message,
                code: diagnostic.code,
                source: diagnostic.source
            });

            if (!seen.has(key)) {
                seen.add(key);
                unique.push(diagnostic);
            }
        }

        if (diagnostics.length > unique.length) {
            Logger.debug(`🔧 Deduplicated ${diagnostics.length - unique.length} duplicate diagnostic(s)`);
        }

        return unique;
    }

    /**
     * Count total nodes in AST for metrics
     */
    private countNodes(nodes: ASTNode[]): number {
        let count = nodes.length;

        for (const node of nodes) {
            if (isClass(node) || isEnum(node)) {
                const symbolNode = node as Declaration & { members: ASTNode[] };
                if (symbolNode.members) {
                    count += this.countNodes(symbolNode.members);
                }
            } else if (isFunction(node) || isMethod(node)) {
                const funcNode = node as FunctionDeclNode | MethodDeclNode;

                if (funcNode.parameters) {
                    count += this.countNodes(funcNode.parameters);
                }

                if (funcNode.locals) {
                    count += this.countNodes(funcNode.locals);
                }

                if (isBlockStatement(funcNode.body)) {
                    const blockStmt = funcNode.body as BlockStatement;
                    if (blockStmt.body && Array.isArray(blockStmt.body)) {
                        count += this.countNodes(blockStmt.body);
                    }
                }
            }
        }

        return count;
    }

    /**
     * Update engine options
     */
    updateOptions(options: Partial<DiagnosticEngineOptions>): void {
        this.options = { ...this.options, ...options };
        if (options.registry) {
            this.registry = options.registry;
        }
    }

    /**
     * Get current engine statistics
     */
    getStats(): {
        totalRules: number;
        enabledRules: number;
        enabledCategories: DiagnosticCategory[];
    } {
        const registryStats = this.registry.getStats();
        return {
            totalRules: registryStats.totalRules,
            enabledRules: registryStats.enabledRules,
            enabledCategories: this.options.enabledCategories
        };
    }
}

