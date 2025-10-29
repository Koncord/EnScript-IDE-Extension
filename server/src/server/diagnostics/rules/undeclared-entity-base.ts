import {
    BaseDiagnosticRule,
    DiagnosticCategory,
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult
} from '../rules';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { FunctionDeclNode, VarDeclNode, ClassDeclNode, ASTNode, MethodDeclNode, Declaration } from '../../ast';
import { Logger } from '../../../util/logger';
import { isClass, isEnum, isTypedef, isCallExpression, isMemberExpression, isStaticDeclaration } from '../../util/ast-class-utils';
import {
    isMethod,
    isVarDecl,
    isIdentifier
} from '../../util/ast-class-utils';
import {
    isLanguageKeyword as isLanguageKeywordUtil,
    isEnumName as isEnumNameUtil,
    isTypeDeclared as isTypeDeclaredUtil,
    isLikelyIncompleteStub as isLikelyIncompleteStubUtil,
    tryLoadClassFromIncludes as tryLoadClassFromIncludesUtil,
    extractTypeName as extractTypeNameUtil,
    extractTypeArguments as extractTypeArgumentsUtil,
    findMemberInClassHierarchy as findMemberInClassHierarchyUtil,
    resolvePropertyType as resolvePropertyTypeUtil,
    resolveMethodReturnType as resolveMethodReturnTypeUtil,
    findContainingClass as findContainingClassUtil,
    SymbolResolutionContext
} from '../../util/symbol-resolution-utils';
import { isBuiltInType } from '../../util/type-utils';

/**
 * Base class for all "undeclared entity" diagnostic rules.
 * Provides common functionality for checking if entities (functions, variables, types, methods) are declared.
 */
export abstract class UndeclaredEntityRule extends BaseDiagnosticRule {
    readonly category = DiagnosticCategory.SEMANTIC;
    readonly defaultSeverity: DiagnosticSeverity = DiagnosticSeverity.Error;

    /**
     * Check if a name is a language keyword or built-in construct
     */
    protected isLanguageKeyword(name: string): boolean {
        return isLanguageKeywordUtil(name);
    }

    /**
     * Check if a type name is a generic parameter of the containing class
     */
    protected isGenericParameter(typeName: string, node: ASTNode, context: DiagnosticRuleContext, containingClass: ClassDeclNode | null): boolean {
        if (!containingClass || !containingClass.genericParameters) {
            return false;
        }

        for (const genericParam of containingClass.genericParameters) {
            if (genericParam.name === typeName) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get the name of the class that contains the current context
     */
    protected getCurrentClassName(context: DiagnosticRuleContext): string | null {
        for (const node of context.ast.body) {
            if (isClass(node)) {
                return node.name;
            }
        }

        return null;
    }

    /**
     * Check if a class/type is declared
     */
    protected isTypeDeclared(typeName: string, context: DiagnosticRuleContext, containingClass: ClassDeclNode | null): boolean {
        return isTypeDeclaredUtil(
            typeName,
            context.ast,
            context.typeResolver,
            containingClass || undefined
        );
    }

    /**
     * Check if a type name is a built-in type
     */
    protected isBuiltInType(typeName: string): boolean {
        return isBuiltInType(typeName);
    }

    /**
     * Check if a name is an enum name (with caching)
     */
    protected isEnumName(name: string, context: DiagnosticRuleContext): boolean {
        // Check cache first
        if (context.sharedCache?.enumNameCache) {
            const cached = context.sharedCache.enumNameCache.get(name);
            if (cached !== undefined) {
                return cached;
            }
        }

        // Compute and cache result
        const result = isEnumNameUtil(name, context.ast, context.typeResolver);
        
        if (context.sharedCache) {
            if (!context.sharedCache.enumNameCache) {
                context.sharedCache.enumNameCache = new Map();
            }
            context.sharedCache.enumNameCache.set(name, result);
        }
        
        return result;
    }

    /**
     * Check if a class definition appears to be an incomplete stub
     */
    protected isLikelyIncompleteStub(className: string, classDefinitions: ClassDeclNode[], context: DiagnosticRuleContext): boolean {
        return isLikelyIncompleteStubUtil(className, classDefinitions, context.includePaths, context.openedDocumentUris);
    }

    /**
     * Load class definitions from include paths if available (with caching)
     */
    protected async tryLoadClassFromIncludes(className: string, context: DiagnosticRuleContext): Promise<ClassDeclNode[]> {
        // Check cache first
        if (context.sharedCache?.classDefinitionsCache) {
            const cached = context.sharedCache.classDefinitionsCache.get(className);
            if (cached !== undefined) {
                return cached;
            }
        }

        const resolveContext: SymbolResolutionContext = {
            document: context.document,
            typeResolver: context.typeResolver,
            includePaths: context.includePaths,
            loadClassFromIncludePaths: context.loadClassFromIncludePaths,
            openedDocumentUris: context.openedDocumentUris
        };
        
        const result = await tryLoadClassFromIncludesUtil(className, resolveContext);
        
        // Cache the result
        if (context.sharedCache?.classDefinitionsCache) {
            context.sharedCache.classDefinitionsCache.set(className, result);
        }
        
        return result;
    }

    /**
     * Create a standardized undeclared entity diagnostic
     */
    protected createUndeclaredDiagnostic(
        entityType: string,
        entityName: string,
        start: { line: number; character: number },
        end: { line: number; character: number },
        config: DiagnosticRuleConfig,
        additionalContext?: string
    ): DiagnosticRuleResult {
        // Use consistent message format for backward compatibility with tests
        let message: string;
        if (entityType.toLowerCase() === 'variable') {
            message = `Cannot find name '${entityName}'`;
        } else if (entityType.toLowerCase() === 'type') {
            message = `Cannot find type '${entityName}'`;
        } else {
            const contextStr = additionalContext ? ` ${additionalContext}` : '';
            message = `${entityType} '${entityName}' is not declared${contextStr}`;
        }

        return this.createDiagnostic(
            message,
            start,
            end,
            config.severity,
            this.id
        );
    }

    /**
     * Get standardized documentation template for undeclared rules
     */
    protected getUndeclaredDocumentation(entityType: string, examples: { bad: string; good: string }): string {
        return `# Undeclared ${entityType} Rule

This rule detects usage of ${entityType.toLowerCase()}s that have not been declared in the current scope.

## Examples

**Bad:**
\`\`\`c
${examples.bad}
\`\`\`

**Good:**
\`\`\`c
${examples.good}
\`\`\`

## Configuration

- \`enabled\`: Enable or disable this rule (default: true)
- \`severity\`: Diagnostic severity level (default: ERROR)`;
    }

    /**
     * Get standardized suggestions for undeclared entities
     */
    protected getUndeclaredSuggestions(entityType: string, entityName: string): string[] {
        return [
            `Declare ${entityType.toLowerCase()} '${entityName}' before using it`,
            `Check if '${entityName}' is spelled correctly`,
            `Verify '${entityName}' is accessible in the current scope`
        ];
    }

    /**
     * Check if a method is declared on the given object's type
     */
    protected async isMethodDeclared(objectName: string, methodName: string, context: DiagnosticRuleContext): Promise<boolean> {
        Logger.info(`🔍 Checking method '${methodName}' on object '${objectName}'`);

        if (!context.typeResolver) {
            Logger.warn(`🔍 No type resolver available for method check`);
            return true; // Can't validate without type resolver
        }

        // First check if objectName is actually a class name (for static method calls)
        const classDefinitions = context.typeResolver.findAllClassDefinitions(objectName);
        let objectType: string | null = null;
        let isStaticMethodCall = false;

        if (classDefinitions.length > 0) {
            // objectName is a class name - this is a static method call
            objectType = objectName;
            isStaticMethodCall = true;
            Logger.info(`🔍 '${objectName}' is a class name (static method call)`);
        } else {
            // objectName is not a class name - resolve it as a variable type
            objectType = context.typeResolver.resolveObjectType(objectName, context.document);
            Logger.info(`🔍 Resolved object type for '${objectName}': ${objectType}`);
        }

        if (!objectType) {
            // Can't resolve type, assume it's valid to avoid false positives
            Logger.warn(`🔍 Could not resolve object type for '${objectName}'`);
            return true;
        }

        // Use the unified member hierarchy check
        const resolveContext: SymbolResolutionContext = {
            document: context.document,
            typeResolver: context.typeResolver,
            includePaths: context.includePaths,
            loadClassFromIncludePaths: context.loadClassFromIncludePaths
        };

        return await findMemberInClassHierarchyUtil(
            objectType,
            methodName,
            isStaticMethodCall,
            resolveContext,
            false // Don't allow private
        ) !== null;
    }

    /**
     * Find the class that contains the given node (with caching)
     */
    protected findContainingClass(node: ASTNode, context: DiagnosticRuleContext): ClassDeclNode | null {
        // Check cache first
        if (context.sharedCache?.containingClassCache) {
            const cached = context.sharedCache.containingClassCache.get(node);
            if (cached !== undefined) {
                return cached;
            }
        }

        // Compute and cache result
        const result = findContainingClassUtil(node, context.ast);
        
        if (context.sharedCache) {
            if (!context.sharedCache.containingClassCache) {
                context.sharedCache.containingClassCache = new Map();
            }
            context.sharedCache.containingClassCache.set(node, result);
        }
        
        return result;
    }

    /**
     * Check if the given node is within a static method context
     */
    protected isInStaticMethodContext(node: ASTNode, _context: DiagnosticRuleContext): boolean {
        // Walk up the AST parent chain to find the containing method
        let current: ASTNode | undefined = node;
        while (current) {
            if (isMethod(current)) {
                // Check if the method has the 'static' modifier
                return isStaticDeclaration(current);
            }
            // Move to parent
            current = current.parent;
        }
        
        return false; // Not in a method, or in a non-static method
    }

    /**
     * Build a scope of available variables for a function
     */
    protected buildVariableScope(functionNode: FunctionDeclNode | MethodDeclNode, context: DiagnosticRuleContext): Set<string> {
        const variables = new Set<string>();

        // Add function parameters
        for (const param of functionNode.parameters) {
            variables.add(param.name);
        }

        // Add local variables declared in the function
        if (functionNode.locals) {
            for (const local of functionNode.locals) {
                variables.add(local.name);
            }
        }

        // Add global variables/constants from the current file
        for (const node of context.ast.body) {
            // Add global variable declarations (including constants)
            if (isVarDecl(node)) {
                const varNode = node as VarDeclNode;
                variables.add(varNode.name);
            }
        }

        // Add class member variables if this is a method
        const currentClass = this.findContainingClass(functionNode, context);
        if (currentClass) {
            for (const member of currentClass.members) {
                if (isVarDecl(member)) {
                    variables.add(member.name);
                }
            }
        }

        // Add some common built-in variables/keywords that shouldn't be flagged
        const builtins = [
            'this', 'super', 'base', 'null', 'true', 'false'
        ];

        for (const builtin of builtins) {
            variables.add(builtin);
        }

        // Add known class names to scope so they won't be flagged in static calls
        this.addKnownClassesToScope(variables, context);

        return variables;
    }

    /**
     * Add known classes to the variable scope so they won't be flagged as undeclared
     */
    protected addKnownClassesToScope(variables: Set<string>, context: DiagnosticRuleContext): void {
        // Get all class, enum, and typedef declarations in the current document
        for (const node of context.ast.body) {
            if (isClass(node)) {
                variables.add(node.name);
            } else if (isEnum(node)) {
                variables.add(node.name);
            } else if (isTypedef(node)) {
                variables.add(node.name);
            }
        }

        // If TypeResolver is available, add globally known classes
        if (context.typeResolver) {
            try {
                // Use the method that was in the original implementation
                const availableClassNames = context.typeResolver.getAllAvailableClassNames();
                for (const className of availableClassNames) {
                    variables.add(className);
                }

                const availableEnumNames = context.typeResolver.getAllAvailableEnumNames();
                for (const enumName of availableEnumNames) {
                    variables.add(enumName);
                }

                const availableTypedefs = context.typeResolver.getAllAvailableTypedefNames();
                for (const typedefName of availableTypedefs) {
                    variables.add(typedefName);
                }
            } catch (error) {
                Logger.warn('Error getting available classes from type resolver:', error);
                // Fallback to basic primitive types only
                const fallbackTypes = ['int', 'float', 'bool', 'string', 'void'];
                for (const type of fallbackTypes) {
                    variables.add(type);
                }
            }
        }
    }

    /**
     * Extract the function body text from the document
     */
    protected getFunctionBodyText(functionNode: FunctionDeclNode | MethodDeclNode, context: DiagnosticRuleContext): string | null {
        const document = context.document;
        const text = document.getText();

        // Find the opening brace position
        const functionStartOffset = document.offsetAt(functionNode.start);
        const bracePos = text.indexOf('{', functionStartOffset);
        if (bracePos === -1) {
            return null;
        }

        // Find the matching closing brace
        let braceCount = 0;
        let i = bracePos;
        while (i < text.length) {
            if (text[i] === '{') {
                braceCount++;
            } else if (text[i] === '}') {
                braceCount--;
                if (braceCount === 0) {
                    break;
                }
            }
            i++;
        }

        if (braceCount !== 0) {
            return null; // Unbalanced braces
        }

        // Return the text inside the braces (excluding the braces themselves)
        return text.slice(bracePos + 1, i);
    }

    /**
     * Get the start offset of the function body in the document
     * This is the position right after the opening brace '{'
     */
    protected getFunctionBodyStartOffset(functionNode: FunctionDeclNode | MethodDeclNode, context: DiagnosticRuleContext): number {
        const document = context.document;
        const text = document.getText();
        const functionStartOffset = document.offsetAt(functionNode.start);
        const bracePos = text.indexOf('{', functionStartOffset);
        return bracePos + 1; // Position after the opening brace
    }

    /**
     * Extract type name from a TypeNode
     * Handles different TypeNode structures (name, identifier properties)
     * Also handles GenericType to get the base type name
     * Note: ref is now a modifier on TypeReference, not a separate RefType node
     */
    protected extractTypeName(typeNode: ASTNode): string | null {
        return extractTypeNameUtil(typeNode);
    }

    /**
     * Get generic type arguments from a TypeNode
     * Handles different TypeNode structures (typeArguments, genericArgs properties)
     */
    protected extractTypeArguments(typeNode: ASTNode): ASTNode[] | null {
        return extractTypeArgumentsUtil(typeNode);
    }

    /**
     * Extract an identifier from a node safely with type checking
     * @param node The AST node to extract from
     * @param expectedKind The expected node kind (e.g., 'Identifier', 'MemberExpression')
     * @param identifierPath Path to the identifier in the node (e.g., ['callee'], ['object'], ['property'])
     * @returns The identifier name or null if extraction fails
     */
    protected extractIdentifierFromNode(
        node: ASTNode,
        expectedKind: string,
        identifierPath: string[]
    ): string | null {
        if (node.kind !== expectedKind) {
            return null;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let current: any = node;
        for (const pathSegment of identifierPath) {
            current = current[pathSegment];
            if (!current) {
                return null;
            }
        }

        if (!isIdentifier(current)) {
            return null;
        }

        return current.name;
    }

    /**
     * Find a member (method/function) in a class or its inheritance chain
     * This is a unified method that handles both static and instance members with proper modifier checking
     * @param className The class name to check
     * @param memberName The member name to look for
     * @param isStatic Whether to look for static members
     * @param context The diagnostic rule context
     * @param allowPrivate Whether to allow private members (default: false for external calls, true for internal)
     * @returns The member declaration and related info if found, null otherwise
     */
    protected async findMemberInClassHierarchy(
        className: string,
        memberName: string,
        isStatic: boolean,
        context: DiagnosticRuleContext,
        allowPrivate: boolean = false,
        excludeModded: boolean = false
    ): Promise<{ member: Declaration; uri: string; foundInClass: string; staticMismatch?: boolean } | null> {
        const resolveContext: SymbolResolutionContext = {
            document: context.document,
            typeResolver: context.typeResolver,
            includePaths: context.includePaths,
            loadClassFromIncludePaths: context.loadClassFromIncludePaths
        };
        return await findMemberInClassHierarchyUtil(
            className,
            memberName,
            isStatic,
            resolveContext,
            allowPrivate,
            excludeModded
        );
    }

    /**
     * Safely resolve the type of an object with position context and error handling
     * @param objectName The name of the object/variable to resolve
     * @param position The position in the document (for scope-aware resolution)
     * @param context The diagnostic rule context
     * @returns The resolved type name or null if resolution fails
     */
    protected safeResolveObjectType(
        objectName: string,
        position: { line: number; character: number },
        context: DiagnosticRuleContext
    ): string | null {
        if (!context.typeResolver) {
            Logger.warn(`🔍 No type resolver available for object type resolution`);
            return null;
        }

        try {
            const objectType = context.typeResolver.resolveObjectType(objectName, context.document, position);
            Logger.info(`🔍 Resolved object type for '${objectName}' at position ${position.line}:${position.character}: ${objectType}`);
            return objectType;
        } catch (error) {
            Logger.warn(`Error resolving object type for '${objectName}':`, error);
            return null;
        }
    }

    /**
     * Resolve the type of an object expression (handles simple identifiers, 'this', 'super', and method chaining)
     * 
     * Supports:
     * - Simple identifiers (e.g., obj in obj.method())
     * - 'this' keyword (resolves to containing class)
     * - 'super' keyword (resolves to parent class, with special handling for modded classes)
     * - Method chaining (e.g., GetGame().GetCallQueue())
     * - Nested member expressions (e.g., a.b.c())
     * 
     * @returns Object containing:
     *  - typeName: The resolved type name
     *  - isStaticAccess: true if accessing static members (direct class name reference)
     *  - isSuperAccess: true if this is a 'super' expression (important for filtering modded classes)
     */
    protected async resolveExpressionType(
        objectExpr: ASTNode,
        position: { line: number; character: number },
        context: DiagnosticRuleContext
    ): Promise<{ typeName: string; isStaticAccess: boolean; isSuperAccess: boolean } | null> {
        // Check cache first
        if (context.sharedCache?.expressionTypeCache) {
            const cached = context.sharedCache.expressionTypeCache.get(objectExpr);
            if (cached !== undefined) {
                return cached;
            }
        }

        // Compute result
        const result = await this.resolveExpressionTypeImpl(objectExpr, position, context);
        
        // Cache result
        if (context.sharedCache) {
            if (!context.sharedCache.expressionTypeCache) {
                context.sharedCache.expressionTypeCache = new Map();
            }
            context.sharedCache.expressionTypeCache.set(objectExpr, result);
        }
        
        return result;
    }

    /**
     * Internal implementation of resolveExpressionType (not cached)
     */
    private async resolveExpressionTypeImpl(
        objectExpr: ASTNode,
        position: { line: number; character: number },
        context: DiagnosticRuleContext
    ): Promise<{ typeName: string; isStaticAccess: boolean; isSuperAccess: boolean } | null> {
        if (!context.typeResolver) {
            Logger.warn(`🔍 No type resolver available for object type resolution`);
            return null;
        }

        // Simple identifier (e.g., obj in obj.method())
        if (isIdentifier(objectExpr)) {
            const objectName = objectExpr.name;
            
            // Check if it's a class name (for static member access)
            const classDefinitions = context.typeResolver.findAllClassDefinitions(objectName);
            if (classDefinitions.length > 0) {
                Logger.debug(`✅ '${objectName}' is a class name (static access)`);
                return { typeName: objectName, isStaticAccess: true, isSuperAccess: false };
            }
            
            // Check if it's an enum name (for enum member access)
            if (this.isEnumName(objectName, context)) {
                Logger.debug(`✅ '${objectName}' is an enum name (static access)`);
                return { typeName: objectName, isStaticAccess: true, isSuperAccess: false };
            }
            
            // Resolve as variable/object (instance access)
            const lspPosition = { line: position.line, character: position.character };
            const resolvedType = this.safeResolveObjectType(objectName, lspPosition, context);
            if (!resolvedType) {
                return null;
            }
            return { typeName: resolvedType, isStaticAccess: false, isSuperAccess: false };
        }

        // 'this' keyword (instance access)
        if (objectExpr.kind === 'ThisExpression') {
            const lspPosition = { line: position.line, character: position.character };
            const resolvedType = this.safeResolveObjectType('this', lspPosition, context);
            if (!resolvedType) {
                return null;
            }
            return { typeName: resolvedType, isStaticAccess: false, isSuperAccess: false };
        }

        // 'super' keyword (instance access to parent class)
        // Special handling: In EnScript, 'super' in a modded class refers to the original class,
        // while in a regular class it refers to the explicit base class.
        if (objectExpr.kind === 'SuperExpression') {
            // Find the containing class
            const containingClass = this.findContainingClass(objectExpr, context);
            if (!containingClass) {
                Logger.debug(`SuperExpression: No containing class found`);
                return null;
            }

            // Determine if this is a modded class
            const isModdedClass = containingClass.modifiers?.includes('modded') || false;
            
            let baseClassName: string | null = null;
            
            if (isModdedClass) {
                // Modded class scenario:
                // modded class PlayerBase { override void Init() { super.Init(); } }
                // Here, 'super' refers to the original (non-modded) PlayerBase class
                baseClassName = containingClass.name;
                Logger.debug(`SuperExpression: Modded class '${containingClass.name}' - super refers to original class '${baseClassName}'`);
            } else {
                // Regular inheritance scenario:
                // class Child extends Parent { override void Method() { super.Method(); } }
                // Here, 'super' refers to the explicit base class
                if (!containingClass.baseClass) {
                    Logger.debug(`SuperExpression: Class '${containingClass.name}' has no base class`);
                    return null;
                }

                baseClassName = this.extractTypeName(containingClass.baseClass);
                if (!baseClassName) {
                    Logger.debug(`SuperExpression: Could not extract base class name from '${containingClass.name}'`);
                    return null;
                }

                Logger.debug(`SuperExpression: Resolved to base class '${baseClassName}' from containing class '${containingClass.name}'`);
            }

            // Return with isSuperAccess: true to enable filtering of modded classes in member lookup
            return { typeName: baseClassName, isStaticAccess: false, isSuperAccess: true };
        }

        // Method chaining: CallExpression (e.g., GetGame() in GetGame().GetCallQueue())
        // This is always an instance call since we're calling a method on the returned object
        if (isCallExpression(objectExpr)) {
            const resolvedType = await this.resolveCallExpressionReturnType(objectExpr, position, context);
            if (!resolvedType) {
                return null;
            }
            return { typeName: resolvedType, isStaticAccess: false, isSuperAccess: false };
        }

        // Nested member expression (e.g., a.b in a.b.c())
        // This is always an instance call
        if (isMemberExpression(objectExpr)) {
            // First resolve the type of the nested member expression
            const nestedResult = await this.resolveExpressionType(objectExpr.object, position, context);
            if (!nestedResult) {
                return null;
            }

            // Then find the type of the property on that type
            const propertyName = objectExpr.property.name;
            const propertyType = await this.resolvePropertyOrFieldType(nestedResult.typeName, propertyName, context);
            if (!propertyType) {
                return null;
            }
            return { typeName: propertyType, isStaticAccess: false, isSuperAccess: false };
        }

        // Other complex expressions - skip for now
        Logger.debug(`UndeclaredEntityRule: Unsupported object expression kind: ${objectExpr.kind}`);
        return null;
    }

    /**
     * Resolve the return type of a CallExpression (e.g., GetGame())
     */
    protected async resolveCallExpressionReturnType(
        callExpr: ASTNode,
        position: { line: number; character: number },
        context: DiagnosticRuleContext
    ): Promise<string | null> {
        if (!context.typeResolver || !isCallExpression(callExpr)) {
            return null;
        }

        const callee = callExpr.callee;

        // Simple function call (e.g., GetGame() or GetSomeClass())
        if (isIdentifier(callee)) {
            const functionName = callee.name;
            
            // First, check if this is an implicit method call on 'this' (within a class context)
            // For example: GetSomeClass() inside a method of AnotherClass is actually this.GetSomeClass()
            const containingClass = this.findContainingClass(callExpr, context);
            if (containingClass) {
                Logger.debug(`🔍 Checking if '${functionName}' is a method on containing class '${containingClass.name}'`);
                
                // Check if this function name is actually a method of the current class
                const classHasMember = await this.findMemberInClassHierarchy(
                    containingClass.name,
                    functionName,
                    false, // instance method
                    context,
                    true  // allow private
                ) !== null;
                
                if (classHasMember) {
                    // This is an implicit 'this.functionName()' call
                    Logger.debug(`🔍 '${functionName}' is an instance method on '${containingClass.name}' - resolving as implicit this call`);
                    return await this.resolveMethodReturnTypeFromClass(containingClass.name, functionName, context);
                }
            }
            
            // Not an instance method - try as global function
            const returnType = context.typeResolver.getGlobalFunctionReturnType(functionName, context.document);
            Logger.debug(`🔍 Function '${functionName}' return type: ${returnType}`);
            return returnType;
        }

        // Method call on an object (e.g., obj.GetSomething())
        if (isMemberExpression(callee)) {

            // First resolve the object type
            const objectResult = await this.resolveExpressionType(callee.object, position, context);
            if (!objectResult) {
                return null;
            }

            // Then find the return type of the method
            const methodName = callee.property.name;
            return await this.resolveMethodReturnTypeFromClass(objectResult.typeName, methodName, context);
        }

        return null;
    }

    /**
     * Resolve the type of a property/field on a class
     */
    protected async resolvePropertyOrFieldType(
        className: string,
        propertyName: string,
        context: DiagnosticRuleContext
    ): Promise<string | null> {
        const resolveContext: SymbolResolutionContext = {
            document: context.document,
            typeResolver: context.typeResolver,
            includePaths: context.includePaths,
            loadClassFromIncludePaths: context.loadClassFromIncludePaths
        };
        
        return await resolvePropertyTypeUtil(className, propertyName, resolveContext);
    }

    /**
     * Resolve the return type of a method on a class
     */
    protected async resolveMethodReturnTypeFromClass(
        className: string,
        methodName: string,
        context: DiagnosticRuleContext
    ): Promise<string | null> {
        const resolveContext: SymbolResolutionContext = {
            document: context.document,
            typeResolver: context.typeResolver,
            includePaths: context.includePaths,
            loadClassFromIncludePaths: context.loadClassFromIncludePaths
        };
        
        return await resolveMethodReturnTypeUtil(className, methodName, resolveContext);
    }

}
