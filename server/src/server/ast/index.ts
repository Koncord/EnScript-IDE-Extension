// Re-export main parsing functions
export { parseWithDiagnostics } from '../parser/parser';

// Re-export factory
export { ParserFactory } from '../util/factory';

// Re-export configuration
export {
    ParserConfig,
    defaultConfig,
    debugConfig,
    createConfig
} from './config';

// Re-export all AST types and interfaces
export {
    NodeKind,
    ASTNode,
    TypeNode,
    ClassDeclNode,
    EnumDeclNode,
    EnumMemberDeclNode,
    TypedefDeclNode,
    VarDeclNode,
    FunctionDeclNode,
    FileNode,
    Declaration,
    Statement,
    Expression,
    ParameterDeclNode,
    BlockStatement,
    MethodDeclNode,
    TypeReferenceNode,
    CallExpression,
    MemberExpression
} from './node-types';

// Re-export error types
export {
    ParseError,
    ContextualParseError,
    ErrorContext
} from './errors';

// Re-export recovery strategies
export {
    ExpressionRecoveryStrategy
} from '../recovery/expression-recovery';

export {
    StatementRecoveryStrategy
} from '../recovery/statement-recovery';

// Re-export unified recovery system
export {
    RecoveryAction,
    RecoveryResult,
    RecoveryActionUtils
} from '../recovery/recovery-actions';

export {
    BaseRecoveryStrategy,
    RecoveryConfig,
    isTypeKeyword,
    isDeclarationKeyword
} from '../recovery/base-recovery';

export {
    DeclarationRecoveryStrategy
} from '../recovery/declaration-recovery';

export {
    TypeRecoveryStrategy
} from '../recovery/type-recovery';

export {
    PreprocessorRecoveryStrategy
} from '../recovery/preprocessor-recovery';

// Re-export utility functions
export {
    isModifier,
    isPrimitiveType,
} from '../util/utils';

// Re-export TokenStream for advanced use cases
export { TokenStream } from '../lexer/token-stream';
