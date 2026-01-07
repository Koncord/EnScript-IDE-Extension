/**
 * Adapter and helper functions for working with Enfusion config AST
 * Provides utilities to extract structured data from ImageSet and other config types
 */

import { parseEnfusionConfig } from './parser';
import {
    EnfusionDocument,
    EnfusionClass,
    EnfusionBlock,
    EnfusionNode,
    EnfusionValue
} from './ast';
import * as fs from 'fs';

/**
 * ImageSet structure
 */
export interface ImageSetTexture {
    mpix: number;
    path: string;
}

export interface ImageSetDef {
    name: string;
    pos: { x: number; y: number };
    size: { width: number; height: number };
    flags: number;
}

export interface ImageSet {
    name: string;
    refSize: { width: number; height: number };
    textures: ImageSetTexture[];
    images: ImageSetDef[];
    groups: unknown[];
}

/**
 * Helper to find a child node by name
 */
function findChild(node: EnfusionClass | EnfusionBlock | EnfusionDocument, name: string): EnfusionNode | undefined {
    return node.children.find(child => {
        if (child.kind === 'property') {
            return child.name === name;
        } else if (child.kind === 'block') {
            return child.name === name;
        } else if (child.kind === 'class') {
            return child.instanceName === name || child.className === name;
        }
        return false;
    });
}

function getPropertyValue(node: EnfusionClass | EnfusionBlock | EnfusionDocument, propName: string): EnfusionValue[] | null {
    const prop = findChild(node, propName);
    if (prop && prop.kind === 'property') {
        return prop.values;
    }
    return null;
}

function getPropertyString(node: EnfusionClass | EnfusionBlock | EnfusionDocument, propName: string): string | null {
    const values = getPropertyValue(node, propName);
    if (values && values.length > 0 && typeof values[0] === 'string') {
        return values[0];
    }
    return null;
}

function getPropertyNumber(node: EnfusionClass | EnfusionBlock | EnfusionDocument, propName: string): number | null {
    const values = getPropertyValue(node, propName);
    if (values && values.length > 0 && typeof values[0] === 'number') {
        return values[0];
    }
    return null;
}

function getChildrenByKind<T extends EnfusionNode>(node: EnfusionClass | EnfusionBlock | EnfusionDocument, kind: T['kind']): T[] {
    return node.children.filter(child => child.kind === kind) as T[];
}

function extractImageSetTexture(node: EnfusionClass): ImageSetTexture {
    const mpix = getPropertyNumber(node, 'mpix') ?? 0;
    const path = getPropertyString(node, 'path') ?? '';

    return {
        mpix,
        path
    };
}

function extractImageSetDef(node: EnfusionClass): ImageSetDef {
    const name = getPropertyString(node, 'Name') ?? node.instanceName ?? '';
    
    const posValues = getPropertyValue(node, 'Pos');
    const pos = {
        x: (posValues && posValues.length >= 1 && typeof posValues[0] === 'number') ? posValues[0] : 0,
        y: (posValues && posValues.length >= 2 && typeof posValues[1] === 'number') ? posValues[1] : 0
    };

    const sizeValues = getPropertyValue(node, 'Size');
    const size = {
        width: (sizeValues && sizeValues.length >= 1 && typeof sizeValues[0] === 'number') ? sizeValues[0] : 0,
        height: (sizeValues && sizeValues.length >= 2 && typeof sizeValues[1] === 'number') ? sizeValues[1] : 0
    };

    const flags = getPropertyNumber(node, 'Flags') ?? 0;

    return {
        name,
        pos,
        size,
        flags
    };
}

export function parseImageSet(filePath: string): ImageSet | null {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const doc = parseEnfusionConfig(content, filePath);

        // Find the ImageSetClass node
        const imageSetClass = doc.children.find(
            child => child.kind === 'class' && child.className === 'ImageSetClass'
        ) as EnfusionClass | undefined;

        if (!imageSetClass) {
            return null;
        }

        // Extract basic properties
        const name = getPropertyString(imageSetClass, 'Name') ?? '';
        
        const refSizeValues = getPropertyValue(imageSetClass, 'RefSize');
        const refSize = {
            width: (refSizeValues && refSizeValues.length >= 1 && typeof refSizeValues[0] === 'number') ? refSizeValues[0] : 0,
            height: (refSizeValues && refSizeValues.length >= 2 && typeof refSizeValues[1] === 'number') ? refSizeValues[1] : 0
        };

        // Extract textures
        const textures: ImageSetTexture[] = [];
        const texturesBlock = findChild(imageSetClass, 'Textures') as EnfusionBlock | undefined;
        if (texturesBlock && texturesBlock.kind === 'block') {
            const textureClasses = getChildrenByKind<EnfusionClass>(texturesBlock, 'class');
            for (const textureClass of textureClasses) {
                if (textureClass.className === 'ImageSetTextureClass') {
                    textures.push(extractImageSetTexture(textureClass));
                }
            }
        }

        // Extract images
        const images: ImageSetDef[] = [];
        const imagesBlock = findChild(imageSetClass, 'Images') as EnfusionBlock | undefined;
        if (imagesBlock && imagesBlock.kind === 'block') {
            const imageClasses = getChildrenByKind<EnfusionClass>(imagesBlock, 'class');
            for (const imageClass of imageClasses) {
                if (imageClass.className === 'ImageSetDefClass') {
                    images.push(extractImageSetDef(imageClass));
                }
            }
        }

        // Groups - not implemented yet
        const groups: unknown[] = [];

        return {
            name,
            refSize,
            textures,
            images,
            groups
        };
    } catch (error) {
        console.error(`Error parsing ImageSet file ${filePath}:`, error);
        return null;
    }
}
