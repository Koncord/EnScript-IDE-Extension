/**
 * Interface for the IndexerService which handles file indexing operations
 */
export interface IIndexerService {
    /**
     * Force re-indexing of all files (can be called by user command)
     */
    forceReindex(): Promise<void>;

    /**
     * Wait for indexing to complete if currently in progress.
     * Also waits for initial indexing to complete if it hasn't happened yet.
     */
    waitForIndexingToComplete(): Promise<void>;

    /**
     * Check if indexing is currently in progress
     */
    isCurrentlyIndexing(): boolean;

    /**
     * Index all files in workspace and include paths
     * @param workspaceRoot - The root path of the workspace
     * @param includePaths - Additional paths to include in indexing
     */
    indexFiles(workspaceRoot: string, includePaths: string[]): Promise<void>;
}
