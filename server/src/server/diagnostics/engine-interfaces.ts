/**
 * Diagnostic Engine Interfaces
 * 
 * Abstractions for the diagnostic engine and its factory.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver';
import { FileNode } from '../ast/node-types';
import { DiagnosticRuleContext, DiagnosticCategory } from './rules';
import { DiagnosticRuleRegistry } from './registry';

/**
 * Configuration options for the diagnostic engine
 */
export interface DiagnosticEngineOptions {
    /** Custom rule registry to use (defaults to global registry) */
    registry?: DiagnosticRuleRegistry;
    /** Maximum number of diagnostics to return per document */
    maxDiagnostics?: number;
    /** Categories of rules to run (all by default) */
    enabledCategories?: DiagnosticCategory[];
    /** Whether to include rule timing information */
    enableTiming?: boolean;
}

/**
 * Performance metrics for diagnostic execution
 */
export interface DiagnosticPerformanceMetrics {
    totalTime: number;
    ruleExecutionTimes: Array<{
        ruleId: string;
        time: number;
        diagnosticCount: number;
        skippedCount?: number;
    }>;
    nodeCount: number;
    diagnosticBreakdown?: Array<{
        ruleId: string;
        message: string;
        location: string;
        time: number;
    }>;
}

/**
 * Interface for the diagnostic engine
 */
export interface IDiagnosticEngine {
    /**
     * Run diagnostics on a document
     */
    runDiagnostics(
        document: TextDocument,
        ast: FileNode,
        context: Omit<DiagnosticRuleContext, 'document' | 'ast'>
    ): Promise<{
        diagnostics: Diagnostic[];
        metrics?: DiagnosticPerformanceMetrics;
    }>;

    /**
     * Update engine options
     */
    updateOptions(options: Partial<DiagnosticEngineOptions>): void;

    /**
     * Get current engine statistics
     */
    getStats(): {
        totalRules: number;
        enabledRules: number;
        enabledCategories: DiagnosticCategory[];
    };
}

/**
 * Factory interface for creating diagnostic engines
 */
export interface IDiagnosticEngineFactory {
    /**
     * Create a new diagnostic engine with the given options
     */
    create(options?: DiagnosticEngineOptions): IDiagnosticEngine;
}
