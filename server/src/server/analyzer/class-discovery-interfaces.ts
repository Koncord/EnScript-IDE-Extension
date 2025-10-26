/**
 * Interface for class discovery operations
 * Abstracts ClassDiscovery for dependency injection
 */
export interface IClassDiscovery {
    /**
     * Proactively scan include paths for class definitions
     * This is crucial for modded class support - we need to find original class definitions
     * from external files before they're explicitly opened
     * 
     * @param includePaths Paths to search for class definitions
     */
    scanIncludePathsForClasses(includePaths: string[]): Promise<void>;

    /**
     * Try to find and load a specific class from include paths
     * @param className Name of the class to find
     * @param includePaths Paths to search for the class
     * @returns true if any new files were loaded, false if all were already cached
     */
    loadClassFromIncludePaths(className: string, includePaths: string[]): Promise<boolean>;
}
