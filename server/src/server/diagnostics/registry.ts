import { DiagnosticRule, DiagnosticRuleConfig, DiagnosticCategory } from './rules';

/**
 * Rule registration options
 */
export interface RuleRegistrationOptions {
    /** Priority for rule execution (higher values run first) */
    priority?: number;
    /** Whether to replace an existing rule with the same ID */
    replace?: boolean;
    /** Default configuration override for this rule */
    config?: Partial<DiagnosticRuleConfig>;
}

/**
 * Registry for managing diagnostic rules
 */
export class DiagnosticRuleRegistry {
    private rules = new Map<string, {
        rule: DiagnosticRule;
        priority: number;
        config: DiagnosticRuleConfig;
    }>();

    private sortedRuleCache: DiagnosticRule[] | null = null;

    /**
     * Register a diagnostic rule
     */
    register(rule: DiagnosticRule, options: RuleRegistrationOptions = {}): void {
        const existing = this.rules.get(rule.id);

        if (existing && !options.replace) {
            throw new Error(`Rule with ID '${rule.id}' is already registered. Use { replace: true } to override.`);
        }

        const priority = options.priority ?? 100;
        const config = { ...rule.defaultConfig, ...options.config };

        this.rules.set(rule.id, { rule, priority, config });
        this.sortedRuleCache = null; // Invalidate cache
    }

    /**
     * Unregister a diagnostic rule
     */
    unregister(ruleId: string): boolean {
        const result = this.rules.delete(ruleId);
        if (result) {
            this.sortedRuleCache = null; // Invalidate cache
        }
        return result;
    }

    /**
     * Get a specific rule by ID
     */
    getRule(ruleId: string): DiagnosticRule | undefined {
        return this.rules.get(ruleId)?.rule;
    }

    /**
     * Get all registered rules sorted by priority
     */
    getAllRules(): DiagnosticRule[] {
        if (this.sortedRuleCache === null) {
            const ruleEntries = Array.from(this.rules.values());
            ruleEntries.sort((a, b) => b.priority - a.priority);
            this.sortedRuleCache = ruleEntries.map(entry => entry.rule);
        }
        return [...this.sortedRuleCache];
    }

    /**
     * Get rules by category
     */
    getRulesByCategory(category: DiagnosticCategory): DiagnosticRule[] {
        return this.getAllRules().filter(rule => rule.category === category);
    }

    /**
     * Get configuration for a specific rule
     */
    getRuleConfig(ruleId: string): DiagnosticRuleConfig | undefined {
        return this.rules.get(ruleId)?.config;
    }

    /**
     * Update configuration for a specific rule
     */
    updateRuleConfig(ruleId: string, config: Partial<DiagnosticRuleConfig>): void {
        const entry = this.rules.get(ruleId);
        if (!entry) {
            throw new Error(`Rule with ID '${ruleId}' is not registered.`);
        }

        entry.config = { ...entry.config, ...config };
    }

    /**
     * Check if a rule is registered
     */
    hasRule(ruleId: string): boolean {
        return this.rules.has(ruleId);
    }

    /**
     * Get all rule IDs
     */
    getRuleIds(): string[] {
        return Array.from(this.rules.keys());
    }

    /**
     * Clear all registered rules
     */
    clear(): void {
        this.rules.clear();
        this.sortedRuleCache = null;
    }

    /**
     * Get rule statistics
     */
    getStats(): {
        totalRules: number;
        enabledRules: number;
        rulesByCategory: Record<DiagnosticCategory, number>;
    } {
        const allRules = Array.from(this.rules.values());
        const enabledRules = allRules.filter(entry => entry.config.enabled);

        const rulesByCategory: Record<DiagnosticCategory, number> = {
            [DiagnosticCategory.SYNTAX]: 0,
            [DiagnosticCategory.SEMANTIC]: 0,
            [DiagnosticCategory.TYPE]: 0,
            [DiagnosticCategory.STYLE]: 0,
            [DiagnosticCategory.PERFORMANCE]: 0,
            [DiagnosticCategory.SECURITY]: 0,
            [DiagnosticCategory.BEST_PRACTICE]: 0
        };

        allRules.forEach(entry => {
            if (entry.config.enabled) {
                rulesByCategory[entry.rule.category]++;
            }
        });

        return {
            totalRules: allRules.length,
            enabledRules: enabledRules.length,
            rulesByCategory
        };
    }

    /**
     * Export current registry state for debugging
     */
    export(): Array<{
        id: string;
        name: string;
        category: DiagnosticCategory;
        priority: number;
        enabled: boolean;
    }> {
        return Array.from(this.rules.entries()).map(([id, entry]) => ({
            id,
            name: entry.rule.name,
            category: entry.rule.category,
            priority: entry.priority,
            enabled: entry.config.enabled
        }));
    }
}

/**
 * Global registry instance
 */
export const globalDiagnosticRegistry = new DiagnosticRuleRegistry();
