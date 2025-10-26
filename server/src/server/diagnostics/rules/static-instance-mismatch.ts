import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult
} from '../rules';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { ASTNode } from '../../ast';
import { Logger } from '../../../util/logger';
import { UndeclaredEntityRule } from './undeclared-entity-base';
import { isMemberExpression } from '../../../util';
import { findMemberInClassHierarchy, SymbolResolutionContext } from '../../util/symbol-resolution-utils';

/**
 * Rule for detecting static/instance mismatch when accessing class members
 * 
 * Examples:
 * - Calling a static method from an instance: `obj.StaticMethod()` (should be `ClassName.StaticMethod()`)
 * - Calling an instance method from a class: `ClassName.InstanceMethod()` (should be `obj.InstanceMethod()`)
 */
export class StaticInstanceMismatchRule extends UndeclaredEntityRule {
    readonly id = 'static-instance-mismatch';
    readonly name = 'Static/Instance Access Mismatch';
    readonly description = 'Detects static methods called from instances or instance methods called from class names';
    // Override to use WARNING instead of ERROR
    readonly defaultSeverity: DiagnosticSeverity = DiagnosticSeverity.Warning;

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
        
        // Extract member name
        const memberName = this.extractIdentifierFromNode(node, 'MemberExpression', ['property']);
        
        if (!memberName) {
            return [];
        }

        // Skip if it's a language keyword
        if (this.isLanguageKeyword(memberName)) {
            return [];
        }

        // Resolve the object type
        const position = node.start;
        const resolutionResult = await this.resolveExpressionType(node.object, position, context);

        if (!resolutionResult) {
            return [];
        }

        const { typeName: objectType, isStaticAccess, isSuperAccess } = resolutionResult;

        // Skip if objectType is an enum - enum members are always static-like
        if (this.isEnumName(objectType, context)) {
            return [];
        }

        // Create resolution context for findMemberInClassHierarchy
        const resolveContext: SymbolResolutionContext = {
            document: context.document,
            typeResolver: context.typeResolver,
            includePaths: context.includePaths,
            loadClassFromIncludePaths: context.loadClassFromIncludePaths
        };

        // Determine if we should allow private methods
        const containingClass = this.findContainingClass(node, context);
        const allowPrivate = containingClass !== null && containingClass.name === objectType;

        Logger.debug(`StaticInstanceMismatchRule: Checking member '${objectType}.${memberName}' (static: ${isStaticAccess}, allowPrivate: ${allowPrivate}, super: ${isSuperAccess})`);

        // Find the member to check for static/instance mismatch
        const memberResult = await findMemberInClassHierarchy(
            objectType,
            memberName,
            isStaticAccess,
            resolveContext,
            allowPrivate,
            isSuperAccess
        );

        if (!memberResult) {
            // Member not found at all - this will be caught by UndeclaredMethodRule
            return [];
        }

        // Check if there's a static/instance mismatch
        if (memberResult.staticMismatch) {
            Logger.debug(`StaticInstanceMismatchRule: Found static mismatch for '${objectType}.${memberName}'`);
            
            // Determine the appropriate message based on the type of mismatch
            let message: string;
            if (isStaticAccess) {
                // Trying to access instance member as static
                message = `Method '${memberName}' is an instance member and should be accessed via an instance, not the class '${objectType}'`;
            } else {
                // Trying to access static member as instance
                message = `Method '${memberName}' is static and should be accessed via the class '${objectType}', not an instance`;
            }

            return [
                this.createDiagnostic(
                    message,
                    node.memberStart,
                    node.memberEnd,
                    config.severity,
                    this.id
                )
            ];
        }

        // No mismatch
        return [];
    }

    getDocumentation(): string {
        return `
**Static/Instance Access Mismatch**

This rule detects when static methods are called from object instances or when instance methods are called from class names.

**Bad:**
\`\`\`enscript
class MyClass {
    static void StaticMethod() {}
    void InstanceMethod() {}
}

void TestFunction() {
    MyClass obj;
    obj.StaticMethod(); // ❌ Static method called from instance
    
    MyClass.InstanceMethod(); // ❌ Instance method called from class
}
\`\`\`

**Good:**
\`\`\`enscript
class MyClass {
    static void StaticMethod() {}
    void InstanceMethod() {}
}

void TestFunction() {
    MyClass obj;
    MyClass.StaticMethod(); // ✅ Static method called from class
    
    obj.InstanceMethod(); // ✅ Instance method called from instance
}
\`\`\`

**Why this matters:**

- **Static methods** belong to the class itself, not to instances. They should be called using the class name.
- **Instance methods** require an object instance to operate on. They should be called using an object variable.
- While some languages allow calling static methods from instances, it's considered bad practice and can lead to confusion.
- In EnScript, following the proper calling convention makes code clearer and more maintainable.
`;
    }
}
