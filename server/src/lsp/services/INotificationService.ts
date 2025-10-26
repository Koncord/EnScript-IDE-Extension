export interface IndexingNotificationParams {
    stage: 'scanning' | 'indexing' | 'complete' | 'processing';
    message: string;
    progress?: number;
    total?: number;
    isInitialIndexing?: boolean;
}

export interface DiagnosticsNotificationParams {
    stage: 'running' | 'complete';
    uri: string;
    fileName: string;
    diagnosticCount?: number;
}

export interface ProjectLoadingNotificationParams {
    stage: 'loading' | 'complete' | 'error';
    message: string;
    modCount?: number;
    diagnosticCount?: number;
}

export interface INotificationService {
    sendIndexingNotification(params: IndexingNotificationParams): void;
    sendLSPReadyNotification(): void;
    sendDiagnosticsNotification(params: DiagnosticsNotificationParams): void;
    sendProjectLoadingNotification(params: ProjectLoadingNotificationParams): void;
    sendIncludePathsUpdatedNotification(): void;
}
