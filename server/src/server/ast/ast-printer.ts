/**
 * AST Printer for debugging and visualization
 * 
 * Provides utilities to print AST nodes in a human-readable format
 * for debugging, testing, and development purposes.
 */

import { Position } from 'vscode-languageserver';
import {
    ASTNode,
    FileNode,
    ClassDeclNode,
    FunctionDeclNode,
    MethodDeclNode,
    VarDeclNode,
    EnumDeclNode,
    EnumMemberDeclNode,
    ParameterDeclNode,
    TypeNode,
    TypeReferenceNode,
    GenericTypeNode,
    ArrayTypeNode,
    BlockStatement,
    IfStatement,
    WhileStatement,
    ForStatement,
    ForEachStatement,
    SwitchStatement,
    CaseStatement,
    ReturnStatement,
    BreakStatement,
    ContinueStatement,
    ExpressionStatement,
    CallExpression,
    MemberExpression,
    BinaryExpression,
    UnaryExpression,
    AssignmentExpression,
    ArrayLiteralExpression,
    NewExpression,
    Identifier,
    Literal
} from './node-types';

export interface PrintOptions {
    /** Include position information in output */
    includePositions?: boolean;
    /** Include URI information in output */
    includeURI?: boolean;
    /** Maximum depth to print (prevents infinite recursion) */
    maxDepth?: number;
    /** Indent string for nested structures */
    indent?: string;
    /** Use colors for output (ANSI codes) */
    useColors?: boolean;
    /** Include type information where available */
    includeTypes?: boolean;
    /** Filter to only show specific node types */
    nodeTypeFilter?: string[];
    /** Compact mode - less verbose output */
    compact?: boolean;
}

const DEFAULT_OPTIONS: Required<PrintOptions> = {
    includePositions: false,
    includeURI: false,
    maxDepth: 10,
    indent: '  ',
    useColors: true,
    includeTypes: true,
    nodeTypeFilter: [],
    compact: false
};

export function prettyPrint(ast: FileNode): string {
    return JSON.stringify(ast, null, 2);
}

export class ASTPrinter {
    private options: Required<PrintOptions>;
    private currentDepth: number = 0;

    constructor(options: PrintOptions = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    /**
     * Print an AST node to string
     */
    print(node: ASTNode): string {
        this.currentDepth = 0;
        return this.printNode(node);
    }

    /**
     * Print an AST node to console
     */
    printToConsole(node: ASTNode): void {
        console.log(this.print(node));
    }

    /**
     * Print multiple AST nodes
     */
    printNodes(nodes: ASTNode[]): string {
        return nodes.map(node => this.print(node)).join('\n\n');
    }

    /**
     * Print a file's AST structure
     */
    printFile(file: FileNode, title?: string): string {
        const lines: string[] = [];

        if (title) {
            lines.push(this.colorize(`=== ${title} ===`, 'header'));
        }

        lines.push(this.colorize('FileNode', 'node'));
        if (this.options.includePositions) {
            lines.push(this.colorize(`  Position: ${this.formatPosition(file.start)} - ${this.formatPosition(file.end)}`, 'position'));
        }

        lines.push(this.colorize(`  Body: ${file.body.length} declarations`, 'info'));

        this.currentDepth = 1;
        for (const [index, decl] of file.body.entries()) {
            lines.push(`${this.getIndent()}[${index}] ${this.printNode(decl)}`);
        }

        return lines.join('\n');
    }

    /**
     * Print file node inline (for use in switch statement)
     */
    private printFileNodeInline(file: FileNode): string {
        const lines: string[] = [];

        lines.push(this.colorize('File', 'node') + this.formatNodeInfo(file));

        if (file.body && file.body.length > 0) {
            lines.push(`${this.getIndent()}body: ${file.body.length} declarations`);
            this.currentDepth++;
            for (const [index, decl] of file.body.entries()) {
                if (!this.options.compact || index < 3) {
                    lines.push(`${this.getIndent()}[${index}] ${this.printNode(decl)}`);
                } else if (index === 3) {
                    lines.push(`${this.getIndent()}... ${file.body.length - 3} more declarations`);
                    break;
                }
            }
            this.currentDepth--;
        }

        return lines.join('\n');
    }

    /**
     * Print AST statistics
     */
    printStats(node: ASTNode): string {
        const stats = this.collectStats(node);
        const lines: string[] = [];

        lines.push(this.colorize('=== AST Statistics ===', 'header'));
        lines.push(`Total nodes: ${stats.totalNodes}`);
        lines.push('Node type counts:');

        const sortedTypes = Object.entries(stats.nodeTypeCounts)
            .sort(([, a], [, b]) => b - a);

        for (const [type, count] of sortedTypes) {
            lines.push(`  ${type}: ${count}`);
        }

        if (stats.maxDepth > 0) {
            lines.push(`Maximum depth: ${stats.maxDepth}`);
        }

        return lines.join('\n');
    }

    private printNode(node: ASTNode): string {
        if (this.currentDepth > this.options.maxDepth) {
            return this.colorize('... (max depth reached)', 'warning');
        }

        if (this.options.nodeTypeFilter.length > 0 &&
            !this.options.nodeTypeFilter.includes(node.kind)) {
            return this.colorize(`${node.kind} (filtered)`, 'muted');
        }

        const nodeStr = this.printNodeByKind(node);
        return nodeStr;
    }

    private printNodeByKind(node: ASTNode): string {
        switch (node.kind) {
            case 'File':
                return this.printFileNodeInline(node as FileNode);
            case 'ClassDecl':
                return this.printClassDecl(node as ClassDeclNode);
            case 'FunctionDecl':
                return this.printFunctionDecl(node as FunctionDeclNode);
            case 'MethodDecl':
                return this.printMethodDecl(node as MethodDeclNode);
            case 'VarDecl':
                return this.printVarDecl(node as VarDeclNode);
            case 'EnumDecl':
                return this.printEnumDecl(node as EnumDeclNode);
            case 'EnumMemberDecl':
                return this.printEnumMemberDecl(node as EnumMemberDeclNode);
            case 'ParameterDecl':
                return this.printParameterDecl(node as ParameterDeclNode);
            case 'TypeReference':
                return this.printTypeNode(node as TypeNode);
            case 'BlockStatement':
                return this.printBlockStatement(node as BlockStatement);
            case 'IfStatement':
                return this.printIfStatement(node as IfStatement);
            case 'WhileStatement':
                return this.printWhileStatement(node as WhileStatement);
            case 'ForStatement':
                return this.printForStatement(node as ForStatement);
            case 'ForEachStatement':
                return this.printForEachStatement(node as ForEachStatement);
            case 'SwitchStatement':
                return this.printSwitchStatement(node as SwitchStatement);
            case 'CaseStatement':
                return this.printCaseStatement(node as CaseStatement);
            case 'ReturnStatement':
                return this.printReturnStatement(node as ReturnStatement);
            case 'BreakStatement':
                return this.printBreakStatement(node as BreakStatement);
            case 'ContinueStatement':
                return this.printContinueStatement(node as ContinueStatement);
            case 'ExpressionStatement':
                return this.printExpressionStatement(node as ExpressionStatement);
            case 'DeclarationStatement':
                return this.printDeclarationStatement(node as ASTNode & { declaration?: ASTNode });
            case 'CallExpression':
                return this.printCallExpression(node as CallExpression);
            case 'MemberExpression':
                return this.printMemberExpression(node as MemberExpression);
            case 'BinaryExpression':
                return this.printBinaryExpression(node as BinaryExpression);
            case 'UnaryExpression':
                return this.printUnaryExpression(node as UnaryExpression);
            case 'AssignmentExpression':
                return this.printAssignmentExpression(node as AssignmentExpression);
            case 'ArrayLiteralExpression':
                return this.printArrayLiteralExpression(node as ArrayLiteralExpression);
            case 'NewExpression':
                return this.printNewExpression(node as NewExpression);
            case 'Identifier':
                return this.printIdentifier(node as Identifier);
            case 'Literal':
                return this.printLiteral(node as Literal);
            default:
                return this.colorize(`${node.kind}`, 'node') + this.formatNodeInfo(node);
        }
    }

    private printClassDecl(node: ClassDeclNode): string {
        const lines: string[] = [];
        const modifiers = (node.modifiers || []).join(' ');
        const name = this.colorize(node.name, 'className');

        // Format as: ClassDecl [modifiers] name
        let header = this.colorize('ClassDecl', 'node');
        if (modifiers.trim()) {
            header += ` [${this.colorize(modifiers, 'modifier')}]`;
        }
        header += ` ${name}${this.formatNodeInfo(node)}`;
        lines.push(header);

        if (node.baseClass) {
            this.currentDepth++;
            lines.push(`${this.getIndent()}extends: ${this.printNode(node.baseClass)}`);
            this.currentDepth--;
        }

        // Prefer showing members over body to avoid duplication
        if (node.members && node.members.length > 0) {
            this.currentDepth++;
            for (const [index, member] of node.members.entries()) {
                const isLast = index === node.members.length - 1;
                const prefix = isLast ? '└──' : '├──';
                if (!this.options.compact || index < 3) {
                    lines.push(`${this.getIndent()}${prefix} ${this.printNode(member)}`);
                } else if (index === 3) {
                    lines.push(`${this.getIndent()}└── ... ${node.members.length - 3} more members`);
                    break;
                }
            }
            this.currentDepth--;
        } else if (node.body) {
            this.currentDepth++;
            lines.push(`${this.getIndent()}└── body: ${this.printNode(node.body)}`);
            this.currentDepth--;
        }

        return lines.join('\n');
    }

    private printFunctionDecl(node: FunctionDeclNode): string {
        const lines: string[] = [];
        const modifiers = (node.modifiers || []).join(' ');
        const name = this.colorize(node.name, 'functionName');
        const returnType = node.returnType ? this.printNode(node.returnType) : 'void';

        // Format as: FunctionDecl [modifiers] name
        let header = this.colorize('FunctionDecl', 'node');
        if (modifiers.trim()) {
            header += ` [${this.colorize(modifiers, 'modifier')}]`;
        }
        header += ` ${name}${this.formatNodeInfo(node)}`;
        lines.push(header);

        // Add return type info
        this.currentDepth++;
        lines.push(`${this.getIndent()}├── ReturnType: ${returnType}`);
        this.currentDepth--;

        // Add parameters
        if (node.parameters && node.parameters.length > 0) {
            this.currentDepth++;
            lines.push(`${this.getIndent()}├── Parameters: [${node.parameters.length}]`);
            this.currentDepth++;
            for (const [index, param] of node.parameters.entries()) {
                const isLast = index === node.parameters.length - 1 && !node.body;
                const prefix = isLast ? '└──' : '├──';
                lines.push(`${this.getIndent()}${prefix} [${index}] ${this.printNode(param)}`);
            }
            this.currentDepth--;
            this.currentDepth--;
        } else {
            this.currentDepth++;
            lines.push(`${this.getIndent()}├── Parameters: []`);
            this.currentDepth--;
        }

        if (node.body && !this.options.compact) {
            this.currentDepth++;
            lines.push(`${this.getIndent()}└── Body: ${this.printNode(node.body)}`);
            this.currentDepth--;
        }

        return lines.join('\n');
    }

    private printVarDecl(node: VarDeclNode): string {
        const modifiers = (node.modifiers || []).join(' ');
        const modifiersStr = modifiers ? modifiers + ' ' : '';
        const type = node.type ? this.printTypeDescription(node.type) : 'auto';
        const name = this.colorize(node.name, 'variableName');

        let result = this.colorize('VarDecl', 'node') + ` ${modifiersStr}${type} ${name}`;

        if (node.initializer) {
            result += ` = ${this.printNode(node.initializer)}`;
        }

        return result + this.formatNodeInfo(node);
    }

    private printEnumDecl(node: EnumDeclNode): string {
        const name = this.colorize(node.name, 'enumName');
        const memberCount = node.members ? node.members.length : 0;

        let result = this.colorize('EnumDecl', 'node') + ` ${name} (${memberCount} members)${this.formatNodeInfo(node)}`;

        // Print enum members if present and not at max depth
        if (node.members && node.members.length > 0 && this.currentDepth < this.options.maxDepth) {
            const memberLines: string[] = [];

            this.currentDepth++;
            node.members.forEach((member, index) => {
                const memberStr = this.printNode(member);
                memberLines.push(`${this.options.indent.repeat(this.currentDepth)}[${index}] ${memberStr}`);
            });
            this.currentDepth--;

            if (memberLines.length > 0) {
                result += '\n' + memberLines.join('\n');
            }
        }

        return result;
    }

    private printEnumMemberDecl(node: EnumMemberDeclNode): string {
        const name = this.colorize(node.name, 'enumMemberName');
        let result = this.colorize('EnumMemberDecl', 'node') + ` ${name}`;

        if (node.value) {
            result += ` = ${this.printNode(node.value)}`;
        }

        return result + this.formatNodeInfo(node);
    }

    private printParameterDecl(node: ParameterDeclNode): string {
        const modifiers = (node.modifiers || []).join(' ');
        const type = node.type ? this.printNode(node.type) : 'unknown';
        const name = this.colorize(node.name || '<unnamed>', 'parameterName');

        // Format as: ParameterDecl [modifiers] type name [= defaultValue]
        let result = this.colorize('ParameterDecl', 'node');
        if (modifiers.trim()) {
            result += ` [${this.colorize(modifiers, 'modifier')}]`;
        }
        result += ` ${type} ${name}`;
        
        // Add default value if present
        if (node.defaultValue) {
            result += ` ${this.colorize('=', 'operator')} ${this.printNode(node.defaultValue)}`;
        }
        
        result += this.formatNodeInfo(node);

        return result;
    }

    private printMethodDecl(node: MethodDeclNode): string {
        const lines: string[] = [];
        const modifiers = (node.modifiers || []).join(' ');
        const name = this.colorize(node.name || '<unnamed>', 'functionName');
        const returnType = node.returnType ? this.printNode(node.returnType) : 'void';

        // Format as: MethodDecl [modifiers] name
        let header = this.colorize('MethodDecl', 'node');
        if (modifiers.trim()) {
            header += ` [${this.colorize(modifiers, 'modifier')}]`;
        }
        header += ` ${name}${this.formatNodeInfo(node)}`;
        lines.push(header);

        // Add return type info - always show it, even if void
        this.currentDepth++;
        lines.push(`${this.getIndent()}├── ReturnType: ${returnType}`);
        this.currentDepth--;

        // Add parameters
        if (node.parameters && node.parameters.length > 0) {
            this.currentDepth++;
            lines.push(`${this.getIndent()}├── Parameters: [${node.parameters.length}]`);
            this.currentDepth++;
            for (const [index, param] of node.parameters.entries()) {
                const isLast = index === node.parameters.length - 1 && !node.body;
                const prefix = isLast ? '└──' : '├──';
                lines.push(`${this.getIndent()}${prefix} [${index}] ${this.printNode(param)}`);
            }
            this.currentDepth--;
            this.currentDepth--;
        } else {
            this.currentDepth++;
            lines.push(`${this.getIndent()}├── Parameters: []`);
            this.currentDepth--;
        }

        // Add body
        if (node.body && !this.options.compact) {
            this.currentDepth++;
            lines.push(`${this.getIndent()}└── Body: ${this.printNode(node.body)}`);
            this.currentDepth--;
        }

        return lines.join('\n');
    }

    private printDeclarationStatement(node: ASTNode & { declaration?: ASTNode; declarations?: ASTNode[] }): string {
        const lines: string[] = [];
        lines.push(this.colorize('DeclarationStatement', 'node') + this.formatNodeInfo(node));

        // Handle multiple declarations (e.g., "int one, two;")
        if (node.declarations && node.declarations.length > 0) {
            this.currentDepth++;
            node.declarations.forEach((decl, index) => {
                const isLast = index === node.declarations!.length - 1;
                const connector = isLast ? '└──' : '├──';
                lines.push(`${this.getIndent()}${connector} ${this.printNode(decl)}`);
            });
            this.currentDepth--;
        }
        // Fallback to single declaration for backward compatibility
        else if (node.declaration) {
            this.currentDepth++;
            lines.push(`${this.getIndent()}└── ${this.printNode(node.declaration)}`);
            this.currentDepth--;
        }

        return lines.join('\n');
    }

    private printTypeNode(node: TypeNode): string {
        switch (node.kind) {
            case 'TypeReference': {
                const typeRef = node as TypeReferenceNode;
                let result = this.colorize('TypeReference', 'type') + ` ${typeRef.name}`;

                if (typeRef.typeArguments && typeRef.typeArguments.length > 0) {
                    const args = typeRef.typeArguments.map(arg => this.printNode(arg)).join(', ');
                    result += `<${args}>`;
                }

                return result + this.formatNodeInfo(node);
            }

            case 'GenericType': {
                const genericType = node as GenericTypeNode;
                const baseType = this.printNode(genericType.baseType);
                const typeArgs = genericType.typeArguments.map(arg => this.printNode(arg)).join(', ');
                return this.colorize('GenericType', 'type') + ` ${baseType}<${typeArgs}>` + this.formatNodeInfo(node);
            }

            case 'ArrayType': {
                const arrayType = node as ArrayTypeNode;
                const elementType = this.printNode(arrayType.elementType);
                const sizeStr = arrayType.size ? `[${this.printNode(arrayType.size)}]` : '[]';
                return this.colorize('ArrayType', 'type') + ` ${elementType}${sizeStr}` + this.formatNodeInfo(node);
            }

            case 'AutoType':
                return this.colorize('AutoType', 'type') + ' auto' + this.formatNodeInfo(node);

            default:
                return this.colorize('UnknownType', 'type') + ` ${(node as ASTNode).kind}` + this.formatNodeInfo(node);
        }
    }

    /**
     * Print a concise type description without node metadata
     */
    private printTypeDescription(node: TypeNode): string {
        switch (node.kind) {
            case 'TypeReference': {
                const typeRef = node as TypeReferenceNode;
                let result = typeRef.name;

                if (typeRef.modifiers && typeRef.modifiers.length > 0) {
                    result = typeRef.modifiers.join(' ') + ' ' + result;
                }

                if (typeRef.typeArguments && typeRef.typeArguments.length > 0) {
                    const args = typeRef.typeArguments.map(arg => this.printTypeDescription(arg)).join(', ');
                    result += `<${args}>`;
                }

                return this.colorize(result, 'type');
            }

            case 'GenericType': {
                const genericType = node as GenericTypeNode;
                const baseType = this.printTypeDescription(genericType.baseType);
                const typeArgs = genericType.typeArguments.map(arg => this.printTypeDescription(arg)).join(', ');
                return this.colorize(`${baseType}<${typeArgs}>`, 'type');
            }

            case 'ArrayType': {
                const arrayType = node as ArrayTypeNode;
                const elementType = this.printTypeDescription(arrayType.elementType);
                const sizeStr = arrayType.size ? `[${this.printNode(arrayType.size)}]` : '[]';
                return this.colorize(`${elementType}${sizeStr}`, 'type');
            }

            case 'AutoType':
                return this.colorize('auto', 'type');

            default:
                return this.colorize((node as ASTNode).kind, 'type');
        }
    }

    private printBlockStatement(node: BlockStatement): string {
        const lines: string[] = [];
        lines.push(this.colorize('BlockStatement', 'node') + ` (${node.body.length} statements)${this.formatNodeInfo(node)}`);

        if (!this.options.compact) {
            this.currentDepth++;
            for (const [index, stmt] of node.body.entries()) {
                lines.push(`${this.getIndent()}[${index}] ${this.printNode(stmt)}`);
            }
            this.currentDepth--;
        }

        return lines.join('\n');
    }

    private printIfStatement(node: IfStatement): string {
        const lines: string[] = [];
        lines.push(this.colorize('IfStatement', 'node') + this.formatNodeInfo(node));

        this.currentDepth++;
        lines.push(`${this.getIndent()}test: ${this.printNode(node.test)}`);
        lines.push(`${this.getIndent()}consequent: ${this.printNode(node.consequent)}`);

        if (node.alternate) {
            lines.push(`${this.getIndent()}alternate: ${this.printNode(node.alternate)}`);
        }
        this.currentDepth--;

        return lines.join('\n');
    }

    private printWhileStatement(node: WhileStatement): string {
        const lines: string[] = [];
        lines.push(this.colorize('WhileStatement', 'node') + this.formatNodeInfo(node));

        this.currentDepth++;
        lines.push(`${this.getIndent()}test: ${this.printNode(node.test)}`);
        lines.push(`${this.getIndent()}body: ${this.printNode(node.body)}`);
        this.currentDepth--;

        return lines.join('\n');
    }

    private printForStatement(node: ForStatement): string {
        const lines: string[] = [];
        lines.push(this.colorize('ForStatement', 'node') + this.formatNodeInfo(node));

        this.currentDepth++;
        if (node.init) lines.push(`${this.getIndent()}init: ${this.printNode(node.init)}`);
        if (node.test) lines.push(`${this.getIndent()}test: ${this.printNode(node.test)}`);
        if (node.update) lines.push(`${this.getIndent()}update: ${this.printNode(node.update)}`);
        lines.push(`${this.getIndent()}body: ${this.printNode(node.body)}`);
        this.currentDepth--;

        return lines.join('\n');
    }

    private printForEachStatement(node: ForEachStatement): string {
        const lines: string[] = [];
        const varCount = node.variables.length;
        const varNames = node.variables.map(v => v.name).join(', ');
        lines.push(this.colorize('ForEachStatement', 'node') + ` (${varCount} variable${varCount !== 1 ? 's' : ''}: ${varNames})${this.formatNodeInfo(node)}`);

        this.currentDepth++;
        
        // Print variables
        for (const [index, variable] of node.variables.entries()) {
            lines.push(`${this.getIndent()}[${index}] variable: ${this.printNode(variable)}`);
        }
        
        // Print iterable
        lines.push(`${this.getIndent()}iterable: ${this.printNode(node.iterable)}`);
        
        // Print body
        lines.push(`${this.getIndent()}body: ${this.printNode(node.body)}`);
        
        this.currentDepth--;

        return lines.join('\n');
    }

    private printSwitchStatement(node: SwitchStatement): string {
        const lines: string[] = [];
        lines.push(this.colorize('SwitchStatement', 'node') + ` (${node.cases.length} cases)${this.formatNodeInfo(node)}`);

        this.currentDepth++;
        lines.push(`${this.getIndent()}discriminant: ${this.printNode(node.discriminant)}`);

        for (const [index, caseNode] of node.cases.entries()) {
            lines.push(`${this.getIndent()}[${index}] ${this.printNode(caseNode)}`);
        }
        this.currentDepth--;

        return lines.join('\n');
    }

    private printCaseStatement(node: CaseStatement): string {
        const lines: string[] = [];
        const caseType = node.test ? 'case' : 'default';
        lines.push(this.colorize('CaseStatement', 'node') + ` ${caseType} (${node.consequent.length} statements)${this.formatNodeInfo(node)}`);

        this.currentDepth++;
        if (node.test) {
            lines.push(`${this.getIndent()}test: ${this.printNode(node.test)}`);
        }

        if (!this.options.compact) {
            for (const [index, stmt] of node.consequent.entries()) {
                lines.push(`${this.getIndent()}[${index}] ${this.printNode(stmt)}`);
            }
        }
        this.currentDepth--;

        return lines.join('\n');
    }

    private printReturnStatement(node: ReturnStatement): string {
        let result = this.colorize('ReturnStatement', 'node');

        if (node.argument) {
            result += ` ${this.printNode(node.argument)}`;
        }

        return result + this.formatNodeInfo(node);
    }

    private printBreakStatement(node: BreakStatement): string {
        return this.colorize('BreakStatement', 'node') + this.formatNodeInfo(node);
    }

    private printContinueStatement(node: ContinueStatement): string {
        return this.colorize('ContinueStatement', 'node') + this.formatNodeInfo(node);
    }

    private printExpressionStatement(node: ExpressionStatement): string {
        const lines: string[] = [];
        lines.push(this.colorize('ExpressionStatement', 'node') + this.formatNodeInfo(node));

        this.currentDepth++;
        lines.push(`${this.getIndent()}└── ${this.printNode(node.expression)}`);
        this.currentDepth--;

        return lines.join('\n');
    }

    private printCallExpression(node: CallExpression): string {
        const callee = this.printNode(node.callee);
        const args = node.arguments ? node.arguments.map(arg => this.printNode(arg)).join(', ') : '';

        return this.colorize('CallExpression', 'node') + ` ${callee}(${args})${this.formatNodeInfo(node)}`;
    }

    private printMemberExpression(node: MemberExpression): string {
        const object = this.printNode(node.object);
        const property = this.printNode(node.property);
        const operator = node.computed ? '[]' : '.';

        return this.colorize('MemberExpression', 'node') + ` ${object}${operator}${property}${this.formatNodeInfo(node)}`;
    }

    private printBinaryExpression(node: BinaryExpression): string {
        const left = this.printNode(node.left);
        const right = this.printNode(node.right);

        return this.colorize('BinaryExpression', 'node') + ` ${left} ${node.operator} ${right}${this.formatNodeInfo(node)}`;
    }

    private printUnaryExpression(node: UnaryExpression): string {
        const lines: string[] = [];
        const operatorName = node.operator === '++' ? 'PostIncrementExpr' :
            node.operator === '--' ? 'PostDecrementExpr' :
                `UnaryExpression (${node.operator})`;

        lines.push(this.colorize(operatorName, 'node') + this.formatNodeInfo(node));

        this.currentDepth++;
        lines.push(`${this.getIndent()}└── ${this.printNode(node.operand)}`);
        this.currentDepth--;

        return lines.join('\n');
    }

    private printAssignmentExpression(node: AssignmentExpression): string {
        const lines: string[] = [];
        lines.push(this.colorize('AssignmentExpression', 'node') + ` (${node.operator})${this.formatNodeInfo(node)}`);

        this.currentDepth++;
        lines.push(`${this.getIndent()}├── Left: ${this.printNode(node.left)}`);
        lines.push(`${this.getIndent()}└── Right: ${this.printNode(node.right)}`);
        this.currentDepth--;

        return lines.join('\n');
    }

    private printArrayLiteralExpression(node: ArrayLiteralExpression): string {
        const lines: string[] = [];
        lines.push(this.colorize('ArrayLiteralExpression', 'node') + this.formatNodeInfo(node));

        if (node.elements.length === 0) {
            this.currentDepth++;
            lines.push(`${this.getIndent()}└── (empty array)`);
            this.currentDepth--;
        } else {
            this.currentDepth++;
            for (let i = 0; i < node.elements.length; i++) {
                const isLast = i === node.elements.length - 1;
                const prefix = isLast ? '└──' : '├──';
                lines.push(`${this.getIndent()}${prefix} [${i}] ${this.printNode(node.elements[i])}`);
            }
            this.currentDepth--;
        }

        return lines.join('\n');
    }

    private printNewExpression(node: NewExpression): string {
        const lines: string[] = [];
        const typeDescription = this.printTypeDescription(node.type);
        lines.push(this.colorize('NewExpression', 'node') + ` new ${typeDescription}${this.formatNodeInfo(node)}`);

        // Show constructor arguments if present
        if (node.arguments && node.arguments.length > 0) {
            this.currentDepth++;
            lines.push(`${this.getIndent()}├── Arguments:`);
            this.currentDepth++;
            for (let i = 0; i < node.arguments.length; i++) {
                const isLast = i === node.arguments.length - 1;
                const prefix = isLast ? '└──' : '├──';
                lines.push(`${this.getIndent()}${prefix} [${i}] ${this.printNode(node.arguments[i])}`);
            }
            this.currentDepth--;
            this.currentDepth--;
        }

        // Show array size if present
        if (node.arraySize) {
            this.currentDepth++;
            lines.push(`${this.getIndent()}└── ArraySize: ${this.printNode(node.arraySize)}`);
            this.currentDepth--;
        }

        return lines.join('\n');
    }

    private printIdentifier(node: Identifier): string {
        return this.colorize('Identifier', 'identifier') + ` ${this.colorize(node.name, 'identifierValue')}${this.formatNodeInfo(node)}`;
    }

    private printLiteral(node: Literal): string {
        const value = typeof node.value === 'string' ? `"${node.value}"` : String(node.value);
        return this.colorize('Literal', 'literal') + ` ${this.colorize(value, 'literalValue')}${this.formatNodeInfo(node)}`;
    }

    private formatNodeInfo(node: ASTNode): string {
        const parts: string[] = [];

        if (this.options.includePositions) {
            parts.push(`@${this.formatPosition(node.start)}-${this.formatPosition(node.end)}`);
        }

        if (this.options.includeURI && node.uri) {
            parts.push(`uri: ${node.uri}`);
        }

        return parts.length > 0 ? ` (${parts.join(', ')})` : '';
    }

    private formatPosition(pos: Position): string {
        return `${pos.line + 1}:${pos.character + 1}`;
    }

    private getIndent(): string {
        return this.options.indent.repeat(this.currentDepth);
    }

    private colorize(text: string, type: string): string {
        if (!this.options.useColors) {
            return text;
        }

        const colors: Record<string, string> = {
            header: '\x1b[1m\x1b[36m',      // Bold Cyan
            node: '\x1b[33m',               // Yellow
            className: '\x1b[1m\x1b[32m',   // Bold Green
            functionName: '\x1b[1m\x1b[34m', // Bold Blue
            variableName: '\x1b[36m',       // Cyan
            enumName: '\x1b[35m',           // Magenta
            enumMemberName: '\x1b[95m',     // Bright Magenta
            parameterName: '\x1b[36m',      // Cyan
            type: '\x1b[32m',               // Green
            identifier: '\x1b[37m',         // White
            identifierValue: '\x1b[1m\x1b[37m', // Bold White
            literal: '\x1b[31m',            // Red
            literalValue: '\x1b[1m\x1b[31m', // Bold Red
            position: '\x1b[90m',           // Dark Gray
            info: '\x1b[36m',               // Cyan
            warning: '\x1b[1m\x1b[33m',     // Bold Yellow
            muted: '\x1b[90m',              // Dark Gray
            reset: '\x1b[0m'                // Reset
        };

        const color = colors[type] || colors.reset;
        return `${color}${text}${colors.reset}`;
    }

    private collectStats(node: ASTNode): {
        totalNodes: number;
        nodeTypeCounts: Record<string, number>;
        maxDepth: number;
    } {
        const stats = {
            totalNodes: 0,
            nodeTypeCounts: {} as Record<string, number>,
            maxDepth: 0
        };

        this.traverseForStats(node, stats, 0);
        return stats;
    }

    private traverseForStats(node: ASTNode, stats: { totalNodes: number; nodeTypeCounts: Record<string, number>; maxDepth: number }, depth: number): void {
        stats.totalNodes++;
        stats.nodeTypeCounts[node.kind] = (stats.nodeTypeCounts[node.kind] || 0) + 1;
        stats.maxDepth = Math.max(stats.maxDepth, depth);

        // Traverse child nodes based on node type
        this.traverseChildren(node, (child) => {
            this.traverseForStats(child, stats, depth + 1);
        });
    }

    private traverseChildren(node: ASTNode, callback: (child: ASTNode) => void): void {
        switch (node.kind) {
            case 'File': {
                const fileNode = node as FileNode;
                fileNode.body.forEach(callback);
                break;
            }

            case 'ClassDecl': {
                const classNode = node as ClassDeclNode;
                if (classNode.baseClass) callback(classNode.baseClass);
                if (classNode.members) classNode.members.forEach(callback);
                if (classNode.body) callback(classNode.body);
                break;
            }

            case 'FunctionDecl': {
                const funcNode = node as FunctionDeclNode;
                if (funcNode.returnType) callback(funcNode.returnType);
                if (funcNode.parameters) funcNode.parameters.forEach(callback);
                if (funcNode.body) callback(funcNode.body);
                break;
            }

            case 'VarDecl': {
                const varNode = node as VarDeclNode;
                if (varNode.type) callback(varNode.type);
                if (varNode.initializer) callback(varNode.initializer);
                break;
            }

            case 'EnumDecl': {
                const enumNode = node as EnumDeclNode;
                if (enumNode.baseType) callback(enumNode.baseType);
                if (enumNode.members) enumNode.members.forEach(callback);
                break;
            }

            case 'EnumMemberDecl': {
                const enumMemberNode = node as EnumMemberDeclNode;
                if (enumMemberNode.value) callback(enumMemberNode.value);
                break;
            }

            case 'BlockStatement': {
                const blockNode = node as BlockStatement;
                blockNode.body.forEach(callback);
                break;
            }

            case 'IfStatement': {
                const ifNode = node as IfStatement;
                callback(ifNode.test);
                callback(ifNode.consequent);
                if (ifNode.alternate) callback(ifNode.alternate);
                break;
            }

            case 'ForStatement': {
                const forNode = node as ForStatement;
                if (forNode.init) callback(forNode.init);
                if (forNode.test) callback(forNode.test);
                if (forNode.update) callback(forNode.update);
                callback(forNode.body);
                break;
            }

            case 'ForEachStatement': {
                const forEachNode = node as ForEachStatement;
                forEachNode.variables.forEach(callback);
                callback(forEachNode.iterable);
                callback(forEachNode.body);
                break;
            }

            case 'CallExpression': {
                const callNode = node as CallExpression;
                callback(callNode.callee);
                if (callNode.arguments) callNode.arguments.forEach(callback);
                break;
            }

            case 'NewExpression': {
                const newNode = node as NewExpression;
                callback(newNode.type);
                if (newNode.arguments) newNode.arguments.forEach(callback);
                if (newNode.arraySize) callback(newNode.arraySize);
                break;
            }

            // Add more cases as needed...
        }
    }
}

/**
 * Utility functions for quick AST printing
 */
export function printAST(node: ASTNode, options?: PrintOptions): string {
    const printer = new ASTPrinter(options);
    return printer.print(node);
}

export function printASTToConsole(node: ASTNode, options?: PrintOptions): void {
    const printer = new ASTPrinter(options);
    printer.printToConsole(node);
}

export function printASTStats(node: ASTNode, options?: PrintOptions): string {
    const printer = new ASTPrinter(options);
    return printer.printStats(node);
}

export function printFile(file: FileNode, title?: string, options?: PrintOptions): string {
    const printer = new ASTPrinter(options);
    return printer.printFile(file, title);
}
