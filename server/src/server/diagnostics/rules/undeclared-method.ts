import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult
} from '../rules';
import { ASTNode } from '../../ast';
import { UndeclaredEntityRule } from './undeclared-entity-base';
import { Logger } from '../../../util/logger';
import { isMemberExpression } from '../../../util';

/**
 * Rule for detecting undeclared member access (methods and fields).
 * 
 * Special handling:
 * - Private members are allowed when accessed from within the same class
 * - Static vs instance member access is validated
 * - Const members are treated as implicitly static in EnScript
 * - Checks both methods and fields/constants (e.g., float.LOWEST, string.Empty)
 */
export class UndeclaredMethodRule extends UndeclaredEntityRule {
    readonly id = 'undeclared-method';
    readonly name = 'Undeclared Method';
    readonly description = 'Detects calls to methods that are not declared on the object type';

    appliesToNode(node: ASTNode): boolean {
        return isMemberExpression(node);
    }

    async check(
        node: ASTNode,
        context: DiagnosticRuleContext,
        config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        if (!isMemberExpression(node)) {
            return [];
        }
        
        // Extract method name using the new helper
        const methodName = this.extractIdentifierFromNode(node, 'MemberExpression', ['property']);
        
        if (!methodName) {
            return [];
        }

        // Skip if it's a language keyword
        if (this.isLanguageKeyword(methodName)) {
            return [];
        }

        // Resolve the object type (handles simple identifiers, 'this', and method chaining)
        const position = node.start;
        const resolutionResult = await this.resolveExpressionType(node.object, position, context);

        if (!resolutionResult) {
            return [];
        }

        let { typeName: objectType, isStaticAccess, isSuperAccess } = resolutionResult;

        // Resolve typedef to underlying type (e.g., "PlayerList" -> "array<Player>")
        if (context.typeResolver) {
            const resolvedType = context.typeResolver.resolveTypedefToClassName(objectType);
            if (resolvedType) {
                Logger.debug(`UndeclaredMethodRule: Resolved typedef '${objectType}' -> '${resolvedType}'`);
                objectType = resolvedType;
            }
        }

        // Skip if objectType is an enum - enum member access is handled by undeclared-enum-member rule
        if (this.isEnumName(objectType, context)) {
            return [];
        }

        // Determine if we should allow private methods
        // Private methods are allowed when called from within the same class
        const containingClass = this.findContainingClass(node, context);
        const allowPrivate = containingClass !== null && containingClass.name === resolutionResult.typeName;

        // Check if objectType is a generic parameter that couldn't be resolved
        // If the type resolver returned a generic parameter (T, T1, T2, etc.), it means
        // it couldn't substitute it with a concrete type, so we skip validation
        if (this.isGenericParameter(objectType, node, context, containingClass)) {
            Logger.debug(`UndeclaredMethodRule: Skipping unresolved generic parameter '${objectType}'`);
            return [];
        }

        Logger.debug(`UndeclaredMethodRule: Checking member '${objectType}.${methodName}' (static: ${isStaticAccess}, allowPrivate: ${allowPrivate}, super: ${isSuperAccess})`);

        // Check if method is declared on the type
        // For super access, exclude modded classes to only check the original class
        const memberResult = await this.findMemberInClassHierarchy(
            objectType,
            methodName,
            isStaticAccess,
            context,
            allowPrivate, // allow private if we're inside the same class
            isSuperAccess // exclude modded classes for super access
        );
        
        // If we found a member (with or without static mismatch), the member exists
        // Static mismatch will be handled by StaticInstanceMismatchRule (as a warning)
        if (memberResult) {
            if (memberResult.staticMismatch) {
                Logger.debug(`UndeclaredMethodRule: Member '${objectType}.${methodName}' found with static mismatch - will be handled by StaticInstanceMismatchRule`);
            } else {
                Logger.debug(`UndeclaredMethodRule: Member '${objectType}.${methodName}' found`);
            }
            return [];
        }

        Logger.warn(`UndeclaredMethodRule: Member '${objectType}.${methodName}' NOT found (static: ${isStaticAccess}, allowPrivate: ${allowPrivate})`);

        // Method is not declared - create diagnostic
        return [
            this.createUndeclaredDiagnostic(
                'Method',
                methodName,
                node.memberStart,
                node.memberEnd,
                config,
                `on class '${objectType}'`
            )
        ];
    }

    getDocumentation(): string {
        return this.getUndeclaredDocumentation('Method', {
            bad: `class MyClass {
    void DeclaredMethod() {}
}

void TestFunction() {
    MyClass obj;
    obj.UndeclaredMethod(); // Error: method not declared
}`,
            good: `class MyClass {
    const float MAX_VALUE = 100.0; // Const is implicitly static
    private void PrivateMethod() {}
    void DeclaredMethod() {}
    
    void CallPrivateMethod() {
        this.PrivateMethod(); // OK: private method called from within same class
    }
}

void TestFunction() {
    MyClass obj;
    obj.DeclaredMethod(); // OK: method is declared
    float max = MyClass.MAX_VALUE; // OK: const member accessed statically
}`
        });
    }

    getSuggestions(node: ASTNode, _context: DiagnosticRuleContext): string[] {
        // Extract method name using the new helper
        const methodName = this.extractIdentifierFromNode(node, 'MemberExpression', ['property']);
        
        if (!methodName) {
            return [];
        }

        return this.getUndeclaredSuggestions('Method', methodName);
    }
}