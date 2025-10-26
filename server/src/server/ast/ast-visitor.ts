/**
 * AST Visitor Pattern Implementation
 * 
 * Provides utilities for traversing and analyzing the new AST structure
 * using the visitor pattern for type-safe node processing.
 */

import {
    ASTNode,
    FileNode,
    ClassDeclNode,
    EnumDeclNode,
    EnumMemberDeclNode,
    FunctionDeclNode,
    VarDeclNode,
    TypedefDeclNode,
    ParameterDeclNode,
    TypeReferenceNode,
    GenericTypeNode,
    ArrayTypeNode,
    AutoTypeNode,
    GenericParameterNode,
    ExpressionStatement,
    BlockStatement,
    IfStatement,
    WhileStatement,
    ForStatement,
    ForEachStatement,
    ReturnStatement,
    BreakStatement,
    ContinueStatement,
    DeclarationStatement,
    SwitchStatement,
    CaseStatement,
    BinaryExpression,
    UnaryExpression,
    AssignmentExpression,
    CallExpression,
    MemberExpression,
    ArrayAccessExpression,
    CastExpression,
    NewExpression,
    ConditionalExpression,
    Identifier,
    Literal,
    ArrayLiteralExpression,
    ThisExpression,
    SuperExpression
} from './node-types';

/**
 * Warning callback type for reporting issues during AST traversal
 */
export type WarningCallback = (message: string, line: number, character: number) => void;

/**
 * Base visitor interface with default implementations
 */
export abstract class BaseASTVisitor<T = void> {
    protected warningCallback?: WarningCallback;

    constructor(warningCallback?: WarningCallback) {
        this.warningCallback = warningCallback;
    }
    /**
     * Visit any AST node - dispatches to specific visitor methods
     */
    visit(node: ASTNode): T {
        switch (node.kind) {
            // File
            case 'File':
                return this.visitFile(node as FileNode);

            // Declarations
            case 'ClassDecl':
                return this.visitClassDeclaration(node as ClassDeclNode);
            case 'EnumDecl':
                return this.visitEnumDeclaration(node as EnumDeclNode);
            case 'EnumMemberDecl':
                return this.visitEnumMemberDeclaration(node as EnumMemberDeclNode);
            case 'FunctionDecl':
            case 'MethodDecl':
                return this.visitFunctionDeclaration(node as FunctionDeclNode);
            case 'VarDecl':
                return this.visitVariableDeclaration(node as VarDeclNode);
            case 'TypedefDecl':
                return this.visitTypedefDeclaration(node as TypedefDeclNode);
            case 'ParameterDecl':
                return this.visitParameterDeclaration(node as ParameterDeclNode);

            // Types
            case 'TypeReference':
                return this.visitTypeReference(node as TypeReferenceNode);
            case 'GenericType':
                return this.visitGenericType(node as GenericTypeNode);
            case 'GenericParameter':
                return this.visitGenericParameter(node as GenericParameterNode);
            case 'ArrayType':
                return this.visitArrayType(node as ArrayTypeNode);
            case 'AutoType':
                return this.visitAutoType(node as AutoTypeNode);

            // Statements
            case 'ExpressionStatement':
                return this.visitExpressionStatement(node as ExpressionStatement);
            case 'BlockStatement':
                return this.visitBlockStatement(node as BlockStatement);
            case 'IfStatement':
                return this.visitIfStatement(node as IfStatement);
            case 'WhileStatement':
                return this.visitWhileStatement(node as WhileStatement);
            case 'ForStatement':
                return this.visitForStatement(node as ForStatement);
            case 'ForEachStatement':
                return this.visitForEachStatement(node as ForEachStatement);
            case 'ReturnStatement':
                return this.visitReturnStatement(node as ReturnStatement);
            case 'BreakStatement':
                return this.visitBreakStatement(node as BreakStatement);
            case 'ContinueStatement':
                return this.visitContinueStatement(node as ContinueStatement);
            case 'DeclarationStatement':
                return this.visitDeclarationStatement(node as DeclarationStatement);
            case 'SwitchStatement':
                return this.visitSwitchStatement(node as SwitchStatement);
            case 'CaseStatement':
                return this.visitCaseStatement(node as CaseStatement);

            // Expressions
            case 'BinaryExpression':
                return this.visitBinaryExpression(node as BinaryExpression);
            case 'UnaryExpression':
                return this.visitUnaryExpression(node as UnaryExpression);
            case 'AssignmentExpression':
                return this.visitAssignmentExpression(node as AssignmentExpression);
            case 'CallExpression':
                return this.visitCallExpression(node as CallExpression);
            case 'MemberExpression':
                return this.visitMemberExpression(node as MemberExpression);
            case 'ArrayAccessExpression':
                return this.visitArrayAccessExpression(node as ArrayAccessExpression);
            case 'CastExpression':
                return this.visitCastExpression(node as CastExpression);
            case 'NewExpression':
                return this.visitNewExpression(node as NewExpression);
            case 'ConditionalExpression':
                return this.visitConditionalExpression(node as ConditionalExpression);
            case 'Identifier':
                return this.visitIdentifier(node as Identifier);
            case 'Literal':
                return this.visitLiteral(node as Literal);
            case 'ArrayLiteralExpression':
                return this.visitArrayLiteralExpression(node as ArrayLiteralExpression);
            case 'ThisExpression':
                return this.visitThisExpression(node as ThisExpression);
            case 'SuperExpression':
                return this.visitSuperExpression(node as SuperExpression);

            default:
                return this.visitUnknown(node);
        }
    }

    /**
     * Visit multiple nodes
     */
    visitAll(nodes: ASTNode[]): T[] {
        return nodes.map(node => this.visit(node));
    }

    // ============================================================================
    // DEFAULT IMPLEMENTATIONS (can be overridden)
    // ============================================================================

    protected visitFile(node: FileNode): T {
        this.visitAll(node.body);
        return this.defaultResult();
    }

    // Declaration visitors
    protected visitClassDeclaration(node: ClassDeclNode): T {
        if (node.baseClass) {
            this.visit(node.baseClass);
        }
        this.visitAll(node.members);
        if (node.body) {
            this.visit(node.body);
        }
        return this.defaultResult();
    }

    protected visitEnumDeclaration(node: EnumDeclNode): T {
        if (node.baseType) {
            this.visit(node.baseType);
        }
        this.visitAll(node.members);
        return this.defaultResult();
    }

    protected visitEnumMemberDeclaration(node: EnumMemberDeclNode): T {
        if (node.value) {
            this.visit(node.value);
        }
        return this.defaultResult();
    }

    protected visitFunctionDeclaration(node: FunctionDeclNode): T {
        this.visit(node.returnType);
        this.visitAll(node.parameters);
        if (node.body) {
            this.visit(node.body);
        }
        return this.defaultResult();
    }

    protected visitVariableDeclaration(node: VarDeclNode): T {
        this.visit(node.type);
        if (node.initializer) {
            this.visit(node.initializer);
        }
        return this.defaultResult();
    }

    protected visitTypedefDeclaration(node: TypedefDeclNode): T {
        this.visit(node.type);
        return this.defaultResult();
    }

    protected visitParameterDeclaration(node: ParameterDeclNode): T {
        this.visit(node.type);
        if (node.defaultValue) {
            this.visit(node.defaultValue);
        }
        return this.defaultResult();
    }

    // Type visitors
    protected visitTypeReference(node: TypeReferenceNode): T {
        if (node.typeArguments) {
            this.visitAll(node.typeArguments);
        }
        return this.defaultResult();
    }

    protected visitGenericType(node: GenericTypeNode): T {
        this.visit(node.baseType);
        this.visitAll(node.typeArguments);
        return this.defaultResult();
    }

    protected visitGenericParameter(node: GenericParameterNode): T {
        void node; // Mark as intentionally unused
        return this.defaultResult();
    }

    protected visitArrayType(node: ArrayTypeNode): T {
        this.visit(node.elementType);
        if (node.size) {
            this.visit(node.size);
        }
        return this.defaultResult();
    }

    protected visitAutoType(node: AutoTypeNode): T {
        void node; // Mark as intentionally unused
        return this.defaultResult();
    }

    // Statement visitors
    protected visitExpressionStatement(node: ExpressionStatement): T {
        // For collecting visitors, we need to return results from the expression
        if (this instanceof CollectingASTVisitor) {
            return this.visit(node.expression);
        }
        this.visit(node.expression);
        return this.defaultResult();
    }

    protected visitBlockStatement(node: BlockStatement): T {
        // For collecting visitors, we need to collect results from children
        if (this instanceof CollectingASTVisitor) {
            const results: unknown[] = [];
            for (const stmt of node.body) {
                const stmtResults = this.visit(stmt);
                if (Array.isArray(stmtResults)) {
                    results.push(...stmtResults);
                } else {
                    results.push(stmtResults);
                }
            }
            return results as T;
        }
        this.visitAll(node.body);
        return this.defaultResult();
    }

    protected visitIfStatement(node: IfStatement): T {
        this.visit(node.test);
        this.visit(node.consequent);
        if (node.alternate) {
            this.visit(node.alternate);
        }
        return this.defaultResult();
    }

    protected visitWhileStatement(node: WhileStatement): T {
        this.visit(node.test);
        this.visit(node.body);
        return this.defaultResult();
    }

    protected visitForStatement(node: ForStatement): T {
        if (node.init) {
            this.visit(node.init);
        }
        if (node.test) {
            this.visit(node.test);
        }
        if (node.update) {
            this.visit(node.update);
        }
        this.visit(node.body);
        return this.defaultResult();
    }

    protected visitForEachStatement(node: ForEachStatement): T {
        this.visitAll(node.variables);
        this.visit(node.iterable);
        this.visit(node.body);
        return this.defaultResult();
    }

    protected visitReturnStatement(node: ReturnStatement): T {
        if (node.argument) {
            this.visit(node.argument);
        }
        return this.defaultResult();
    }

    protected visitBreakStatement(node: BreakStatement): T {
        void node; // Mark as intentionally unused
        return this.defaultResult();
    }

    protected visitContinueStatement(node: ContinueStatement): T {
        void node; // Mark as intentionally unused
        return this.defaultResult();
    }

    protected visitDeclarationStatement(node: DeclarationStatement): T {
        this.visit(node.declaration);
        return this.defaultResult();
    }

    protected visitSwitchStatement(node: SwitchStatement): T {
        this.visit(node.discriminant);
        for (const caseNode of node.cases) {
            this.visit(caseNode);
        }
        return this.defaultResult();
    }

    protected visitCaseStatement(node: CaseStatement): T {
        if (node.test) {
            this.visit(node.test);
        }
        for (const stmt of node.consequent) {
            this.visit(stmt);
        }
        return this.defaultResult();
    }

    // Expression visitors
    protected visitBinaryExpression(node: BinaryExpression): T {
        this.visit(node.left);
        this.visit(node.right);
        return this.defaultResult();
    }

    protected visitUnaryExpression(node: UnaryExpression): T {
        this.visit(node.operand);
        return this.defaultResult();
    }

    protected visitAssignmentExpression(node: AssignmentExpression): T {
        this.visit(node.left);
        this.visit(node.right);
        return this.defaultResult();
    }

    protected visitCallExpression(node: CallExpression): T {
        this.visit(node.callee);
        this.visitAll(node.arguments);
        return this.defaultResult();
    }

    protected visitMemberExpression(node: MemberExpression): T {
        this.visit(node.object);
        this.visit(node.property);
        return this.defaultResult();
    }

    protected visitArrayAccessExpression(node: ArrayAccessExpression): T {
        this.visit(node.object);
        this.visit(node.index);
        return this.defaultResult();
    }

    protected visitCastExpression(node: CastExpression): T {
        this.visit(node.type);
        this.visit(node.expression);
        return this.defaultResult();
    }

    protected visitNewExpression(node: NewExpression): T {
        this.visit(node.type);
        if (node.arguments) {
            this.visitAll(node.arguments);
        }
        if (node.arraySize) {
            this.visit(node.arraySize);
        }
        return this.defaultResult();
    }

    protected visitConditionalExpression(node: ConditionalExpression): T {
        this.visit(node.test);
        this.visit(node.consequent);
        this.visit(node.alternate);
        return this.defaultResult();
    }

    protected visitIdentifier(node: Identifier): T {
        void node; // Mark as intentionally unused
        return this.defaultResult();
    }

    protected visitLiteral(node: Literal): T {
        void node; // Mark as intentionally unused
        return this.defaultResult();
    }

    protected visitArrayLiteralExpression(node: ArrayLiteralExpression): T {
        // Visit all elements in the array literal
        if (node.elements) {
            node.elements.forEach(element => this.visit(element));
        }
        return this.defaultResult();
    }

    protected visitThisExpression(node: ThisExpression): T {
        void node; // Mark as intentionally unused
        return this.defaultResult();
    }

    protected visitSuperExpression(node: SuperExpression): T {
        void node; // Mark as intentionally unused
        return this.defaultResult();
    }

    protected visitUnknown(node: ASTNode): T {
        const message = `Unknown AST node kind: ${node.kind}`;
        if (this.warningCallback) {
            this.warningCallback(message, node.start.line, node.start.character);
        } else {
            console.warn(message);
        }
        return this.defaultResult();
    }

    /**
     * Default result for visitors that don't return anything
     */
    protected abstract defaultResult(): T;
}

/**
 * Visitor for collecting information without returning values
 */
export abstract class VoidASTVisitor extends BaseASTVisitor<void> {
    constructor(warningCallback?: WarningCallback) {
        super(warningCallback);
    }

    protected defaultResult(): void {
        // No-op
    }
}

/**
 * Visitor for collecting arrays of results
 */
export abstract class CollectingASTVisitor<T> extends BaseASTVisitor<T[]> {
    constructor(warningCallback?: WarningCallback) {
        super(warningCallback);
    }

    protected defaultResult(): T[] {
        return [];
    }

    /**
     * Helper to flatten results from visiting multiple nodes
     */
    protected collectResults(nodes: ASTNode[]): T[] {
        return nodes.flatMap(node => this.visit(node));
    }
}

/**
 * Transform visitor base class for modifying AST nodes
 */
export abstract class TransformASTVisitor extends BaseASTVisitor<ASTNode> {
    protected defaultResult(): ASTNode {
        throw new Error('Transform visitor must override all visit methods');
    }

    /**
     * Helper to transform child nodes
     */
    protected transformChildren<T extends ASTNode>(nodes: T[]): T[] {
        return nodes.map(node => this.visit(node) as T);
    }
}

