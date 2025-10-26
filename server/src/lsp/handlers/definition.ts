import {
    Definition,
    DefinitionParams,
    Location
} from 'vscode-languageserver';
import { IHandlerRegistration, Connection, TextDocuments, TextDocument } from './handler-interfaces';
import { inject, injectable } from 'inversify';
import { ISymbolOperations } from '../../server/symbols/symbol-operations-interfaces';
import { TYPES } from '../../server/di';
import { IIndexerService } from '../services/IIndexerService';
import { SERVICE_TYPES } from '../services/service-types';

@injectable()
export class DefinitionHandler implements IHandlerRegistration {
    constructor(
        @inject(TYPES.ISymbolOperations) private symbolOperations: ISymbolOperations,
        @inject(SERVICE_TYPES.IIndexerService) private indexerService: IIndexerService
    ) {}
    register(connection: Connection, documents: TextDocuments<TextDocument>): void {
        connection.onDefinition(async (params: DefinitionParams): Promise<Definition> => {
            // Wait for indexing to complete before processing definition requests
            await this.indexerService.waitForIndexingToComplete();

            const doc = documents.get(params.textDocument.uri);
            if (!doc) return [];

            const symbols = await this.symbolOperations.resolveDefinitions(doc, params.position);

            // Convert symbol results to LSP Locations
            const locations: Location[] = symbols.map(sym => ({
                uri: sym.uri,
                range: {
                    start: sym.nameStart,
                    end: sym.nameEnd
                }
            }));

            return locations;
        });
    }
}
