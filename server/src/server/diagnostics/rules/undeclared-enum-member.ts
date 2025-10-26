import {
    DiagnosticRuleContext,
    DiagnosticRuleConfig,
    DiagnosticRuleResult,
    DiagnosticSuggestion
} from '../rules';
import { ASTNode } from '../../ast';
import { Logger } from '../../../util/logger';
import { UndeclaredEntityRule } from './undeclared-entity-base';
import { isMemberExpression, isIdentifier, isEnum } from '../../../util';

interface EnumMemberDiagnosticData {
    enumName: string;
    invalidMemberName: string;
    availableMembers: string[];
}

/**
 * Rule for detecting usage of undeclared enum members
 */
export class UndeclaredEnumMemberRule extends UndeclaredEntityRule {
    readonly id = 'undeclared-enum-member';
    readonly name = 'Undeclared Enum Member';
    readonly description = 'Detects usage of enum members that are not declared in the enum';

    appliesToNode(node: ASTNode): boolean {
        // Only apply to member expressions where the object is an identifier
        return isMemberExpression(node) && isIdentifier(node.object);
    }

    async check(
        node: ASTNode,
        context: DiagnosticRuleContext,
        config: DiagnosticRuleConfig
    ): Promise<DiagnosticRuleResult[]> {
        if (!isMemberExpression(node)) {
            return [];
        }

        // Extract member name using the helper
        const memberName = this.extractIdentifierFromNode(node, 'MemberExpression', ['property']);

        if (!memberName) {
            return [];
        }

        // Get the enum name (must be a simple identifier)
        let enumName: string | null = null;
        if (isIdentifier(node.object)) {
            enumName = node.object.name;
        }

        if (!enumName) {
            return [];
        }

        // Check if this is actually an enum
        if (!this.isEnumName(enumName, context)) {
            return []; // Not an enum, skip
        }

        // Get available enum definitions
        const availableEnums = this.buildEnumScope(context);

        // Check if the enum exists and has this member
        if (!availableEnums.has(enumName)) {
            // Enum not found - this shouldn't happen since we checked with isEnumName
            Logger.warn(`Enum '${enumName}' not found in scope`);
            return [];
        }

        const enumMembers = availableEnums.get(enumName)!;

        // Check if the member exists in this enum
        if (enumMembers.has(memberName)) {
            return []; // Member exists, all good
        }

        // Member doesn't exist - create diagnostic
        return [{
            message: `Enum member '${memberName}' is not declared in enum '${enumName}'`,
            range: {
                start: node.memberStart,
                end: node.memberEnd
            },
            severity: config.severity || this.defaultSeverity,
            source: 'enscript.semantic',
            code: this.id,
            data: {
                enumName,
                invalidMemberName: memberName,
                availableMembers: Array.from(enumMembers)
            }
        }];
    }

    /**
     * Build a scope of available enums and their members
     */
    private buildEnumScope(context: DiagnosticRuleContext): Map<string, Set<string>> {
        const enums = new Map<string, Set<string>>();

        // Get all enum declarations in the current document
        const currentAst = context.ast;

        for (const node of currentAst.body) {
            if (isEnum(node)) {
                const members = new Set<string>();

                // Add all enum members
                for (const member of node.members) {
                    members.add(member.name);
                }

                enums.set(node.name, members);
            }
        }

        return enums;
    }

    getDocumentation(): string {
        return `**Undeclared Enum Member**

Detects usage of enum members that are not declared in the enum definition.

**Examples:**

*Incorrect usage:*
\`\`\`
enum Status {
    Active,
    Inactive
}

void MyFunction() {
    Status s = Status.Pending;  // Error: 'Pending' not declared in Status enum
}
\`\`\`

*Correct usage:*
\`\`\`
enum Status {
    Active,
    Inactive,
    Pending  // Member is declared
}

void MyFunction() {
    Status s = Status.Pending;  // OK: 'Pending' is declared
}
\`\`\`

**Why this rule helps:**
- Prevents runtime errors from accessing non-existent enum members
- Catches typos in enum member names
- Ensures enum usage is consistent with enum definitions`;
    }

    getSuggestions(_node: ASTNode, _context: DiagnosticRuleContext): string[] {
        return [
            'Check the spelling of the enum member name',
            'Verify that the member is declared in the enum definition',
            'Add the missing member to the enum if it should exist',
            'Use an existing enum member instead'
        ];
    }

    getActionableSuggestions(diagnostic: DiagnosticRuleResult, _node: ASTNode, _context: DiagnosticRuleContext): DiagnosticSuggestion[] {
        const suggestions: DiagnosticSuggestion[] = [];

        // Extract diagnostic data
        const data = diagnostic.data as EnumMemberDiagnosticData;
        if (!data || !data.enumName || !data.invalidMemberName || !data.availableMembers) {
            return suggestions;
        }

        const { invalidMemberName, availableMembers } = data;

        // Suggest replacing with each available enum member
        for (const member of availableMembers) {
            suggestions.push({
                title: `Change '${invalidMemberName}' to '${member}'`,
                newText: member,
                range: diagnostic.range
            });
        }

        // Add suggestion based on similarity (simple typo correction)
        const similarMembers = this.findSimilarMembers(invalidMemberName, availableMembers);
        for (const similar of similarMembers) {
            if (similar !== invalidMemberName) {
                suggestions.unshift({ // Put similar suggestions first
                    title: `Did you mean '${similar}'?`,
                    newText: similar,
                    range: diagnostic.range
                });
            }
        }

        return suggestions;
    }

    /**
     * Find enum members similar to the invalid member name (simple similarity check)
     */
    private findSimilarMembers(invalidName: string, availableMembers: string[]): string[] {
        const similar: string[] = [];
        const lowerInvalid = invalidName.toLowerCase();

        for (const member of availableMembers) {
            const lowerMember = member.toLowerCase();

            // Check for case-insensitive match
            if (lowerMember === lowerInvalid) {
                similar.push(member);
                continue;
            }

            // Check for simple prefix/suffix match
            if (lowerMember.startsWith(lowerInvalid.substring(0, 3)) ||
                lowerMember.includes(lowerInvalid) ||
                this.calculateLevenshteinDistance(lowerInvalid, lowerMember) <= 2) {
                similar.push(member);
            }
        }

        return similar;
    }

    /**
     * Calculate Levenshtein distance for simple typo detection
     */
    private calculateLevenshteinDistance(a: string, b: string): number {
        const matrix = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }
}
