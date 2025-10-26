/**
 * AST-Based Completion Provider
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import { Declaration } from '../ast/node-types';
import { Logger } from '../../util/logger';
import { getPublicMembersWithInheritance, mergeClassDefinitions } from '../util/ast-class-utils';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/tokens';
import { ITypeResolver } from '../types/type-resolver-interfaces';
import { IWorkspaceManager } from '../workspace/workspace-interfaces';
import { IASTCompletionProvider } from './ast-completion-provider-interfaces';

// Import shared utilities
import { 
    extractBaseClassName, 
    extractBaseClassNameWithoutGenerics
} from '../util/type-utils';

// Import shared generic type utilities
import { 
    applyGenericSubstitution,
} from '../util/generic-type-utils';

/**
 * Enhanced completion provider using AST-based analysis
 * This replaces regex patterns and brace counting with structured AST traversal
 */
@injectable()
export class ASTCompletionProvider implements IASTCompletionProvider {
    constructor(
        @inject(TYPES.ITypeResolver) private typeResolver: ITypeResolver,
        @inject(TYPES.IWorkspaceManager) private workspaceManager: IWorkspaceManager
    ) {
    }

    // ============================================================================
    // PRIMARY AST-BASED COMPLETION METHODS
    // ============================================================================

    /**
     * Get member completions using AST-based analysis
     * This replaces the regex-based getMemberCompletions method
     */
    async getMemberCompletions(objectName: string, doc: TextDocument, knownType?: string | null, position?: Position): Promise<Declaration[]> {
        try {
            // Resolve object type if not provided (this may include generics like "array<PlayerBase>")
            const objectType = knownType || this.typeResolver.resolveObjectType(objectName, doc, position);
            
            if (!objectType) {
                Logger.warn(`❌ ASTCompletionProvider: Could not resolve type for object "${objectName}"`);
                return [];
            }

            // Extract base class name (strip modifiers but preserve generics for substitution)
            const typeWithoutModifiers = extractBaseClassName(objectType);
            
            // Parse generic type to separate base class from generic arguments
            // e.g., "array<PlayerBase>" -> baseClass: "array", typeArgs: ["PlayerBase"]
            const baseClassName = extractBaseClassNameWithoutGenerics(typeWithoutModifiers);
            const fullTypeForSubstitution = typeWithoutModifiers; // Keep full type for generic substitution
            
            Logger.debug(`🔧 ASTCompletionProvider: Base class name: "${baseClassName}", full type: "${fullTypeForSubstitution}"`);

            // Use AST-based approach
            const astMembers = await this.getMembersViaAST(baseClassName, fullTypeForSubstitution, doc, position);
            if (astMembers.length > 0) {
                Logger.info(`✅ ASTCompletionProvider: AST found ${astMembers.length} members for "${baseClassName}"`);
                return astMembers;
            }

            Logger.warn(`❌ ASTCompletionProvider: No members found for "${baseClassName}"`);
            return [];

        } catch (error) {
            Logger.error(`❌ ASTCompletionProvider: Error in getMemberCompletionsAST:`, error);
            return [];
        }
    }

    /**
     * Get members using AST-based approach
     */
    private async getMembersViaAST(className: string, fullType: string, _doc: TextDocument, _position?: Position): Promise<Declaration[]> {
        // Find matching classes using TypeResolver (with just base class name)
        const matchingClasses = this.typeResolver.findAllClassDefinitions(className);
        Logger.debug(`🔍 ASTCompletionProvider: Found ${matchingClasses.length} matching classes for "${className}" (fullType: "${fullType}")`);

        if (matchingClasses.length > 0) {
            const mergedClass = mergeClassDefinitions(matchingClasses);
            if (mergedClass) {
                // Use getPublicMembersWithInheritance to get all accessible members
                // This already handles inheritance and access control properly
                const members = getPublicMembersWithInheritance(mergedClass, (name) => {
                    const defs = this.typeResolver.findAllClassDefinitions(name);
                    return mergeClassDefinitions(defs);
                });
                
                Logger.debug(`🔗 ASTCompletionProvider: Found ${members.length} members for "${className}"`);
                
                // Apply generic type substitution if the full type has generic arguments
                // e.g., if fullType is "array<PlayerBase>", substitute T with PlayerBase
                const substitutedMembers = applyGenericSubstitution(members, fullType, mergedClass);
                return substitutedMembers;
            }
        }

        // Try class discovery for external classes
        const classDiscovery = this.workspaceManager.getClassDiscovery();
        if (classDiscovery) {
            const includePaths = this.workspaceManager.getIncludePaths();
            await classDiscovery.loadClassFromIncludePaths(className, includePaths);
            
            // Retry after loading
            const retriedClasses = this.typeResolver.findAllClassDefinitions(className);
            if (retriedClasses.length > 0) {
                Logger.info(`✅ ASTCompletionProvider: Found "${className}" after include scan`);
                const mergedClass = mergeClassDefinitions(retriedClasses);
                if (mergedClass) {
                    const inheritedMembers = getPublicMembersWithInheritance(mergedClass, (name) => {
                        const defs = this.typeResolver.findAllClassDefinitions(name);
                        return mergeClassDefinitions(defs);
                    });
                    
                    // Apply generic substitution here too
                    const substitutedMembers = applyGenericSubstitution(inheritedMembers, fullType, mergedClass);
                    return substitutedMembers;
                }
            }
        }

        return [];
    }
}
