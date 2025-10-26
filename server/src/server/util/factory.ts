/**
 * Parser factory for creating customized parser instances
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Token } from '../lexer/token';
import { ParserConfig, defaultConfig, createConfig } from '../ast/config';
import { Parser } from '../parser/parser-core';

export class ParserFactory {
    /**
     * Create a parser with standard EnScript configuration
     * 
     * @param doc Document to parse
     * @param config Optional configuration overrides
     * @returns Parser instance configured for EnScript
     */
    static createEnScriptParser(doc: TextDocument, config?: Partial<ParserConfig>): Parser {
        const enscriptConfig = config ? createConfig(config) : defaultConfig;
        return Parser.createWithPreprocessor(doc, doc.getText(), enscriptConfig);
    }

    /**
     * Create a parser from a pre-tokenized source
     * 
     * Useful when tokens are already available from another process.
     * 
     * @param doc Document reference
     * @param tokens Pre-tokenized source
     * @param config Parser configuration
     * @returns Parser instance with provided tokens
     */
    static createFromTokens(doc: TextDocument, tokens: Token[], config?: ParserConfig): Parser {
        const parserConfig = config || defaultConfig;
        return new Parser(doc, tokens, parserConfig);
    }
}
