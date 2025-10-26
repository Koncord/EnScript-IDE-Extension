import {
    PrepareRenameParams,
    Range,
    RenameParams,
    WorkspaceEdit
} from 'vscode-languageserver';
import { IHandlerRegistration, Connection, TextDocuments, TextDocument } from './handler-interfaces';
import { injectable, inject } from 'inversify';
import { TYPES } from '../../server/di';
import { ISymbolOperations } from '../../server/symbols/symbol-operations-interfaces';

@injectable()
export class RenameHandler implements IHandlerRegistration {
    constructor(
        @inject(TYPES.ISymbolOperations) private symbolOperations: ISymbolOperations
    ) {}

    register(connection: Connection, documents: TextDocuments<TextDocument>): void {

        connection.onPrepareRename((params: PrepareRenameParams): Range | null => {
            const doc = documents.get(params.textDocument.uri);
            if (!doc) return null;
            return this.symbolOperations.prepareRename(doc, params.position);
        });

        connection.onRenameRequest(async (params: RenameParams): Promise<WorkspaceEdit> => {
            const doc = documents.get(params.textDocument.uri);
            if (!doc) return { changes: {} };

            const edits = await this.symbolOperations.renameSymbol(doc, params.position, params.newName);
            // this.symbolOperations.renameSymbol returns WorkspaceEdit | null directly
            return edits || { changes: {} };
        });
    }
}
