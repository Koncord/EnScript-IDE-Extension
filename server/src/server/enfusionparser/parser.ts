/**
 * Parser for Enfusion config format (.imageset, .layout, etc.)
 * 
 * Grammar:
 *   Document := Node*
 *   Node := Class | Block | Property
 *   Class := Identifier Identifier? '{' Node* '}'
 *   Block := Identifier '{' Node* '}'
 *   Property := Identifier Value+
 *   Value := String | Number | Identifier
 */

import { lex, EnfusionToken, EnfusionTokenKind } from './lexer';
import {
    EnfusionDocument,
    EnfusionProperty,
    EnfusionNode,
    EnfusionValue
} from './ast';

export class EnfusionParser {
    private tokens: EnfusionToken[];
    private current: number = 0;
    private filename: string;

    constructor(input: string, filename?: string) {
        this.tokens = lex(input).filter(t => t.kind !== EnfusionTokenKind.Comment);
        this.filename = filename || '<unknown>';
    }

    private peek(offset: number = 0): EnfusionToken | null {
        const index = this.current + offset;
        return index < this.tokens.length ? this.tokens[index] : null;
    }

    private advance(): EnfusionToken | null {
        if (this.current < this.tokens.length) {
            return this.tokens[this.current++];
        }
        return null;
    }

    private consume(kind: EnfusionTokenKind, value?: string): EnfusionToken {
        const token = this.peek();
        if (!token || token.kind !== kind || (value !== undefined && token.value !== value)) {
            const expected = value ? `'${value}'` : EnfusionTokenKind[kind];
            const got = token ? `${EnfusionTokenKind[token.kind]} '${token.value}'` : 'EOF';
            const location = token ? `${this.filename}:${token.line}:${token.column}` : this.filename;
            throw new Error(`${location}: Expected ${expected}, got ${got}`);
        }
        return this.advance()!;
    }

    private isAtEnd(): boolean {
        const token = this.peek();
        return !token || token.kind === EnfusionTokenKind.EOF;
    }

    /**
     * Parse a value (string, number, or identifier as fallback)
     */
    private parseValue(): EnfusionValue {
        const token = this.peek();
        if (!token) {
            throw new Error(`${this.filename}: Unexpected end of input`);
        }

        if (token.kind === EnfusionTokenKind.String) {
            this.advance();
            return token.value;
        } else if (token.kind === EnfusionTokenKind.Number) {
            this.advance();
            return parseFloat(token.value);
        } else if (token.kind === EnfusionTokenKind.Identifier) {
            // Handle special identifiers as booleans or keywords
            this.advance();
            if (token.value === 'true') return true;
            if (token.value === 'false') return false;
            // Return as string for other identifiers
            return token.value;
        }

        throw new Error(`${this.filename}:${token.line}:${token.column}: Expected value, got ${EnfusionTokenKind[token.kind]} '${token.value}'`);
    }

    /**
     * Parse a property: Identifier Value+
     */
    private parseProperty(name: string): EnfusionProperty {
        const values: EnfusionValue[] = [];

        // Read values until we hit a brace or identifier (next property/class)
        while (!this.isAtEnd()) {
            const token = this.peek();
            if (!token) break;

            // Stop if we see braces or another identifier that starts a new statement
            if (token.kind === EnfusionTokenKind.LeftBrace || 
                token.kind === EnfusionTokenKind.RightBrace) {
                break;
            }

            // If we see an identifier after reading at least one value, it's the next statement
            if (token.kind === EnfusionTokenKind.Identifier && values.length > 0) {
                break;
            }

            // Handle case where identifier might be at the start (empty property - skip it)
            if (token.kind === EnfusionTokenKind.Identifier && values.length === 0) {
                // This might be an empty block name, not a property
                break;
            }

            values.push(this.parseValue());
        }

        if (values.length === 0) {
            // Return a property with empty array rather than throwing
            return {
                kind: 'property',
                name,
                values: []
            };
        }

        return {
            kind: 'property',
            name,
            values
        };
    }

    /**
     * Check if an identifier looks like a class name (heuristic: ends with "Class")
     */
    private looksLikeClassName(name: string): boolean {
        return name.endsWith('Class');
    }

    /**
     * Parse a class or block
     * - Class (no instance): ClassName { ... } where name ends with "Class"
     * - Class (with instance): ClassName InstanceName { ... }
     * - Class (numeric instance): ClassName 123 { ... }
     * - Block: BlockName { ... } where name doesn't end with "Class"
     */
    private parseNode(): EnfusionNode {
        const firstToken = this.consume(EnfusionTokenKind.Identifier);
        const firstName = firstToken.value;

        const nextToken = this.peek();
        if (!nextToken) {
            throw new Error(`${this.filename}:${firstToken.line}:${firstToken.column}: Unexpected end after identifier '${firstName}'`);
        }

        // Case 1: Property (no brace following, and not an identifier or number or string)
        if (nextToken.kind !== EnfusionTokenKind.Identifier && 
            nextToken.kind !== EnfusionTokenKind.Number &&
            nextToken.kind !== EnfusionTokenKind.String &&
            nextToken.kind !== EnfusionTokenKind.LeftBrace) {
            return this.parseProperty(firstName);
        }

        // Case 2: Single identifier followed by '{'
        if (nextToken.kind === EnfusionTokenKind.LeftBrace) {
            this.consume(EnfusionTokenKind.LeftBrace);
            const children = this.parseChildren();
            this.consume(EnfusionTokenKind.RightBrace);

            // Distinguish between class and block based on naming convention
            if (this.looksLikeClassName(firstName)) {
                return {
                    kind: 'class',
                    className: firstName,
                    children
                };
            } else {
                return {
                    kind: 'block',
                    name: firstName,
                    children
                };
            }
        }

        // Case 3: Identifier, Number, or String followed by '{' - class with instance name/number
        if (nextToken.kind === EnfusionTokenKind.Identifier || 
            nextToken.kind === EnfusionTokenKind.Number ||
            nextToken.kind === EnfusionTokenKind.String) {
            const secondToken = this.peek(1);
            if (secondToken && secondToken.kind === EnfusionTokenKind.LeftBrace) {
                // It's a class with instance name (or numeric ID, or quoted string)
                const instanceToken = this.advance();
                if (!instanceToken) {
                    throw new Error(`${this.filename}:${firstToken.line}: Expected instance name after '${firstName}'`);
                }
                this.consume(EnfusionTokenKind.LeftBrace);
                const children = this.parseChildren();
                this.consume(EnfusionTokenKind.RightBrace);

                return {
                    kind: 'class',
                    className: firstName,
                    instanceName: instanceToken.kind === EnfusionTokenKind.String 
                        ? instanceToken.value  // Remove quotes from string
                        : instanceToken.value,
                    children
                };
            }
        }

        // Otherwise, it's a property with identifier/number/string values
        return this.parseProperty(firstName);
    }

    /**
     * Parse children nodes inside braces
     */
    private parseChildren(): EnfusionNode[] {
        const children: EnfusionNode[] = [];

        while (!this.isAtEnd()) {
            const token = this.peek();
            if (!token || token.kind === EnfusionTokenKind.RightBrace) {
                break;
            }

            children.push(this.parseNode());
        }

        return children;
    }

    /**
     * Parse the entire document
     */
    public parse(): EnfusionDocument {
        const children: EnfusionNode[] = [];

        while (!this.isAtEnd()) {
            children.push(this.parseNode());
        }

        return {
            kind: 'document',
            children
        };
    }
}

/**
 * Parse Enfusion config content into an AST
 */
export function parseEnfusionConfig(content: string, filename?: string): EnfusionDocument {
    const parser = new EnfusionParser(content, filename);
    return parser.parse();
}
