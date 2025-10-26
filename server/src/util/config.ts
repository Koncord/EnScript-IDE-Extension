import * as url from 'node:url';
import * as path from 'node:path';
import { Logger } from './logger';

export interface VSCodeConfiguration {
    includePaths?: string[];
    preprocessorDefinitions?: string[];
    modRoots?: string[];
    diagnostics?: unknown;
    logging?: {
        level?: string;
    };
    logLevel?: string;
    debug?: boolean;
}

/**
 * Determines if a file URI is external (from includePaths) vs internal (workspace)
 * @param fileUri The file URI to check
 * @param workspaceRoot The workspace root path
 * @param includePaths Array of include paths configured by the user
 * @returns true if the file is external (in includePaths), false if it's in workspace
 */
export function isExternalFile(fileUri: string, workspaceRoot: string, includePaths: string[]): boolean {
    try {
        // If no workspace root is configured, treat all files as internal (workspace files)
        // This ensures function bodies get parsed when workspace detection fails
        if (!workspaceRoot || workspaceRoot.trim() === '') {
            Logger.warn(`⚠️ No workspace root configured, treating file as internal: ${fileUri}`);
            return false;
        }

        const filePath = url.fileURLToPath(fileUri);
        const normalizedFilePath = path.normalize(filePath).toLowerCase();
        const normalizedWorkspaceRoot = path.normalize(workspaceRoot).toLowerCase();

        // Check if file is in workspace root
        if (normalizedFilePath.startsWith(normalizedWorkspaceRoot)) {
            return false;
        }

        // Check if file is in any of the include paths
        for (const includePath of includePaths) {
            const normalizedIncludePath = path.normalize(includePath).toLowerCase();
            if (normalizedFilePath.startsWith(normalizedIncludePath)) {
                return true;
            }
        }

        // If not in workspace or include paths, consider it external
        return true;
    } catch (error) {
        // If URI parsing fails, default to treating as external to be safe
        Logger.warn(`Failed to parse URI for external file check: ${fileUri}`, error);
        return true;
    }
}
