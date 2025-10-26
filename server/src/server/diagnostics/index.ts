// Core exports
export { DiagnosticEngine } from './engine';
export { DiagnosticEngineFactory } from './engine-factory';
export {
    IDiagnosticEngine,
    IDiagnosticEngineFactory,
    DiagnosticEngineOptions,
    DiagnosticPerformanceMetrics
} from './engine-interfaces';
export { DiagnosticRuleRegistry, globalDiagnosticRegistry, RuleRegistrationOptions } from './registry';
export {
    DiagnosticRule,
    BaseDiagnosticRule,
    DiagnosticCategory,
    DiagnosticRuleConfig,
    DiagnosticRuleContext,
    DiagnosticRuleResult
} from './rules';
export {
    DiagnosticConfiguration,
    DiagnosticConfigurationManager,
    globalDiagnosticConfig,
    defaultDiagnosticConfiguration
} from './configuration';

// Built-in rules
export {
    UnusedTypedefRule,
    UndeclaredFunctionRule,
    UndeclaredMethodRule,
    getBuiltInRules,
    registerBuiltInRules
} from './rules/index';

