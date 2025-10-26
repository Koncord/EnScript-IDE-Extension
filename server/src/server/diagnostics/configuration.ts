import { DiagnosticSeverity } from 'vscode-languageserver';
import { DiagnosticCategory, DiagnosticRuleConfig } from './rules';
import { Logger } from '../../util/logger';

/**
 * Configuration for the entire diagnostic system
 */
export interface DiagnosticConfiguration {
    /** Whether the diagnostic system is enabled */
    enabled: boolean;

    /** Maximum number of diagnostics per document */
    maxDiagnosticsPerFile: number;

    /** Whether to enable performance timing */
    enableTiming: boolean;

    /** Categories of diagnostics to enable */
    enabledCategories: DiagnosticCategory[];

    /** Global severity override for all rules */
    globalSeverityOverride?: DiagnosticSeverity;

    /** Rule-specific configurations */
    rules: Record<string, DiagnosticRuleConfig>;

    /** External files to exclude from diagnostics */
    excludePatterns: string[];

    /** Whether to be lenient with incomplete stubs */
    lenientStubValidation: boolean;
}

/**
 * Default diagnostic configuration
 */
export const defaultDiagnosticConfiguration: DiagnosticConfiguration = {
    enabled: true,
    maxDiagnosticsPerFile: 1000,
    enableTiming: false,
    enabledCategories: [
        DiagnosticCategory.SYNTAX,
        DiagnosticCategory.SEMANTIC,
        DiagnosticCategory.TYPE,
        DiagnosticCategory.STYLE
    ],
    rules: {
        'unused-typedef': {
            enabled: true,
            severity: DiagnosticSeverity.Warning
        },
        'undeclared-function': {
            enabled: true,
            severity: DiagnosticSeverity.Error
        },
        'undeclared-method': {
            enabled: true,
            severity: DiagnosticSeverity.Error
        },
        'parsing-errors': {
            enabled: true,
            severity: DiagnosticSeverity.Error
        }
    },
    excludePatterns: [
        '**/node_modules/**',
        '**/test/**/*.stub.c',
        '**/*.d.c'
    ],
    lenientStubValidation: true
};

/**
 * Configuration manager for diagnostics
 */
export class DiagnosticConfigurationManager {
    private config: DiagnosticConfiguration;
    private listeners: Array<(config: DiagnosticConfiguration) => void> = [];

    constructor(initialConfig: Partial<DiagnosticConfiguration> = {}) {
        this.config = { ...defaultDiagnosticConfiguration, ...initialConfig };
    }

    /**
     * Get the current configuration
     */
    getConfiguration(): DiagnosticConfiguration {
        return { ...this.config };
    }

    /**
     * Update the configuration
     */
    updateConfiguration(updates: Partial<DiagnosticConfiguration>): void {
        const oldConfig = this.config;
        this.config = { ...this.config, ...updates };

        // Merge rule configurations
        if (updates.rules) {
            this.config.rules = { ...oldConfig.rules, ...updates.rules };
        }

        this.notifyListeners();
    }

    /**
     * Update a specific rule configuration
     */
    updateRuleConfig(ruleId: string, config: Partial<DiagnosticRuleConfig>): void {
        const existingConfig = this.config.rules[ruleId] || { enabled: true };
        this.config.rules[ruleId] = { ...existingConfig, ...config };
        this.notifyListeners();
    }

    /**
     * Get configuration for a specific rule
     */
    getRuleConfig(ruleId: string): DiagnosticRuleConfig | undefined {
        return this.config.rules[ruleId];
    }

    /**
     * Enable or disable a rule
     */
    setRuleEnabled(ruleId: string, enabled: boolean): void {
        this.updateRuleConfig(ruleId, { enabled });
    }

    /**
     * Set severity for a rule
     */
    setRuleSeverity(ruleId: string, severity: DiagnosticSeverity): void {
        this.updateRuleConfig(ruleId, { severity });
    }

    /**
     * Enable or disable a diagnostic category
     */
    setCategoryEnabled(category: DiagnosticCategory, enabled: boolean): void {
        const categories = new Set(this.config.enabledCategories);

        if (enabled) {
            categories.add(category);
        } else {
            categories.delete(category);
        }

        this.updateConfiguration({
            enabledCategories: Array.from(categories)
        });
    }

    /**
     * Check if a file should be excluded from diagnostics
     */
    shouldExcludeFile(filePath: string): boolean {
        if (!this.config.enabled) {
            return true;
        }

        return this.config.excludePatterns.some(pattern => {
            // Simple glob pattern matching
            const regexPattern = pattern
                .replace(/\./g, '\\.')  // Escape dots first
                .replace(/\*\*/g, '.*')
                .replace(/\*/g, '[^/\\\\]*')
                .replace(/\?/g, '.');

            const regex = new RegExp(regexPattern + '$', 'i');  // Add end anchor
            return regex.test(filePath);
        });
    }

    /**
     * Add a configuration change listener
     */
    onConfigurationChanged(listener: (config: DiagnosticConfiguration) => void): void {
        this.listeners.push(listener);
    }

    /**
     * Remove a configuration change listener
     */
    removeListener(listener: (config: DiagnosticConfiguration) => void): void {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
            this.listeners.splice(index, 1);
        }
    }

    /**
     * Notify all listeners of configuration changes
     */
    private notifyListeners(): void {
        for (const listener of this.listeners) {
            try {
                listener(this.config);
            } catch (error) {
                Logger.error('Error notifying configuration listener:', error);
            }
        }
    }

    /**
     * Load configuration from a JSON object (e.g., from VS Code settings)
     */
    loadFromJSON(json: Partial<DiagnosticConfiguration>): void {
        try {
            const config: Partial<DiagnosticConfiguration> = {
                enabled: json.enabled ?? this.config.enabled,
                maxDiagnosticsPerFile: json.maxDiagnosticsPerFile ?? this.config.maxDiagnosticsPerFile,
                enableTiming: json.enableTiming ?? this.config.enableTiming,
                lenientStubValidation: json.lenientStubValidation ?? this.config.lenientStubValidation
            };

            if (json.enabledCategories) {
                config.enabledCategories = json.enabledCategories;
            }

            if (json.globalSeverityOverride) {
                config.globalSeverityOverride = json.globalSeverityOverride;
            }

            if (json.excludePatterns) {
                config.excludePatterns = json.excludePatterns;
            }

            if (json.rules) {
                config.rules = {};
                for (const [ruleId, ruleConfig] of Object.entries(json.rules)) {
                    config.rules[ruleId] = ruleConfig as DiagnosticRuleConfig;
                }
            }

            this.updateConfiguration(config);
        } catch (error) {
            Logger.error('Error loading diagnostic configuration from JSON:', error);
        }
    }

    /**
     * Reset to default configuration
     */
    reset(): void {
        this.config = { ...defaultDiagnosticConfiguration };
        this.notifyListeners();
    }
}

/**
 * Global diagnostic configuration instance
 */
export const globalDiagnosticConfig = new DiagnosticConfigurationManager();
