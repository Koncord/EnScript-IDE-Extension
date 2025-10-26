import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult
} from '../rules';
import { ASTNode, VarDeclNode, ParameterDeclNode, TypeNode } from '../../ast';
import { Logger } from '../../../util/logger';
import { UndeclaredEntityRule } from './undeclared-entity-base';
import { isVarDecl, isParameterDecl, isTypeReference } from '../../../util';

/**
 * Rule for detecting usage of undeclared types in variable declarations and function parameters
 */
export class UndeclaredTypeRule extends UndeclaredEntityRule {
    readonly id = 'undeclared-type';
    readonly name = 'Undeclared Type';
    readonly description = 'Detects usage of types that are not declared or imported';

    appliesToNode(node: ASTNode): boolean {
        return isVarDecl(node) || isParameterDecl(node);
    }

    async check(
        node: ASTNode,
        context: DiagnosticRuleContext,
        config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        // Handle both VarDecl and ParameterDecl
        if (!isVarDecl(node) && !isParameterDecl(node)) {
            return [];
        }

        const diagnostics: DiagnosticRuleResult[] = [];

        // Check the main type
        if (node.type) {
            const typeCheck = await this.checkTypeDeclaration(node.type, node, context, config);
            diagnostics.push(...typeCheck);
        }

        return diagnostics;
    }

    /**
     * Check if a type declaration uses undeclared types
     */
    private async checkTypeDeclaration(
        typeNode: TypeNode,
        declNode: VarDeclNode | ParameterDeclNode,
        context: DiagnosticRuleContext,
        config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        const diagnostics: DiagnosticRuleResult[] = [];

        // Check the main type identifier using the new helper
        const typeName = this.extractTypeName(typeNode);
        
        if (typeName && !this.isBuiltInType(typeName)) {
            // Find containing class using parent traversal
            const containingClass = this.findContainingClass(declNode, context);

            if (!this.isTypeDeclared(typeName, context, containingClass)) {
                // Ensure we have valid position information
                if (!typeNode.start || !typeNode.end) {
                    Logger.warn(`Type node for '${typeName}' missing position information`);
                    return diagnostics;
                }

                // For TypeReference with 'ref' modifier, adjust the diagnostic range
                // to exclude the 'ref' keyword from the underline
                let startPos = typeNode.start;
                const endPos = typeNode.end;
                
                if (isTypeReference(typeNode)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const typeRef = typeNode as any;
                    if (typeRef.modifiers && Array.isArray(typeRef.modifiers) && typeRef.modifiers.includes('ref')) {
                        // The 'ref' keyword is typically 3 characters + 1 space = 4 characters
                        // Adjust start position to skip past "ref "
                        const refKeywordLength = 4; // "ref "
                        startPos = {
                            line: startPos.line,
                            character: startPos.character + refKeywordLength
                        };
                    }
                }

                diagnostics.push(this.createUndeclaredDiagnostic(
                    'Type',
                    typeName,
                    startPos,
                    endPos,
                    config
                ));
            }
        }

        // Check generic type arguments recursively using the new helper
        const genericArgs = this.extractTypeArguments(typeNode);
        
        if (genericArgs) {
            for (const genericArg of genericArgs) {
                const genericDiagnostics = await this.checkTypeDeclaration(genericArg as TypeNode, declNode, context, config);
                diagnostics.push(...genericDiagnostics);
            }
        }

        return diagnostics;
    }



    getDocumentation(): string {
        return this.getUndeclaredDocumentation('Type', {
            bad: `void MyFunction(UnknownType param) {  // Error: 'UnknownType' is not declared
    UnknownType myVar;                    // Error: 'UnknownType' is not declared
    SomeClass<UnknownGeneric> obj;        // Error: 'UnknownGeneric' is not declared
}`,
            good: `class MyClass { }

void MyFunction(MyClass param) {         // OK: 'MyClass' is declared
    MyClass myVar;                        // OK: 'MyClass' is declared
    PlayerBase player;                    // OK: 'PlayerBase' is external class
    vector<int> numbers;                  // OK: 'vector' is built-in container
}`
        });
    }

    getSuggestions(node: ASTNode, _context: DiagnosticRuleContext): string[] {
        if (!isVarDecl(node) && !isParameterDecl(node)) {
            return [];
        }

        const baseSuggestions = this.getUndeclaredSuggestions('Type', 'type_name');
        return [
            ...baseSuggestions,
            'Check if you need to import or include the file containing the type definition',
            'Ensure the class or type is accessible in the current scope'
        ];
    }
}
