import { Parser } from './parser';
import { Preprocessor } from './preprocessor';
import { CfgDocument, CfgClass, CfgArrayVariable, CfgSimpleVariable } from './ast';
import { ProjectFile, CfgPatches, CfgPatch, CfgMods, CfgMod, ScriptModule } from './project';
import * as fs from 'fs';

export function parseProject(filePath: string, options?: { defines?: Map<string, string> }): ProjectFile | null {
    const file = fs.readFileSync(filePath, 'utf-8');
    // pre-checking file for CfgMods or CfgPatches
    const cfgModsRegex = /class\s+CfgMods/g;
    const cfgPatchesRegex = /class\s+CfgPatches/g;
    if (!cfgModsRegex.test(file) && !cfgPatchesRegex.test(file)) {
        return null;
    }
    const preprocessor = new Preprocessor({ defines: options?.defines });
    const processedInput = preprocessor.preprocess(filePath);
    const parser = new Parser(processedInput, filePath);
    const doc = parser.parse();
    const cfgPatches = extractCfgPatches(doc);
    const cfgMods = extractCfgMods(doc);
    return {
        cfgPatches,
        cfgMods
    };
}

function extractCfgPatches(doc: CfgDocument): CfgPatches {
    const patches = new Map<string, CfgPatch>();
    for (const stmt of doc.statements) {
        if (stmt.kind === 'class' && (stmt as CfgClass).name === 'CfgPatches') {
            const cls = stmt as CfgClass;
            for (const [patchName, patchNode] of cls.properties) {
                if (patchNode.kind === 'class') {
                    const patch = extractCfgPatch(patchNode as CfgClass);
                    patches.set(patchName, patch);
                }
            }
        }
    }
    return patches;
}

function extractCfgPatch(patchClass: CfgClass): CfgPatch {
    const requiredAddons: string[] = [];
    // Extract requiredAddons
    const reqAddonsProp = patchClass.properties.get('requiredAddons');
    if (reqAddonsProp && reqAddonsProp.kind === 'array') {
        const arr = reqAddonsProp as CfgArrayVariable;
        for (const addon of arr.values) {
            if (typeof addon === 'string') {
                requiredAddons.push(addon);
            }
        }
    }
    return {
        requiredAddons
    };
}

function extractCfgMods(doc: CfgDocument): CfgMods {
    const mods = new Map<string, CfgMod>();
    for (const stmt of doc.statements) {
        if (stmt.kind === 'class' && (stmt as CfgClass).name === 'CfgMods') {
            const cls = stmt as CfgClass;
            for (const [modName, modNode] of cls.properties) {
                if (modNode.kind === 'class') {
                    const mod = extractCfgMod(modNode as CfgClass);
                    mods.set(modName, mod);
                }
            }
        }
    }
    return { mods };
}

function extractCfgMod(modClass: CfgClass): CfgMod {
    const mod: Partial<CfgMod> = {
        scriptModules: new Map()
    };

    for (const [propName, propNode] of modClass.properties) {
        if (propNode.kind === 'variable') {
            const varNode = propNode as CfgSimpleVariable;
            const value = varNode.value;
            switch (propName) {
                case 'dir':
                    if (typeof value === 'string') mod.dir = value;
                    break;
                case 'type':
                    if (typeof value === 'string') mod.type = value;
                    break;
                case 'action':
                    if (typeof value === 'string') mod.action = value;
                    break;
                case 'hideName':
                    if (typeof value === 'boolean') mod.hideName = value;
                    break;
                case 'hidePicture':
                    if (typeof value === 'boolean') mod.hidePicture = value;
                    break;
                case 'name':
                    if (typeof value === 'string') mod.name = value;
                    break;
                case 'overview':
                    if (typeof value === 'string') mod.overview = value;
                    break;
                case 'credits':
                    if (typeof value === 'string') mod.credits = value;
                    break;
                case 'author':
                    if (typeof value === 'string') mod.author = value;
                    break;
                case 'authorID':
                    if (typeof value === 'string') mod.authorID = value;
                    break;
                case 'version':
                    if (typeof value === 'string') mod.version = value;
                    break;
                case 'extra':
                    if (typeof value === 'number') mod.extra = value;
                    break;
            }
        } else if (propNode.kind === 'class' && propName === 'defs') {
            // Extract scriptModules from defs
            extractScriptModules(propNode as CfgClass, mod.scriptModules!);
        }
    }

    return mod as CfgMod;
}

function extractScriptModules(defsClass: CfgClass, scriptModules: Map<string, ScriptModule>) {
    for (const [moduleName, moduleNode] of defsClass.properties) {
        if (moduleNode.kind === 'class') {
            const scriptModule = extractScriptModule(moduleName, moduleNode as CfgClass);
            scriptModules.set(moduleName, scriptModule);
        }
    }
}

function extractScriptModule(name: string, moduleClass: CfgClass): ScriptModule {
    let value = '';
    const files: string[] = [];

    for (const [propName, propNode] of moduleClass.properties) {
        if (propNode.kind === 'variable' && propName === 'value') {
            const varNode = propNode as CfgSimpleVariable;
            if (typeof varNode.value === 'string') value = varNode.value;
        } else if (propNode.kind === 'array' && propName === 'files') {
            const arr = propNode as CfgArrayVariable;
            for (const file of arr.values) {
                if (typeof file === 'string') {
                    files.push(file);
                }
            }
        }
    }

    return {
        name,
        value,
        files
    };
}