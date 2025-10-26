import { isTypeReference } from '../../util';
import {
    Declaration,
    FunctionDeclNode,
    VarDeclNode,
    ParameterDeclNode,
    ClassDeclNode,
    TypedefDeclNode,
    TypeNode,
    MethodDeclNode
} from '../ast/node-types';

// Helper function to get type name from TypeNode
export function getTypeName(typeNode: TypeNode | undefined): string {
    if (!typeNode) return 'unknown';
    
    if (isTypeReference(typeNode)) {
        // Include modifiers like 'ref' in the type name
        const modifiers = typeNode.modifiers ? typeNode.modifiers.join(' ') + ' ' : '';
        return modifiers + typeNode.name;
    }
    if (typeNode.kind === 'GenericType') {
        const baseName = getTypeName(typeNode.baseType);
        const args = typeNode.typeArguments.map(arg => getTypeName(arg)).join(',');
        return `${baseName}<${args}>`;
    }
    if (typeNode.kind === 'ArrayType') {
        return getTypeName(typeNode.elementType) + '[]';
    }
    if (typeNode.kind === 'AutoType') {
        return 'auto';
    }
    return 'unknown';
}

export function formatDeclaration(node: Declaration): string {
    let fmt: string | null = null;
    switch (node.kind) {
        case 'FunctionDecl':
        case 'MethodDecl':
        case 'ProtoMethodDecl': {
            const _node = node as FunctionDeclNode | MethodDeclNode;
            const returnTypeName = getTypeName(_node.returnType);
            const paramStr = _node.parameters?.map(p => {
                const modifiers = p.modifiers.length ? p.modifiers.join(' ') + ' ' : '';
                const typeName = getTypeName(p.type);
                return modifiers + typeName + ' ' + p.name;
            }).join(', ') ?? '';
            fmt = `${(_node.modifiers.length ? _node.modifiers.join(' ') + ' ' : '')}${returnTypeName} ${_node.name}(${paramStr})`;
            break;
        }

        case 'VarDecl':
        case 'ParameterDecl': {
            const _node = node as VarDeclNode | ParameterDeclNode;
            const typeName = getTypeName(_node.type);
            fmt = `${(_node.modifiers.length ? _node.modifiers.join(' ') + ' ' : '')}${typeName} ${_node.name}`;
            break;
        }

        case 'ClassDecl': {
            const _node = node as ClassDeclNode;
            let baseClassStr = '';
            if (_node.baseClass && isTypeReference(_node.baseClass)) {
                baseClassStr = ` : ${_node.baseClass.name}`;
            }
            fmt = `${(_node.modifiers.length ? _node.modifiers.join(' ') + ' ' : '')}class ${_node.name}${baseClassStr}`;
            break;
        }

        case 'EnumDecl': {
            fmt = `${(node.modifiers.length ? node.modifiers.join(' ') + ' ' : '')}enum ${node.name}`;
            break;
        }

        case 'EnumMemberDecl': {
            fmt = `${node.name}`;
            break;
        }

        case 'TypedefDecl': {
            const _node = node as TypedefDeclNode;
            const typeName = getTypeName(_node.type);
            fmt = `typedef ${typeName} ${_node.name}`;
            break;
        }
    }

    if (fmt)
        return '```enscript\n' + fmt + '\n```';

    return `(Unknown ${node.kind}) ${node.name}`;
}
