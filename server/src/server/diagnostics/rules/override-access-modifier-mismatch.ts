import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult
} from '../rules';
import { ASTNode, ClassDeclNode, MethodDeclNode } from '../../ast';
import { UndeclaredEntityRule } from './undeclared-entity-base';
import { isMethod } from '../../../util';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { findMemberInClassWithInheritance } from '../../util/ast-class-utils';

/**
 * Rule for detecting mismatched access modifiers in override methods
 * Warns when a method uses 'override' keyword but doesn't match the base method's access modifier
 * 
 * Example:
 * Base:     protected void Test()
 * Wrong:    override void Test()           // Missing 'protected'
 * Correct:  override protected void Test()
 */
export class OverrideAccessModifierMismatchRule extends UndeclaredEntityRule {
    readonly id = 'override-access-modifier-mismatch';
    readonly name = 'Override Access Modifier Mismatch';
    readonly description = 'Detects override methods with mismatched access modifiers';

    private readonly accessModifiers = ['protected', 'private'];

    appliesToNode(node: ASTNode): boolean {
        return isMethod(node);
    }

    async check(
        node: MethodDeclNode,
        context: DiagnosticRuleContext,
        _config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        // Only check methods with override modifier
        if (!node.modifiers?.includes('override')) {
            return [];
        }

        // Skip constructors/destructors
        if (node.isConstructor || node.isDestructor) {
            return [];
        }

        const containingClass = this.findContainingClass(node, context);
        if (!containingClass) {
            return [];
        }

        const isModdedClass = containingClass.modifiers?.includes('modded');

        // For modded classes, check the original class definition
        // For regular derived classes, check the base class
        let baseClass: ClassDeclNode | null = null;
        
        if (isModdedClass) {
            const originalClass = this.findOriginalClass(containingClass.name, context);
            if (originalClass) {
                baseClass = originalClass;
            }
        } else if (containingClass.baseClass) {
            const baseClassName = this.extractTypeName(containingClass.baseClass);
            if (baseClassName) {
                baseClass = this.findClassByName(baseClassName, context);
            }
        }

        if (!baseClass) {
            return [];
        }

        // Look for method in base class hierarchy
        // For standard inheritance (not modded classes), include private members to detect invalid overrides
        const includePrivate = !isModdedClass;
        const baseMember = findMemberInClassWithInheritance(
            baseClass,
            node.name,
            (className) => this.findClassByName(className, context),
            includePrivate // Include private members for standard inheritance to catch invalid overrides
        );

        // Check if the found member is a method
        if (baseMember && isMethod(baseMember)) {
            const baseMethod = baseMember as MethodDeclNode;

            // Skip if base method is marked as static (can't be overridden)
            if (baseMethod.modifiers?.includes('static')) {
                return [];
            }

            // Check if signatures match
            if (!this.signaturesMatch(node, baseMethod)) {
                return []; // Different signatures = overload, not override
            }

            // Get access modifiers
            const baseAccessModifier = this.getAccessModifier(baseMethod);
            const overrideAccessModifier = this.getAccessModifier(node);

            // For standard inheritance, error if trying to override a private method
            if (!isModdedClass && baseAccessModifier === 'private') {
                const diagnostic = this.createDiagnostic(
                    `Cannot override private method '${node.name}'.`,
                    node.nameStart,
                    node.nameEnd,
                    DiagnosticSeverity.Error,
                    this.id
                );

                return [diagnostic];
            }

            // Check for mismatch
            if (baseAccessModifier !== overrideAccessModifier) {
                const baseAccess = baseAccessModifier || 'public';
                const overrideAccess = overrideAccessModifier || 'public';
                const correctModifiers = baseAccessModifier ? `override ${baseAccessModifier}` : 'override';
                
                // For modded classes, the error message is different since it's the same class
                const messagePrefix = isModdedClass 
                    ? `Method '${node.name}' in modded class has '${overrideAccess}' access but original method has '${baseAccess}' access`
                    : `Method '${node.name}' has '${overrideAccess}' access but overrides '${baseAccess}' method`;
                
                const diagnostic = this.createDiagnostic(
                    `${messagePrefix}. Use '${correctModifiers} ${this.getReturnTypeString(node)} ${node.name}(...)'`,
                    node.nameStart,
                    node.nameEnd,
                    DiagnosticSeverity.Warning,
                    this.id
                );

                return [diagnostic];
            }
        }

        return [];
    }

    /**
     * Get the access modifier from a method's modifiers
     * Returns 'protected', 'private', or null (which means default public in EnScript)
     * Note: EnScript doesn't have an explicit 'public' keyword - members are public by default
     */
    private getAccessModifier(method: MethodDeclNode): string | null {
        if (!method.modifiers) {
            return null;
        }

        for (const modifier of this.accessModifiers) {
            if (method.modifiers.includes(modifier)) {
                return modifier;
            }
        }

        return null;
    }

    /**
     * Get return type string for diagnostic message
     */
    private getReturnTypeString(method: MethodDeclNode): string {
        if (!method.returnType) {
            return 'void';
        }

        const typeName = this.extractTypeName(method.returnType);
        return typeName || 'void';
    }

}
