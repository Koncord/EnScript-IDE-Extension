export { UnusedTypedefRule } from './unused-typedef';
export { UndeclaredFunctionRule } from './undeclared-function';
export { UndeclaredMethodRule } from './undeclared-method';
export { UndeclaredVariableRule } from './undeclared-variable';
export { UndeclaredTypeRule } from './undeclared-type';
export { UndeclaredEnumMemberRule } from './undeclared-enum-member';
export { UndeclaredBaseClassRule } from './undeclared-base-class';
export { UndeclaredEntityRule } from './undeclared-entity-base';
export { StaticInstanceMismatchRule } from './static-instance-mismatch';
export { TypeMismatchRule } from './type-mismatch';
export { IncorrectRefUsageRule } from './incorrect-ref-usage';
export { VariableShadowingRule } from './variable-shadowing';
export { MissingOverrideRule } from './missing-override';
export { OverrideAccessModifierMismatchRule } from './override-access-modifier-mismatch';

import { DiagnosticRule } from '../rules';
import { UnusedTypedefRule } from './unused-typedef';
import { UndeclaredFunctionRule } from './undeclared-function';
import { UndeclaredMethodRule } from './undeclared-method';
import { UndeclaredVariableRule } from './undeclared-variable';
import { UndeclaredTypeRule } from './undeclared-type';
import { UndeclaredEnumMemberRule } from './undeclared-enum-member';
import { UndeclaredBaseClassRule } from './undeclared-base-class';
import { StaticInstanceMismatchRule } from './static-instance-mismatch';
import { TypeMismatchRule } from './type-mismatch';
import { IncorrectRefUsageRule } from './incorrect-ref-usage';
import { VariableShadowingRule } from './variable-shadowing';
import { MissingOverrideRule } from './missing-override';
import { OverrideAccessModifierMismatchRule } from './override-access-modifier-mismatch';
import { DiagnosticRuleRegistry } from '../registry';

/**
 * Get all built-in diagnostic rules
 */
export function getBuiltInRules(): DiagnosticRule[] {
    return [
        new UnusedTypedefRule(),
        new UndeclaredFunctionRule(),
        new UndeclaredMethodRule(),
        new UndeclaredVariableRule(),
        new UndeclaredTypeRule(),
        new UndeclaredEnumMemberRule(),
        new UndeclaredBaseClassRule(),
        new StaticInstanceMismatchRule(),
        new TypeMismatchRule(),
        new IncorrectRefUsageRule(),
        new VariableShadowingRule(),
        new MissingOverrideRule(),
        new OverrideAccessModifierMismatchRule()
    ];
}

/**
 * Register all built-in rules with a registry
 * 
 * Priority system (higher values run first):
 * - 110: Specific rules that should run before generic ones (method, enum member checks)
 * - 100: Standard rules (function, variable, type checks)
 * - 90: Lower priority rules (unused typedef, base class checks)
 */
export function registerBuiltInRules(registry: DiagnosticRuleRegistry): void {
    // High priority: More specific rules that should check nodes first
    registry.register(new UndeclaredMethodRule(), {
        priority: 110 // Check method calls before falling back to function checks
    });
    
    registry.register(new UndeclaredEnumMemberRule(), {
        priority: 110 // Check enum member access before falling back to function checks
    });

    registry.register(new StaticInstanceMismatchRule(), {
        priority: 105 // Check after method existence is verified, but before general function checks
    });

    // Standard priority: General undeclared entity checks
    registry.register(new UndeclaredFunctionRule(), {
        priority: 100 // Will skip if method/enum rules already found issue
    });

    registry.register(new UndeclaredVariableRule(), {
        priority: 100
    });

    registry.register(new UndeclaredTypeRule(), {
        priority: 100
    });

    // Lower priority: Less critical checks
    registry.register(new UndeclaredBaseClassRule(), {
        priority: 90
    });

    registry.register(new UnusedTypedefRule(), {
        priority: 90
    });

    // Type checking rules
    registry.register(new TypeMismatchRule(), {
        priority: 95 // Check type compatibility after type existence is verified
    });

    // Best practice rules
    registry.register(new IncorrectRefUsageRule(), {
        priority: 90 // Check for best practices
    });

    registry.register(new VariableShadowingRule(), {
        priority: 90 // Checks both shadowing (warnings) and redeclarations (errors)
    });

    registry.register(new MissingOverrideRule(), {
        priority: 85 // Warning rule, run after critical checks
    });

    registry.register(new OverrideAccessModifierMismatchRule(), {
        priority: 85 // Warning rule, run after critical checks
    });
}
