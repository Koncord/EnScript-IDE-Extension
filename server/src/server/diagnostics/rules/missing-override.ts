import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult
} from '../rules';
import { ASTNode, ClassDeclNode, MethodDeclNode } from '../../ast';
import { UndeclaredEntityRule } from './undeclared-entity-base';
import { isMethod, isClass } from '../../../util';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { findMemberInClassWithInheritance } from '../../util/ast-class-utils';

/**
 * Rule for detecting missing override keyword
 * Warns when a method in a derived class overrides a method from a base class
 * without using the 'override' modifier
 */
export class MissingOverrideRule extends UndeclaredEntityRule {
    readonly id = 'missing-override';
    readonly name = 'Missing Override';
    readonly description = 'Detects methods that override base class methods without override keyword';

    appliesToNode(node: ASTNode): boolean {
        return isMethod(node);
    }

    async check(
        node: MethodDeclNode,
        context: DiagnosticRuleContext,
        _config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        // Skip checking proto/native methods and constructors/destructors
        if (
            node.modifiers?.includes('proto') ||
            node.modifiers?.includes('native') ||
            node.isConstructor ||
            node.isDestructor
        ) {
            return [];
        }

        // Skip if method already has override modifier
        if (node.modifiers?.includes('override')) {
            return [];
        }

        const containingClass = this.findContainingClass(node, context);
        if (!containingClass) {
            return [];
        }

        // For modded classes, check the original class definition
        // For regular derived classes, check the base class
        let baseClass: ClassDeclNode | null = null;
        
        if (containingClass.modifiers?.includes('modded')) {
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
        const baseMember = findMemberInClassWithInheritance(
            baseClass,
            node.name,
            (className) => this.findClassByName(className, context),
            false // Don't include private members
        );

        // Check if the found member is a method
        if (baseMember && isMethod(baseMember)) {
            const baseMethod = baseMember as MethodDeclNode;

            // Skip if base method is marked as static or private (can't be overridden)
            if (
                baseMethod.modifiers?.includes('static') ||
                baseMethod.modifiers?.includes('private')
            ) {
                return [];
            }

            // Check if signatures match - only warn if this is an override, not an overload
            if (!this.signaturesMatch(node, baseMethod)) {
                return []; // Different signatures = overload, not override
            }

            // Create diagnostic for missing override keyword
            const diagnostic = this.createDiagnostic(
                `Method '${node.name}' overrides base class method without 'override' keyword`,
                node.nameStart,
                node.nameEnd,
                DiagnosticSeverity.Warning,
                this.id
            );

            return [diagnostic];
        }

        return [];
    }

}
