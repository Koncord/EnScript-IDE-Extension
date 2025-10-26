import { SymbolInformation, SymbolKind, WorkspaceSymbolParams } from 'vscode-languageserver';
import { isClass, isEnum } from '../../util';
import { IHandlerRegistration, Connection, TextDocuments, TextDocument } from './handler-interfaces';
import { inject, injectable } from 'inversify';
import { IDocumentCacheManager } from '../../server/cache/document-cache-interfaces';
import { TYPES } from '../../server/di';

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
        case 'ParameterDecl':
            return SymbolKind.Variable;
        case 'EnumDecl':
            return SymbolKind.Enum;
        case 'EnumMemberDecl':
            return SymbolKind.EnumMember;
        case 'TypedefDecl':
            return SymbolKind.Class; // Treat typedefs as classes
        default:
            return SymbolKind.Variable;
    }
}

@injectable()
export class WorkspaceSymbolHandler implements IHandlerRegistration {
    constructor(
        @inject(TYPES.IDocumentCacheManager) private cacheManager: IDocumentCacheManager
    ) {}
    register(connection: Connection, _documents: TextDocuments<TextDocument>): void {
        connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
            const query = params.query?.toLowerCase() || "";
            const symbols: SymbolInformation[] = [];

            // Iterate through all cached documents
            for (const [uri, ast] of this.cacheManager.entries()) {
                // Search top-level declarations
                for (const decl of ast.body) {
                    // Skip declarations without names
                    if (!decl.name) continue;

                    // Filter by query
                    if (query && !decl.name.toLowerCase().includes(query)) {
                        continue;
                    }

                    // Add top-level symbol
                    symbols.push({
                        name: decl.name,
                        kind: declarationKindToSymbolKind(decl.kind),
                        location: {
                            uri: uri,
                            range: {
                                start: decl.nameStart,
                                end: decl.nameEnd
                            }
                        },
                        containerName: undefined
                    });

                    // For classes, also add their members
                    if (isClass(decl)) {
                        for (const member of decl.members) {
                            if (!member.name) continue;

                            // Filter by query
                            if (query && !member.name.toLowerCase().includes(query)) {
                                continue;
                            }

                            symbols.push({
                                name: member.name,
                                kind: declarationKindToSymbolKind(member.kind),
                                location: {
                                    uri: uri,
                                    range: {
                                        start: member.nameStart,
                                        end: member.nameEnd
                                    }
                                },
                                containerName: decl.name
                            });
                        }
                    }

                    // For enums, add their members
                    if (isEnum(decl)) {
                        for (const member of decl.members) {
                            if (!member.name) continue;

                            // Filter by query
                            if (query && !member.name.toLowerCase().includes(query)) {
                                continue;
                            }

                            symbols.push({
                                name: member.name,
                                kind: SymbolKind.EnumMember,
                                location: {
                                    uri: uri,
                                    range: {
                                        start: member.nameStart,
                                        end: member.nameEnd
                                    }
                                },
                                containerName: decl.name
                            });
                        }
                    }
                }
            }

            return symbols;
        });
    }
}
