import {
    CompletionItem,
    CompletionParams
} from 'vscode-languageserver';
import { IAnalyzer, TYPES } from '../../server/di';
import { IHandlerRegistration, Connection, TextDocuments, TextDocument } from './handler-interfaces';
import { injectable, inject } from 'inversify';
import { IIndexerService } from '../services/IIndexerService';
import { SERVICE_TYPES } from '../services/service-types';

@injectable()
export class CompletionHandler implements IHandlerRegistration {
    constructor(
        @inject(TYPES.IAnalyzer) private analyzer: IAnalyzer,
        @inject(SERVICE_TYPES.IIndexerService) private indexerService: IIndexerService
    ) {}

    register(connection: Connection, documents: TextDocuments<TextDocument>): void {
        connection.onCompletion(async (params: CompletionParams): Promise<CompletionItem[]> => {
            // Wait for indexing to complete before processing completion requests
            await this.indexerService.waitForIndexingToComplete();

            const doc = documents.get(params.textDocument.uri);
            if (!doc) return [];

            const items = await this.analyzer.getCompletions(doc, params.position);
            return items;
        });
    }
}

