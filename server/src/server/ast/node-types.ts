/**
 * Comprehensive AST Node Type Definitions
 */

import { Position } from 'vscode-languageserver';

/**
 * All possible node kinds in the AST
 */
export type NodeKind =
    // File/Root
    | 'File'

    // Declarations
    | 'ClassDecl'
    | 'EnumDecl'
    | 'EnumMemberDecl'
    | 'FunctionDecl'
    | 'MethodDecl'
    | 'ProtoMethodDecl'
    | 'VarDecl'
    | 'TypedefDecl'
    | 'ParameterDecl'

    // Types
    | 'TypeReference'
    | 'GenericType'
    | 'GenericParameter'
    | 'ArrayType'
    | 'AutoType'

    // Statements
    | 'ExpressionStatement'
    | 'BlockStatement'
    | 'IfStatement'
    | 'WhileStatement'
    | 'ForStatement'
    | 'ForEachStatement'
    | 'SwitchStatement'
    | 'CaseStatement'
    | 'ReturnStatement'
    | 'BreakStatement'
    | 'ContinueStatement'
    | 'DeclarationStatement'

    // Expressions
    | 'BinaryExpression'
    | 'UnaryExpression'
    | 'AssignmentExpression'
    | 'CallExpression'
    | 'MemberExpression'
    | 'StaticMemberExpression'
    | 'ArrayAccessExpression'
    | 'CastExpression'
    | 'NewExpression'
    | 'ConditionalExpression'
    | 'Identifier'
    | 'Literal'
    | 'VectorLiteral'
    | 'ArrayLiteralExpression'
    | 'TypeNameExpression'
    | 'ThisExpression'
    | 'SuperExpression'
    ;

/**
 * Base interface for all AST nodes
 */
export interface ASTNode {
    kind: NodeKind;
    uri: string;
    start: Position;
    end: Position;
    parent?: ASTNode;
    children?: ASTNode[];
}

// ============================================================================
// BASE TYPES
// ============================================================================

/**
 * Base interface for expressions
 */
export interface Expression extends ASTNode {
    /** Inferred type information */
    inferredType?: import('../types/model').Type;
}

/**
 * Base interface for all statement nodes
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Statement extends ASTNode {
}

/**
 * Base interface for declarations
 */
export interface Declaration extends ASTNode {
    name: string;
    nameStart: Position;
    nameEnd: Position;
    modifiers: string[];
    annotations: string[][];
}

// ============================================================================
// TYPE NODES
// ============================================================================

/**
 * Reference to a type (e.g., int, string, MyClass)
 */
export interface TypeReferenceNode extends ASTNode {
    kind: 'TypeReference';
    name: string;
    /** Type modifiers like 'ref', 'owned' */
    modifiers?: string[];
    /** Generic type arguments */
    typeArguments?: TypeNode[];
}

/**
 * Generic type with parameters (e.g., array<Class T>, map<Class K, Class V>)
 */
export interface GenericTypeNode extends ASTNode {
    kind: 'GenericType';
    baseType: TypeNode;
    typeArguments: TypeNode[];
}

/**
 * Generic parameter declaration (Class T, Class K, etc.)
 */
export interface GenericParameterNode extends ASTNode {
    kind: 'GenericParameter';
    name: string;
    isClass: boolean; // true for "Class T", false for just "T"
}

/**
 * Array type (e.g., int[], string[10])
 */
export interface ArrayTypeNode extends ASTNode {
    kind: 'ArrayType';
    elementType: TypeNode;
    size?: Expression; // For sized arrays like int[10]
}

/**
 * Auto type for type inference
 */
export interface AutoTypeNode extends ASTNode {
    kind: 'AutoType';
    inferredType?: import('../types/model').Type;
}

/**
 * Union type for all type nodes
 */
export type TypeNode =
    | TypeReferenceNode
    | GenericTypeNode
    | ArrayTypeNode
    | AutoTypeNode;

// ============================================================================
// EXPRESSION NODES
// ============================================================================

/**
 * Binary operations (e.g., a + b, x == y, p && q)
 */
export interface BinaryExpression extends Expression {
    kind: 'BinaryExpression';
    operator: BinaryOperator;
    left: Expression;
    right: Expression;
}

/**
 * Unary operations (e.g., !x, -y, ++z)
 */
export interface UnaryExpression extends Expression {
    kind: 'UnaryExpression';
    operator: UnaryOperator;
    operand: Expression;
    prefix: boolean; // true for ++x, false for x++
}

/**
 * Assignment expressions (e.g., x = y, a += b)
 */
export interface AssignmentExpression extends Expression {
    kind: 'AssignmentExpression';
    operator: AssignmentOperator;
    left: Expression;
    right: Expression;
}

/**
 * Function calls (e.g., func(a, b))
 */
export interface CallExpression extends Expression {
    kind: 'CallExpression';
    callee: Expression;
    arguments: Expression[];
    calleeStart: Position;
    calleeEnd: Position;
}

/**
 * Member access (e.g., obj.prop, ptr->field)
 */
export interface MemberExpression extends Expression {
    kind: 'MemberExpression';
    object: Expression;
    property: Identifier;
    computed: boolean; // true for obj[prop], false for obj.prop
    optional: boolean; // true for obj?.prop
    memberStart: Position;
    memberEnd: Position;
}

/**
 * Static member access (e.g., ClassName.StaticMethod())
 */
export interface StaticMemberExpression extends Expression {
    kind: 'StaticMemberExpression';
    className: Identifier;
    property: Identifier;
    classStart: Position;
    classEnd: Position;
    memberStart: Position;
    memberEnd: Position;
}

/**
 * Array/bracket access (e.g., arr[index])
 */
export interface ArrayAccessExpression extends Expression {
    kind: 'ArrayAccessExpression';
    object: Expression;
    index: Expression;
}

/**
 * Type casting (e.g., (int)x)
 */
export interface CastExpression extends Expression {
    kind: 'CastExpression';
    type: TypeNode;
    expression: Expression;
    style: 'c-style';
}

/**
 * Object construction (e.g., new Class(), new int[10])
 */
export interface NewExpression extends Expression {
    kind: 'NewExpression';
    type: TypeNode;
    arguments?: Expression[];
    arraySize?: Expression;
}

/**
 * Conditional/ternary expression (e.g., condition ? trueExpr : falseExpr)
 */
export interface ConditionalExpression extends Expression {
    kind: 'ConditionalExpression';
    test: Expression;
    consequent: Expression;
    alternate: Expression;
}

/**
 * Identifier reference (e.g., variableName)
 */
export interface Identifier extends Expression {
    kind: 'Identifier';
    name: string;
}

/**
 * Literal values with EnScript type system support
 */
export interface Literal extends Expression {
    kind: 'Literal';
    value: LiteralValue;
    raw: string; // Original text representation
    literalType: LiteralType;
}

/**
 * Union type for all possible literal values in EnScript
 */
export type LiteralValue =
    | number     // int: −2,147,483,648 to +2,147,483,647
    | number     // float: ±1.401298E−45 to ±3.402823E+38  
    | boolean    // bool: true or false
    | string     // string: UTF-8 text
    | Vector3    // vector: (x, y, z) coordinates
    | null       // null reference
    | undefined  // void/uninitialized
    | string;    // typename/Class (as string representation)

/**
 * 3D Vector type for EnScript vector literals
 */
export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

/**
 * this keyword
 */
export interface ThisExpression extends Expression {
    kind: 'ThisExpression';
}

/**
 * super keyword
 */
export interface SuperExpression extends Expression {
    kind: 'SuperExpression';
}

/**
 * Vector literal (e.g., "1.0 2.0 3.0" or Vector(1.0, 2.0, 3.0))
 */
export interface VectorLiteral extends Expression {
    kind: 'VectorLiteral';
    x: number;
    y: number;
    z: number;
    raw: string; // Original representation
}

/**
 * Array literal expression using EnScript {element1, element2, ...} syntax
 */
export interface ArrayLiteralExpression extends Expression {
    kind: 'ArrayLiteralExpression';
    elements: Expression[];
}

/**
 * Typename expression for type references (e.g., typename PlayerBase)
 */
export interface TypeNameExpression extends Expression {
    kind: 'TypeNameExpression';
    typeName: string;
}

// ============================================================================
// STATEMENT NODES
// ============================================================================

/**
 * Expression used as a statement
 */
export interface ExpressionStatement extends Statement {
    kind: 'ExpressionStatement';
    expression: Expression;
}

/**
 * Block of statements ({ ... })
 */
export interface BlockStatement extends Statement {
    kind: 'BlockStatement';
    body: Statement[];
}

/**
 * If statement with optional else
 */
export interface IfStatement extends Statement {
    kind: 'IfStatement';
    test: Expression;
    consequent: Statement;
    alternate?: Statement;
}

/**
 * While loop
 */
export interface WhileStatement extends Statement {
    kind: 'WhileStatement';
    test: Expression;
    body: Statement;
}

/**
 * For loop
 */
export interface ForStatement extends Statement {
    kind: 'ForStatement';
    init?: VarDeclNode | Expression;
    test?: Expression;
    update?: Expression;
    body: Statement;
}

/**
 * Foreach loop (EnScript syntax: foreach (type variable : iterable) or foreach (type key, type value : iterable))
 */
export interface ForEachStatement extends Statement {
    kind: 'ForEachStatement';
    variables: VarDeclNode[];  // The loop variable declarations (can be multiple: key, value)
    iterable: Expression;      // The expression to iterate over
    body: Statement;           // The loop body
}

/**
 * Return statement
 */
export interface ReturnStatement extends Statement {
    kind: 'ReturnStatement';
    argument?: Expression;
}

/**
 * Break statement
 */
export interface BreakStatement extends Statement {
    kind: 'BreakStatement';
}

/**
 * Continue statement
 */
export interface ContinueStatement extends Statement {
    kind: 'ContinueStatement';
}

/**
 * Switch statement
 */
export interface SwitchStatement extends Statement {
    kind: 'SwitchStatement';
    discriminant: Expression;
    cases: CaseStatement[];
}

/**
 * Case statement (including default)
 */
export interface CaseStatement extends Statement {
    kind: 'CaseStatement';
    test?: Expression; // undefined for default case
    consequent: Statement[];
}

/**
 * Declaration as a statement (for variable declarations inside blocks)
 * Supports multiple comma-separated declarations like: int low, high;
 */
export interface DeclarationStatement extends Statement {
    kind: 'DeclarationStatement';
    declaration: Declaration; // Primary declaration (first one)
    declarations?: Declaration[]; // All declarations when there are multiple (includes declaration)
}

// ============================================================================
// DECLARATION NODES
// ============================================================================

/**
 * Class declaration node
 */
export interface ClassDeclNode extends Declaration {
    kind: 'ClassDecl';
    genericParameters?: GenericParameterNode[]; // EnScript uses "Class T" syntax
    baseClass?: TypeNode;
    members: Declaration[]; // MethodDecl, ProtoMethodDecl, VarDecl
    body: BlockStatement;
}

/**
 * Enum declaration
 */
export interface EnumDeclNode extends Declaration {
    kind: 'EnumDecl';
    baseType?: TypeNode;
    members: EnumMemberDeclNode[];
}

/**
 * Enum member declaration
 */
export interface EnumMemberDeclNode extends Declaration {
    kind: 'EnumMemberDecl';
    value?: Expression;
}

/**
 * Function declaration node (global functions)
 */
export interface FunctionDeclNode extends Declaration {
    kind: 'FunctionDecl';
    parameters: ParameterDeclNode[];
    returnType: TypeNode;
    locals?: VarDeclNode[]; // Local variables declared in function body
    body?: BlockStatement;
    genericParameters?: GenericParameterNode[]; // For generic functions
    isStatic?: boolean; // Legacy field, typically not used for global functions
    isOverride?: boolean; // Legacy field, typically not used for global functions
}

/**
 * Method declaration (regular class methods)
 */
export interface MethodDeclNode extends Declaration {
    kind: 'MethodDecl';
    returnType: TypeNode;
    parameters: ParameterDeclNode[];
    locals?: VarDeclNode[]; // Local variables declared in method body
    body?: BlockStatement;
    isConstructor?: boolean;
    isDestructor?: boolean;
}

/**
 * Parameter declaration
 */
export interface ParameterDeclNode extends Declaration {
    kind: 'ParameterDecl';
    type: TypeNode;
    defaultValue?: Expression;
}

/**
 * Variable declaration
 */
export interface VarDeclNode extends Declaration {
    kind: 'VarDecl';
    type: TypeNode;
    initializer?: Expression;
}

/**
 * Typedef declaration
 */
export interface TypedefDeclNode extends Declaration {
    kind: 'TypedefDecl';
    type: TypeNode;
}

// ============================================================================
// OPERATOR TYPES
// ============================================================================

export type BinaryOperator =
    // Arithmetic
    | '+' | '-' | '*' | '/' | '%'
    // Comparison  
    | '==' | '!=' | '<' | '>' | '<=' | '>='
    // Logical
    | '&&' | '||'
    // Bitwise
    | '&' | '|' | '^' | '<<' | '>>'
    // Member access
    | '.' | '->'
    // EnScript specific
    | 'is' | 'as'; // Type checking and casting

export type UnaryOperator =
    | '+' | '-' | '!' | '~' | '++' | '--'
    | '&' | '*' // Address-of and dereference
    | 'delete'; // EnScript specific

export type AssignmentOperator =
    | '=' | '+=' | '-=' | '*=' | '/=' | '%='
    | '&=' | '|=' | '^=' | '<<=' | '>>=';

/**
 * EnScript primitive and literal types
 */
export type LiteralType =
    // EnScript primitives
    | 'int'      // −2,147,483,648 to +2,147,483,647, default: 0
    | 'float'    // ±1.401298E−45 to ±3.402823E+38, default: 0.0
    | 'bool'     // true or false, default: false
    | 'string'   // text, default: "" (empty string)
    | 'vector'   // 3D vector (float, float, float), default: (0.0,0.0,0.0)
    | 'void'     // no value
    | 'null'     // null reference
    | 'char'     // Single character
    // Additional types
    | 'typename' // Type name literal
    | 'Class'    // Class reference
    | 'func'     // Function reference
    ;

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Represents a parsed file containing top-level declarations
 */
export interface FileNode extends ASTNode {
    kind: 'File';
    body: Declaration[]; // Contains ClassDecl, FunctionDecl, EnumDecl, TypedefDecl, VarDecl
    version: number;
}

/**
 * EnScript operator precedence and associativity
 * Higher precedence = evaluated first
 */
export const ENSCRIPT_OPERATOR_PRECEDENCE = {
    // Postfix operators
    '++': { precedence: 16, associativity: 'left' as const, type: 'postfix' as const },
    '--': { precedence: 16, associativity: 'left' as const, type: 'postfix' as const },
    '()': { precedence: 16, associativity: 'left' as const, type: 'call' as const },
    '[]': { precedence: 16, associativity: 'left' as const, type: 'subscript' as const },
    '.': { precedence: 16, associativity: 'left' as const, type: 'member' as const },

    // Unary operators (prefix)
    'unary+': { precedence: 15, associativity: 'right' as const, type: 'prefix' as const },
    'unary-': { precedence: 15, associativity: 'right' as const, type: 'prefix' as const },
    '!': { precedence: 15, associativity: 'right' as const, type: 'prefix' as const },
    '~': { precedence: 15, associativity: 'right' as const, type: 'prefix' as const },
    'delete': { precedence: 15, associativity: 'right' as const, type: 'prefix' as const },

    // Type casting
    'as': { precedence: 14, associativity: 'left' as const, type: 'binary' as const },
    'is': { precedence: 14, associativity: 'left' as const, type: 'binary' as const },

    // Multiplicative
    '*': { precedence: 13, associativity: 'left' as const, type: 'binary' as const },
    '/': { precedence: 13, associativity: 'left' as const, type: 'binary' as const },
    '%': { precedence: 13, associativity: 'left' as const, type: 'binary' as const },

    // Additive
    '+': { precedence: 12, associativity: 'left' as const, type: 'binary' as const },
    '-': { precedence: 12, associativity: 'left' as const, type: 'binary' as const },

    // Bitwise shift
    '<<': { precedence: 11, associativity: 'left' as const, type: 'binary' as const },
    '>>': { precedence: 11, associativity: 'left' as const, type: 'binary' as const },

    // Relational
    '<': { precedence: 10, associativity: 'left' as const, type: 'binary' as const },
    '>': { precedence: 10, associativity: 'left' as const, type: 'binary' as const },
    '<=': { precedence: 10, associativity: 'left' as const, type: 'binary' as const },
    '>=': { precedence: 10, associativity: 'left' as const, type: 'binary' as const },

    // Equality
    '==': { precedence: 9, associativity: 'left' as const, type: 'binary' as const },
    '!=': { precedence: 9, associativity: 'left' as const, type: 'binary' as const },

    // Bitwise AND
    '&': { precedence: 8, associativity: 'left' as const, type: 'binary' as const },

    // Bitwise XOR
    '^': { precedence: 7, associativity: 'left' as const, type: 'binary' as const },

    // Bitwise OR
    '|': { precedence: 6, associativity: 'left' as const, type: 'binary' as const },

    // Logical AND
    '&&': { precedence: 5, associativity: 'left' as const, type: 'binary' as const },

    // Logical OR
    '||': { precedence: 4, associativity: 'left' as const, type: 'binary' as const },

    // Assignment
    '=': { precedence: 2, associativity: 'right' as const, type: 'binary' as const },
    '+=': { precedence: 2, associativity: 'right' as const, type: 'binary' as const },
    '-=': { precedence: 2, associativity: 'right' as const, type: 'binary' as const },
    '*=': { precedence: 2, associativity: 'right' as const, type: 'binary' as const },
    '/=': { precedence: 2, associativity: 'right' as const, type: 'binary' as const },
    '%=': { precedence: 2, associativity: 'right' as const, type: 'binary' as const },
    '&=': { precedence: 2, associativity: 'right' as const, type: 'binary' as const },
    '|=': { precedence: 2, associativity: 'right' as const, type: 'binary' as const },
    '^=': { precedence: 2, associativity: 'right' as const, type: 'binary' as const },
    '<<=': { precedence: 2, associativity: 'right' as const, type: 'binary' as const },
    '>>=': { precedence: 2, associativity: 'right' as const, type: 'binary' as const },

    // Comma (lowest precedence)
    ',': { precedence: 1, associativity: 'left' as const, type: 'binary' as const }
} as const;

/**
 * Check if an operator is valid in EnScript
 */
export function isValidEnScriptOperator(operator: string): boolean {
    return operator in ENSCRIPT_OPERATOR_PRECEDENCE;
}

/**
 * Get operator precedence for EnScript operators
 */
export function getOperatorPrecedence(operator: string): number {
    const info = ENSCRIPT_OPERATOR_PRECEDENCE[operator as keyof typeof ENSCRIPT_OPERATOR_PRECEDENCE];
    return info?.precedence ?? 0;
}

/**
 * Check if an operator is right-associative
 */
export function isRightAssociative(operator: string): boolean {
    const info = ENSCRIPT_OPERATOR_PRECEDENCE[operator as keyof typeof ENSCRIPT_OPERATOR_PRECEDENCE];
    return info?.associativity === 'right';
}

// ============================================================================
// ENSCRIPT TYPE UTILITIES
// ============================================================================

/**
 * EnScript primitive type names with their specifications
 */
export const ENSCRIPT_PRIMITIVES = {
    'int': {
        min: -2147483648,
        max: 2147483647,
        default: 0,
        size: 32 // bits
    },
    'float': {
        min: 1.401298e-45,
        max: 3.402823e38,
        default: 0.0,
        size: 32 // bits, IEEE 754 single precision
    },
    'bool': {
        values: [true, false],
        default: false
    },
    'string': {
        default: '',
        encoding: 'utf-8'
    },
    'vector': {
        components: 3,
        default: { x: 0.0, y: 0.0, z: 0.0 },
        elementType: 'float'
    },
    'void': {
        description: 'No value type'
    },
    'Class': {
        default: null,
        description: 'Reference to any class instance'
    },
    'typename': {
        default: null,
        description: 'Type name reference'
    }
} as const;

/**
 * Check if a type name is an EnScript primitive
 */
export function isEnScriptPrimitive(typeName: string): boolean {
    return typeName in ENSCRIPT_PRIMITIVES;
}

/**
 * Get default value for an EnScript type
 */
export function getDefaultValue(typeName: string): LiteralValue {
    switch (typeName) {
        case 'int':
            return ENSCRIPT_PRIMITIVES.int.default;
        case 'float':
            return ENSCRIPT_PRIMITIVES.float.default;
        case 'bool':
            return ENSCRIPT_PRIMITIVES.bool.default;
        case 'string':
            return ENSCRIPT_PRIMITIVES.string.default;
        case 'vector':
            return ENSCRIPT_PRIMITIVES.vector.default;
        case 'void':
            return undefined;
        case 'Class':
        case 'typename':
            return null;
        default:
            return null; // Unknown type defaults to null
    }
}

/**
 * Validate if a value is within range for an EnScript type
 */
export function validateTypeValue(typeName: string, value: LiteralValue): boolean {
    switch (typeName) {
        case 'int':
            if (typeof value !== 'number' || !Number.isInteger(value)) return false;
            return value >= ENSCRIPT_PRIMITIVES.int.min && value <= ENSCRIPT_PRIMITIVES.int.max;

        case 'float':
            if (typeof value !== 'number') return false;
            return Math.abs(value) >= ENSCRIPT_PRIMITIVES.float.min || value === 0;

        case 'bool':
            return typeof value === 'boolean';

        case 'string':
            return typeof value === 'string';

        case 'vector':
            return typeof value === 'object' && value !== null &&
                'x' in value && 'y' in value && 'z' in value &&
                typeof value.x === 'number' && typeof value.y === 'number' && typeof value.z === 'number';

        case 'void':
            return value === undefined;

        case 'Class':
        case 'typename':
            return value === null || typeof value === 'string';

        default:
            return true; // Unknown types are not validated
    }
}
