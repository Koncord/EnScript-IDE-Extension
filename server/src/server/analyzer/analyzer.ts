import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import { normalizeUri } from '../../util/uri';
import { 
    ClassDeclNode, 
    Declaration, 
    FunctionDeclNode, 
    MethodDeclNode,
    VarDeclNode, 
    Expression
} from '../ast/node-types';

// Import the extracted modules
import { ITypeResolver } from '../types/type-resolver-interfaces';
import { ScopeContext } from '../scopes/ast-scope-resolver';
import { IASTScopeResolver } from '../scopes/ast-scope-resolver-interfaces';
import { getTypeName } from './symbol-formatter';
import { IDocumentCacheManager } from '../cache/document-cache-interfaces';
import { IASTCompletionProvider } from './ast-completion-provider-interfaces';
import { isPrimitiveType } from '../util/type-utils';
import { createEngineConstantsDocument } from '../virtual/engine-constants';
import { TYPES } from '../di';

import { Logger } from '../../util/logger';
import { isPrivateDeclaration } from '../../util';
import { isClass, isEnum, isFunction, isMethod, isTypedef, isTypeReference, isVarDecl } from '../util/ast-class-utils';
import { injectable, inject } from 'inversify';
import { IAnalyzer } from './analyzer-interfaces';

// Import keywords for autocompletion
import { 
    declarationKeywords,
    modifierKeywords,
    typeKeywords,
    controlKeywords,
    storageKeywords,
    literalKeywords
} from '../lexer/rules';

@injectable()
export class Analyzer implements IAnalyzer {
    constructor(
        @inject(TYPES.IDocumentCacheManager) private cacheManager: IDocumentCacheManager,
        @inject(TYPES.ITypeResolver) private typeResolver: ITypeResolver,
        @inject(TYPES.IASTScopeResolver) private astScopeResolver: IASTScopeResolver,
        @inject(TYPES.IASTCompletionProvider) private completionProvider: IASTCompletionProvider,
    ) {
        // Load engine-provided constants as a virtual document
        const engineConstantsDoc = createEngineConstantsDocument();
        this.cacheManager.ensureDocumentParsed(engineConstantsDoc);
        Logger.info('✨ Loaded engine constants virtual document');

        // Register cache change callback to invalidate type resolver caches
        this.cacheManager.onCacheChange((uri: string) => {
            this.typeResolver.invalidateCachesForDocument(uri);
        });
    }

    // ============================================================================
    // DUMP/DEBUG METHODS
    // ============================================================================

    /**
     * Dump all classes for debugging
     */
    public dumpClasses(): unknown[] {
        const classes: unknown[] = [];
        
        for (const [uri, ast] of this.cacheManager.getDocCache().entries()) {
            for (const decl of ast.body) {
                if (isClass(decl)) {
                    classes.push({
                        name: decl.name,
                        uri,
                        baseClass: decl.baseClass ? 
                            (isTypeReference(decl.baseClass) ? decl.baseClass.name : 'unknown') : 
                            null,
                        modifiers: decl.modifiers,
                        memberCount: decl.members.length,
                        position: {
                            line: decl.start.line,
                            character: decl.start.character
                        }
                    });
                }
            }
        }

        Logger.debug(`dumpClasses: Found ${classes.length} class(es)`);
        return classes;
    }

    /**
     * Dump diagnostics for debugging
     */
    public dumpDiagnostics(): unknown[] {
        const diagnostics: unknown[] = [];
        
        for (const [uri, errors] of this.cacheManager.getAllParsingErrors()) {
            diagnostics.push({
                uri,
                errorCount: errors.length,
                errors: errors.map(e => ({
                    message: e.message,
                    severity: e.severity,
                    line: e.range.start.line,
                    character: e.range.start.character
                }))
            });
        }

        Logger.debug(`dumpDiagnostics: ${diagnostics.length} document(s) with errors`);
        return diagnostics;
    }

    // LSP Method Implementations
    public async getCompletions(doc: TextDocument, position: Position): Promise<CompletionItem[]> {
        try {
            const ideAst = this.cacheManager.ensureDocumentParsedForIde(doc);
            const uri = normalizeUri(doc.uri);
            
            // Temporarily store the IDE-parsed AST in the main cache for type resolution
            const originalAst = this.cacheManager.getDocCache().get(uri);
            this.cacheManager.getDocCache().set(uri, ideAst);
            
            try {
                Logger.debug(`🎯 Using ASTCompletionProvider for completions at ${position.line}:${position.character}`);
                
                // Check if we're in a member completion context (e.g., "object.")
                const text = doc.getText();
                const offset = doc.offsetAt(position);
                const isMemberContext = this.isMemberCompletionContext(text, offset);
                
                Logger.debug(`🔍 Member context check: ${isMemberContext}, offset: ${offset}, text around cursor: "${text.substring(Math.max(0, offset - 20), offset + 5)}"`);
                
                if (isMemberContext) {
                    // Member completion - extract object name and use AST provider
                    const objectName = this.extractObjectName(text, offset);
                    if (objectName) {
                        Logger.debug(`✅ Member completion for object: "${objectName}"`);
                        const members = await this.completionProvider.getMemberCompletions(objectName, doc, null, position);
                        
                        // Convert Declaration[] to CompletionItem[]
                        return this.declarationsToCompletionItems(members, doc, position);
                    } else {
                        Logger.warn(`⚠️ Member context detected but couldn't extract object name`);
                    }
                }
                
                // Non-member completion - provide context-aware completions based on scope
                Logger.debug('Providing scope-based completions');
                
                // Get scope context using ASTScopeResolver
                const scopeContext = this.astScopeResolver.getScopeContext(doc, position);
                
                // Check if we're in class body but not in a method (offer override completions)
                if (scopeContext.containingClass && !scopeContext.containingFunction) {
                    Logger.debug('Providing override completions for class body');
                    const overrideItems = this.getOverrideCompletions(scopeContext.containingClass);
                    const scopedItems = this.getScopedCompletions(scopeContext, uri, doc, position);
                    return [...overrideItems, ...scopedItems];
                }
                
                // Otherwise, provide scope-based completions
                return this.getScopedCompletions(scopeContext, uri, doc, position);
                
            } finally {
                // Restore original AST in main cache
                if (originalAst) {
                    this.cacheManager.getDocCache().set(uri, originalAst);
                } else {
                    this.cacheManager.getDocCache().delete(uri);
                }
            }
        } catch (error) {
            Logger.error('Error in getCompletions:', error);
            return [];
        }
    }

    /**
     * Convert Declaration[] to CompletionItem[]
     */
    private declarationsToCompletionItems(members: Declaration[], doc?: TextDocument, position?: Position): CompletionItem[] {
        // Check if we're at the start of a line (likely a statement, not an expression)
        const isStatementContext = position && doc ? this.isStatementContext(doc, position) : false;
        
        return members.map(member => this.declarationToCompletionItem(member, doc, position, isStatementContext));
    }
    
    /**
     * Check if we're in a statement context (vs an expression context)
     * Statement context means we should add semicolon after function calls
     */
    private isStatementContext(doc: TextDocument, position: Position): boolean {
        const text = doc.getText();
        const offset = doc.offsetAt(position);
        
        // Look at the character after the cursor position
        const restOfLine = text.substring(offset, text.indexOf('\n', offset));
        
        // If there's nothing significant after (no operators, commas, semicolons already there), 
        // we're likely in statement context
        const hasOperatorAfter = /^\s*[+\-*/%&|<>=!,]/.test(restOfLine);
        const hasSemicolonAfter = /^\s*;/.test(restOfLine);
        
        // Statement context if: no operator after, and no semicolon already present
        return !hasOperatorAfter && !hasSemicolonAfter;
    }

    /**
     * Check if we're in a member completion context (after a dot)
     */
    private isMemberCompletionContext(text: string, offset: number): boolean {
        let i = offset - 1;
        
        // Skip any identifier characters we're currently typing
        while (i >= 0 && /[a-zA-Z0-9_]/.test(text[i])) {
            i--;
        }
        
        // Skip whitespace
        while (i >= 0 && /\s/.test(text[i])) {
            i--;
        }
        
        // Check if we're right after a dot
        return i >= 0 && text[i] === '.';
    }

    /**
     * Extract the object name before the dot
     */
    private extractObjectName(text: string, offset: number): string | null {
        let i = offset - 1;
        
        // Skip any identifier characters we're currently typing
        while (i >= 0 && /[a-zA-Z0-9_]/.test(text[i])) {
            i--;
        }
        
        // Skip whitespace after dot
        while (i >= 0 && /\s/.test(text[i])) {
            i--;
        }
        
        // Should be at the dot
        if (i < 0 || text[i] !== '.') {
            return null;
        }
        i--; // Move before the dot
        
        // Skip whitespace before dot
        while (i >= 0 && /\s/.test(text[i])) {
            i--;
        }
        
        const end = i;
        
        // Handle method calls and chained expressions
        let parenDepth = 0;
        while (i >= 0) {
            const char = text[i];
            if (char === ')') {
                parenDepth++;
            } else if (char === '(') {
                parenDepth--;
                if (parenDepth < 0) {
                    i++;
                    break;
                }
            } else if (parenDepth === 0 && !/[a-zA-Z0-9_$.]/.test(char)) {
                i++;
                break;
            }
            i--;
        }
        
        if (i < 0) i = 0;
        
        const objectName = text.substring(i, end + 1).trim();
        Logger.debug(`📝 Extracted object name: "${objectName}" from position ${offset}`);
        return objectName;
    }

    /**
     * Convert Declaration kind to CompletionItemKind
     */
    private declarationKindToCompletionItemKind(kind: string): CompletionItemKind {
        // CompletionItemKind enum values
        switch (kind) {
            case 'ClassDecl': return CompletionItemKind.Class;
            case 'FunctionDecl':
            case 'MethodDecl': return CompletionItemKind.Function;
            case 'VarDecl': return CompletionItemKind.Variable;
            case 'ParameterDecl': return CompletionItemKind.Variable;
            case 'EnumDecl': return CompletionItemKind.Enum;
            case 'EnumMemberDecl': return CompletionItemKind.EnumMember;
            case 'TypedefDecl': return CompletionItemKind.TypeParameter;
            default: return CompletionItemKind.Variable; // default
        }
    }

    /**
     * Format member detail for completion item
     */
    private formatMemberDetail(member: Declaration, doc?: TextDocument): string {
        // Type guard for method declarations
        if (isMethod(member)) {
            const funcMember = member as MethodDeclNode;
            // Format function signature
            const params = funcMember.parameters?.map((p) => `${p.name}: ${getTypeName(p.type)}`).join(', ') || '';
            const returnType = getTypeName(funcMember.returnType);
            return `${member.name}(${params}): ${returnType}`;
        }
        // Type guard for variable declarations
        if (isVarDecl(member)) {
            let typeName = getTypeName(member.type);
            
            // If type is 'auto', try to infer it from the initializer
            if (typeName === 'auto' && member.initializer && doc) {
                const inferredType = this.inferTypeFromInitializer(member, doc);
                if (inferredType) {
                    typeName = inferredType;
                }
            }
            
            return `${member.name}: ${typeName}`;
        }
        return member.name || '';
    }

    /**
     * Infer type from variable initializer for auto variables
     */
    private inferTypeFromInitializer(varMember: VarDeclNode, doc: TextDocument): string | null {
        if (!varMember.initializer) {
            return null;
        }

        // Use the document's AST context for type resolution
        const uri = normalizeUri(doc.uri);
        const ast = this.cacheManager.getDocCache().get(uri);
        if (!ast) {
            return null;
        }

        // Use the type resolver's expression type resolution
        const context = ast;
        const inferredType = this.typeResolver.resolveExpressionType(varMember.initializer as Expression, context, doc);
        
        return inferredType;
    }

    /**
     * Get scope-based completions (locals, parameters, class members, inherited members, globals)
     */
    private getScopedCompletions(scopeContext: ScopeContext, uri: string, doc?: TextDocument, position?: Position): CompletionItem[] {
        const items: CompletionItem[] = [];
        const seen = new Set<string>();
        
        // Check if we're in statement context
        const isStatementContext = position && doc ? this.isStatementContext(doc, position) : false;

        // Helper to add unique items with sort priority
        const addItem = (decl: Declaration, sortPriority: string) => {
            if (!seen.has(decl.name)) {
                seen.add(decl.name);
                const item = this.declarationToCompletionItem(decl, doc, position, isStatementContext);
                // Use sortText to control ordering: lower values appear first
                item.sortText = `${sortPriority}_${decl.name}`;
                items.push(item);
            }
        };

        // 1. Local variables from containing function
        if (scopeContext.containingFunction) {
            const locals = scopeContext.containingFunction.locals || [];
            for (const local of locals) {
                if (isVarDecl(local)) {
                    addItem(local, '0');
                }
            }
        }

        // 2. Function parameters
        if (scopeContext.containingFunction) {
            const params = scopeContext.containingFunction.parameters || [];
            for (const param of params) {
                addItem(param, '1');
            }
        }

        // 3. Class members (if in a class method) - includes 'this' access
        if (scopeContext.containingClass) {
            for (const member of scopeContext.containingClass.members) {
                addItem(member, '2');
            }

            // Also add inherited members from base class
            if (isTypeReference(scopeContext.containingClass.baseClass)) {
                const baseClassName = scopeContext.containingClass.baseClass.name;
                const baseClasses = this.typeResolver.findAllClassDefinitions(baseClassName);
                for (const baseClass of baseClasses) {
                    for (const member of baseClass.members) {
                        // Only include public/protected members from base class
                        const isPublic = !isPrivateDeclaration(member);
                        if (isPublic) {
                            addItem(member, '2');
                        }
                    }
                }
            }
        }

        // 4. Global symbols from all documents
        const ast = this.cacheManager.getDocCache().get(uri);
        if (ast) {
            for (const decl of ast.body) {
                // Only include top-level declarations
                if (isClass(decl) ||
                    isFunction(decl) ||
                    isEnum(decl) ||
                    isTypedef(decl) ||
                    isVarDecl(decl)) {
                    addItem(decl, '3');
                }
            }
        }

        // Also include globals from other documents (lower priority)
        for (const [otherUri, otherAst] of this.cacheManager.getDocCache().entries()) {
            if (otherUri !== uri) {
                for (const decl of otherAst.body) {
                    if (isClass(decl) ||
                        isFunction(decl) ||
                        isEnum(decl)) {
                        addItem(decl, '4');
                    }
                }
            }
        }

        // 5. Add language keywords (lowest priority)
        const keywordItems = this.getKeywordCompletions();
        for (const keywordItem of keywordItems) {
            if (!seen.has(keywordItem.label)) {
                seen.add(keywordItem.label);
                keywordItem.sortText = `5_${keywordItem.label}`;
                items.push(keywordItem);
            }
        }

        return items;
    }

    /**
     * Get keyword completion items
     */
    private getKeywordCompletions(): CompletionItem[] {
        const items: CompletionItem[] = [];

        // Helper function to create keyword completion items
        const createKeywordItem = (keyword: string, category: string): CompletionItem => ({
            label: keyword,
            kind: CompletionItemKind.Keyword,
            detail: `${category} keyword`,
            documentation: `${category.charAt(0).toUpperCase() + category.slice(1)} keyword: ${keyword}`
        });

        // Helper function to create control flow keyword with snippet
        const createControlFlowItem = (keyword: string, snippet: string, description: string): CompletionItem => ({
            label: keyword,
            kind: CompletionItemKind.Snippet,
            detail: `${keyword} statement`,
            documentation: description,
            insertText: snippet,
            insertTextFormat: 2 // Snippet format
        });

        // Add all keyword categories
        for (const keyword of declarationKeywords) {
            items.push(createKeywordItem(keyword, 'declaration'));
        }

        for (const keyword of modifierKeywords) {
            items.push(createKeywordItem(keyword, 'modifier'));
        }

        for (const keyword of typeKeywords) {
            items.push(createKeywordItem(keyword, 'type'));
        }

        // Control flow keywords with smart snippets
        for (const keyword of controlKeywords) {
            switch (keyword) {
                case 'if':
                    items.push(createControlFlowItem(
                        'if',
                        'if ($1)$0',
                        'if statement with condition and block'
                    ));
                    break;
                case 'for':
                    items.push(createControlFlowItem(
                        'for',
                        'for (${1:int i = 0}; ${2:i < count}; ${3:i++})$0',
                        'for loop with initialization, condition, and increment'
                    ));
                    break;
                case 'foreach':
                    items.push(createControlFlowItem(
                        'foreach',
                        'foreach (${1:auto item} : ${2:collection})$0',
                        'foreach loop to iterate over collection'
                    ));
                    break;
                case 'while':
                    items.push(createControlFlowItem(
                        'while',
                        'while ($1)$0',
                        'while loop with condition'
                    ));
                    break;
                case 'switch':
                    items.push(createControlFlowItem(
                        'switch',
                        'switch ($1)$0',
                        'switch statement with case and default'
                    ));
                    break;
                case 'case':
                    items.push(createControlFlowItem(
                        'case',
                        'case ${1:value}:$0',
                        'case label in switch statement'
                    ));
                    break;
                case 'default':
                    items.push(createControlFlowItem(
                        'default',
                        'default:\n\t$0',
                        'default case in switch statement'
                    ));
                    break;
                case 'break':
                    items.push(createControlFlowItem(
                        'break',
                        'break;',
                        'break out of loop or switch'
                    ));
                    break;
                case 'continue':
                    items.push(createControlFlowItem(
                        'continue',
                        'continue;',
                        'continue to next iteration'
                    ));
                    break;
                default:
                    items.push(createKeywordItem(keyword, 'control flow'));
            }
        }

        for (const keyword of storageKeywords) {
            items.push(createKeywordItem(keyword, 'storage'));
        }

        for (const keyword of literalKeywords) {
            items.push(createKeywordItem(keyword, 'literal'));
        }

        return items;
    }

    /**
     * Get override completions for methods that can be overridden from base class
     */
    private getOverrideCompletions(classNode: ClassDeclNode): CompletionItem[] {
        const items: CompletionItem[] = [];

        if (!classNode.baseClass || !isTypeReference(classNode.baseClass)) {
            return items;
        }

        const baseClassName = classNode.baseClass.name;
        const baseClasses = this.typeResolver.findAllClassDefinitions(baseClassName);

        // Get existing method names in current class
        const existingMethods = new Set(
            classNode.members
                .filter(m => isMethod(m))
                .map(m => m.name)
        );

        // Suggest methods from base class that haven't been overridden
        for (const baseClass of baseClasses) {
            for (const member of baseClass.members) {
                if (isMethod(member) &&
                    !existingMethods.has(member.name) &&
                    !isPrivateDeclaration(member)) {

                    const item = this.declarationToCompletionItem(member);
                    item.detail = `override ${item.detail || 'method'}`;
                    item.kind = CompletionItemKind.Method;

                    // Add snippet for override
                    const funcNode = member as FunctionDeclNode | MethodDeclNode;
                    const params = funcNode.parameters?.map(p => p.name).join(', ') || '';
                    item.insertText = `${member.name}(${params})\n{\n\t$0\n}`;
                    item.insertTextFormat = 2; // Snippet

                    items.push(item);
                }
            }
        }

        return items;
    }

    /**
     * Convert a Declaration to a CompletionItem
     */
    private declarationToCompletionItem(decl: Declaration, doc?: TextDocument, _position?: Position, _isStatementContext?: boolean): CompletionItem {
        const item: CompletionItem = {
            label: decl.name,
            kind: this.declarationKindToCompletionItemKind(decl.kind),
            detail: this.formatMemberDetail(decl, doc),
            documentation: decl.annotations?.join('\n')
        };

        // Add smart insertText based on declaration type
        const declName = decl.name || '';

        // 1. Functions/Methods: add () and place cursor inside, optionally add semicolon
        if (isFunction(decl) || isMethod(decl)) {
            const funcDecl = decl as FunctionDeclNode | MethodDeclNode;
            const hasParams = funcDecl.parameters && funcDecl.parameters.length > 0;
            const hasReturnType = funcDecl.returnType && getTypeName(funcDecl.returnType).toLowerCase() !== 'void';
            
            
            // In statement context, add semicolon (user is calling function as statement, ignoring return value)
            if (!hasReturnType) {
                if (!hasParams) {
                    item.insertText = `${declName}();$0`;
                } else {
                    item.insertText = `${declName}($1);$0`;
                }
            } else {
                if (!hasParams) {
                    item.insertText = `${declName}()$0`;
                } else {
                    item.insertText = `${declName}($1)$0`;
                }
            }
            item.insertTextFormat = 2; // InsertTextFormat.Snippet
        }
        // 2. Classes: don't add any suffix
        // Classes are types, used in both declarations (PlayerBase myVar) and static access (PlayerBase.Method)
        // Let the user type space or dot depending on their intent
        else if (isClass(decl)) {
            // No special insertText needed - just insert the class name
        }
        // 3. Variables: check if type is non-primitive
        else if (isVarDecl(decl)) {
            const varDecl = decl as VarDeclNode;
            if (varDecl.type) {
                let typeName = getTypeName(varDecl.type).toLowerCase();
                
                // For auto variables, infer the actual type from initializer
                if (typeName === 'auto' && doc) {
                    const inferredType = this.inferTypeFromInitializer(varDecl, doc);
                    if (inferredType) {
                        typeName = inferredType.toLowerCase();
                    }
                }
                
                // Check type structure from AST
                // Check if type has 'ref' modifier (ref is now a modifier, not a separate RefType)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const isRef = isTypeReference(varDecl.type) && (varDecl.type as any).modifiers?.includes('ref');
                const isPrimitive = isPrimitiveType(typeName);
                
                // Add dot for non-primitive, non-ref, non-generic types (simple objects)
                if (!isPrimitive && !isRef) {
                    item.insertText = `${declName}.$0`;
                    item.insertTextFormat = 2; // InsertTextFormat.Snippet
                }
            }
        }

        return item;
    }
}
