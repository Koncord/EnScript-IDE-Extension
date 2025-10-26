/**
 * Types for project file (config.cpp) parsing and management
 */

/**
 * Represents a patch configuration class
 */
export interface CfgPatch {
    requiredAddons: string[];
}

/**
 * Represents a script module definition
 */
export interface ScriptModule {
    name: string;
    value: string;
    files: string[];
}

/**
 * Represents a mod definition in CfgMods
 */
export interface CfgMod {
    dir: string;
    type: string;
    action?: string;
    hideName?: boolean;
    hidePicture?: boolean;
    name: string;
    overview?: string;
    credits?: string;
    author?: string;
    authorID?: string;
    version?: string;
    extra?: number;
    scriptModules: Map<string, ScriptModule>;
}

/**
 * Represents the CfgMods configuration
 */
export interface CfgMods {
    mods: Map<string, CfgMod>;
}

export type CfgPatches = Map<string, CfgPatch>;

/**
 * Represents the entire project file structure
 */
export interface ProjectFile {
    cfgPatches: CfgPatches;
    cfgMods: CfgMods;
}
