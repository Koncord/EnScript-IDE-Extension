/**
 * Parser configuration options and defaults
 */

/**
 * Parser configuration options for customizing behavior
 */
export interface ParserConfig {
    /** Whether to include debug logging */
    debug: boolean;
    /** Whether to attempt error recovery */
    errorRecovery: boolean;
    /** Whether to skip parsing function bodies (for external files) */
    skipFunctionBodies: boolean;
    /** Preprocessor symbols to define globally */
    preprocessorDefinitions: Set<string>;
    /** Whether to be lenient with missing semicolons (for external files) */
    lenientSemicolons: boolean;
    /** Whether to suppress stylistic warnings (like unnecessary semicolons) */
    suppressStylisticWarnings?: boolean;
    /** Whether to enable IDE-specific recovery (like incomplete member access) */
    ideMode?: boolean;
}

/**
 * Default parser configuration for EnScript
 */
export const defaultConfig: ParserConfig = {
    debug: false,
    errorRecovery: true,
    skipFunctionBodies: false,
    preprocessorDefinitions: new Set(),
    lenientSemicolons: false,
    suppressStylisticWarnings: false,
    ideMode: false
};

/**
 * Debug parser configuration with enhanced logging
 */
export const debugConfig: ParserConfig = {
    debug: true,
    errorRecovery: true,
    skipFunctionBodies: false,
    preprocessorDefinitions: new Set(),
    lenientSemicolons: false,
    suppressStylisticWarnings: false,
    ideMode: false
};

/**
 * Create a custom parser configuration by merging with defaults
 * 
 * @param overrides Partial configuration to override defaults
 * @returns Complete parser configuration
 */
export function createConfig(overrides: Partial<ParserConfig>): ParserConfig {
    return {
        ...defaultConfig,
        ...overrides
    };
}

/**
 * Create an IDE-specific parser configuration for completion and diagnostics
 * 
 * @param overrides Additional configuration to override
 * @returns Complete parser configuration with IDE mode enabled
 */
export function createIdeConfig(overrides: Partial<ParserConfig> = {}): ParserConfig {
    return createConfig({
        ideMode: true,
        errorRecovery: true,
        lenientSemicolons: true,
        suppressStylisticWarnings: true,
        ...overrides
    });
}
