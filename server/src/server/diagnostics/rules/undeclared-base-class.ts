import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult
} from '../rules';
import { ASTNode, ClassDeclNode } from '../../ast';
import { Logger } from '../../../util/logger';
import { UndeclaredEntityRule } from './undeclared-entity-base';
import { isClass, isTypeReference } from '../../../util';

/**
 * Rule for detecting undeclared base classes in class inheritance
 */
export class UndeclaredBaseClassRule extends UndeclaredEntityRule {
    readonly id = 'undeclared-base-class';
    readonly name = 'Undeclared Base Class';
    readonly description = 'Detects class inheritance from undeclared base classes';

    appliesToNode(node: ASTNode): boolean {
        return isClass(node);
    }

    async check(
        node: ClassDeclNode,
        context: DiagnosticRuleContext,
        config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        // Check if class has a base class
        if (!node.baseClass) {
            return [];
        }

        // Only handle TypeReference base classes for now
        if (!isTypeReference(node.baseClass)) {
            return [];
        }

        const baseClassRef = node.baseClass;
        const baseClassName = baseClassRef.name;

        Logger.debug(`🔍 UndeclaredBaseClassRule: Checking if base class '${baseClassName}' is declared`);
        // Check if the base class is declared
        if (this.isTypeDeclared(baseClassName, context, null)) {
            Logger.debug(`✅ UndeclaredBaseClassRule: Found base class '${baseClassName}'`);
            return [];
        }

        // Base class is not declared - create diagnostic
        Logger.debug(`❌ UndeclaredBaseClassRule: Base class '${baseClassName}' not found for class '${node.name}'`);

        return [
            this.createUndeclaredDiagnostic(
                'Base class',
                baseClassName,
                baseClassRef.start,
                baseClassRef.end,
                config
            )
        ];
    }

    getDocumentation(): string {
        return this.getUndeclaredDocumentation('Base Class', {
            bad: `class MyClass : UndeclaredBase {  // Error: 'UndeclaredBase' is not declared
    void MyMethod() {}
}`,
            good: `class DeclaredBase {
    void BaseMethod() {}
}

class MyClass : DeclaredBase {  // OK: 'DeclaredBase' is declared
    void MyMethod() {}
}`
        });
    }

    getSuggestions(node: ASTNode, _context: DiagnosticRuleContext): string[] {
        if (!isClass(node)) {
            return [];
        }

        const classDecl = node as ClassDeclNode;
        
        if (!isTypeReference(classDecl.baseClass)) {
            return [];
        }

        const baseClassName = classDecl.baseClass.name;
        
        return [
            ...this.getUndeclaredSuggestions('Base class', baseClassName),
            'Check if you need to import or include the file containing the base class definition',
            'Verify the base class name is spelled correctly',
            'Remove the inheritance if the base class is not needed'
        ];
    }
}
