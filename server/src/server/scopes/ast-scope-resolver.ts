/**
 * AST-based Scope Resolution Utilities
 * 
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import {
    ClassDeclNode,
    FunctionDeclNode,
    MethodDeclNode,
    FileNode
} from '../ast/node-types';
import { Logger } from '../../util/logger';
import { isClass, isFunction, isMethod } from '../../util';
import { isPositionInNode } from '../util/utils';
import { IASTScopeResolver } from './ast-scope-resolver-interfaces';
import { IDocumentCacheManager } from '../cache/document-cache-interfaces';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/tokens';

/**
 * Information about the scope context at a given position
 */
export interface ScopeContext {
    /** The containing class, if any */
    containingClass?: ClassDeclNode;
    /** The containing function/method, if any */
    containingFunction?: FunctionDeclNode | MethodDeclNode;
    /** Whether position is within class body */
    inClassBody: boolean;
    /** Whether position is within function body */
    inFunctionBody: boolean;
    /** Depth of nesting (class > method > block) */
    nestingDepth: number;
}

/**
 * AST-based scope resolver that replaces regex-based approaches
 * with structured AST traversal for accurate scope analysis
 */
@injectable()
export class ASTScopeResolver implements IASTScopeResolver {

    constructor(@inject(TYPES.IDocumentCacheManager) private cacheManager: IDocumentCacheManager) { }

    findContainingClass(ast: FileNode, position: Position): ClassDeclNode | null {
        for (const node of ast.body) {
            if (isClass(node)) {
                if (isPositionInNode(position, node)) {
                    Logger.debug(`🎯 ASTScopeResolver: Found containing class "${node.name}" at position ${position.line}:${position.character}`);
                    return node;
                }
            }
        }
        return null;
    }

    findContainingGlobalFunction(ast: FileNode, position: Position): FunctionDeclNode | null {
        for (const node of ast.body) {
            if (isFunction(node)) {
                if (isPositionInNode(position, node)) {
                    Logger.debug(`🎯 ASTScopeResolver: Found containing global function "${node.name}" at position ${position.line}:${position.character}`);
                    return node;
                }
            }
        }
        return null;
    }

    findContainingMethod(ast: FileNode, position: Position): MethodDeclNode | null {
        const containingClass = this.findContainingClass(ast, position);
        if (containingClass) {
            for (const member of containingClass.members) {
                if (isMethod(member)) {
                    if (isPositionInNode(position, member)) {
                        Logger.debug(`🔧 ASTScopeResolver: Found containing method "${member.name}" in class "${containingClass.name}"`);
                        return member;
                    }
                }
            }
        }
        return null;
    }

    getScopeContext(doc: TextDocument, position: Position): ScopeContext {
        const ast = this.cacheManager.ensureDocumentParsed(doc);
        let containingClass = null;
        let containingFunction : FunctionDeclNode | MethodDeclNode | null = this.findContainingGlobalFunction(ast, position);
        if (containingFunction === null) {
            containingClass = this.findContainingClass(ast, position);
            containingFunction = this.findContainingMethod(ast, position);
        }

        const inClassBody = containingClass !== null;
        const inFunctionBody = containingFunction !== null;

        // Calculate nesting depth
        let nestingDepth = 0;
        if (inClassBody) nestingDepth++;
        if (inFunctionBody) nestingDepth++;

        const context: ScopeContext = {
            containingClass: containingClass || undefined,
            containingFunction: containingFunction || undefined,
            inClassBody,
            inFunctionBody,
            nestingDepth
        };

        Logger.debug(`📍 ASTScopeResolver: Scope context at ${position.line}:${position.character}:`, {
            class: containingClass?.name,
            function: containingFunction?.name,
            depth: nestingDepth
        });
        return context;
    }
}
