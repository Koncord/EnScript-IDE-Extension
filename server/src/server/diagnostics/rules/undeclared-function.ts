import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult
} from '../rules';
import { ASTNode, CallExpression, ClassDeclNode, Declaration } from '../../ast';
import { UndeclaredEntityRule } from './undeclared-entity-base';
import { findSymbolInFile } from '../../analyzer/symbol-lookup';
import { Logger } from '../../../util/logger';
import { isFunction, isIdentifier, isMemberExpression, isCallExpression } from '../../../util';
import { PerformanceTimer } from './PerformanceTimer';

/**
 * Rule for detecting undeclared function calls
 * 
 * Uses the same infrastructure as "Go to Definition" for accurate function resolution.
 * 
 * Scope:
 * - Only checks CallExpression nodes where the callee is an Identifier
 * - CallExpression nodes with MemberExpression callees (e.g., obj.method()) are
 *   filtered out in appliesToNode() and handled by undeclared-method rule
 * 
 * Special handling:
 * - Skips constructor calls (e.g., SomeClass() without 'new')
 * - Detects instance methods called from static context
 * - Handles implicit 'this' when calling methods within a class
 * 
 * Example issues detected:
 * ```
 * UndeclaredFunc();  // Error: function not declared
 * 
 * class MyClass {
 *     void InstanceMethod() {}
 *     static void StaticMethod() {
 *         InstanceMethod();  // Error: cannot call instance method from static context
 *     }
 * }
 * ```
 * 
 * Example valid code:
 * ```
 * DeclaredFunc();                 // OK: function is declared
 * SomeClass();                    // OK: constructor call (class is declared)
 * 
 * class MyClass {
 *     void InstanceMethod() {}
 *     void CallInstance() {
 *         InstanceMethod();       // OK: instance method called from instance context
 *     }
 * }
 * 
 * // Method calls are NOT checked by this rule:
 * obj.Method();                   // Checked by undeclared-method rule
 * SomeClass.StaticMethod();       // Checked by undeclared-method rule
 * ```
 */
export class UndeclaredFunctionRule extends UndeclaredEntityRule {
    readonly id = 'undeclared-function';
    readonly name = 'Undeclared Function';
    readonly description = 'Detects calls to functions that are not declared';

    /**
     * Log performance statistics for debugging
     */
    static logPerformanceStats(): void {
        PerformanceTimer.logStats();
    }

    /**
     * Reset performance statistics
     */
    static resetPerformanceStats(): void {
        PerformanceTimer.reset();
    }

    appliesToNode(node: ASTNode): boolean {
        // Only apply to CallExpression nodes where the callee is NOT a MemberExpression
        // (method calls like obj.method() are handled by undeclared-method rule)
        if (!isCallExpression(node)) {
            return false;
        }
        
        // Skip if callee is a MemberExpression (method call)
        return !isMemberExpression(node.callee);
    }

    async check(
        node: CallExpression,
        context: DiagnosticRuleContext,
        config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        return await PerformanceTimer.time('UndeclaredFunction.check.total', async () => {
            if (!isIdentifier(node.callee)) {
                return [];
            }

            const functionName = node.callee.name;

            // Skip if it's a language keyword
            if (await PerformanceTimer.time('UndeclaredFunction.isLanguageKeyword', () => this.isLanguageKeyword(functionName))) {
                return [];
            }

            // Skip constructor calls (e.g., DialogueErrorProperties() without 'new')
            // In EnScript, constructors can be called directly without the 'new' keyword

            // Find containing class using parent traversal. If parent links are missing
            // fall back to the first class declared in the file (best-effort).
            const currentClass = await PerformanceTimer.time('UndeclaredFunction.findContainingClass', () => 
                this.findContainingClass(node, context)
            );

            if (await PerformanceTimer.time('UndeclaredFunction.isTypeDeclared', () => 
                this.isTypeDeclared(functionName, context, currentClass)
            )) {
                Logger.debug(`✅ UndeclaredFunctionRule: "${functionName}" is a class/type (constructor call), skipping`);
                return [];
            }

            // Use scope-aware function resolution (same as "Go to Definition")
            const scopeCheckResult = await PerformanceTimer.time('UndeclaredFunction.isFunctionDeclaredScopeAware', () =>
                this.isFunctionDeclaredScopeAware(functionName, node, context, currentClass)
            );
            if (scopeCheckResult.isDeclared) {
                return [];
            }

            // Function is not declared or inaccessible - create diagnostic with context-aware message
            let message: string;
            
            if (scopeCheckResult.isInstanceMethodInStaticContext) {
                message = `Cannot call instance method '${functionName}' from static context`;
            } else if (currentClass) {
                // We're inside a class, so this looks like it should be a method
                message = `Method '${functionName}' is not declared on class '${currentClass.name}' or its base classes`;
            } else {
                // Not in a class context, so it's a function call
                message = `Function '${functionName}' is not declared`;
            }

            return [
                {
                    message,
                    range: {
                        start: node.calleeStart,
                        end: node.calleeEnd
                    },
                    severity: config.severity || this.defaultSeverity,
                    code: this.id
                }
            ];
        });
    }

    /**
     * Check if a function is declared using scope-aware resolution
     * This follows the same logic as "Go to Definition" for consistency
     * 
     * @returns Object with isDeclared flag and context information
     */
    private async isFunctionDeclaredScopeAware(
        functionName: string,
        node: ASTNode,
        context: DiagnosticRuleContext,
        currentClass: ClassDeclNode | null
    ): Promise<{ isDeclared: boolean; isInstanceMethodInStaticContext?: boolean }> {
        try {
            const currentAst = context.ast;
            const currentUri = context.document.uri;

            // 1. Check if it's a global function in current file (with caching)
            let currentFileResults: Declaration[];
            
            // Use shared cache for symbol lookups if available
            const symbolCacheKey = `symbol:${functionName}:${currentUri}`;
            const sharedCacheExt = context.sharedCache as Record<string, unknown> | undefined;
            
            if (sharedCacheExt && !('symbolCache' in sharedCacheExt)) {
                sharedCacheExt.symbolCache = new Map<string, Declaration[]>();
            }
            const symbolCache = sharedCacheExt?.symbolCache as Map<string, Declaration[]> | undefined;
            
            if (symbolCache?.has(symbolCacheKey)) {
                currentFileResults = symbolCache.get(symbolCacheKey)!;
            } else {
                currentFileResults = await PerformanceTimer.time('UndeclaredFunction.findSymbolInFile', () =>
                    findSymbolInFile(functionName, currentAst, currentUri)
                );
                symbolCache?.set(symbolCacheKey, currentFileResults);
            }
            
            const globalFunctions = currentFileResults.filter(
                decl => isFunction(decl)
            );

            if (globalFunctions.length > 0) {
                Logger.debug(`✅ UndeclaredFunctionRule: Found global function "${functionName}" in current file`);
                return { isDeclared: true };
            }

            // 2. Check if it's a method in the current class using the new helper
            // Use findContainingClass with the node to get the correct class in files with multiple classes
            // Obtain current class name (fallback to first class in file)
            const currentClassName = currentClass ? currentClass.name : await PerformanceTimer.time('UndeclaredFunction.getCurrentClassName', () =>
                this.getCurrentClassName(context)
            );
            if (currentClassName) {
                // Check if we're in a static method context
                const isInStaticMethod = await PerformanceTimer.time('UndeclaredFunction.isInStaticMethodContext', () =>
                    this.isInStaticMethodContext(node, context)
                );

                // Check for instance methods first (can be called without 'this.')
                const instanceMethodResult = await PerformanceTimer.time('UndeclaredFunction.findMemberInClassHierarchy.instance', async () =>
                    await this.findMemberInClassHierarchy(
                        currentClassName,
                        functionName,
                        false, // instance methods
                        context,
                        true // allow private since we're inside the class
                    )
                );

                if (instanceMethodResult && !instanceMethodResult.staticMismatch) {
                    // Found an actual instance method (not a static method mismatch)
                    // Instance methods cannot be called from static methods
                    if (isInStaticMethod) {
                        return { isDeclared: false, isInstanceMethodInStaticContext: true };
                    }
                    return { isDeclared: true };
                }

                // Also check for static methods (can be called without class name prefix from within same class)
                const staticMethodResult = await PerformanceTimer.time('UndeclaredFunction.findMemberInClassHierarchy.static', async () =>
                    await this.findMemberInClassHierarchy(
                        currentClassName,
                        functionName,
                        true, // static methods
                        context,
                        true // allow private since we're inside the class
                    )
                );

                if (staticMethodResult && !staticMethodResult.staticMismatch) {
                    Logger.debug(`✅ UndeclaredFunctionRule: Found static method "${functionName}" in current class or inheritance`);
                    return { isDeclared: true };
                }
            }

            // 3. Check global functions using type resolver
            if (context.typeResolver) {
                const globalFuncs = await PerformanceTimer.time('UndeclaredFunction.typeResolver.findAllGlobalFunctionDefinitions', () =>
                    context.typeResolver!.findAllGlobalFunctionDefinitions(functionName)
                );
                if (globalFuncs.length > 0) {
                    Logger.debug(`✅ UndeclaredFunctionRule: Found global function "${functionName}" via type resolver`);
                    return { isDeclared: true };
                }
            }

            Logger.debug(`❌ UndeclaredFunctionRule: Function "${functionName}" not found`);
            return { isDeclared: false };
        } catch (error) {
            Logger.error(`UndeclaredFunctionRule: Error in isFunctionDeclaredScopeAware for "${functionName}":`, error);
            // On error, assume it's declared to avoid false positives
            return { isDeclared: true };
        }
    }

    getDocumentation(): string {
        return this.getUndeclaredDocumentation('Function', {
            bad: `void MyFunction() {
    UndeclaredFunc(); // Error: function not declared
}`,
            good: `void DeclaredFunc() {
    // Function implementation
}

class SomeClass {
    // Class definition
}

void MyFunction() {
    DeclaredFunc(); // OK: function is declared
    SomeClass(); // OK: constructor call
    auto obj = new SomeClass(); // OK: constructor with 'new'
}`
        });
    }

    getSuggestions(node: ASTNode, _context: DiagnosticRuleContext): string[] {
        if (!isCallExpression(node) || !isIdentifier(node.callee)) {
            return [];
        }

        return this.getUndeclaredSuggestions('Function', node.callee.name);
    }
}
