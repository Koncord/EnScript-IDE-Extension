import { TextDocument } from 'vscode-languageserver-textdocument';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as url from 'url';
import { normalizeUri } from '../../util/uri';
import { Logger } from '../../util/logger';
import { isClass } from '../../util';
import { IClassDiscovery } from './class-discovery-interfaces';
import { IDocumentCacheManager } from '../cache/document-cache-interfaces';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/tokens';

/**
 * Handles discovery and loading of class definitions from include paths
 */
@injectable()
export class ClassDiscovery implements IClassDiscovery {
    constructor(
        @inject(TYPES.IDocumentCacheManager) private cacheManager: IDocumentCacheManager
    ) { }

    /**
     * Proactively scan include paths for class definitions
     * This is crucial for modded class support - we need to find original class definitions
     * from external files before they're explicitly opened
     * 
     * @param includePaths Paths to search for class definitions
     */
    async scanIncludePathsForClasses(includePaths: string[]): Promise<void> {
        if (includePaths.length === 0) {
            Logger.warn('📦 No include paths configured, skipping proactive class scanning');
            return;
        }

        Logger.debug(`🔍 Scanning include paths for class definitions...`);

        for (const includePath of includePaths) {
            try {
                Logger.debug(`📂 Scanning include path: ${includePath}`);
                await this.scanDirectoryForClasses(includePath);
            } catch (error) {
                Logger.warn(`⚠️ Failed to scan include path ${includePath}:`, error);
            }
        }
    }

    /**
     * Recursively scan a directory for .c files and load class definitions
     */
    private async scanDirectoryForClasses(dirPath: string): Promise<void> {

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    // Recursively scan subdirectories
                    await this.scanDirectoryForClasses(fullPath);
                } else if (entry.isFile() && (entry.name.endsWith('.c') || entry.name.endsWith('.h'))) {
                    // Load and parse .c and .h files
                    await this.loadExternalClassFile(fullPath);
                }
            }
        } catch (error) {
            // Ignore directory access errors (permissions, non-existent paths, etc.)
            Logger.warn(`⚠️ Could not scan directory ${dirPath}:`, error);
        }
    }

    /**
     * Load and parse an external file, then check if it contains a specific class
     */
    private async loadAndCheckForClass(filePath: string, className: string): Promise<boolean> {

        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            const fileUri = url.pathToFileURL(filePath).href;

            // Create a TextDocument for parsing
            const textDoc = TextDocument.create(fileUri, 'enscript', 1, fileContent);

            // Parse the file (this will add it to docCache)
            const ast = this.cacheManager.ensureDocumentParsed(textDoc);

            // Check if this specific AST contains the class we're looking for
            if (ast && ast.body) {
                for (const node of ast.body) {
                    if (isClass(node) && node.name === className) {
                        return true; // Found the class in this file
                    }
                }
            }

            return false; // Class not found in this file
        } catch (error) {
            // Ignore file read errors for now
            Logger.warn(`⚠️ Could not load external file ${filePath}:`, error);
            return false;
        }
    }

    /**
     * Load and parse an external file for class definitions
     */
    private async loadExternalClassFile(filePath: string): Promise<void> {

        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            const fileUri = url.pathToFileURL(filePath).href;

            const textDoc = TextDocument.create(fileUri, 'enscript', 1, fileContent);

            // Check if we already have this file cached
            const normalizedUri = normalizeUri(fileUri);
            if (this.cacheManager.has(normalizedUri)) {
                return;
            }

            // Parse the file (this will add it to docCache)
            this.cacheManager.ensureDocumentParsed(textDoc);

        } catch (error) {
            Logger.warn(`⚠️ Could not load external file ${filePath}:`, error);
        }
    }

    /**
     * Try to find and load a specific class from include paths
     * @param className Name of the class to find
     * @param includePaths Paths to search for the class
     * @returns true if any new files were loaded, false if all were already cached
     */
    async loadClassFromIncludePaths(className: string, includePaths: string[]): Promise<boolean> {
        if (includePaths.length === 0) {
            return false;
        }

        Logger.debug(`🔍 Searching for class '${className}' in include paths...`);

        let foundAny = false;
        for (const includePath of includePaths) {
            try {
                const found = await this.searchClassInDirectory(includePath, className);
                if (found) foundAny = true;
            } catch (error) {
                Logger.warn(`⚠️ Error searching for '${className}' in ${includePath}:`, error);
            }
        }
        return foundAny;
    }

    /**
     * Search for a specific class in a directory
     * @returns true if the class was found in any file in this directory tree
     */
    private async searchClassInDirectory(dirPath: string, className: string): Promise<boolean> {

        let foundAny = false;
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    // Recursively search subdirectories
                    const foundInSubdir = await this.searchClassInDirectory(fullPath, className);
                    if (foundInSubdir) foundAny = true;
                } else if (entry.isFile() && entry.name.endsWith('.c')) {
                    // Load and parse every .c file to check for the class
                    // We can't rely on filename patterns since classes can be defined in any file
                    const foundInFile = await this.loadAndCheckForClass(fullPath, className);
                    if (foundInFile) {
                        Logger.info(`✅ Found class '${className}' in ${fullPath}`);
                        foundAny = true;
                        // Don't return here - continue searching to find ALL definitions of the class
                        // This is important for modded classes where we might have multiple definitions
                    }
                }
            }
        } catch (error) {
            // Ignore directory access errors
            Logger.warn(`⚠️ Could not search directory ${dirPath}:`, error);
        }
        return foundAny;
    }
}
