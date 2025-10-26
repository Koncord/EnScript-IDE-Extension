export type CfgNodeType = 'document' | 'variable' | 'array' | 'array-extend' | 'array-shrink' | 'enum' | 'class' | 'prototype' | 'delete';
export type CfgType = string | number | boolean | null | CfgType[];


export interface CfgBaseType {
    kind: CfgNodeType;
}

/**
 * Represents the root document containing all CFG statements
 */
export interface CfgDocument extends CfgBaseType {
    kind: 'document';
    statements: CfgBaseType[];
}

export interface CfgNamedType extends CfgBaseType {
    name: string;
}

/**
 * Represents a simple variable in Cfg ( myVar = 42; )
 */

export interface CfgSimpleVariable extends CfgNamedType {
    kind: 'variable';
    value: CfgType;
}

/**
 * Represents a named variable in Cfg ( myVar[] = {42, "string", true}; )
 */
export interface CfgArrayVariable extends CfgNamedType {
    kind: 'array';
    values: CfgType[];
}

/**
 * Represents a class definition in Cfg ( class MyClass : BaseClass { ... }; )
 */

export interface CfgClass extends CfgNamedType {
    kind: 'class';
    baseClassName?: string;
    properties: Map<string, CfgBaseType>;
}

/**
 * Represents a prototype definition in Cfg ( class MyPrototype; or class MyPrototype : BaseClass; )
 */
export interface CfgPrototype extends CfgNamedType {
    kind: 'prototype';
    baseClassName?: string;
}

/**
 * Represents an array extension in Cfg ( myArray[] += {42, "string"}; )
 */
export interface CfgArrayExtend extends CfgNamedType {
    kind: 'array-extend';
    values: CfgType[];
}

/**
 * Represents an array shrink in Cfg ( myArray[] -= {42, "string"}; )
 */
export interface CfgArrayShrink extends CfgNamedType {
    kind: 'array-shrink';
    values: CfgType[];
}

/**
 * Represents a C-style enum in Cfg ( enum MyEnum { VAL1, VAL2 = 5, VAL3 }; )
 */
export interface CfgEnum extends CfgNamedType {
    kind: 'enum';
    members: { name: string; value?: number }[];
}

/**
 * Represents a delete operation in Cfg ( delete MyClass; )
 */
export interface CfgDelete extends CfgNamedType {
    kind: 'delete';
}
