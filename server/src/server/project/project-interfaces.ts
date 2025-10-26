import { ProjectFile } from '../rapparser/project';

/**
 * Represents a mod with its dependencies
 */
export interface ModInfo {
    name: string;
    path: string;
    project: ProjectFile | null;
    dependencies: string[];
}

/**
 * Dependency graph node
 */
export interface DependencyNode {
    modName: string;
    dependencies: Set<string>;
    dependents: Set<string>;
}

/**
 * Diagnostic information about dependency issues
 */
export interface DependencyDiagnostic {
    type: 'missing' | 'circular' | 'warning';
    modName: string;
    message: string;
    relatedMods?: string[];
}


export interface IProjectManager {
    /**
     * Initialize and load project from workspace
     */
    loadProject(): Promise<void>;

    /**
     * Get all discovered mods
     */
    getMods(): Map<string, ModInfo>;

    /**
     * Resolve path to a mod by its name
     */
    resolveModPath(modName: string): string | null;

    /**
     * Get all dependencies for a mod
     */
    getModDependencies(modName: string): string[];

    /**
     * Get all dependents of a mod
     */
    getModDependents(modName: string): string[];

    /**
     * Get the full dependency graph
     */
    getDependencyGraph(): Map<string, DependencyNode>;

    /**
     * Get mod name by include path
     * Returns mod name if the path belongs to a discovered mod
     */
    getModNameByPath(includePath: string): string | null;

    /**
     * Check if project has been loaded
     */
    isLoaded(): boolean;

    /**
     * Refresh project (rescan workspace)
     */
    refresh(): Promise<void>;

    /**
     * Get all include paths from discovered mods
     */
    getModIncludePaths(): string[];

    /**
     * Validate dependencies and return diagnostics
     */
    validateDependencies(): DependencyDiagnostic[];

    /**
     * Set custom mod roots (alternative to default P: drive)
     */
    setModRoots(roots: string[]): void;

    /**
     * Get current mod roots
     */
    getModRoots(): string[];

    /**
     * Update configuration and refresh if needed
     */
    updateConfiguration(modRoots: string[]): Promise<void>;
}
