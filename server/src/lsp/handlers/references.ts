import {
    Location,
    ReferenceParams
} from 'vscode-languageserver';
import { IHandlerRegistration, Connection, TextDocuments, TextDocument } from './handler-interfaces';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../server/di';
import { ISymbolOperations } from '../../server/symbols/symbol-operations-interfaces';

@injectable()
export class ReferencesHandler implements IHandlerRegistration {

    constructor(
        @inject(TYPES.ISymbolOperations) private symbolOperations: ISymbolOperations
    ) {}

    register(connection: Connection, documents: TextDocuments<TextDocument>): void {
        connection.onReferences(async (params: ReferenceParams): Promise<Location[]> => {
            const doc = documents.get(params.textDocument.uri);
            if (!doc) return [];

            return await this.symbolOperations.findReferences(doc, params.position, params.context.includeDeclaration);
        });
    }
}
