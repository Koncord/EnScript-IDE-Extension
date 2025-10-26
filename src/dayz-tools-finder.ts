import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Parse VDF (Valve Data Format) file
 */
function parseVDF(content: string): Record<string, unknown> {
    const lines = content.split('\n');
    const stack: Record<string, unknown>[] = [{}];
    let current = stack[0];

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === '{') {
            const newObj = {};
            stack.push(newObj);
            current = newObj;
        } else if (trimmed === '}') {
            const obj = stack.pop();
            current = stack[stack.length - 1];

            // Find the last key in current object and assign the popped object
            const keys = Object.keys(current);
            if (keys.length > 0) {
                const lastKey = keys[keys.length - 1];
                if (typeof current[lastKey] === 'string' && current[lastKey] === '__pending__') {
                    current[lastKey] = obj;
                }
            }
        } else if (trimmed.includes('\t\t')) {
            const match = trimmed.match(/"([^"]+)"\s+"([^"]+)"/);
            if (match) {
                const [, key, value] = match;
                current[key] = value;
            }
        } else {
            const match = trimmed.match(/"([^"]+)"/);
            if (match) {
                const key = match[1];
                current[key] = '__pending__';
            }
        }
    }

    return stack[0];
}

/**
 * Get Steam installation path from Windows Registry
 */
async function getSteamPath(): Promise<string | null> {
    if (process.platform !== 'win32') {
        return null;
    }

    try {
        const { stdout } = await execAsync(
            'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath'
        );

        const match = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/);
        if (match) {
            return match[1].trim();
        }
    } catch (error) {
        console.error('Failed to read Steam path from registry:', error);
    }

    return null;
}

/**
 * Find DayZ Tools installation path
 */
export async function findDayZToolsPath(): Promise<string | null> {
    const steamPath = await getSteamPath();
    if (!steamPath) {
        return null;
    }

    // Read libraryfolders.vdf
    const libraryFoldersPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(libraryFoldersPath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(libraryFoldersPath, 'utf-8');
        const data = parseVDF(content);

        // Find library folder containing DayZ Tools (appid: 830640)
        const libraryFolders = (data.libraryfolders || data) as Record<string, unknown>;

        for (const key of Object.keys(libraryFolders)) {
            const folder = libraryFolders[key] as Record<string, unknown>;
            if (typeof folder === 'object' && folder.apps) {
                const apps = folder.apps as Record<string, unknown>;
                if ('830640' in apps && typeof folder.path === 'string') {
                    const libraryPath = folder.path.replace(/\\\\/g, '\\');
                    const dayZToolsPath = path.join(libraryPath, 'steamapps', 'common', 'DayZ Tools');

                    if (fs.existsSync(dayZToolsPath)) {
                        return dayZToolsPath;
                    }
                }
            }
        }
    } catch (error) {
        console.error('Failed to parse libraryfolders.vdf:', error);
    }

    return null;
}

/**
 * Read ProjectDrive path from DayZ Tools settings.ini
 */
export function getProjectDriveFromSettings(dayZToolsPath: string): string | null {
    const settingsPath = path.join(dayZToolsPath, 'settings.ini');

    if (!fs.existsSync(settingsPath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(settingsPath, 'utf-8');
        const lines = content.split('\n');

        let inProjectDriveSection = false;

        for (const line of lines) {
            const trimmed = line.trim();

            // Check if we're entering ProjectDrive section
            if (trimmed === '[ProjectDrive]') {
                inProjectDriveSection = true;
                continue;
            }

            // Check if we're entering a different section
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                inProjectDriveSection = false;
                continue;
            }

            // If we're in ProjectDrive section, look for path=
            if (inProjectDriveSection && trimmed.startsWith('path=')) {
                return trimmed.substring(5).trim();
            }
        }
    } catch (error) {
        console.error(`Failed to read settings.ini at ${settingsPath}:`, error);
    }

    return null;
}

/**
 * Configure modRoots with DayZ Tools Project Drive
 */
export async function configureDayZTools(): Promise<boolean> {
    try {
        const dayZToolsPath = await findDayZToolsPath();

        if (!dayZToolsPath) {
            const result = await vscode.window.showErrorMessage(
                'DayZ Tools not found. Please install DayZ Tools from Steam.',
                'Open Steam Store'
            );

            if (result === 'Open Steam Store') {
                vscode.env.openExternal(vscode.Uri.parse('steam://store/830640'));
            }

            return false;
        }

        const projectDrive = getProjectDriveFromSettings(dayZToolsPath);

        if (!projectDrive) {
            const result = await vscode.window.showErrorMessage(
                'Could not find Project Drive in DayZ Tools settings. Please configure DayZ Tools Workbench first, or manually set modRoots.',
                'Open Settings Location',
                'Manual Setup'
            );

            if (result === 'Open Settings Location') {
                // Open the DayZ Tools folder so user can find settings
                vscode.env.openExternal(vscode.Uri.file(dayZToolsPath));
            } else if (result === 'Manual Setup') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'enscript.modRoots');
            }

            return false;
        }

        // Update user configuration
        const config = vscode.workspace.getConfiguration('enscript');
        const currentModRoots = config.get<string[]>('modRoots') || [];

        // Add project drive if not already present
        const normalizedProjectDrive = path.normalize(projectDrive);
        const hasProjectDrive = currentModRoots.some(
            root => path.normalize(root).toLowerCase() === normalizedProjectDrive.toLowerCase()
        );

        if (!hasProjectDrive) {
            const newModRoots = [...currentModRoots, projectDrive];
            await config.update('modRoots', newModRoots, vscode.ConfigurationTarget.Global);

            vscode.window.showInformationMessage(
                `✅ DayZ Tools Project Drive configured: ${projectDrive}`
            );
        } else {
            vscode.window.showInformationMessage(
                `DayZ Tools Project Drive already configured: ${projectDrive}`
            );
        }

        return true;
    } catch (error) {
        vscode.window.showErrorMessage(
            `Failed to configure DayZ Tools: ${error}`
        );
        return false;
    }
}

/**
 * Check if extension is configured
 */
export function isExtensionConfigured(): boolean {
    const config = vscode.workspace.getConfiguration('enscript');
    const modRoots = config.get<string[]>('modRoots') || [];
    return modRoots.length > 0;
}

/**
 * Show first-time setup notification
 */
export async function showFirstTimeSetup(): Promise<void> {
    if (isExtensionConfigured()) {
        return;
    }

    const result = await vscode.window.showInformationMessage(
        'EnScript IDE extension is not configured. Would you like to auto-configure it with DayZ Tools?',
        'Auto-Configure',
        'Manual Setup',
        'Later'
    );

    if (result === 'Auto-Configure') {
        const success = await configureDayZTools();
        if (success) {
            vscode.window.showInformationMessage(
                '✅ EnScript IDE configured successfully! Reloading workspace...'
            );
            // Trigger refresh
            await vscode.commands.executeCommand('enscript.refreshProject');
        }
    } else if (result === 'Manual Setup') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'enscript.modRoots');
    }
}
