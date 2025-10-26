import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver';
import {
    FileNode
} from '../parser/parser';
import { IDiagnosticEngine, IDiagnosticEngineFactory } from '../diagnostics/engine-interfaces';
import { globalDiagnosticRegistry } from '../diagnostics/registry';
import { registerBuiltInRules } from '../diagnostics/rules/index';
import { globalDiagnosticConfig } from '../diagnostics/configuration';

import { Logger } from '../../util/logger';
import { ITypeResolver } from '../types/type-resolver-interfaces';
import { IDiagnosticsProvider } from './diagnostics-provider-interfaces';
import { IDocumentCacheManager } from '../cache/document-cache-interfaces';
import { IWorkspaceManager } from '../workspace/workspace-interfaces';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/tokens';

@injectable()
export class DiagnosticsProvider implements IDiagnosticsProvider {
    // Cache for function existence to avoid repeated searches (keyed by document version)
    private functionExistenceCache = new Map<string, boolean>();
    private functionCacheVersion = 0;

    // Diagnostic engine
    private diagnosticEngine!: IDiagnosticEngine;

    constructor(
        @inject(TYPES.IDocumentCacheManager) private cacheManager: IDocumentCacheManager,
        @inject(TYPES.ITypeResolver) private typeResolver: ITypeResolver,
        @inject(TYPES.IWorkspaceManager) private workspaceManager: IWorkspaceManager,
        @inject(TYPES.IDiagnosticEngineFactory) private diagnosticEngineFactory: IDiagnosticEngineFactory
    ) {
        // Initialize the diagnostic engine
        this.initializeDiagnosticEngine();
    }

    /**
     * Initialize the new diagnostic engine with built-in rules
     */
    private initializeDiagnosticEngine(): void {
        // Register built-in rules if not already registered
        if (globalDiagnosticRegistry.getRuleIds().length === 0) {
            registerBuiltInRules(globalDiagnosticRegistry);
        }

        // Get configuration
        const config = globalDiagnosticConfig.getConfiguration();

        // Create the diagnostic engine with configuration using the factory
        this.diagnosticEngine = this.diagnosticEngineFactory.create({
            registry: globalDiagnosticRegistry,
            maxDiagnostics: config.maxDiagnosticsPerFile,
            enabledCategories: config.enabledCategories,
            enableTiming: config.enableTiming
        });

        // Listen for configuration changes
        globalDiagnosticConfig.onConfigurationChanged((newConfig) => {
            // Update engine options
            this.diagnosticEngine.updateOptions({
                maxDiagnostics: newConfig.maxDiagnosticsPerFile,
                enabledCategories: newConfig.enabledCategories,
                enableTiming: newConfig.enableTiming
            });
        });
    }

    incrementFunctionCacheVersion(): void {
        this.functionCacheVersion++;
    }

    clearFunctionExistenceCache(): void {
        this.functionExistenceCache.clear();
    }



    /**
     * Get the diagnostic engine instance for advanced configuration
     */
    getDiagnosticEngine(): IDiagnosticEngine {
        return this.diagnosticEngine;
    }

    /**
     * Get diagnostic statistics
     */
    getDiagnosticStats(): { engineStats: unknown; registryStats: unknown } {
        return {
            engineStats: this.diagnosticEngine.getStats(),
            registryStats: globalDiagnosticRegistry.getStats()
        };
    }

    async runDiagnostics(doc: TextDocument): Promise<Diagnostic[]> {
        // Check if diagnostics are globally disabled
        const config = globalDiagnosticConfig.getConfiguration();
        if (!config.enabled) {
            Logger.warn(`🚫 Diagnostics are globally disabled`);
            return [];
        }

        // Check if file should be excluded
        if (globalDiagnosticConfig.shouldExcludeFile(doc.uri)) {
            Logger.debug(`🚫 File excluded by configuration: ${doc.uri}`);
            return [];
        }

        // Note: Diagnostics will be filtered by the VS Code extension client-side
        // based on whether the file is in a pinned tab or not
        Logger.debug(`📝 Running diagnostics for: ${doc.uri}`);

        const ast = this.cacheManager.ensureDocumentParsed(doc);
        
        Logger.info(`🚀 Running diagnostics for version ${doc.version}...`);
        Logger.info(`📋 AST has ${ast.body.length} top-level nodes`);
        
        return await this.runDiagnosticsWithEngine(doc, ast);
    }

    /**
     * Get parsing errors from the analyzer for the specified document
     */
    private getParsingErrorsFromAnalyzer(uri: string): Diagnostic[] {
        // Check if parsing error diagnostics are enabled
        const config = globalDiagnosticConfig.getConfiguration();
        const parsingErrorConfig = config.rules['parsing-errors'];

        if (!parsingErrorConfig || !parsingErrorConfig.enabled) {
            Logger.warn(`⚠️ Parsing error diagnostics are disabled`);
            return [];
        }

        // Access parsing errors through the cache manager
        const errors = this.cacheManager.getParsingErrors(uri);

        // Apply severity override if configured
        if (parsingErrorConfig.severity && errors.length > 0) {
            return errors.map((error: Diagnostic) => ({
                ...error,
                severity: parsingErrorConfig.severity
            }));
        }

        return errors;
    }

    /**
     * Run diagnostics using the diagnostic engine
     */
    private async runDiagnosticsWithEngine(doc: TextDocument, ast: FileNode): Promise<Diagnostic[]> {
        try {
            // Get opened documents from workspace manager
            const openedDocuments = this.workspaceManager.getOpenedDocuments();
            
            // Get workspace configuration
            const workspaceRoot = this.workspaceManager.getWorkspaceRoot();
            const includePaths = this.workspaceManager.getIncludePaths();
            
            // Get class discovery for loading classes
            const classDiscovery = this.workspaceManager.getClassDiscovery();
            
            const context = {
                workspaceRoot,
                includePaths,
                ensureDocumentParsed: (doc: TextDocument): FileNode => {
                    const file = this.cacheManager.ensureDocumentParsed(doc);
                    return {
                        kind: 'File',
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        body: file.body.map((node: any) => node as any), // Type cast for compatibility
                        version: file.version,
                        uri: doc.uri,
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 0 }
                    };
                },
                loadClassFromIncludePaths: async (className: string) => {
                    await classDiscovery.loadClassFromIncludePaths(className, includePaths);
                },
                typeResolver: this.typeResolver,
                openedDocumentUris: openedDocuments
            };



            // Convert File to FileNode for compatibility
            const fileNode: FileNode = {
                kind: 'File',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                body: ast.body.map(node => node as any), // Type cast for compatibility
                version: ast.version,
                uri: doc.uri,
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 }
            };

            const result = await this.diagnosticEngine.runDiagnostics(doc, fileNode, context);

            // Get parsing errors from the analyzer and add them to the diagnostic results
            const parsingErrors = this.getParsingErrorsFromAnalyzer(doc.uri);
            const allDiagnostics = [...parsingErrors, ...result.diagnostics];

            Logger.info(`✅ Diagnostics complete: ${allDiagnostics.length} total diagnostics generated (${parsingErrors.length} parsing errors, ${result.diagnostics.length} analysis diagnostics)`);
            
            if (parsingErrors.length > 0) {
                Logger.info(`🔍 Parsing errors details:`, parsingErrors.map(e => `Line ${e.range.start.line + 1}: ${e.message}`));
            }

            if (result.metrics) {
                Logger.debug(`📊 Performance metrics:`, {
                    totalTime: `${result.metrics.totalTime.toFixed(2)}ms`,
                    nodeCount: result.metrics.nodeCount,
                    rulesExecuted: result.metrics.ruleExecutionTimes.length
                });
                
                // Log per-diagnostic performance if we have breakdown data
                if (result.metrics.diagnosticBreakdown && result.metrics.diagnosticBreakdown.length > 0) {
                    Logger.debug(`📊 Diagnostic breakdown (top 20 slowest):`);
                    const topDiagnostics = result.metrics.diagnosticBreakdown.slice(0, 20);
                    topDiagnostics.forEach((diag, index) => {
                        Logger.debug(`   ${index + 1}. [${diag.ruleId}] ${diag.time.toFixed(2)}ms - ${diag.location}: ${diag.message.substring(0, 80)}${diag.message.length > 80 ? '...' : ''}`);
                    });
                    
                    if (result.metrics.diagnosticBreakdown.length > 20) {
                        Logger.debug(`   ... and ${result.metrics.diagnosticBreakdown.length - 20} more diagnostics`);
                    }
                }
                
                // Aggregate and log per-rule summary
                if (result.metrics.ruleExecutionTimes.length > 0) {
                    const totalWallClockTime = result.metrics.totalTime;
                    
                    // Aggregate by rule ID
                    const ruleMap = new Map<string, { totalTime: number; totalDiagnostics: number; totalSkipped: number; invocations: number }>();
                    for (const execution of result.metrics.ruleExecutionTimes) {
                        const existing = ruleMap.get(execution.ruleId);
                        if (existing) {
                            existing.totalTime += execution.time;
                            existing.totalDiagnostics += execution.diagnosticCount;
                            existing.totalSkipped += execution.skippedCount || 0;
                            existing.invocations++;
                        } else {
                            ruleMap.set(execution.ruleId, {
                                totalTime: execution.time,
                                totalDiagnostics: execution.diagnosticCount,
                                totalSkipped: execution.skippedCount || 0,
                                invocations: 1
                            });
                        }
                    }
                    
                    // Sort by total time and display
                    const aggregatedRules = Array.from(ruleMap.entries())
                        .map(([ruleId, stats]) => ({ ruleId, ...stats }))
                        .sort((a, b) => b.totalTime - a.totalTime);
                    
                    // Calculate total CPU time
                    const totalCpuTime = aggregatedRules.reduce((sum, rule) => sum + rule.totalTime, 0);
                    const parallelismFactor = (totalCpuTime / totalWallClockTime).toFixed(1);
                    
                    Logger.debug(`📊 Rule performance summary (CPU time, runs in parallel):`);
                    Logger.debug(`   Total wall-clock time: ${totalWallClockTime.toFixed(2)}ms`);
                    Logger.debug(`   Total CPU time: ${totalCpuTime.toFixed(2)}ms (${parallelismFactor}x parallelism)`);
                    Logger.debug(``);
                    aggregatedRules.forEach(rule => {
                        const skipInfo = rule.totalSkipped > 0 ? `, ${rule.totalSkipped} skipped` : '';
                        const avgTime = (rule.totalTime / rule.invocations).toFixed(2);
                        Logger.debug(`   ${rule.ruleId}: ${rule.totalTime.toFixed(2)}ms total, ${avgTime}ms avg (${rule.totalDiagnostics} diagnostics, ${rule.invocations} invocations${skipInfo})`);
                    });
                    
                    // Log detailed UndeclaredFunction performance stats if available
                    try {
                        // Import the rule to access its performance logging
                        const { UndeclaredFunctionRule } = await import('../diagnostics/rules/undeclared-function');
                        UndeclaredFunctionRule.logPerformanceStats();
                        // Reset stats for next diagnostic run
                        UndeclaredFunctionRule.resetPerformanceStats();
                    } catch {
                        // Ignore errors - this is just debug logging
                    }
                }
            }

            return allDiagnostics;
        } catch (error) {
            Logger.error(`❌ Error in diagnostics:`, error);
            Logger.error(`❌ Error message:`, error instanceof Error ? error.message : 'Unknown error');
            Logger.error(`❌ Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
            return [];
        }
    }
}
