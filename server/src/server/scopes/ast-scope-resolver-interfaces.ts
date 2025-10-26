import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import {
    ClassDeclNode,
    FunctionDeclNode,
    MethodDeclNode,
    FileNode
} from '../ast/node-types';
import { ScopeContext } from './ast-scope-resolver';

/**
 * Interface for AST-based scope resolution
 * Abstracts ASTScopeResolver for dependency injection
 */
export interface IASTScopeResolver {
    /**
     * Find the containing class at a given position
     */
    findContainingClass(ast: FileNode, position: Position): ClassDeclNode | null;

    /**
     * Find the containing global function at a given position
     */
    findContainingGlobalFunction(ast: FileNode, position: Position): FunctionDeclNode | null;

    /**
     * Find the containing method at a given position
     */
    findContainingMethod(ast: FileNode, position: Position): MethodDeclNode | null;

    /**
     * Get the complete scope context at a given position
     */
    getScopeContext(doc: TextDocument, position: Position): ScopeContext;
}
