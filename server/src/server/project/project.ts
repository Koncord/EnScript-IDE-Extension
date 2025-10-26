import { inject, injectable } from 'inversify';
import { parseProject } from '../rapparser/adapter';
import { ProjectFile } from '../rapparser/project';
import { IWorkspaceManager } from '../workspace/workspace-interfaces';
import { TYPES } from '../di';
import * as fs from 'fs';
import * as path from 'path';
import { IProjectManager, DependencyDiagnostic, ModInfo, DependencyNode } from './project-interfaces';
import { Logger } from '../../util';

@injectable()
export class ProjectManager implements IProjectManager {
    private project: ProjectFile | null = null;
    private mods: Map<string, ModInfo> = new Map();
    private dependencyGraph: Map<string, DependencyNode> = new Map();
    private modPaths: Map<string, string> = new Map();
    private modRoots: string[] = [];
    private loaded: boolean = false;
    
    // Cache for parsed config.cpp files during scanning (cleared after each load/refresh)
    private configCache: Map<string, ProjectFile | null> = new Map();

    // Well-known dependencies that should be ignored during validation
    private readonly WELL_KNOWN_DEPENDENCIES = new Set([
        'DZ_Data',
        'DZ_Scripts',
        'DZ_Sounds_Effects',
        'DZ_Characters',
        'DZ_Characters_Backpacks',
        'DZ_Characters_Belts',
        'DZ_Characters_Glasses',
        'DZ_Characters_Gloves',
        'DZ_Characters_Heads',
        'DZ_Characters_Headgear',
        'DZ_Characters_Masks',
        'DZ_Characters_Pants',
        'DZ_Characters_Shirts',
        'DZ_Characters_Vests',
        'DZ_Characters_Shoes',
        'DZ_Characters_Zombies',
        'DZ_Gear_Books',
        'DZ_Gear_Camping',
        'DZ_Gear_Consumables',
        'DZ_Gear_Containers',
        'DZ_Gear_Cooking',
        'DZ_Gear_Crafting',
        'DZ_Gear_Cultivation',
        'DZ_Gear_Drinks',
        'DZ_Gear_Food',
        'DZ_Gear_Medical',
        'DZ_Gear_Navigation',
        'DZ_Gear_Optics',
        'DZ_Gear_Tools',
        'DZ_Gear_Traps',
        'DZ_AI',
        'DZ_Data_Bliss',
        'DZ_Structures',
        'DZ_Plants',
        'DZ_Animals',
        'DZ_Worlds',
        'DZ_Radio'
    ]);

    // Directory names to exclude from mod scanning (case-insensitive)
    private readonly EXCLUDED_DIRECTORIES = new Set([
        '.git',
        '.vscode',
        'node_modules',
        '.idea',
        '__pycache__'
    ]);

    // Directory names to exclude only at modRoot level (case-insensitive)
    private readonly EXCLUDED_ROOT_DIRECTORIES = new Set([
        'dz',
        "bin",
        "gui",
        "system",
        "temp" // PBO Tools temp folder
    ]);

    constructor(
        @inject(TYPES.IWorkspaceManager) private workspaceManager: IWorkspaceManager
    ) { }

    public async loadProject(): Promise<void> {
        const workspaceRoot = this.workspaceManager.getWorkspaceRoot();
        if (!workspaceRoot) {
            throw new Error('No workspace root available');
        }

        // Step 1: Find and parse project file
        const projectFile = await this.findProjectFile(workspaceRoot);
        if (!projectFile) {
            console.warn('No config.cpp with CfgMods found in workspace');
            return;
        }

        this.project = projectFile;

        // Step 2: Build dependency list from CfgPatches
        this.buildDependencyList();

        // Step 3: Search for mods in modRoots
        await this.searchModsInRoots();

        // Step 4: Build dependency graph
        this.buildDependencyGraph();

        this.loaded = true;
    }

    public getMods(): Map<string, ModInfo> {
        return this.mods;
    }

    public resolveModPath(modName: string): string | null {
        return this.modPaths.get(modName) || null;
    }

    public getModDependencies(modName: string): string[] {
        const node = this.dependencyGraph.get(modName);
        return node ? Array.from(node.dependencies) : [];
    }

    public getModDependents(modName: string): string[] {
        const node = this.dependencyGraph.get(modName);
        return node ? Array.from(node.dependents) : [];
    }

    public getDependencyGraph(): Map<string, DependencyNode> {
        return this.dependencyGraph;
    }

    public getModNameByPath(includePath: string): string | null {
        const normalizedPath = path.normalize(includePath).toLowerCase();
        
        for (const [modName, modInfo] of this.mods) {
            const modPath = path.normalize(modInfo.path).toLowerCase();
            if (normalizedPath.startsWith(modPath)) {
                return modName;
            }
        }
        
        return null;
    }

    public isLoaded(): boolean {
        return this.loaded;
    }

    public async refresh(): Promise<void> {
        this.mods.clear();
        this.dependencyGraph.clear();
        this.modPaths.clear();
        this.configCache.clear();
        this.loaded = false;
        await this.loadProject();
    }

    private async findProjectFile(workspaceRoot: string): Promise<ProjectFile | null> {
        const configPath = path.join(workspaceRoot, 'config.cpp');
        if (fs.existsSync(configPath)) {
            try {
                return parseProject(configPath);
            } catch (error) {
                Logger.error('Failed to parse config.cpp:', error);
                return null;
            }
        }
        return null;
    }

    private buildDependencyList(): void {
        if (!this.project) return;

        const dependencies = new Set<string>();

        // Collect all requiredAddons from CfgPatches
        for (const [_patchName, patch] of this.project.cfgPatches) {
            for (const addon of patch.requiredAddons) {
                dependencies.add(addon);
            }
        }

        // Store dependencies for the workspace mod
        const workspaceModName = this.getWorkspaceModName();
        if (workspaceModName) {
            this.mods.set(workspaceModName, {
                name: workspaceModName,
                path: this.workspaceManager.getWorkspaceRoot(),
                project: this.project,
                dependencies: Array.from(dependencies)
            });
        }
    }

    /**
     * Get workspace mod name from CfgMods
     */
    private getWorkspaceModName(): string | null {
        if (!this.project?.cfgMods.mods.size) return null;

        // Return the first mod name found in CfgMods
        const firstMod = Array.from(this.project.cfgMods.mods.keys())[0];
        return firstMod || null;
    }

    private async searchModsInRoots(): Promise<void> {
        const workspaceRoot = this.workspaceManager.getWorkspaceRoot();
        let previousModCount = 0;
        let currentModCount = this.mods.size;
        
        // Keep searching until we don't find any new mods
        // This handles transitive dependencies (dependencies of dependencies)
        while (currentModCount > previousModCount) {
            const dependencies = new Set<string>();

            // Collect all dependencies we need to find
            for (const modInfo of this.mods.values()) {
                for (const dep of modInfo.dependencies) {
                    // Skip if we already found this mod
                    if (!this.mods.has(dep)) {
                        dependencies.add(dep);
                    }
                }
            }

            // If no new dependencies to search for, we're done
            if (dependencies.size === 0) {
                break;
            }

            Logger.debug(`🔍 Searching for ${dependencies.size} dependencies...`);

            // Search each modRoot for the dependencies
            for (const modRoot of this.modRoots) {
                const normalizedRoot = path.normalize(modRoot);
                
                // Check if directory exists and is accessible
                try {
                    if (!fs.existsSync(normalizedRoot)) {
                        continue;
                    }
                    
                    // Double-check with stat to ensure it's actually a directory
                    const stats = fs.statSync(normalizedRoot);
                    if (!stats.isDirectory()) {
                        continue;
                    }
                    
                    // Try to actually read the directory to verify accessibility
                    fs.readdirSync(normalizedRoot);
                } catch {
                    Logger.debug(`⏭️ Cannot access mod root ${normalizedRoot}`);
                    continue;
                }

                await this.scanModRoot(normalizedRoot, dependencies, workspaceRoot);
            }

            previousModCount = currentModCount;
            currentModCount = this.mods.size;
            
            if (currentModCount > previousModCount) {
                Logger.debug(`✅ Found ${currentModCount - previousModCount} new mods, checking for their dependencies...`);
            }
        }
        
        Logger.info(`📦 Total mods discovered: ${this.mods.size}`);
        
        // Log any dependencies that couldn't be found
        const missingDeps = new Set<string>();
        for (const modInfo of this.mods.values()) {
            for (const dep of modInfo.dependencies) {
                if (!this.WELL_KNOWN_DEPENDENCIES.has(dep) && !this.mods.has(dep)) {
                    missingDeps.add(dep);
                }
            }
        }
        
        if (missingDeps.size > 0) {
            Logger.warn(`⚠️ Could not find ${missingDeps.size} mod(s):`);
            for (const dep of missingDeps) {
                Logger.warn(`   - ${dep}`);
            }
            Logger.warn(`💡 Tip: Make sure these mods are in one of your configured modRoots: ${this.modRoots.join(', ')}`);
        }
    }

    private async scanModRoot(
        modRoot: string,
        targetMods: Set<string>,
        excludePath: string
    ): Promise<void> {
        const normalizedModRoot = path.normalize(modRoot);
        
        if (!fs.existsSync(normalizedModRoot)) {
            return;
        }

        try {
            const entries = fs.readdirSync(normalizedModRoot, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                const modPath = path.join(normalizedModRoot, entry.name);
                const normalizedExcludePath = path.normalize(excludePath).toLowerCase();

                // Skip excluded directories
                const dirName = entry.name.toLowerCase();
                if (this.EXCLUDED_DIRECTORIES.has(dirName) || this.EXCLUDED_ROOT_DIRECTORIES.has(dirName)) {
                    continue;
                }

                // Recursively scan for mods
                await this.scanModDirectory(modPath, targetMods, 0, normalizedExcludePath);
            }
        } catch {
            // Silently ignore ENOENT errors for inaccessible drives
        }
    }

    private async scanModDirectory(
        directoryPath: string,
        targetMods: Set<string>,
        depth: number = 0,
        excludePath?: string
    ): Promise<void> {
        const MAX_DEPTH = 5;
        if (depth > MAX_DEPTH) {
            return;
        }

        // Skip workspace directory (exact match only)
        if (excludePath) {
            const normalizedCurrent = path.normalize(directoryPath).toLowerCase();
            if (normalizedCurrent === excludePath) {
                return;
            }
        }

        try {
            // Look for config.cpp in this directory
            const configPath = path.join(directoryPath, 'config.cpp');
            if (fs.existsSync(configPath)) {
                let project: ProjectFile | null = null;
                
                // Check cache first
                const normalizedConfigPath = path.normalize(configPath).toLowerCase();
                if (this.configCache.has(normalizedConfigPath)) {
                    project = this.configCache.get(normalizedConfigPath)!;
                    Logger.debug(`📋 Using cached config.cpp: ${configPath}`);
                } else {
                    try {
                        project = parseProject(configPath);
                        
                        // Cache the result (even if null)
                        this.configCache.set(normalizedConfigPath, project);
                    } catch (parseError) {
                        // Cache the failed parse as null
                        this.configCache.set(normalizedConfigPath, null);
                        
                        // If parsing fails, check if any target mod name matches the directory name
                        // This allows us to still find mods even if config.cpp has syntax we don't support
                        const dirName = path.basename(directoryPath);
                        
                        // Check if this directory name or any parent directory names match target mods
                        for (const targetMod of targetMods) {
                            if (dirName === targetMod) {
                                // Check if mod already exists
                                if (this.mods.has(dirName)) {
                                    const existingPath = this.mods.get(dirName)!.path;
                                    const normalizedPath = path.normalize(directoryPath);
                                    Logger.warn(`⚠️ Duplicate mod "${dirName}" found (parse failed):`);
                                    Logger.warn(`   Existing: ${existingPath}`);
                                    Logger.warn(`   Ignored:  ${normalizedPath}`);
                                    return; // Skip duplicate, keep first found
                                }

                                const normalizedPath = path.normalize(directoryPath);
                                Logger.debug(`Found mod "${dirName}" by directory name (config.cpp parse failed): ${normalizedPath}`);
                                Logger.debug(`Parse error: ${parseError}`);
                                
                                this.mods.set(dirName, {
                                    name: dirName,
                                    path: normalizedPath,
                                    project: null,
                                    dependencies: [] // Can't extract dependencies without parsing
                                });
                                
                                this.modPaths.set(dirName, normalizedPath);
                                break;
                            }
                        }
                    }
                }
                
                // Log all found config.cpp with CfgMods or CfgPatches
                if (project) {
                    const parts: string[] = [];
                    if (project.cfgMods && project.cfgMods.mods.size > 0) {
                        const modNames = Array.from(project.cfgMods.mods.keys());
                        parts.push(`CfgMods: ${modNames.join(', ')}`);
                    }
                    if (project.cfgPatches && project.cfgPatches.size > 0) {
                        const patchNames = Array.from(project.cfgPatches.keys());
                        parts.push(`CfgPatches: ${patchNames.join(', ')}`);
                    }
                    if (parts.length > 0) {
                        Logger.debug(`📄 Found config.cpp: ${configPath}`);
                        Logger.debug(`   ${parts.join(' | ')}`);
                    }
                }
                
                if (project && project.cfgPatches && project.cfgPatches.size > 0) {
                    // Collect dependencies from all patches
                    const dependencies: string[] = [];
                    for (const [_patchName, patch] of project.cfgPatches) {
                        dependencies.push(...patch.requiredAddons);
                    }

                    const normalizedPath = path.normalize(directoryPath);
                    
                    // Search by CfgPatches names (this is how the game resolves dependencies)
                    for (const [patchName, _patch] of project.cfgPatches) {
                        if (targetMods.has(patchName)) {
                            // Check if mod already exists
                            if (this.mods.has(patchName)) {
                                const existingPath = this.mods.get(patchName)!.path;
                                Logger.warn(`⚠️ Duplicate mod "${patchName}" found:`);
                                Logger.warn(`   Existing: ${existingPath}`);
                                Logger.warn(`   Ignored:  ${normalizedPath}`);
                                continue; // Skip duplicate, keep first found
                            }

                            this.mods.set(patchName, {
                                name: patchName,
                                path: normalizedPath,
                                project,
                                dependencies
                            });

                            this.modPaths.set(patchName, normalizedPath);
                            Logger.info(`✅ Found mod "${patchName}": ${normalizedPath}`);
                            if (dependencies.length > 0) {
                                Logger.debug(`   Dependencies: ${dependencies.join(', ')}`);
                            }
                        }
                    }
                }
            }

            // Recursively scan subdirectories for nested mods
            const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const dirName = entry.name.toLowerCase();
                    if (this.EXCLUDED_DIRECTORIES.has(dirName)) {
                        continue;
                    }
                    
                    const subPath = path.join(directoryPath, entry.name);
                    await this.scanModDirectory(subPath, targetMods, depth + 1, excludePath);
                }
            }
        } catch {
            // Silently ignore inaccessible directories
        }
    }

    private buildDependencyGraph(): void {
        this.dependencyGraph.clear();

        // Initialize nodes for all mods
        for (const [modName, modInfo] of this.mods) {
            if (!this.dependencyGraph.has(modName)) {
                this.dependencyGraph.set(modName, {
                    modName,
                    dependencies: new Set(),
                    dependents: new Set()
                });
            }

            const node = this.dependencyGraph.get(modName)!;

            // Add dependencies
            for (const dep of modInfo.dependencies) {
                // Skip well-known dependencies in dependency graph
                if (this.WELL_KNOWN_DEPENDENCIES.has(dep)) {
                    continue;
                }
                
                node.dependencies.add(dep);

                // Create node for dependency if it doesn't exist
                if (!this.dependencyGraph.has(dep)) {
                    this.dependencyGraph.set(dep, {
                        modName: dep,
                        dependencies: new Set(),
                        dependents: new Set()
                    });
                }

                // Add this mod as a dependent of the dependency
                this.dependencyGraph.get(dep)!.dependents.add(modName);
            }
        }
    }

    public getModIncludePaths(): string[] {
        const includePaths: string[] = [];
        const addedPaths = new Set<string>();
        const workspaceRoot = this.workspaceManager.getWorkspaceRoot();
        const normalizedWorkspace = path.normalize(workspaceRoot).toLowerCase();

        // Add scripts folder from each modRoot (typically DayZ SDK)
        for (const modRoot of this.modRoots) {
            const scriptsPath = path.join(modRoot, 'scripts');
            if (fs.existsSync(scriptsPath)) {
                const normalizedScriptsPath = path.normalize(scriptsPath).toLowerCase();
                
                // Skip if this is workspace path
                if (normalizedScriptsPath === normalizedWorkspace) {
                    continue;
                }
                
                if (!addedPaths.has(normalizedScriptsPath)) {
                    includePaths.push(scriptsPath);
                    addedPaths.add(normalizedScriptsPath);
                    Logger.debug(`📚 Added SDK scripts path: ${scriptsPath}`);
                }
            }
        }

        for (const modInfo of this.mods.values()) {
            const normalizedModPath = path.normalize(modInfo.path).toLowerCase();
            
            // Skip workspace mod - it's already handled by WorkspaceManager
            if (normalizedModPath === normalizedWorkspace) {
                continue;
            }
            
            // Add the mod root path
            if (!addedPaths.has(normalizedModPath)) {
                includePaths.push(modInfo.path);
                addedPaths.add(normalizedModPath);
            }

            // Add paths from scriptModules if available
            if (modInfo.project && modInfo.project.cfgMods) {
                for (const [_modName, mod] of modInfo.project.cfgMods.mods) {
                    for (const [_scriptModName, scriptModule] of mod.scriptModules) {
                        // Add each file's directory to include paths
                        for (const file of scriptModule.files) {
                            // Files in scriptModules are paths relative to modRoot (P:\)
                            // We need to resolve them relative to the modRoot, not to the mod path
                            
                            // Find the modRoot that contains this mod
                            let modRootPath: string | null = null;
                            for (const root of this.modRoots) {
                                const normalizedRoot = path.normalize(root).toLowerCase();
                                const normalizedMod = path.normalize(modInfo.path).toLowerCase();
                                if (normalizedMod.startsWith(normalizedRoot)) {
                                    modRootPath = root;
                                    break;
                                }
                            }

                            if (modRootPath) {
                                // Construct full path from modRoot
                                const fullPath = path.join(modRootPath, file);
                                const dirPath = path.dirname(fullPath);
                                const normalizedDir = path.normalize(dirPath).toLowerCase();
                                
                                // Skip if this is a workspace path
                                if (normalizedDir.startsWith(normalizedWorkspace)) {
                                    continue;
                                }
                                
                                // Skip if this path is inside the mod root path (already added)
                                if (normalizedDir.startsWith(normalizedModPath)) {
                                    continue;
                                }
                                
                                if (!addedPaths.has(normalizedDir)) {
                                    includePaths.push(dirPath);
                                    addedPaths.add(normalizedDir);
                                }
                            }
                        }
                    }
                }
            }
        }

        Logger.info(`📦 Total mod include paths: ${includePaths.length}`);
        return includePaths;
    }

    public validateDependencies(): DependencyDiagnostic[] {
        const diagnostics: DependencyDiagnostic[] = [];

        // Check for missing dependencies (skip well-known dependencies)
        for (const [modName, node] of this.dependencyGraph) {
            for (const dep of node.dependencies) {
                // Skip well-known dependencies
                if (this.WELL_KNOWN_DEPENDENCIES.has(dep)) {
                    continue;
                }
                
                if (!this.mods.has(dep)) {
                    diagnostics.push({
                        type: 'missing',
                        modName,
                        message: `Missing dependency: ${dep}`,
                        relatedMods: [dep]
                    });
                }
            }
        }

        // Check for circular dependencies
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const detectCycle = (modName: string, path: string[]): boolean => {
            if (recursionStack.has(modName)) {
                // Found a cycle
                const cycleStart = path.indexOf(modName);
                const cycle = path.slice(cycleStart).concat(modName);
                diagnostics.push({
                    type: 'circular',
                    modName,
                    message: `Circular dependency detected: ${cycle.join(' -> ')}`,
                    relatedMods: cycle
                });
                return true;
            }

            if (visited.has(modName)) {
                return false;
            }

            visited.add(modName);
            recursionStack.add(modName);

            const node = this.dependencyGraph.get(modName);
            if (node) {
                for (const dep of node.dependencies) {
                    if (detectCycle(dep, [...path, modName])) {
                        recursionStack.delete(modName);
                        return true;
                    }
                }
            }

            recursionStack.delete(modName);
            return false;
        };

        for (const modName of this.dependencyGraph.keys()) {
            if (!visited.has(modName)) {
                detectCycle(modName, []);
            }
        }

        return diagnostics;
    }

    public setModRoots(roots: string[]): void {
        this.modRoots = roots;
    }

    public getModRoots(): string[] {
        return [...this.modRoots];
    }

    public async updateConfiguration(modRoots: string[]): Promise<void> {
        const oldModRoots = JSON.stringify(this.modRoots);
        const newModRoots = JSON.stringify(modRoots);

        if (oldModRoots !== newModRoots) {
            this.modRoots = modRoots;
            Logger.info(`📦 Mod roots changed, refreshing project...`);
            await this.refresh();
        }
    }
}
