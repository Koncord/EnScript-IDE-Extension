import { DocumentSymbol, DocumentSymbolParams, SymbolKind } from 'vscode-languageserver';
import { isClass, isEnum, isFunction, isMethod } from '../../util';
import { IHandlerRegistration, Connection, TextDocuments, TextDocument } from './handler-interfaces';
import { inject, injectable } from 'inversify';
import { IDocumentCacheManager } from '../../server/cache/document-cache-interfaces';
import { TYPES } from '../../server/di';
import { ClassDeclNode, Declaration, EnumDeclNode, FunctionDeclNode, MethodDeclNode } from '../../server/ast/node-types';

/**
 * Convert declaration kind to LSP SymbolKind
 */
function declarationKindToSymbolKind(kind: string): SymbolKind {
    switch (kind) {
        case 'ClassDecl':
            return SymbolKind.Class;
        case 'FunctionDecl':
            return SymbolKind.Function;
        case 'MethodDecl':
            return SymbolKind.Method;
        case 'VarDecl':
            return SymbolKind.Variable;
        case 'ParameterDecl':
            return SymbolKind.Variable;
        case 'EnumDecl':
            return SymbolKind.Enum;
        case 'EnumMemberDecl':
            return SymbolKind.EnumMember;
        case 'TypedefDecl':
            return SymbolKind.TypeParameter;
        case 'ProtoMethodDecl':
            return SymbolKind.Method;
        default:
            return SymbolKind.Variable;
    }
}

/**
 * Get detail string for a declaration
 * @param decl The declaration node
 * @param _parentClassName Optional parent class name for constructor detection (kept for backwards compatibility but no longer needed)
 */
function getDeclarationDetail(decl: Declaration, _parentClassName?: string): string {
    if (isMethod(decl)) {
        const methodDecl = decl as MethodDeclNode;

        // Use the AST flags set by the parser
        if (methodDecl.isConstructor) {
            return 'constructor';
        }

        if (methodDecl.isDestructor) {
            return 'destructor';
        }

        const params = methodDecl.parameters.map(p => {
            const typeStr = 'name' in p.type ? p.type.name : 'auto';
            return `${typeStr} ${p.name}`;
        }).join(', ');
        const returnType = 'name' in methodDecl.returnType ? methodDecl.returnType.name : 'void';
        return `${returnType} ${decl.name}(${params})`;
    }

    if (isFunction(decl)) {
        const funcDecl = decl as FunctionDeclNode;
        const params = funcDecl.parameters.map(p => {
            const typeStr = 'name' in p.type ? p.type.name : 'auto';
            return `${typeStr} ${p.name}`;
        }).join(', ');
        const returnType = 'name' in funcDecl.returnType ? funcDecl.returnType.name : 'void';
        return `${returnType} ${decl.name}(${params})`;
    }

    if (isClass(decl)) {
        const classDecl = decl as ClassDeclNode;
        if (classDecl.baseClass && 'name' in classDecl.baseClass) {
            return `extends ${classDecl.baseClass.name}`;
        }
    }

    if (isEnum(decl)) {
        const enumDecl = decl as EnumDeclNode;
        if (enumDecl.baseType && 'name' in enumDecl.baseType) {
            return `: ${enumDecl.baseType.name}`;
        }
    }

    // For other declarations (vars, typedefs, etc.), show modifiers if any
    if (decl.modifiers && decl.modifiers.length > 0) {
        return decl.modifiers.join(' ');
    }

    return '';
}

/**
 * Create a DocumentSymbol from a declaration with nested children
 * @param decl The declaration to convert
 * @param parentClassName Optional parent class name for constructor detection
 */
function createDocumentSymbol(decl: Declaration, parentClassName?: string): DocumentSymbol {
    const symbol: DocumentSymbol = {
        name: decl.name,
        detail: getDeclarationDetail(decl, parentClassName),
        kind: declarationKindToSymbolKind(decl.kind),
        range: {
            start: decl.start,
            end: decl.end
        },
        selectionRange: {
            start: decl.nameStart,
            end: decl.nameEnd
        },
        children: []
    };

    // Add children for classes (methods and fields)
    if (isClass(decl)) {
        for (const member of decl.members) {
            if (member.name) {
                // Pass the class name so constructors can be detected
                symbol.children!.push(createDocumentSymbol(member, decl.name));
            }
        }
    }

    // Add children for enums (enum members)
    if (isEnum(decl)) {
        for (const member of decl.members) {
            if (member.name) {
                symbol.children!.push(createDocumentSymbol(member));
            }
        }
    }

    return symbol;
}

@injectable()
export class DocumentSymbolHandler implements IHandlerRegistration {
    constructor(
        @inject(TYPES.IDocumentCacheManager) private cacheManager: IDocumentCacheManager
    ) { }

    register(connection: Connection, documents: TextDocuments<TextDocument>): void {
        connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
            const doc = documents.get(params.textDocument.uri);
            if (!doc) return [];

            // Get the AST for the document (use IDE cache for open documents)
            const ast = this.cacheManager.get(params.textDocument.uri);
            if (!ast) return [];

            const symbols: DocumentSymbol[] = [];

            // Create hierarchical document symbols from top-level declarations
            for (const decl of ast.body) {
                if (decl.name) {
                    symbols.push(createDocumentSymbol(decl));
                }
            }

            return symbols;
        });
    }
}
