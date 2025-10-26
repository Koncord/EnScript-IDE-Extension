import { inject, injectable } from "inversify";
import { Logger, readFileUtf8 } from "../../util";
import { findAllFiles } from "../../util";
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as url from 'url';
import { ServerConfigurationManager } from "../server-config";
import { IDocumentCacheManager } from "../../server/cache/document-cache-interfaces";
import { TYPES } from "../../server/di";
import { IIndexerService } from "./IIndexerService";
import { SERVICE_TYPES } from "./service-types";
import { INotificationService } from "./INotificationService";

@injectable()
export class IndexerService implements IIndexerService {
    private isIndexing: boolean = false;
    private indexingPromise: Promise<void> | null = null;
    private hasCompletedInitialIndexing: boolean = false;

    private initialIndexingCompleteLatch: Promise<void>;
    private resolveInitialIndexing!: () => void;

    constructor(
        @inject(SERVICE_TYPES.INotificationService) private notificationService: INotificationService,
        @inject(ServerConfigurationManager) private configManager: ServerConfigurationManager,
        @inject(TYPES.IDocumentCacheManager) private cacheManager: IDocumentCacheManager
    ) {
        // Initialize the latch - this promise will resolve when initial indexing completes
        this.initialIndexingCompleteLatch = new Promise<void>((resolve) => {
            this.resolveInitialIndexing = resolve;
        });
    }



    /**
     * Force re-indexing of all files (can be called by user command)
     */
    public async forceReindex(): Promise<void> {
        try {
            Logger.info(`🔄 Force re-indexing requested...`);

            // Send notification that re-indexing is starting
            this.notificationService.sendIndexingNotification({
                stage: 'scanning',
                message: 'Re-indexing all files...'
            });

            await this.indexFiles(this.configManager.getConfiguration().workspaceRoot, this.configManager.getConfiguration().includePaths);
            Logger.info('🔄 Force re-indexing completed');

        } catch (error) {
            Logger.error(`❌ Failed to force re-index: ${error}`);
            throw error;
        }
    }

    /**
     * Wait for indexing to complete if currently in progress
     * Also waits for initial indexing to complete if it hasn't happened yet
     */
    public async waitForIndexingToComplete(): Promise<void> {
        // First, wait for initial indexing to complete (if not already done)
        if (!this.hasCompletedInitialIndexing) {
            await this.initialIndexingCompleteLatch;
        }

        // Then, if there's an ongoing re-indexing, wait for that too
        if (this.indexingPromise) {
            await this.indexingPromise;
        }
    }

    /**
     * Check if indexing is currently in progress
     */
    public isCurrentlyIndexing(): boolean {
        return this.isIndexing;
    }

    /**
     * Index all files in workspace and include paths
     */
    public async indexFiles(workspaceRoot: string, includePaths: string[]): Promise<void> {
        // Send notification that re-indexing is starting
        this.notificationService.sendIndexingNotification({
            stage: 'scanning',
            message: 'Re-indexing files due to configuration change...'
        });

        // Set indexing state
        this.isIndexing = true;
        this.indexingPromise = this._performIndexing(workspaceRoot, includePaths);

        try {
            await this.indexingPromise;
        } finally {
            this.isIndexing = false;
            this.indexingPromise = null;
        }
    }

    /**
     * Internal method to perform the actual indexing
     */
    private async _performIndexing(workspaceRoot: string, includePaths: string[]): Promise<void> {
        Logger.info('🗂️  Starting file indexing...');
        const pathsToIndex = [workspaceRoot, ...includePaths].filter(p => p && p.trim() !== '');
        Logger.info(`🔍 Paths to index: [${pathsToIndex.join(', ')}]`);

        // Check if we have any paths to index
        if (pathsToIndex.length === 0) {
            Logger.warn('⚠️ No workspace root or include paths configured - cannot index files');
            Logger.warn('💡 Please configure "enscript.includePaths" in your VS Code settings or open a workspace folder');
            this.notificationService.sendIndexingNotification({
                stage: 'complete',
                message: 'No paths configured for indexing. Please set enscript.includePaths in settings.'
            });
            return;
        }

        const allFiles: string[] = [];

        // Send notification for status bar progress

        try {
            const message = this.hasCompletedInitialIndexing
                ? 'Re-scanning workspace for EnScript files...'
                : 'Scanning workspace for EnScript files...';
            this.notificationService.sendIndexingNotification({
                stage: 'scanning',
                message
            });
        } catch (error) {
            Logger.debug('Progress notification not available:', error);
        }

        for (const basePath of pathsToIndex) {
            if (!basePath) continue;

            Logger.info(`🗂️  Scanning folder: ${basePath}`);
            try {
                const files = await findAllFiles(basePath, ['.c']);
                Logger.info(`📁 Found ${files.length} .c files in ${basePath}`);
                allFiles.push(...files);
            } catch (err) {
                Logger.warn(`Failed to scan path: ${basePath} – ${String(err)}`);
            }
        }

        Logger.info(`🗂️  Total files found: ${allFiles.length}`);

        if (allFiles.length === 0) {
            Logger.info('📂 No EnScript files found to index');
            this.notificationService.sendIndexingNotification({
                stage: 'complete',
                message: 'No EnScript files found to index'
            });
            return;
        }

        Logger.info(`Indexing ${allFiles.length} EnScript files...`);
        Logger.time('file-indexing');
        Logger.info('📊 Starting to process individual files...');

        this.notificationService.sendIndexingNotification({
            stage: 'processing',
            message: this.hasCompletedInitialIndexing
                ? `Re-processing ${allFiles.length} EnScript files...`
                : `Processing ${allFiles.length} EnScript files...`,
            progress: 0,
            total: allFiles.length
        });

        for (let i = 0; i < allFiles.length; i++) {
            const filePath = allFiles[i];
            try {
                // Log progress every 10 files, but send notifications every 5 files for smoother status bar updates
                if (i % 10 === 0) {
                    Logger.debug(`📊 Processing file ${i + 1}/${allFiles.length}: ${filePath}`);
                }

                if (i % 5 === 0) {
                    this.notificationService.sendIndexingNotification({
                        stage: 'processing',
                        message: `Processing file ${i + 1}/${allFiles.length}`,
                        progress: i + 1,
                        total: allFiles.length
                    });
                }
                const uri = url.pathToFileURL(filePath).toString();
                const text = await readFileUtf8(filePath);
                const doc = TextDocument.create(uri, 'enscript', 1, text);
                await this.cacheManager.ensureDocumentParsed(doc);  // will parse & cache (normalizes URI internally)
            } catch (error) {
                Logger.error(`❌ Failed to index file ${filePath}: ${error}`);
                Logger.error(`Stack trace: ${error instanceof Error ? error.stack : 'N/A'}`);
            }
        }

        Logger.info(`✅ Finished processing loop - processed ${allFiles.length} files`);

        this.notificationService.sendIndexingNotification({
            stage: 'complete',
            message: this.hasCompletedInitialIndexing
                ? `Re-indexing complete! Processed ${allFiles.length} files.`
                : `Indexing complete! Processed ${allFiles.length} files.`,
            isInitialIndexing: !this.hasCompletedInitialIndexing
        });

        // Mark that initial indexing is complete and resolve the latch
        if (!this.hasCompletedInitialIndexing) {
            this.hasCompletedInitialIndexing = true;
            this.resolveInitialIndexing(); // Release any waiting diagnostics
            Logger.debug('🔓 Initial indexing latch released');
        }

        Logger.timeEnd('file-indexing');
        Logger.info('🎉 Indexing complete!');
    }
}