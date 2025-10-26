import { lex } from '../../../server/src/server/lexer/preprocessor-lexer';
import { TokenKind, Token } from '../../../server/src/server/lexer/token';

describe('Lexer', () => {
    describe('Basic Tokenization', () => {
        it('should tokenize an empty string', () => {
            const tokens = lex('');
            expect(tokens).toHaveLength(1);
            expect(tokens[0].kind).toBe(TokenKind.EOF);
        });

        it('should tokenize a simple identifier', () => {
            const tokens = lex('myVar');
            expect(tokens).toHaveLength(2); // identifier + EOF
            expect(tokens[0].kind).toBe(TokenKind.Identifier);
            expect(tokens[0].value).toBe('myVar');
            expect(tokens[0].start).toBe(0);
            expect(tokens[0].end).toBe(5);
        });

        it('should tokenize multiple identifiers', () => {
            const tokens = lex('foo bar baz');
            expect(tokens).toHaveLength(4); // 3 identifiers + EOF
            expect(tokens[0].value).toBe('foo');
            expect(tokens[1].value).toBe('bar');
            expect(tokens[2].value).toBe('baz');
        });
    });

    describe('Keywords', () => {
        it('should tokenize class keyword', () => {
            const tokens = lex('class');
            expect(tokens).toHaveLength(2);
            expect(tokens[0].kind).toBe(TokenKind.KeywordDeclaration);
            expect(tokens[0].value).toBe('class');
        });

        it('should tokenize control flow keywords', () => {
            const tokens = lex('if else for while return');
            const keywordTokens = tokens.filter((t: Token) => t.kind === TokenKind.KeywordControl);
            expect(keywordTokens).toHaveLength(5);
        });

        it('should tokenize type keywords', () => {
            const tokens = lex('int float bool void string');
            const typeTokens = tokens.filter((t: Token) => t.kind === TokenKind.KeywordType);
            expect(typeTokens).toHaveLength(5);
        });

        it('should tokenize modifier keywords', () => {
            const tokens = lex('private protected static');
            const modifierTokens = tokens.filter((t: Token) => t.kind === TokenKind.KeywordModifier);
            expect(modifierTokens).toHaveLength(3);
        });
    });

    describe('Literals', () => {
        it('should tokenize integer numbers', () => {
            const tokens = lex('42');
            expect(tokens[0].kind).toBe(TokenKind.Number);
            expect(tokens[0].value).toBe('42');
        });

        it('should tokenize float numbers', () => {
            const tokens = lex('3.14');
            expect(tokens[0].kind).toBe(TokenKind.Number);
            expect(tokens[0].value).toBe('3.14');
        });

        it('should tokenize hexadecimal numbers', () => {
            const tokens = lex('0xFF');
            expect(tokens[0].kind).toBe(TokenKind.Number);
            expect(tokens[0].value).toBe('0xFF');
        });

        it('should tokenize string literals', () => {
            const tokens = lex('"hello world"');
            expect(tokens[0].kind).toBe(TokenKind.String);
            expect(tokens[0].value).toBe('"hello world"');
        });

        it('should tokenize boolean literals', () => {
            const tokens = lex('true false');
            expect(tokens[0].kind).toBe(TokenKind.KeywordLiteral);
            expect(tokens[0].value).toBe('true');
            expect(tokens[1].kind).toBe(TokenKind.KeywordLiteral);
            expect(tokens[1].value).toBe('false');
        });

        it('should tokenize null literal', () => {
            const tokens = lex('null');
            expect(tokens[0].kind).toBe(TokenKind.KeywordLiteral);
            expect(tokens[0].value).toBe('null');
        });
    });

    describe('Operators and Punctuation', () => {
        it('should tokenize arithmetic operators', () => {
            const tokens = lex('+ - * / %');
            const operators = tokens.filter((t: Token) => t.kind === TokenKind.Operator);
            expect(operators.length).toBeGreaterThanOrEqual(5);
        });

        it('should tokenize comparison operators', () => {
            const tokens = lex('== != < > <= >=');
            const operators = tokens.filter((t: Token) => t.kind === TokenKind.Operator);
            // Note: Some compound operators may be tokenized as single operators
            expect(operators.length).toBeGreaterThanOrEqual(4);
        });

        it('should tokenize assignment operators', () => {
            const tokens = lex('= += -= *= /=');
            const operators = tokens.filter((t: Token) => t.kind === TokenKind.Operator);
            // Note: Some compound operators may be tokenized as single operators
            expect(operators.length).toBeGreaterThanOrEqual(4);
        });

        it('should tokenize punctuation', () => {
            const tokens = lex('{ } ( ) [ ] ; , .');
            const punctuation = tokens.filter((t: Token) => t.kind === TokenKind.Punctuation);
            expect(punctuation.length).toBeGreaterThanOrEqual(9);
        });
    });

    describe('Comments', () => {
        it('should tokenize single-line comments', () => {
            const tokens = lex('// this is a comment');
            expect(tokens[0].kind).toBe(TokenKind.Comment);
            expect(tokens[0].value).toBe('// this is a comment');
        });

        it('should tokenize multi-line comments', () => {
            const tokens = lex('/* comment */');
            expect(tokens[0].kind).toBe(TokenKind.Comment);
            expect(tokens[0].value).toBe('/* comment */');
        });

        it('should handle code after single-line comment', () => {
            const tokens = lex('// comment\nint x');
            expect(tokens[0].kind).toBe(TokenKind.Comment);
            expect(tokens[1].kind).toBe(TokenKind.KeywordType);
            expect(tokens[2].kind).toBe(TokenKind.Identifier);
        });
    });

    describe('Preprocessor Directives', () => {
        it('should tokenize preprocessor define', () => {
            const tokens = lex('#define FOO');
            expect(tokens[0].kind).toBe(TokenKind.Preproc);
            expect(tokens[0].value).toBe('#define FOO');
        });

        it('should tokenize preprocessor ifdef', () => {
            const tokens = lex('#ifdef DEBUG');
            expect(tokens[0].kind).toBe(TokenKind.Preproc);
            expect(tokens[0].value).toBe('#ifdef DEBUG');
        });

        it('should tokenize preprocessor include', () => {
            const tokens = lex('#include "file.c"');
            expect(tokens[0].kind).toBe(TokenKind.Preproc);
            expect(tokens[0].value).toBe('#include "file.c"');
        });
    });

    describe('Complex Code', () => {
        it('should tokenize a simple class declaration', () => {
            const code = `class MyClass {
    int x;
}`;
            const tokens = lex(code);

            expect(tokens[0].kind).toBe(TokenKind.KeywordDeclaration); // class
            expect(tokens[0].value).toBe('class');
            expect(tokens[1].kind).toBe(TokenKind.Identifier); // MyClass
            expect(tokens[1].value).toBe('MyClass');
            expect(tokens[2].kind).toBe(TokenKind.Punctuation); // {
            expect(tokens[3].kind).toBe(TokenKind.KeywordType); // int
            expect(tokens[4].kind).toBe(TokenKind.Identifier); // x
            expect(tokens[5].kind).toBe(TokenKind.Punctuation); // ;
            expect(tokens[6].kind).toBe(TokenKind.Punctuation); // }
        });

        it('should tokenize a simple function', () => {
            const code = `void myFunction(int param) {
    return;
}`;
            const tokens = lex(code);

            const keywordTypes = tokens.filter((t: Token) => t.kind === TokenKind.KeywordType);
            const identifiers = tokens.filter((t: Token) => t.kind === TokenKind.Identifier);
            const controlKeywords = tokens.filter((t: Token) => t.kind === TokenKind.KeywordControl);

            expect(keywordTypes.length).toBeGreaterThanOrEqual(2); // void, int
            expect(identifiers.length).toBeGreaterThanOrEqual(2); // myFunction, param
            expect(controlKeywords.length).toBeGreaterThanOrEqual(1); // return
        });

        it('should maintain correct token positions', () => {
            const code = 'int x = 42;';
            const tokens = lex(code);

            expect(tokens[0].start).toBe(0); // int
            expect(tokens[0].end).toBe(3);

            expect(tokens[1].start).toBe(4); // x
            expect(tokens[1].end).toBe(5);

            expect(tokens[2].start).toBe(6); // =
            expect(tokens[2].end).toBe(7);

            expect(tokens[3].start).toBe(8); // 42
            expect(tokens[3].end).toBe(10);
        });
    });

    describe('Edge Cases', () => {
        it('should handle whitespace-only input', () => {
            const tokens = lex('   \n\t  ');
            expect(tokens).toHaveLength(1);
            expect(tokens[0].kind).toBe(TokenKind.EOF);
        });

        it('should handle consecutive operators', () => {
            const tokens = lex('x++--');
            // Should tokenize x, ++, --
            expect(tokens.length).toBeGreaterThanOrEqual(3);
        });

        it('should handle mixed content', () => {
            const code = '// comment\nint x = 42; /* block */ "string"';
            const tokens = lex(code);

            const hasComment = tokens.some((t: Token) => t.kind === TokenKind.Comment);
            const hasKeyword = tokens.some((t: Token) => t.kind === TokenKind.KeywordType);
            const hasNumber = tokens.some((t: Token) => t.kind === TokenKind.Number);
            const hasString = tokens.some((t: Token) => t.kind === TokenKind.String);

            expect(hasComment).toBe(true);
            expect(hasKeyword).toBe(true);
            expect(hasNumber).toBe(true);
            expect(hasString).toBe(true);
        });
    });
});
