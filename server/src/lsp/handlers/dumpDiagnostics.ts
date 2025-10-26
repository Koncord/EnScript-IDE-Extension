import { IAnalyzer, TYPES } from '../../server/di';
import { IHandlerRegistration, Connection, TextDocuments, TextDocument } from './handler-interfaces';
import { injectable, inject } from 'inversify';

@injectable()
export class DumpDiagnosticsHandler implements IHandlerRegistration {
    constructor(@inject(TYPES.IAnalyzer) private analyzer: IAnalyzer) {}

    register(connection: Connection, _documents: TextDocuments<TextDocument>): void {
        connection.onRequest('enscript/dumpDiagnostics', () => {
            return this.analyzer.dumpDiagnostics();
        });
    }
}
