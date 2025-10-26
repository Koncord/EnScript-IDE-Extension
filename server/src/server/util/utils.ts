/**
 * Parser utility functions and helpers
 */

import { Token, TokenKind } from '../lexer/token';
import * as typeUtils from './type-utils';
import { ASTNode } from '../ast/node-types';
import { Position } from 'vscode-languageserver';

/**
 * Check if a token is any type of keyword (for backward compatibility)
 * 
 * @param token Token to check
 * @returns True if the token is any kind of keyword
 */
export function isKeyword(token: Token): boolean {
    return token.kind === TokenKind.KeywordDeclaration ||
           token.kind === TokenKind.KeywordModifier ||
           token.kind === TokenKind.KeywordType ||
           token.kind === TokenKind.KeywordControl ||
           token.kind === TokenKind.KeywordStorage ||
           token.kind === TokenKind.KeywordLiteral;
}

/**
 * Check if a token is a modifier keyword based on lexer classification
 * 
 * @param token Token to check
 * @returns True if the token is a valid modifier
 */
export function isModifier(token: Token): boolean {
    return token.kind === TokenKind.KeywordModifier || 
           token.kind === TokenKind.KeywordStorage;
}

/**
 * Check if a token represents a primitive type
 * 
 * @param token Token to check
 * @returns True if the token is a primitive type
 */
export function isPrimitiveType(token: Token): boolean {
    //import { isPrimitiveType } from '../../util/type-utils';
    return token.kind === TokenKind.KeywordType && 
           typeUtils.isPrimitiveType(token.value);
}

/**
 * Set parent references throughout the AST tree
 * 
 * This recursively traverses the AST and sets the parent field on each node.
 * This is called once during parsing to make parent context available to all tools.
 * 
 * @param root The root node of the tree
 * @param parentNode The parent node (used for recursion, leave undefined for root)
 */
export function setParentReferences(
    root: ASTNode,
    parentNode?: ASTNode
): void {
    // Set the parent on the current node
    if (parentNode) {
        root.parent = parentNode;
    }

    // Recursively set parents on all children
    // Handle arrays of nodes
    const processArray = (nodes: unknown) => {
        if (Array.isArray(nodes)) {
            for (const node of nodes) {
                if (node && typeof node === 'object' && 'kind' in node) {
                    setParentReferences(node as ASTNode, root);
                }
            }
        }
    };

    // Process all properties that might contain child nodes
    for (const key in root) {
        if (!Object.prototype.hasOwnProperty.call(root, key)) continue;
        if (key === 'parent') continue; // Skip parent property to avoid cycles

        const value = root[key as keyof ASTNode];
        
        // Handle arrays
        if (Array.isArray(value)) {
            processArray(value);
        }
        // Handle single node children
        else if (value && typeof value === 'object' && 'kind' in value) {
            setParentReferences(value as ASTNode, root);
        }
    }
}


    /**
     * Check if a position is within an AST node's boundaries
     */
    export function isPositionInNode(position: Position, node: ASTNode): boolean {
        const start = node.start;
        const end = node.end;

        // Check if position is after start
        if (position.line < start.line) return false;
        if (position.line === start.line && position.character < start.character) return false;

        // Check if position is before end
        if (position.line > end.line) return false;
        if (position.line === end.line && position.character > end.character) return false;

        return true;
    }