import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticRelatedInformation, DiagnosticTag, DiagnosticSeverity } from 'vscode-languageserver';
import { ASTNode, FileNode, ClassDeclNode } from '../ast';
import { ITypeResolver } from '../types/type-resolver-interfaces';

/**
 * Diagnostic category for grouping related diagnostics
 */
export enum DiagnosticCategory {
    SYNTAX = 'syntax',
    SEMANTIC = 'semantic',
    TYPE = 'type',
    STYLE = 'style',
    PERFORMANCE = 'performance',
    SECURITY = 'security',
    BEST_PRACTICE = 'bestPractice'
}

/**
 * Configuration options for diagnostic rules
 */
export interface DiagnosticRuleConfig {
    enabled: boolean;
    severity?: DiagnosticSeverity;
    [key: string]: unknown; // Allow rule-specific configuration
}

/**
 * Cached results for expensive computations that can be shared across rules
 */
export interface DiagnosticSharedCache {
    /** Cache for containing class lookups: Map<node, ClassDeclNode | null> */
    containingClassCache?: Map<ASTNode, ClassDeclNode | null>;
    /** Cache for expression type resolution: Map<node, ResolvedType | null> */
    expressionTypeCache?: Map<ASTNode, { typeName: string; isStaticAccess: boolean; isSuperAccess: boolean } | null>;
    /** Cache for enum name checks: Map<name, boolean> */
    enumNameCache?: Map<string, boolean>;
    /** Cache for class definitions: Map<className, ClassDeclNode[]> */
    classDefinitionsCache?: Map<string, ClassDeclNode[]>;
    /** Cache for resolved object types: Map<objectName, typeName | null> */
    objectTypeCache?: Map<string, string | null>;
    /** Cache for member existence: Map<className:memberName:isStatic, boolean> */
    memberExistenceCache?: Map<string, boolean>;
    /** Cache for type existence: Map<typeName, boolean> */
    typeExistenceCache?: Map<string, boolean>;
}

/**
 * Context provided to diagnostic rules during execution
 */
export interface DiagnosticRuleContext {
    document: TextDocument;
    ast: FileNode; // Pre-parsed AST for the document being analyzed
    workspaceRoot: string;
    includePaths: string[];
    loadClassFromIncludePaths?: (className: string) => Promise<void>;
    typeResolver?: ITypeResolver; // NewTypeResolver instance if available
    openedDocumentUris?: Set<string>; // URIs of documents currently opened in the editor
    /**
     * Map tracking which rules have found diagnostics for specific nodes.
     * Key: node reference, Value: Set of rule IDs that found issues
     * This allows rules to skip checking if a more specific rule already handled the node.
     */
    nodeDiagnostics?: Map<ASTNode, Set<string>>;
    /**
     * Map tracking how many times each rule skipped due to other rules.
     * Key: rule ID, Value: skip count
     */
    ruleSkipCounts?: Map<string, number>;
    /**
     * Shared cache for expensive computations that can be reused across rules
     */
    sharedCache?: DiagnosticSharedCache;
}

/**
 * Result from executing a diagnostic rule
 */
export interface DiagnosticRuleResult {
    severity: DiagnosticSeverity;
    message: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    code?: string | number;
    source?: string;
    relatedInformation?: DiagnosticRelatedInformation[];
    tags?: DiagnosticTag[];
    data?: unknown;
}

/**
 * An actionable suggestion for fixing a diagnostic issue
 */
export interface DiagnosticSuggestion {
    /** Human-readable title for the suggestion */
    title: string;

    /** The new text to replace the error range with */
    newText?: string;

    /** Custom range to replace (if different from diagnostic range) */
    range?: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };

    /** Additional data for the suggestion */
    data?: unknown;
}

/**
 * Base interface for all diagnostic rules
 */
export interface DiagnosticRule {
    /** Unique identifier for this rule */
    readonly id: string;

    /** Human-readable name for this rule */
    readonly name: string;

    /** Description of what this rule checks */
    readonly description: string;

    /** Category this rule belongs to */
    readonly category: DiagnosticCategory;

    /** Default severity level */
    readonly defaultSeverity: DiagnosticSeverity;

    /** Default configuration for this rule */
    readonly defaultConfig: DiagnosticRuleConfig;

    /**
     * Check if this rule applies to the given node type
     */
    appliesToNode(node: ASTNode): boolean;

    /**
     * Execute the diagnostic check on a node
     */
    check(node: ASTNode, context: DiagnosticRuleContext, config: DiagnosticRuleConfig): Promise<DiagnosticRuleResult[]>;

    /**
     * Get documentation for this rule
     */
    getDocumentation?(): string;

    /**
     * Get fix suggestions for diagnostics produced by this rule
     */
    getSuggestions?(node: ASTNode, context: DiagnosticRuleContext): string[];

    /**
     * Get actionable suggestions for fixing diagnostics produced by this rule
     */
    getActionableSuggestions?(diagnostic: DiagnosticRuleResult, node: ASTNode, context: DiagnosticRuleContext): DiagnosticSuggestion[];
}

/**
 * Abstract base class for diagnostic rules providing common functionality
 */
export abstract class BaseDiagnosticRule implements DiagnosticRule {
    abstract readonly id: string;
    abstract readonly name: string;
    abstract readonly description: string;
    abstract readonly category: DiagnosticCategory;
    abstract readonly defaultSeverity: DiagnosticSeverity;

    get defaultConfig(): DiagnosticRuleConfig {
        return {
            enabled: true,
            severity: this.defaultSeverity
        };
    }

    /**
     * Helper method to create a diagnostic result
     */
    protected createDiagnostic(
        message: string,
        start: { line: number; character: number },
        end: { line: number; character: number },
        severity?: DiagnosticSeverity,
        code?: string | number
    ): DiagnosticRuleResult {
        return {
            severity: severity || this.defaultSeverity,
            message,
            range: { start, end },
            code,
            source: `enscript.${this.category}`
        };
    }

    /**
     * Helper method to convert document positions
     */
    protected getPosition(document: TextDocument, offset: number): { line: number; character: number } {
        return document.positionAt(offset);
    }

    /**
     * Check if another rule has already found a diagnostic for this node.
     * This allows rules to skip checking if a more specific rule already handled the node.
     * 
     * @param node - The AST node to check
     * @param context - Diagnostic rule context containing node tracking
     * @param ruleIds - Array of rule IDs to check (e.g., ['undeclared-method', 'undeclared-enum-member'])
     * @returns true if any of the specified rules found a diagnostic for this node
     */
    protected shouldSkipDueToOtherRule(
        node: ASTNode,
        context: DiagnosticRuleContext,
        ruleIds: string[]
    ): boolean {
        if (!context.nodeDiagnostics) {
            return false;
        }

        const rulesForNode = context.nodeDiagnostics.get(node);
        if (!rulesForNode) {
            return false;
        }

        // Check if any of the specified rules found a diagnostic for this node
        const shouldSkip = ruleIds.some(ruleId => rulesForNode.has(ruleId));
        
        // Track skip count for performance metrics
        if (shouldSkip && context.ruleSkipCounts) {
            const currentCount = context.ruleSkipCounts.get(this.id) || 0;
            context.ruleSkipCounts.set(this.id, currentCount + 1);
        }
        
        return shouldSkip;
    }

    abstract appliesToNode(node: ASTNode): boolean;
    abstract check(node: ASTNode, context: DiagnosticRuleContext, config: DiagnosticRuleConfig): Promise<DiagnosticRuleResult[]>;
}

