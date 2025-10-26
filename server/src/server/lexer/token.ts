export enum TokenKind {
    Identifier,
    KeywordDeclaration, // class, enum, typedef, etc.
    KeywordModifier,    // private, protected, static, etc.
    KeywordType,        // auto, void, bool, int, etc.
    KeywordControl,     // if, else, for, while, return, etc.
    KeywordStorage,     // ref, reference, const, volatile, etc.
    KeywordLiteral,     // true, false, null, etc.
    Number,
    String,
    Operator,
    Punctuation,
    Comment,
    Preproc,
    EOF
}

export interface Token {
    kind: TokenKind;
    value: string;
    start: number;
    end: number;
}
