/**
 * Rename Type Visitor
 * 
 * AST visitor for renaming type references throughout the codebase.
 * Used during symbol rename operations to update type annotations
 * in all possible contexts where types can be referenced.
 * 
 * Handles type references in:
 * - Variable declarations (VarDecl.type)
 * - Parameter declarations (ParameterDecl.type)
 * - Function return types (FunctionDecl.returnType)
 * - Class inheritance (ClassDecl.baseClass)
 * - Typedef declarations (TypedefDecl.type)
 * - Cast expressions ((MyType)value)
 * - New expressions (new MyType())
 * - Generic types (array<MyType>, MyType.baseType, MyType.typeArguments)
 */

import { Range, TextEdit } from 'vscode-languageserver';
import { VoidASTVisitor } from './ast-visitor';
import { 
    VarDeclNode, 
    ParameterDeclNode, 
    FunctionDeclNode,
    ClassDeclNode,
    TypedefDeclNode,
    CastExpression,
    NewExpression,
    GenericTypeNode,
    TypeReferenceNode,
    ASTNode
} from './node-types';

/**
 * Type guard to check if a type object has a name property
 * Handles TypeReferenceNode and other type objects
 */
export function isNamedType(type: unknown): type is TypeReferenceNode | { name: string, nameRange: Range } {
    return !!type && typeof (type as { name?: string }).name === 'string';
}

/**
 * Helper function to get the text range for a type name
 * Handles both TypeReferenceNode (uses start/end) and legacy objects (uses nameRange)
 */
function getTypeNameRange(type: TypeReferenceNode | { name: string, nameRange: Range }): Range {
    if ('nameRange' in type) {
        return type.nameRange;
    } else {
        // For TypeReferenceNode, use the entire node range since it represents just the type name
        return {
            start: type.start,
            end: type.end
        };
    }
}

/**
 * AST visitor that finds and renames type references in the code
 * 
 * This visitor traverses the AST looking for type annotations that match
 * the old type name and creates text edits to rename them to the new name.
 * 
 * Features:
 * - Deduplication: Prevents multiple edits to the same text range within a file
 * - Comprehensive coverage: Handles all type reference patterns
 * - Range accuracy: Properly handles TypeReferenceNode vs legacy objects
 * - Multi-file support: Can process multiple files with a single instance
 */
export class RenameTypeVisitor extends VoidASTVisitor {
    private processedRanges = new Set<string>();
    private currentUri: string = '';

    constructor(
        private oldName: string,
        private newName: string,
        private changes: { [uri: string]: TextEdit[] }
    ) {
        super();
    }

    /**
     * Process an AST for a specific file
     * @param ast The AST to visit
     * @param uri The URI of the file being processed
     */
    processFile(ast: ASTNode, uri: string): void {
        // Reset state for new file
        this.processedRanges.clear();
        this.currentUri = uri;
        
        // Visit the AST
        this.visit(ast);
    }

    /**
     * Helper to add a text edit, but only if the range hasn't been processed already
     */
    private addTextEditIfNew(range: Range): void {
        const rangeKey = `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
        
        if (this.processedRanges.has(rangeKey)) {
            // Skip duplicate range
            return;
        }
        
        this.processedRanges.add(rangeKey);
        
        if (!this.changes[this.currentUri]) {
            this.changes[this.currentUri] = [];
        }
        
        this.changes[this.currentUri].push({
            range: range,
            newText: this.newName
        });
    }

    /**
     * Visit variable declarations and check their type annotations
     */
    visitVariableDeclaration(node: VarDeclNode): void {
        if (node.type && isNamedType(node.type) && node.type.name === this.oldName) {
            this.addTextEditIfNew(getTypeNameRange(node.type));
        }
        super.visitVariableDeclaration(node);
    }

    /**
     * Visit parameter declarations and check their type annotations
     */
    visitParameterDeclaration(node: ParameterDeclNode): void {
        if (node.type && isNamedType(node.type) && node.type.name === this.oldName) {
            this.addTextEditIfNew(getTypeNameRange(node.type));
        }
        super.visitParameterDeclaration(node);
    }

    /**
     * Visit function declarations and check their return type annotations
     */
    visitFunctionDeclaration(node: FunctionDeclNode): void {
        if (node.returnType && isNamedType(node.returnType) && node.returnType.name === this.oldName) {
            this.addTextEditIfNew(getTypeNameRange(node.returnType));
        }
        super.visitFunctionDeclaration(node);
    }

    /**
     * Visit class declarations and check their base class type
     */
    visitClassDeclaration(node: ClassDeclNode): void {
        if (node.baseClass && isNamedType(node.baseClass) && node.baseClass.name === this.oldName) {
            this.addTextEditIfNew(getTypeNameRange(node.baseClass));
        }
        super.visitClassDeclaration(node);
    }

    /**
     * Visit typedef declarations and check their type
     */
    visitTypedefDeclaration(node: TypedefDeclNode): void {
        if (node.type && isNamedType(node.type) && node.type.name === this.oldName) {
            this.addTextEditIfNew(getTypeNameRange(node.type));
        }
        super.visitTypedefDeclaration(node);
    }

    /**
     * Visit cast expressions and check their target type
     */
    visitCastExpression(node: CastExpression): void {
        if (node.type && isNamedType(node.type) && node.type.name === this.oldName) {
            this.addTextEditIfNew(getTypeNameRange(node.type));
        }
        super.visitCastExpression(node);
    }

    /**
     * Visit new expressions and check their type
     */
    visitNewExpression(node: NewExpression): void {
        if (node.type && isNamedType(node.type) && node.type.name === this.oldName) {
            this.addTextEditIfNew(getTypeNameRange(node.type));
        }
        super.visitNewExpression(node);
    }

    /**
     * Visit generic types and check their base type and type arguments
     */
    visitGenericType(node: GenericTypeNode): void {
        // Check the base type (e.g., "array" in "array<MyClass>")
        if (node.baseType && isNamedType(node.baseType) && node.baseType.name === this.oldName) {
            this.addTextEditIfNew(getTypeNameRange(node.baseType));
        }
        
        // Check each type argument (e.g., "MyClass" in "array<MyClass>")
        if (node.typeArguments) {
            for (const typeArg of node.typeArguments) {
                if (isNamedType(typeArg) && typeArg.name === this.oldName) {
                    this.addTextEditIfNew(getTypeNameRange(typeArg));
                }
            }
        }
        
        super.visitGenericType(node);
    }
}