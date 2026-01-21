export { UnusedTypedefRule } from './unused-typedef';
export { UndeclaredFunctionRule } from './undeclared-rules/undeclared-function';
export { UndeclaredMethodRule } from './undeclared-rules/undeclared-method';
export { UndeclaredVariableRule } from './undeclared-rules/undeclared-variable';
export { UndeclaredTypeRule } from './undeclared-rules/undeclared-type';
export { UndeclaredEnumMemberRule } from './undeclared-rules/undeclared-enum-member';
export { UndeclaredBaseClassRule } from './undeclared-rules/undeclared-base-class';
export { UndeclaredEntityRule } from './undeclared-rules/undeclared-entity-base';
export { StaticInstanceMismatchRule } from './static-instance-mismatch';
export { AssignmentTypeMismatchRule } from './type-missmatch-rules/assignment-type-mismatch';
export { VariableDeclarationTypeMismatchRule } from './type-missmatch-rules/variable-declaration-type-mismatch';
export { ReturnTypeMismatchRule } from './type-missmatch-rules/return-type-mismatch';
export { FunctionCallTypeMismatchRule } from './type-missmatch-rules/function-call-type-mismatch';
export { BinaryOperationTypeMismatchRule } from './type-missmatch-rules/binary-operation-type-mismatch';
export { TypeMissmatchBase as TypeCheckingHelpers } from './type-missmatch-rules/type-missmatch-base';
export { IncorrectRefUsageRule } from './incorrect-ref-usage';
export { VariableShadowingRule } from './variable-shadowing';
export { MissingOverrideRule } from './missing-override';
export { OverrideAccessModifierMismatchRule } from './override-access-modifier-mismatch';

import { DiagnosticRule } from '../rules';
import { UnusedTypedefRule } from './unused-typedef';
import { UndeclaredFunctionRule } from './undeclared-rules/undeclared-function';
import { UndeclaredMethodRule } from './undeclared-rules/undeclared-method';
import { UndeclaredVariableRule } from './undeclared-rules/undeclared-variable';
import { UndeclaredTypeRule } from './undeclared-rules/undeclared-type';
import { UndeclaredEnumMemberRule } from './undeclared-rules/undeclared-enum-member';
import { UndeclaredBaseClassRule } from './undeclared-rules/undeclared-base-class';
import { StaticInstanceMismatchRule } from './static-instance-mismatch';
import { AssignmentTypeMismatchRule } from './type-missmatch-rules/assignment-type-mismatch';
import { VariableDeclarationTypeMismatchRule } from './type-missmatch-rules/variable-declaration-type-mismatch';
import { ReturnTypeMismatchRule } from './type-missmatch-rules/return-type-mismatch';
import { FunctionCallTypeMismatchRule } from './type-missmatch-rules/function-call-type-mismatch';
import { BinaryOperationTypeMismatchRule } from './type-missmatch-rules/binary-operation-type-mismatch';
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
        // Type mismatch rules - now split into focused rules
        new AssignmentTypeMismatchRule(),
        new VariableDeclarationTypeMismatchRule(),
        new ReturnTypeMismatchRule(),
        new FunctionCallTypeMismatchRule(),
        new BinaryOperationTypeMismatchRule(),
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

    // Type checking rules - now split into focused rules for better maintainability
    registry.register(new AssignmentTypeMismatchRule(), {
        priority: 95 // Check type compatibility after type existence is verified
    });

    registry.register(new VariableDeclarationTypeMismatchRule(), {
        priority: 95
    });

    registry.register(new ReturnTypeMismatchRule(), {
        priority: 95
    });

    registry.register(new FunctionCallTypeMismatchRule(), {
        priority: 95
    });

    registry.register(new BinaryOperationTypeMismatchRule(), {
        priority: 95
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
