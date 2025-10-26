/**
 * Unified recovery actions for all recovery strategies
 * Consolidates common patterns while maintaining strategy-specific capabilities
 */

import { Token } from '../lexer/token';

/**
 * Core recovery actions available to all recovery strategies
 */
export enum RecoveryAction {
    // === CONTINUATION ACTIONS ===
    /** Continue parsing normally */
    Continue = 'continue',
    /** Report warning and continue */
    WarnAndContinue = 'warn_continue',
    /** Throw error and stop parsing */
    ThrowError = 'throw_error',

    // === TOKEN MANIPULATION ACTIONS ===
    /** Insert synthetic token and continue */
    InsertSynthetic = 'insert_synthetic',
    /** Skip current token and continue */
    Skip = 'skip',
    /** Split compound token into parts */
    SplitToken = 'split_token',

    // === GENERIC SKIP ACTIONS ===
    /** Skip to next delimiter (;, }, etc.) */
    SkipToDelimiter = 'skip_to_delimiter',
    /** Skip to next keyword */
    SkipToKeyword = 'skip_to_keyword',

    // === STATEMENT-LEVEL SKIP ACTIONS ===
    /** Skip to next semicolon */
    SkipToSemicolon = 'skip_to_semicolon',
    /** Skip to next closing brace */
    SkipToCloseBrace = 'skip_to_close_brace',
    /** Skip to next statement keyword */
    SkipToStatement = 'skip_to_statement',

    // === DECLARATION-LEVEL SKIP ACTIONS ===
    /** Skip to next declaration */
    SkipToNextDeclaration = 'skip_to_next_declaration',
    /** Skip to next class member */
    SkipToClassMember = 'skip_to_class_member',
    /** Skip to end of current block */
    SkipToBlockEnd = 'skip_to_block_end',

    // === TYPE-LEVEL SKIP ACTIONS ===
    /** Skip to end of generic parameter list */
    SkipToGenericEnd = 'skip_to_generic_end',
    /** Skip to end of type expression */
    SkipToTypeEnd = 'skip_to_type_end',

    // === PREPROCESSOR-LEVEL SKIP ACTIONS ===
    /** Skip to next preprocessor directive */
    SkipToNextDirective = 'skip_to_next_directive',
    /** Skip to matching #endif */
    SkipToEndif = 'skip_to_endif',
    /** Skip to #else clause */
    SkipToElse = 'skip_to_else'
}

/**
 * Recovery result interface that all strategies use
 */
export interface RecoveryResult {
    /** The recovery action to take */
    action: RecoveryAction;
    /** Optional descriptive message about the recovery */
    message?: string;
    /** Position after recovery (for skip actions) */
    recoveredPosition?: number;
    /** Synthetic token created during recovery */
    syntheticToken?: Token
    /** Strategy-specific context data */
    declarationType?: 'class' | 'function' | 'variable' | 'enum' | 'typedef';
    statementType?: 'if' | 'while' | 'for' | 'switch' | 'block' | 'expression';
    typeContext?: 'generic' | 'array' | 'ref' | 'pointer' | 'compound' | 'basic' | 'modifier';
    directiveType?: 'ifdef' | 'ifndef' | 'if' | 'else' | 'elif' | 'endif' | 'define' | 'undef' | 'include';
    expressionType?: 'binary' | 'unary' | 'call' | 'member' | 'literal' | 'identifier';
    /** Recovery metadata */
    skipTarget?: string;
    tokensSkipped?: number;
    syntheticsInserted?: number;
    /** For split token operations */
    splitTokens?: Token[];
}



/**
 * Utility functions for working with recovery actions
 */
export class RecoveryActionUtils {
    
    /** Check if action continues parsing */
    static isContinuation(action: RecoveryAction): boolean {
        return action === RecoveryAction.Continue || 
               action === RecoveryAction.WarnAndContinue ||
               action === RecoveryAction.InsertSynthetic;
    }

    /** Check if action involves skipping tokens */
    static isSkipAction(action: RecoveryAction): boolean {
        return action.toString().includes('skip') || action === RecoveryAction.Skip;
    }

    /** Check if action terminates parsing */
    static isTerminalAction(action: RecoveryAction): boolean {
        return action === RecoveryAction.ThrowError;
    }

    /** Check if action creates synthetic content */
    static createsSynthetic(action: RecoveryAction): boolean {
        return action === RecoveryAction.InsertSynthetic || 
               action === RecoveryAction.SplitToken;
    }

    /** Get human-readable description of recovery action */
    static getActionDescription(action: RecoveryAction): string {
        switch (action) {
            case RecoveryAction.Continue: return 'Continue parsing normally';
            case RecoveryAction.WarnAndContinue: return 'Issue warning and continue';
            case RecoveryAction.ThrowError: return 'Stop parsing due to error';
            case RecoveryAction.InsertSynthetic: return 'Insert synthetic token';
            case RecoveryAction.Skip: return 'Skip problematic token';
            case RecoveryAction.SplitToken: return 'Split compound token';
            case RecoveryAction.SkipToSemicolon: return 'Skip to next semicolon';
            case RecoveryAction.SkipToCloseBrace: return 'Skip to closing brace';
            case RecoveryAction.SkipToNextDeclaration: return 'Skip to next declaration';
            case RecoveryAction.SkipToEndif: return 'Skip to matching #endif';
            default: return `Perform ${action} recovery`;
        }
    }
}
