import { DiagnosticRule, DiagnosticRuleConfig, DiagnosticCategory } from './rules';
import type { DiagnosticConfigurationManager } from './configuration';

/**
 * Rule registration options
 */
export interface RuleRegistrationOptions {
    /** Priority for rule execution (higher values run first) */
    priority?: number;
    /** Whether to replace an existing rule with the same ID */
    replace?: boolean;
    /** Default configuration for this rule (stored in global config manager) */
    config?: Partial<DiagnosticRuleConfig>;
}

/**
 * Registry for managing diagnostic rules
 */
export class DiagnosticRuleRegistry {
    private rules = new Map<string, {
        rule: DiagnosticRule;
        priority: number;
    }>();

    private configManager?: DiagnosticConfigurationManager;

    private sortedRuleCache: DiagnosticRule[] | null = null;

    /**
     * Set the configuration manager for this registry
     * This allows the registry to delegate config lookups
     */
    setConfigManager(configManager: DiagnosticConfigurationManager): void {
        this.configManager = configManager;
    }

    /**
     * Register a diagnostic rule
     */
    register(rule: DiagnosticRule, options: RuleRegistrationOptions = {}): void {
        const existing = this.rules.get(rule.id);

        if (existing && !options.replace) {
            throw new Error(`Rule with ID '${rule.id}' is already registered. Use { replace: true } to override.`);
        }

        const priority = options.priority ?? 100;

        // Store default config in the config manager if not already present
        if (this.configManager && !this.configManager.getRuleConfig(rule.id)) {
            const defaultConfig = { ...rule.defaultConfig, ...options.config };
            this.configManager.updateRuleConfig(rule.id, defaultConfig);
        }

        this.rules.set(rule.id, { rule, priority });
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
     * Delegates to the global configuration manager
     */
    getRuleConfig(ruleId: string): DiagnosticRuleConfig | undefined {
        if (!this.configManager) {
            // Fallback: return default config from the rule itself
            const rule = this.rules.get(ruleId)?.rule;
            return rule?.defaultConfig;
        }

        // First check config manager, fall back to rule's default config
        const configFromManager = this.configManager.getRuleConfig(ruleId);
        if (configFromManager) {
            return configFromManager;
        }

        // If not in config manager, return rule's default
        const rule = this.rules.get(ruleId)?.rule;
        return rule?.defaultConfig;
    }

    /**
     * @deprecated Use globalDiagnosticConfig.updateRuleConfig() instead
     * Update configuration for a specific rule
     */
    updateRuleConfig(ruleId: string, config: Partial<DiagnosticRuleConfig>): void {
        if (!this.configManager) {
            throw new Error('Config manager not set. Call setConfigManager() first.');
        }

        // Delegate to config manager
        this.configManager.updateRuleConfig(ruleId, config);
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
        const enabledRules = allRules.filter(entry => {
            const config = this.getRuleConfig(entry.rule.id);
            return config?.enabled ?? true;
        });

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
            const config = this.getRuleConfig(entry.rule.id);
            if (config?.enabled ?? true) {
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
        return Array.from(this.rules.entries()).map(([id, entry]) => {
            const config = this.getRuleConfig(id);
            return {
                id,
                name: entry.rule.name,
                category: entry.rule.category,
                priority: entry.priority,
                enabled: config?.enabled ?? true
            };
        });
    }
}

/**
 * Global registry instance
 */
export const globalDiagnosticRegistry = new DiagnosticRuleRegistry();

// Connect the registry to the global config manager
// This must be done after both are created to avoid circular dependency issues
import { globalDiagnosticConfig } from './configuration';
globalDiagnosticRegistry.setConfigManager(globalDiagnosticConfig);
