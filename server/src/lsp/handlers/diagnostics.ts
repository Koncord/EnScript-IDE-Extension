import {
    TextDocumentChangeEvent
} from 'vscode-languageserver';
import { diagnosticsCache } from '../../server/cache';
import { Logger } from '../../util/logger';
import { isExternalFile } from '../../util/config';
import { IHandlerRegistration, Connection, TextDocuments, TextDocument } from './handler-interfaces';
import { inject, injectable } from 'inversify';
import { IWorkspaceManager } from '../../server/workspace/workspace-interfaces';
import { IDiagnosticsProvider, TYPES } from '../../server/di';
import { IIndexerService } from '../services/IIndexerService';
import { SERVICE_TYPES } from '../services/service-types';
import { ServerConfigurationManager } from '../server-config';
import { INotificationService } from '../services/INotificationService';

@injectable()
export class DiagnosticsHandler implements IHandlerRegistration {
    constructor(
        @inject(TYPES.IWorkspaceManager) private workspaceManager: IWorkspaceManager,
        @inject(TYPES.IDiagnosticsProvider) private diagnosticsProvider: IDiagnosticsProvider,
        @inject(SERVICE_TYPES.IIndexerService) private indexerService: IIndexerService,
        @inject(SERVICE_TYPES.INotificationService) private notificationService: INotificationService,
        @inject(ServerConfigurationManager) private configManager: ServerConfigurationManager
    ) {}
    register(connection: Connection, documents: TextDocuments<TextDocument>): void {
        // Track recent validation requests to avoid double-running
        const recentValidations = new Map<string, number>();
        const DEBOUNCE_MS = 100; // Don't run diagnostics more than once per 100ms

        // Track pending validations to avoid parallel runs for the same document
        const pendingValidations = new Map<string, Promise<void>>();

        const validate = async (change: TextDocumentChangeEvent<TextDocument>) => {
            const uri = change.document.uri;
            const now = Date.now();
            const lastRun = recentValidations.get(uri) || 0;

            // Debounce: skip if we just ran diagnostics very recently
            if (now - lastRun < DEBOUNCE_MS) {
                return;
            }

            // If there's already a validation in progress for this document, wait for it instead of starting a new one
            const existingValidation = pendingValidations.get(uri);
            if (existingValidation) {
                Logger.debug(`⏭️ Validation already in progress for ${uri}, waiting for completion`);
                await existingValidation;
                return;
            }

            // Create a new validation promise and track it
            const validationPromise = (async () => {
                try {
                    recentValidations.set(uri, now);

                    // Wait for indexing to complete before running diagnostics
                    // This ensures we have all type information available
                    if (this.indexerService.isCurrentlyIndexing()) {
                        Logger.debug(`⏳ Waiting for indexing to complete before running diagnostics for ${uri}`);
                    }
                    await this.indexerService.waitForIndexingToComplete();

                    // Clear the diagnostics cache to ensure fresh diagnostic run
                    // Note: We don't clear the document cache here because:
                    // 1. runDiagnostics will re-parse with forceReparse if needed
                    // 2. Clearing the cache triggers TypeResolver invalidation which can cause false positives
                    // 3. The document will be automatically reparsed if version changed
                    diagnosticsCache.clearForDocument(uri);

                    // Get file name for status bar
                    const fileName = uri.split('/').pop() || uri.split('\\').pop() || 'file';

                    // Send progress notification - diagnostics started
                    this.notificationService.sendDiagnosticsNotification({
                        stage: 'running',
                        fileName: fileName,
                        uri: uri
                    });

                    const diagnostics = await this.diagnosticsProvider.runDiagnostics(change.document);
                    connection.sendDiagnostics({ uri, diagnostics });

                    // Send progress notification - diagnostics complete
                    this.notificationService.sendDiagnosticsNotification({
                        stage: 'complete',
                        fileName: fileName,
                        uri: uri,
                        diagnosticCount: diagnostics.length
                    });
                } catch (error) {
                    Logger.error(`❌ Error running diagnostics for ${uri}: ${error}`);
                    // Send empty diagnostics to clear any stale ones
                    connection.sendDiagnostics({ uri, diagnostics: [] });
                } finally {
                    // Remove from pending validations when complete
                    pendingValidations.delete(uri);
                }
            })();

            // Track this validation
            pendingValidations.set(uri, validationPromise);

            // Await the validation
            await validationPromise;
        };

        // Track which external files have visible tabs and their pinned state
        // Note: Hover previews (Ctrl+hover) NEVER create tabs, so they're never tracked here
        const externalFilesWithTabs = new Map<string, boolean>(); // uri -> isPinned

        // Helper to check if diagnostics should run for a given external file
        const shouldRunDiagnosticsForExternalFile = (uri: string): boolean => {
            const isPinned = externalFilesWithTabs.get(uri);
            if (isPinned === undefined) {
                // File doesn't have a tab
                return false;
            }

            const config = this.configManager.getConfiguration();
            if (isPinned) {
                // Pinned tab - check pinned tab setting
                return config.enableExternalPinnedTabDiagnostics ?? true;
            } else {
                // Preview tab - check preview tab setting
                return config.enableExternalTabDiagnostics ?? true;
            }
        };

        // Listen for tab opened notifications from client
        connection.onNotification('enscript/tabOpened', (params: { uri: string; isPinned: boolean }) => {
            externalFilesWithTabs.set(params.uri, params.isPinned);
        });

        // Listen for tab pinned state change notifications from client
        connection.onNotification('enscript/tabPinnedChanged', (params: { uri: string; isPinned: boolean }) => {
            externalFilesWithTabs.set(params.uri, params.isPinned);

            // When pinned state changes, re-run diagnostics if appropriate
            const doc = documents.get(params.uri);
            if (doc && shouldRunDiagnosticsForExternalFile(params.uri)) {
                validate({ document: doc });
            }
        });

        // Listen for tab closed notifications from client
        connection.onNotification('enscript/tabClosed', (params: { uri: string }) => {
            externalFilesWithTabs.delete(params.uri);
        });

        // Run diagnostics on open
        // Note: Hover previews (Ctrl+hover) NEVER create tabs, so they never reach this point in externalFilesWithTabs
        // Settings control:
        //   - enableExternalTabDiagnostics: Controls preview tabs (Ctrl+Click, unpinned)
        //   - enableExternalPinnedTabDiagnostics: Controls pinned tabs (double-click or pin action)
        // For workspace files, always run diagnostics.
        documents.onDidOpen((change) => {
            const uri = change.document.uri;

            if (isExternalFile(uri, this.workspaceManager.getWorkspaceRoot(), this.workspaceManager.getIncludePaths())) {
                // External file - check if diagnostics should run based on tab state and settings
                if (shouldRunDiagnosticsForExternalFile(uri)) {
                    validate(change);
                }
                // Otherwise skip diagnostics
                return;
            }

            // Workspace file - always run diagnostics
            validate(change);
        });

        // Run diagnostics on save
        // For external files, skip unless they are being edited (which means they're pinned/opened intentionally)
        documents.onDidSave((change) => {
            // Always run diagnostics on save - if user is saving, they're actively working on the file
            validate(change);
        });

        // Detect when user types ';' or '}' or pastes code, and trigger diagnostics immediately
        const lastContent = new Map<string, string>();

        documents.onDidChangeContent((change) => {
            const uri = change.document.uri;
            const currentContent = change.document.getText();
            const prevContent = lastContent.get(uri) || '';

            // Skip diagnostics for external files on initial content change (file load)
            // Content change fires when file is first loaded, which we want to ignore for external files
            // Note: Hover previews trigger this but are already filtered by onDidOpen
            if (isExternalFile(uri, this.workspaceManager.getWorkspaceRoot(), this.workspaceManager.getIncludePaths()) && !prevContent) {
                // First load of external file - skip diagnostics
                lastContent.set(uri, currentContent);
                return;
            }

            // Check if text was added or deleted
            const lengthDiff = Math.abs(currentContent.length - prevContent.length);

            // Trigger on paste (larger changes, typically > 15 chars - accounts for single line pastes)
            // or when trigger characters are typed
            if (lengthDiff > 15) {
                // Moderate to large change detected - likely paste, multi-line edit, or significant edit
                validate(change);
            } else if (currentContent.length > prevContent.length && lengthDiff <= 15) {
                // Small addition - check for trigger characters (typical typing)
                // Find the first difference
                let changeStart = 0;
                for (let i = 0; i < Math.min(prevContent.length, currentContent.length); i++) {
                    if (prevContent[i] !== currentContent[i]) {
                        changeStart = i;
                        break;
                    }
                }

                // Extract the added text
                const addedText = currentContent.substring(changeStart, changeStart + lengthDiff);

                // Check if the added text contains trigger characters
                if (addedText.includes(';') || addedText.includes('}') || addedText.includes('\n')) {
                    validate(change);
                }
            }

            lastContent.set(uri, currentContent);
        });

        // Clean up cache when documents are closed
        documents.onDidClose((event) => {
            diagnosticsCache.clearForDocument(event.document.uri);
            // Also clear diagnostics from the problems panel
            connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
        });
    }
}
