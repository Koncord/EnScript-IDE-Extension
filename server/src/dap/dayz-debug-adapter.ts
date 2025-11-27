import { Logger } from "../util";
import { DebugProtocol } from "./protocol/debug-protocol";
import {
    BaseMessage,
    DebugModule,
    MessageType,
    ModuleLoadMessage,
    DebugControlMessage,
    DebugControlCommand,
    ExecuteCodeMessage,
    ModuleUnloadMessage
} from "./protocol/messages";

export interface IDayZDebugListener {
    onConnectedAsync(port: DayZDebugAdapter): Promise<void>;
    onDisconnectedAsync(port: DayZDebugAdapter): Promise<void>;
    onMessageAsync(port: DayZDebugAdapter, message: BaseMessage): Promise<void>;
}

export class DayZDebugAdapter {
    public pid: number = -1;
    private listeners: IDayZDebugListener[] = [];
    private running: boolean = false;
    private modules: Map<bigint, DebugModule> = new Map();
    private breakpoints: Map<bigint, number[]> = new Map();

    constructor(
        public readonly address: [string, number],
        public readonly protocol: DebugProtocol,
        public readonly peerType: string
    ) { }

    /**
     * Add a breakpoint for a specific module and code point index
     */
    public addBreakpoint(moduleAddress: bigint, codePointIndex: number): void {
        Logger.info(`[${this.peerType}] Adding breakpoint: module=0x${moduleAddress.toString(16)}, codePoint=${codePointIndex.toString(16)}`);

        if (!this.breakpoints.has(moduleAddress)) {
            this.breakpoints.set(moduleAddress, []);
        }

        const bps = this.breakpoints.get(moduleAddress)!;
        if (!bps.includes(codePointIndex)) {
            bps.push(codePointIndex);
        }
    }

    public addListener(listener: IDayZDebugListener): void {
        this.listeners.push(listener);
    }

    public async runAsync(abortSignal: AbortSignal): Promise<void> {
        this.running = true;

        while (this.running && !abortSignal.aborted) {
            try {
                // Use 30 second timeout - we're just waiting for next debug event from DayZ
                const message = await this.protocol.processMessage(30000);

                if (message.kind === MessageType.Bye) {
                    this.running = false;
                    break;
                } else if (message.kind === MessageType.LoadModule) {
                    const module = (message as ModuleLoadMessage).module;
                    this.modules.set(module.baseAddress, module);

                    // Log all module paths to understand the format
                    Logger.info(`[${this.peerType}] Module loaded with ${module.paths.length} files:`);
                    for (let i = 0; i < Math.min(5, module.paths.length); i++) {
                        Logger.info(`[${this.peerType}]   [${i}] ${module.paths[i]}`);
                    }
                    if (module.paths.length > 5) {
                        Logger.info(`[${this.peerType}]   ... and ${module.paths.length - 5} more`);
                    }

                    // Restore breakpoints from previous session if available
                    if (module.breakPoints && module.breakPoints.length > 0) {
                        Logger.info(`[${this.peerType}] Restoring ${module.breakPoints.length} breakpoint(s) from previous session for module 0x${module.baseAddress.toString(16)}`);
                        this.breakpoints.set(module.baseAddress, [...module.breakPoints]);

                        // Log which lines have breakpoints restored
                        if (module.debugPoints) {
                            for (const bpIdx of module.breakPoints) {
                                const dp = module.debugPoints[bpIdx];
                                if (dp && dp.fileIndex < module.paths.length) {
                                    const filePath = module.paths[dp.fileIndex];
                                    Logger.debug(`[${this.peerType}] Restored breakpoint: ${filePath} line ${dp.lineNumber} (bpIdx=0x${bpIdx.toString(16)})`);
                                }
                            }
                        }
                    } else {
                        this.breakpoints.set(module.baseAddress, []);
                    }
                } else if (message.kind === MessageType.UnloadModule) {
                    const baseAddress = (message as ModuleUnloadMessage).baseAddress;
                    this.modules.delete(baseAddress);
                    this.breakpoints.delete(baseAddress);
                }

                // Notify all listeners
                for (const listener of this.listeners) {
                    await listener.onMessageAsync(this, message);
                }
            } catch (error) {
                const err = error as Error;

                // Check for timeout errors (normal when waiting for next message)
                if (err.message?.includes('Timed out waiting')) {
                    // Normal - just waiting for next message from DayZ
                    continue;
                }

                // Check if this is a socket close error (normal when stopping debug session)
                if (err.message?.includes('Socket closed') ||
                    err.message?.includes('Socket read cancelled') ||
                    abortSignal.aborted) {
                    // Normal shutdown, not an error
                    Logger.debug('Debug session ended, socket closed');
                    break;
                }

                Logger.error(`Error receiving message: ${err.message || 'Unknown error'}`, err.stack);
                break;
            }
        }

        this.running = false;
    }

    /**
     * Resolve a code point index to source location (file path and line number)
     */
    public resolveSourceLocation(moduleAddress: bigint, codePointIndex: number): { filePath: string; line: number } | null {
        const module = this.modules.get(moduleAddress);
        if (!module || !module.debugPoints || codePointIndex >= module.debugPoints.length) {
            Logger.warn(`[${this.peerType}] Cannot resolve source location: module=0x${moduleAddress.toString(16)}, codePoint=${codePointIndex}`);
            return null;
        }

        const debugPoint = module.debugPoints[codePointIndex];
        if (!debugPoint || debugPoint.fileIndex >= module.paths.length) {
            Logger.warn(`[${this.peerType}] Invalid debug point or file index: codePoint=${codePointIndex}`);
            return null;
        }

        const filePath = module.paths[debugPoint.fileIndex];
        const line = debugPoint.lineNumber;

        Logger.debug(`[${this.peerType}] Resolved 0x${moduleAddress.toString(16)}:${codePointIndex} -> ${filePath}:${line}`);

        return { filePath, line };
    }

    /**
     * Normalize a path by:
     * - Converting to lowercase
     * - Converting backslashes to forward slashes
     * - Removing drive letters
     * - Trimming leading slashes
     */
    private normalizePath(path: string): string {
        let normalized = path.toLowerCase().replace(/\\/g, '/');
        // Remove drive letter if present (e.g., "p:/scripts/..." -> "scripts/...")
        normalized = normalized.replace(/^[a-z]:\//, '');
        // Remove leading slash if present
        return normalized.replace(/^\/+/, '');
    }

    /**
     * Find the module that contains the given file path
     */
    public findModuleByPath(filePath: string): DebugModule | null {
        const normalizedRequestPath = this.normalizePath(filePath);

        Logger.debug(`[${this.peerType}] Looking for module with normalized path: ${normalizedRequestPath}`);

        for (const module of this.modules.values()) {
            for (const modulePath of module.paths) {
                const normalizedModulePath = this.normalizePath(modulePath);

                if (normalizedModulePath === normalizedRequestPath) {
                    Logger.debug(`[${this.peerType}] Found exact match in module 0x${module.baseAddress.toString(16)}: ${modulePath}`);
                    return module;
                }
            }
        }

        Logger.warn(`[${this.peerType}] No module found for path: ${filePath} (normalized: ${normalizedRequestPath})`);
        return null;
    }

    /**
     * Validate and set breakpoints for a file. Returns the status of each requested breakpoint.
     * This replaces all breakpoints for the file's module with the new set.
     */
    public setBreakpointsForFile(filePath: string, lines: number[]): Array<{ verified: boolean; line: number; message?: string }> {
        Logger.info(`[${this.peerType}] Setting breakpoints for ${filePath}: lines ${lines.join(', ')}`);

        const module = this.findModuleByPath(filePath);

        if (!module) {
            Logger.warn(`[${this.peerType}] Module not found for file: ${filePath}`);
            return lines.map(line => ({
                verified: false,
                line: line,
                message: 'Module not loaded for this file'
            }));
        }

        if (!module.debugPoints || module.debugPoints.length === 0) {
            Logger.warn(`[${this.peerType}] No debug points available for module 0x${module.baseAddress.toString(16)}`);
            return lines.map(line => ({
                verified: false,
                line: line,
                message: 'No debug information available'
            }));
        }

        // Find the file index in the module's paths using normalized comparison
        const normalizedRequestPath = this.normalizePath(filePath);
        const fileIndex = module.paths.findIndex(p =>
            this.normalizePath(p) === normalizedRequestPath
        );

        if (fileIndex === -1) {
            Logger.warn(`[${this.peerType}] File not found in module paths: ${filePath}`);
            Logger.debug(`[${this.peerType}] Available paths in module: ${module.paths.join(', ')}`);
            return lines.map(line => ({
                verified: false,
                line: line,
                message: 'File not found in module'
            }));
        }

        Logger.debug(`[${this.peerType}] Found file at index ${fileIndex} in module: ${module.paths[fileIndex]}`);

        // Clear existing breakpoints for this file by filtering out breakpoints from this file's debug points
        // We need to keep breakpoints from other files in the same module
        const existingBreakpoints = this.breakpoints.get(module.baseAddress) || [];
        const breakpointsFromOtherFiles = existingBreakpoints.filter(bpIdx => {
            const dp = module.debugPoints![bpIdx];
            return dp && dp.fileIndex !== fileIndex;
        });

        // Start with breakpoints from other files
        this.breakpoints.set(module.baseAddress, breakpointsFromOtherFiles);
        Logger.debug(`[${this.peerType}] Cleared breakpoints for file index ${fileIndex}, kept ${breakpointsFromOtherFiles.length} from other files`);

        const results: Array<{ verified: boolean; line: number; message?: string }> = [];

        for (const line of lines) {
            // Find debug point index for this file and line
            const debugPointIndex = module.debugPoints.findIndex(dp =>
                dp.fileIndex === fileIndex && dp.lineNumber === line
            );

            if (debugPointIndex !== -1) {
                const debugPoint = module.debugPoints[debugPointIndex];
                // Use the index of the debug point in the array as the breakpoint index
                this.addBreakpoint(module.baseAddress, debugPointIndex);
                results.push({
                    verified: true,
                    line: line
                });
                Logger.info(`[${this.peerType}] Breakpoint verified at line ${line}, bpIdx=0x${debugPointIndex.toString(16)} (debugPoint.unknown=0x${debugPoint.unknown.toString(16)})`);
            } else {
                results.push({
                    verified: false,
                    line: line,
                    message: 'No executable code on this line'
                });
                Logger.warn(`[${this.peerType}] No debug point found for line ${line}`);
            }
        }

        return results;
    }

    /**
     * Synchronize breakpoints with DayZ by sending a SetBreakpoint command
     */
    public async syncBreakpoints(): Promise<void> {
        Logger.debug(`[${this.peerType}] Syncing ${this.breakpoints.size} module(s) with breakpoints to DayZ`);

        const message = new DebugControlMessage(DebugControlCommand.SetBreakpoint, this.breakpoints);

        try {
            await this.protocol.sendMessage(message);
            Logger.debug(`[${this.peerType}] Breakpoints synced successfully`);
        } catch (error) {
            Logger.error(`[${this.peerType}] Failed to sync breakpoints:`, error);
            throw error;
        }
    }

    /**
     * Resume execution (Continue)
     */
    public async continue(): Promise<void> {
        Logger.debug(`[${this.peerType}] Sending Continue command`);

        const message = new DebugControlMessage(DebugControlCommand.Continue, this.breakpoints);

        try {
            await this.protocol.sendMessage(message);
            Logger.debug(`[${this.peerType}] Continue command sent successfully`);
        } catch (error) {
            Logger.error(`[${this.peerType}] Failed to send Continue command:`, error);
            throw error;
        }
    }

    /**
     * Step into function
     */
    public async stepIn(): Promise<void> {
        Logger.debug(`[${this.peerType}] Sending Step In command`);

        const message = new DebugControlMessage(DebugControlCommand.StepIn, this.breakpoints);

        try {
            await this.protocol.sendMessage(message);
            Logger.debug(`[${this.peerType}] Step In command sent successfully`);
        } catch (error) {
            Logger.error(`[${this.peerType}] Failed to send Step In command:`, error);
            throw error;
        }
    }

    /**
     * Step over function
     */
    public async stepOver(): Promise<void> {
        Logger.debug(`[${this.peerType}] Sending Step Over command`);

        const message = new DebugControlMessage(DebugControlCommand.StepOver, this.breakpoints);

        try {
            await this.protocol.sendMessage(message);
            Logger.debug(`[${this.peerType}] Step Over command sent successfully`);
        } catch (error) {
            Logger.error(`[${this.peerType}] Failed to send Step Over command:`, error);
            throw error;
        }
    }

    /**
     * Step out of function
     */
    public async stepOut(): Promise<void> {
        Logger.debug(`[${this.peerType}] Sending Step Out command`);

        const message = new DebugControlMessage(DebugControlCommand.StepOut, this.breakpoints);

        try {
            await this.protocol.sendMessage(message);
            Logger.debug(`[${this.peerType}] Step Out command sent successfully`);
        } catch (error) {
            Logger.error(`[${this.peerType}] Failed to send Step Out command:`, error);
            throw error;
        }
    }

    /**
     * Execute EnScript code in DayZ
     * 
     * @param code The EnScript code to execute
     * @param moduleName Module context for execution.
     * @returns Promise that resolves when code is sent
     */
    public async executeCode(code: string, moduleName: string = 'Mission'): Promise<void> {
        Logger.debug(`[${this.peerType}] Executing code in module '${moduleName}': ${code.substring(0, 50)}${code.length > 50 ? '...' : ''}`);

        const message = new ExecuteCodeMessage(moduleName, code);

        try {
            await this.protocol.sendMessage(message);
            Logger.debug(`[${this.peerType}] Code execution command sent successfully`);
        } catch (error) {
            Logger.error(`[${this.peerType}] Failed to send code execution command:`, error);
            throw error;
        }
    }
}
