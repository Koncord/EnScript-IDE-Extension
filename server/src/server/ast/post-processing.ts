/**
 * AST Post-Processing Utilities
 * 
 * Functions that modify the AST after parsing to add implicit behavior
 * that is part of the language but not explicitly written in source code.
 */

import { FileNode, ClassDeclNode, TypeReferenceNode, VarDeclNode, Literal } from './node-types';
import { isClass } from '../util/ast-class-utils';
import { Logger } from '../../util/logger';

/**
 * Add implicit Class base inheritance to all classes that don't have an explicit base.
 * 
 * In DayZ/EnScript, all classes implicitly inherit from a base "Class" class
 * even when no explicit inheritance is declared. This function modifies the AST
 * to make this implicit inheritance explicit by setting baseClass to "Class"
 * for all classes without a base (except the Class class itself).
 * 
 * @param ast The parsed FileNode AST
 * @param uri The document URI (for creating TypeReferenceNode)
 */
export function addImplicitClassBaseInheritance(ast: FileNode, uri: string): void {
    let classesProcessed = 0;
    let classesModified = 0;
    let classesSkipped = 0;

    for (const node of ast.body) {
        if (isClass(node)) {
            classesProcessed++;

            // Skip if this IS the Class class itself
            if (node.name === 'Class') {
                classesSkipped++;
                continue;
            }

            // Skip modded classes - they extend existing class definitions
            // and inherit from whatever the original class inherits from
            if (node.modifiers && node.modifiers.includes('modded')) {
                classesSkipped++;
                continue;
            }

            // Skip if class already has an explicit base
            if (node.baseClass) {
                const baseClassName = (node.baseClass as TypeReferenceNode).name || 'unknown';

                // Double-check: if the base is already "Class", definitely skip
                if (baseClassName === 'Class') {
                    Logger.debug(`⏭️  Class '${node.name}' already inherits from Class explicitly`);
                }
                classesSkipped++;
                continue;
            }

            // Add implicit Class base
            const implicitClassBase: TypeReferenceNode = {
                kind: 'TypeReference',
                name: 'Class',
                uri: uri,
                start: node.start, // Use class's start position
                end: node.start    // Zero-width position since it's implicit
            };

            (node as ClassDeclNode).baseClass = implicitClassBase;
            classesModified++;
        }
    }

    if (classesModified > 0 || classesSkipped > 0) {
        Logger.debug(`✨ Post-processing: Added implicit Class base to ${classesModified}/${classesProcessed} classes (${classesSkipped} skipped) in ${uri}`);
    }
}

/**
 * Add native 'value' field to base type classes.
 * 
 * In EnScript, primitive base type classes (bool, int, float, vector, string)
 * have a special 'value' field that is provided by the native engine code.
 * This field can be accessed within methods of these classes.
 * 
 * 
 * @param ast The parsed FileNode AST
 * @param uri The document URI
 */
export function addNativeValueFieldToBaseTypes(ast: FileNode, uri: string): void {
    let classesModified = 0;
    const BASE_TYPES_WITH_NATIVE_VALUE = new Set(['bool', 'int', 'float', 'vector', 'string']);

    for (const node of ast.body) {
        if (!isClass(node) || !BASE_TYPES_WITH_NATIVE_VALUE.has(node.name)) continue;
        // Check if 'value' field already exists (shouldn't happen, but be safe)
        const hasValueField = node.members.some(member => member.name === 'value');
        if (hasValueField) {
            continue;
        }

        // Create synthetic 'value' field with the same type as the class
        const valueField: VarDeclNode = {
            kind: 'VarDecl',
            name: 'value',
            type: {
                kind: 'TypeReference',
                name: node.name,
                modifiers: [],
                uri: uri,
                start: node.start,
                end: node.start
            } as TypeReferenceNode,
            modifiers: ['private'],
            annotations: [],
            uri: uri,
            start: node.start,
            end: node.start,
            nameStart: node.start,
            nameEnd: node.start
        };

        // Add to the beginning of members array
        node.members.unshift(valueField);
        classesModified++;
    }


    if (classesModified > 0) {
        Logger.info(`✨ Post-processing: Added native 'value' field to ${classesModified} base type classes in ${uri}`);
    }
}

export function addNativeValuesToInventorySlots(ast: FileNode, uri: string): void {
    const SLOTS: string[] = [
        'HEADGEAR', 'MASK', 'EYEWEAR',
        'HANDS', 'SHOULDER', 'MELEE', 'LEFTHAND', 'GLOVES', 'ARMBAND',
        'BODY', 'VEST', 'BACK',
        'HIPS', 'LEGS', 'FEET',
        'PISTOL', 'KNIFE', 'MAGAZINE', 'MAGAZINE2', 'MAGAZINE3'
    ];
    for (const node of ast.body) {
        if (!isClass(node) || node.name !== 'InventorySlots') continue;
        // creating const int fields for each slot where value is the index in the SLOTS array
        for (let i = 0; i < SLOTS.length; i++) {
            const slotName = SLOTS[i];
            // Check if slot field already exists
            const hasSlotField = node.members.some(member => member.name === slotName);
            if (hasSlotField) {
                continue;
            }

            const slotField: VarDeclNode = {
                kind: 'VarDecl',
                name: slotName,
                type: {
                    kind: 'TypeReference',
                    name: 'int',
                    modifiers: [],
                    uri: uri,
                    start: node.start,
                    end: node.start
                } as TypeReferenceNode,
                initializer: {
                    kind: 'Literal',
                    value: i,
                    uri: uri,
                    start: node.start,
                    end: node.start
                } as Literal,
                modifiers: ['const'],
                annotations: [],
                uri: uri,
                start: node.start,
                end: node.start,
                nameStart: node.start,
                nameEnd: node.start
            };
            node.members.push(slotField);
        }
    }
}

/**
 * Apply all post-processing transformations to the AST
 * 
 * This is the main entry point for AST post-processing.
 * Add new transformations here as needed.
 * 
 * @param ast The parsed FileNode AST
 * @param uri The document URI
 */
export function postProcessAST(ast: FileNode, uri: string): void {
    // Add implicit Class base inheritance (DayZ/EnScript language feature)
    addImplicitClassBaseInheritance(ast, uri);

    // Add native 'value' field to base types (bool, int, float, vector, string)
    addNativeValueFieldToBaseTypes(ast, uri);

    // Add native inventory slot constants to InventorySlots class
    addNativeValuesToInventorySlots(ast, uri);
}
