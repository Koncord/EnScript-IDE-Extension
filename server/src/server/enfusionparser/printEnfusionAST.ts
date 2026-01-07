import { EnfusionDocument, EnfusionNode } from './ast';

/**
 * Pretty print an Enfusion AST (for debugging)
 */

export function printEnfusionAST(node: EnfusionDocument | EnfusionNode, indent: number = 0): string {
    const spaces = '  '.repeat(indent);
    let result = '';

    if (node.kind === 'document') {
        result += `${spaces}Document:\n`;
        for (const child of node.children) {
            result += printEnfusionAST(child, indent + 1);
        }
    } else if (node.kind === 'class') {
        result += `${spaces}Class: ${node.className}`;
        if (node.instanceName) {
            result += ` (${node.instanceName})`;
        }
        result += '\n';
        for (const child of node.children) {
            result += printEnfusionAST(child, indent + 1);
        }
    } else if (node.kind === 'block') {
        result += `${spaces}Block: ${node.name}\n`;
        for (const child of node.children) {
            result += printEnfusionAST(child, indent + 1);
        }
    } else if (node.kind === 'property') {
        result += `${spaces}Property: ${node.name} = [${node.values.join(', ')}]\n`;
    }

    return result;
}
