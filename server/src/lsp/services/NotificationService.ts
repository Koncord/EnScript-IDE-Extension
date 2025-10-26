import { injectable } from 'inversify';
import { Connection } from 'vscode-languageserver';
import { DiagnosticsNotificationParams, IndexingNotificationParams, INotificationService, ProjectLoadingNotificationParams } from './INotificationService';

@injectable()
export class NotificationService implements INotificationService {
    private connection!: Connection;

    constructor() {
        // Initialization code if needed
    }

    /**
     * Set the LSP connection instance
     * Must be called before using sendNotification
     */
    public setConnection(connection: Connection): void {
        this.connection = connection;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private sendNotification(method: string, params?: any): void {
        this.connection.sendNotification(method, params);
    }

    public sendLSPReadyNotification(): void {
        this.sendNotification('enscript/ready', {
            message: 'Enscript Language Server is ready.'
        });
    }

    public sendIndexingNotification(params: IndexingNotificationParams): void {
        this.sendNotification('enscript/indexing', params);
    }

    public sendDiagnosticsNotification(params: DiagnosticsNotificationParams): void {
        this.sendNotification('enscript/diagnostics', params);
    }

    public sendProjectLoadingNotification(params: ProjectLoadingNotificationParams): void {
        this.sendNotification('enscript/projectLoading', params);
    }

    public sendIncludePathsUpdatedNotification(): void {
        this.sendNotification('enscript/includePathsUpdated', {});
    }
}
