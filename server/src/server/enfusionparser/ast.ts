/**
 * AST types for Enfusion config format (.imageset, .layout, etc.)
 * 
 * Format example:
 * ImageSetClass {
 *   Name "value"
 *   RefSize 512 512
 *   Textures {
 *     ImageSetTextureClass {
 *       mpix 0
 *       path "{GUID}path/to/file.edds"
 *     }
 *   }
 * }
 */

export type EnfusionNodeType = 
    | 'document'
    | 'class'
    | 'property'
    | 'block';

export type EnfusionValue = string | number | boolean;

export interface EnfusionBaseNode {
    kind: EnfusionNodeType;
}

export interface EnfusionDocument extends EnfusionBaseNode {
    kind: 'document';
    children: EnfusionNode[];
}

export interface EnfusionClass extends EnfusionBaseNode {
    kind: 'class';
    className: string;
    instanceName?: string;
    children: EnfusionNode[];
}

export interface EnfusionProperty extends EnfusionBaseNode {
    kind: 'property';
    name: string;
    values: EnfusionValue[];
}

export interface EnfusionBlock extends EnfusionBaseNode {
    kind: 'block';
    name: string;
    children: EnfusionNode[];
}

export type EnfusionNode = 
    | EnfusionClass
    | EnfusionProperty
    | EnfusionBlock;
