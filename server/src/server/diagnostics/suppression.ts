/**
 * Diagnostic Suppression via Comments
 * 
 * Supports suppressing diagnostics via special comments:
 * - `// enscript-suppress` - suppresses all rules on the next line
 * - `// enscript-suppress[rule-id]` - suppresses specific rule on next line
 * - `// enscript-suppress[rule-id1,rule-id2]` - suppresses multiple rules on next line
 * - `something; // enscript-suppress` - suppresses all rules on the current line
 * - `something; // enscript-suppress[rule-id]` - suppresses specific rule on current line
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Token, TokenKind } from '../lexer/token';

/**
 * Represents a suppression directive parsed from a comment
 */
export interface SuppressionDirective {
    /** Line number (0-based) where the suppression applies */
    line: number;

    /** Specific rule IDs to suppress, or undefined to suppress all rules */
    ruleIds?: Set<string>;

    /** The type of suppression directive */
    type: 'next-line' | 'current-line';

    /** The full comment text */
    commentText: string;
}

/**
 * Maps line numbers to suppression directives
 */
export interface SuppressionMap {
    /** Map from line number to suppression directives active on that line */
    suppressionsByLine: Map<number, SuppressionDirective[]>;
}

// Matches: // enscript-suppress or // enscript-suppress[rule1,rule2]
const SUPPRESSION_PATTERN = /\/\/\s*enscript-suppress(?:\s*\[([^\]]+)\])?\s*$/i;

/**
 * Parse rule IDs from a suppression comment
 * Handles comma-separated rule IDs with optional whitespace
 */
function parseRuleIds(ruleIdString?: string): Set<string> | undefined {
    if (!ruleIdString || ruleIdString.trim() === '') {
        return undefined; // Suppress all rules
    }

    const ruleIds = ruleIdString
        .split(',')
        .map(id => id.trim())
        .filter(id => id.length > 0);

    return ruleIds.length > 0 ? new Set(ruleIds) : undefined;
}

/**
 * Extract suppression directives from a comment token
 */
function parseSuppressionDirective(
    comment: Token,
    document: TextDocument
): SuppressionDirective | null {
    const commentText = comment.value.trim();
    const position = document.positionAt(comment.start);
    const currentLine = position.line;

    // Check if comment matches suppression pattern
    const match = commentText.match(SUPPRESSION_PATTERN);
    if (!match) {
        return null;
    }

    // Determine if this is a standalone comment (suppresses next line) or inline (suppresses current line)
    // A comment is considered standalone if it's at the beginning of the line (only whitespace before it)
    const lineText = document.getText({
        start: { line: currentLine, character: 0 },
        end: { line: currentLine, character: position.character }
    });
    
    const isStandalone = lineText.trim() === '';

    if (isStandalone) {
        // Standalone comment suppresses the next line
        return {
            line: currentLine + 1,
            ruleIds: parseRuleIds(match[1]),
            type: 'next-line',
            commentText
        };
    } else {
        // Inline comment suppresses the current line
        return {
            line: currentLine,
            ruleIds: parseRuleIds(match[1]),
            type: 'current-line',
            commentText
        };
    }
}

/**
 * Build a suppression map from tokens
 * 
 * @param tokens - Array of all tokens from lexer (including comments)
 * @param document - The text document being analyzed
 * @returns A map of line numbers to active suppression directives
 */
export function buildSuppressionMap(
    tokens: Token[],
    document: TextDocument
): SuppressionMap {
    const suppressionsByLine = new Map<number, SuppressionDirective[]>();

    for (const token of tokens) {
        if (token.kind !== TokenKind.Comment) {
            continue;
        }

        const directive = parseSuppressionDirective(token, document);
        if (!directive) {
            continue;
        }

        const existingDirectives = suppressionsByLine.get(directive.line) || [];
        existingDirectives.push(directive);
        suppressionsByLine.set(directive.line, existingDirectives);
    }

    return { suppressionsByLine };
}

/**
 * Check if a diagnostic should be suppressed based on suppression directives
 * 
 * @param line - The line number (0-based) where the diagnostic would appear
 * @param ruleId - The diagnostic rule ID
 * @param suppressionMap - The suppression map for the document
 * @returns true if the diagnostic should be suppressed
 */
export function isDiagnosticSuppressed(
    line: number,
    ruleId: string,
    suppressionMap: SuppressionMap
): boolean {
    const directives = suppressionMap.suppressionsByLine.get(line);
    if (!directives || directives.length === 0) {
        return false;
    }

    for (const directive of directives) {
        if (!directive.ruleIds) {
            return true;
        }

        if (directive.ruleIds.has(ruleId)) {
            return true;
        }
    }

    return false;
}

/**
 * Get all suppressed rule IDs for a given line
 * 
 * @param line - The line number (0-based)
 * @param suppressionMap - The suppression map for the document
 * @returns Set of suppressed rule IDs, or null if all rules are suppressed
 */
export function getSuppressedRulesForLine(
    line: number,
    suppressionMap: SuppressionMap
): Set<string> | null {
    const directives = suppressionMap.suppressionsByLine.get(line);
    if (!directives || directives.length === 0) {
        return new Set();
    }

    let suppressAll = false;
    const suppressedRules = new Set<string>();

    for (const directive of directives) {
        if (!directive.ruleIds) {
            suppressAll = true;
        } else {
            directive.ruleIds.forEach(ruleId => suppressedRules.add(ruleId));
        }
    }

    return suppressAll ? null : suppressedRules;
}
