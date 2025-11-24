import {
    DebugSession,
    InitializedEvent,
    StoppedEvent,
    BreakpointEvent,
    OutputEvent,
    Thread,
    StackFrame,
    Scope,
    Source,
    Handles
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { TcpDebugServer } from './dap/debug-server';
import { DayZDebugAdapter, IDayZDebugListener } from './dap/dayz-debug-adapter';
import { BaseMessage, MessageType, CallstackMessage, WatchpointMessage, LogMessage, ModuleLoadMessage } from './dap/protocol/messages';
import path from 'path';
import { Logger, LogLevel } from './util/logger';
import { defaultConfig } from './server/ast/config';

// Configure Logger for DAP - logs will be sent through DAP session once set
Logger.configure(defaultConfig, {
    prefix: 'EnScript-DAP',
    enabled: true,
    level: LogLevel.DEBUG
});

/**
 * Debug adapter for EnScript (DayZ)
 */
export class EnScriptDebugSession extends DebugSession implements IDayZDebugListener {
    private static THREAD_ID = 1;
    private _variableHandles = new Handles<string>();
    private _configurationDoneResolve!: () => void;
    private _configurationDone = new Promise<void>((resolve) => {
        this._configurationDoneResolve = resolve;
    });
    private _debugServer: TcpDebugServer | undefined;
    private _abortController: AbortController | undefined;
    private _currentCallstack: any[] = [];
    private _currentWatchpoints: any[] = [];
    private _connectedPorts: Map<DayZDebugAdapter, string> = new Map();
    private _workspaceRoot: string | undefined;
    // Store breakpoints that were set before modules loaded
    private _pendingBreakpoints: Map<string, number[]> = new Map();
    // Store breakpoint objects with their IDs to send events when they become verified
    private _breakpointIdsByFile: Map<string, Map<number, number>> = new Map(); // path -> (line -> breakpoint ID)
    private _nextBreakpointId: number = 1;

    public constructor() {
        super();
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);
        Logger.setDAPSession(this);
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
     * Normalize DayZ path to absolute workspace path
     * DayZ sends paths relative to drive root: scripts/5_Mission/mission\missionserver.c
     * We need to resolve them to: P:\scripts\5_Mission\mission\missionserver.c
     */
    private resolveAbsolutePath(dayzPath: string): string {
        // Normalize slashes first
        const normalized = dayzPath.replace(/\\/g, '/');

        // Get workspace root to extract drive letter
        if (!this._workspaceRoot) {
            Logger.warn(`Cannot resolve path ${dayzPath}: no workspace root`);
            return normalized;
        }

        // Extract drive letter from workspace root
        const driveMatch = this._workspaceRoot.match(/^([a-zA-Z]:)/);
        if (!driveMatch) {
            Logger.warn(`Cannot extract drive letter from workspace root: ${this._workspaceRoot}`);
            // Fallback: join with workspace root
            return path.join(this._workspaceRoot, normalized);
        }

        const drive = driveMatch[1];
        // Join drive letter with the DayZ path
        const absolutePath = path.join(drive, '/', normalized);
        Logger.info(`Resolved DayZ path: "${dayzPath}" (drive: ${drive}) -> "${absolutePath}"`);
        return absolutePath;
    }

    async onConnectedAsync(port: DayZDebugAdapter): Promise<void> {
        Logger.info(`DayZ ${port.peerType} connected (PID: ${port.pid})`);
        this._connectedPorts.set(port, port.peerType);
    }

    async onDisconnectedAsync(port: DayZDebugAdapter): Promise<void> {
        const peerType = this._connectedPorts.get(port) || 'Unknown';
        Logger.info(`DayZ ${peerType} disconnected (PID: ${port.pid})`);
        this._connectedPorts.delete(port);
    }

    async onMessageAsync(port: DayZDebugAdapter, message: BaseMessage): Promise<void> {
        Logger.debug(`Message received: type=${MessageType[message.kind]}`);

        switch (message.kind) {
            case MessageType.Log: {
                const logMsg = message as LogMessage;
                this.sendEvent(new OutputEvent(logMsg.message + '\n', 'console'));
                break;
            }

            case MessageType.Callstack: {
                const callstackMsg = message as CallstackMessage;
                Logger.info(`Callstack received with ${callstackMsg.entries.length} frames`);

                // Convert callstack entries to the format expected by stackTraceRequest
                this._currentCallstack = callstackMsg.entries.map(entry => {
                    // Try to resolve source location
                    const location = port.resolveSourceLocation(callstackMsg.moduleAddress, entry.codePointIndex);
                    return {
                        className: entry.className || '',
                        functionName: entry.functionName || '',
                        filePath: location?.filePath ? this.resolveAbsolutePath(location.filePath) : undefined,
                        line: location?.line,
                        codePointIndex: entry.codePointIndex
                    };
                });

                // Show cursor location if available
                const firstFrame = this._currentCallstack[0];
                if (firstFrame?.filePath && firstFrame?.line) {
                    Logger.debug(`Stopped at ${firstFrame.filePath}:${firstFrame.line}`);
                } else {
                    Logger.debug(`Stopped at 0x${callstackMsg.moduleAddress.toString(16)}:${callstackMsg.codePointIndex}`);
                }

                // Trigger stopped event
                this.sendEvent(new StoppedEvent('breakpoint', EnScriptDebugSession.THREAD_ID));
                break;
            }

            case MessageType.Watchpoints: {
                const watchpointMsg = message as WatchpointMessage;
                Logger.info(`Watchpoints received: ${watchpointMsg.watchpoints.length} entries`);
                this._currentWatchpoints = watchpointMsg.watchpoints;
                break;
            }

            case MessageType.LoadModule: {
                const moduleMsg = message as ModuleLoadMessage;
                const module = moduleMsg.module;
                Logger.info(`Module loaded: 0x${module.baseAddress.toString(16)} with ${module.paths.length} files, ${module.debugPoints?.length || 0} debug points, ${module.breakPoints?.length || 0} restored breakpoints`);

                // If module has breakpoints from previous session, sync them back to DayZ
                if (module.breakPoints && module.breakPoints.length > 0 && module.debugPoints) {
                    Logger.info(`Module has ${module.breakPoints.length} restored breakpoints, syncing to DayZ`);

                    // Group breakpoints by file path for logging
                    const breakpointsByFile = new Map<string, number[]>();
                    
                    for (const bpIdx of module.breakPoints) {
                        const dp = module.debugPoints[bpIdx];
                        if (dp && dp.fileIndex < module.paths.length) {
                            const filePath = this.resolveAbsolutePath(module.paths[dp.fileIndex]);
                            if (!breakpointsByFile.has(filePath)) {
                                breakpointsByFile.set(filePath, []);
                            }
                            breakpointsByFile.get(filePath)!.push(dp.lineNumber);
                        }
                    }

                    // Log restored breakpoints
                    for (const [filePath, lines] of breakpointsByFile) {
                        Logger.info(`Restored breakpoints for ${filePath}: lines ${lines.join(', ')}`);
                    }

                    // Sync the restored breakpoints to DayZ
                    // The breakpoints are already in port's internal map (set by dayz-debug-adapter.ts)
                    // We just need to sync them
                    try {
                        await port.syncBreakpoints();
                        Logger.info(`Successfully synced ${module.breakPoints.length} restored breakpoints to DayZ`);
                    } catch (error) {
                        Logger.error(`Failed to sync restored breakpoints:`, error);
                    }
                }

                // Check if we have pending breakpoints for files in this module
                if (module.paths && module.paths.length > 0) {
                    let hasPendingBreakpoints = false;

                    for (const [pendingPath, pendingLines] of this._pendingBreakpoints) {
                        // Check if any file in the module matches this pending breakpoint path
                        const normalizedPendingPath = this.normalizePath(pendingPath);
                        const matchingPath = module.paths.find(modulePath => {
                            const normalizedModulePath = this.normalizePath(this.resolveAbsolutePath(modulePath));
                            return normalizedModulePath === normalizedPendingPath;
                        });

                        if (matchingPath) {
                            Logger.info(`Found pending breakpoints for ${pendingPath} in loaded module`);
                            const resolvedPath = this.resolveAbsolutePath(matchingPath);
                            
                            // Set breakpoints on this port
                            const results = port.setBreakpointsForFile(resolvedPath, pendingLines);
                            const verifiedCount = results.filter(bp => bp.verified).length;
                            Logger.info(`Applied ${verifiedCount}/${pendingLines.length} pending breakpoints to ${resolvedPath}`);
                            
                            // Get stored breakpoint IDs for this file
                            const lineToId = this._breakpointIdsByFile.get(pendingPath);
                            
                            if (lineToId) {
                                // Send breakpoint events to VS Code for each verified breakpoint
                                for (const result of results) {
                                    if (result.verified) {
                                        const bpId = lineToId.get(result.line);
                                        if (bpId !== undefined) {
                                            const bp: DebugProtocol.Breakpoint = {
                                                id: bpId,
                                                verified: true,
                                                line: result.line,
                                                source: { name: path.basename(pendingPath), path: pendingPath }
                                            };
                                            this.sendEvent(new BreakpointEvent('changed', bp as any));
                                            Logger.debug(`Sent breakpoint changed event for ${pendingPath}:${result.line} (id=${bpId})`);
                                        }
                                    }
                                }
                            }
                            
                            hasPendingBreakpoints = true;
                        }
                    }

                    // Sync all breakpoints if we applied any pending ones
                    if (hasPendingBreakpoints) {
                        try {
                            await port.syncBreakpoints();
                            Logger.info('Successfully synced pending breakpoints to DayZ');
                        } catch (error) {
                            Logger.error('Failed to sync pending breakpoints:', error);
                        }
                    }
                }
                break;
            }
        }
    }

    /**
     * Initialize request; VS Code asks which features the debug adapter provides
     */
    protected initializeRequest(
        response: DebugProtocol.InitializeResponse,
        _args: DebugProtocol.InitializeRequestArguments
    ): void {
        // Build and return the capabilities of this debug adapter
        response.body = response.body || {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsStepBack = false;
        response.body.supportsSetVariable = false;
        response.body.supportsRestartFrame = false;
        response.body.supportsGotoTargetsRequest = false;
        response.body.supportsStepInTargetsRequest = false;
        response.body.supportsCompletionsRequest = false;
        response.body.supportsModulesRequest = true;
        response.body.supportsBreakpointLocationsRequest = false;
        response.body.supportSuspendDebuggee = false;

        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    protected configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        _args: DebugProtocol.ConfigurationDoneArguments
    ): void {
        this._configurationDoneResolve();
        this.sendResponse(response);
    }

    protected async launchRequest(
        response: DebugProtocol.LaunchResponse,
        args: any
    ): Promise<void> {
        // Wait for configuration to be done
        await this._configurationDone;

        // Store workspace root from config
        this._workspaceRoot = args.workspaceRoot;

        try {
            const ports = args.ports || [1000, 1001];
            
            // Create and start TCP debug server directly
            this._abortController = new AbortController();
            this._debugServer = new TcpDebugServer(this, ports);
            
            // Start server in background (don't await)
            this._debugServer.startAsync(this._abortController.signal).catch(error => {
                Logger.error('Server error:', error);
            });

            Logger.info(`Debug server listening on ports ${ports.join(', ')}`);
            Logger.info('Waiting for DayZ connection...');
        } catch (error) {
            Logger.error(`Failed to start debug server: ${error}`);
        }

        this.sendResponse(response);
    }

    protected async attachRequest(
        response: DebugProtocol.AttachResponse,
        args: any
    ): Promise<void> {
        // Wait for configuration to be done
        await this._configurationDone;

        // Store workspace root from config
        this._workspaceRoot = args.workspaceRoot;

        try {
            const ports = args.ports || [1000, 1001];
            
            // Create and start TCP debug server directly
            this._abortController = new AbortController();
            this._debugServer = new TcpDebugServer(this, ports);
            
            // Start server in background (don't await)
            this._debugServer.startAsync(this._abortController.signal).catch(error => {
                Logger.error('Server error:', error);
            });

            Logger.info(`Attached to debug server on ports ${ports.join(', ')}`);
        } catch (error) {
            Logger.error(`Failed to attach to debug server: ${error}`);
        }

        this.sendResponse(response);
    }

    protected async disconnectRequest(
        response: DebugProtocol.DisconnectResponse,
        _args: DebugProtocol.DisconnectArguments
    ): Promise<void> {
        try {
            // Stop TCP debug server directly
            if (this._abortController) {
                this._abortController.abort();
            }
            if (this._debugServer) {
                this._debugServer.stop();
                this._debugServer = undefined;
            }
            Logger.info('Debug server stopped');
        } catch (error) {
            Logger.error(`Failed to stop debug server: ${error}`);
        }
        this.sendResponse(response);
    }

    protected async setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ): Promise<void> {
        const filePath = args.source.path as string;
        const clientLines = args.lines || [];

        Logger.info(`Setting breakpoints for ${filePath}: lines ${clientLines.join(', ')}`);

        try {
            if (this._connectedPorts.size === 0) {
                // No connections yet - store as pending and mark as unverified
                Logger.info('No DayZ connections yet, storing as pending breakpoints');
                this._pendingBreakpoints.set(filePath, clientLines);
                
                // Create breakpoints with IDs and store the mapping
                const lineToId = new Map<number, number>();
                const breakpoints: DebugProtocol.Breakpoint[] = clientLines.map((line) => {
                    const bpId = this._nextBreakpointId++;
                    lineToId.set(line, bpId);
                    return {
                        id: bpId,
                        verified: false,
                        line: line,
                        message: 'Waiting for DayZ connection',
                        source: { name: path.basename(filePath), path: filePath }
                    };
                });
                this._breakpointIdsByFile.set(filePath, lineToId);
                
                response.body = { breakpoints };
            } else {
                // Set breakpoints on all connected DayZ instances
                const allResults: Array<{ verified: boolean; line: number; message?: string }> = [];
                
                for (const [port, _] of this._connectedPorts) {
                    const results = port.setBreakpointsForFile(filePath, clientLines);
                    
                    // Merge results (a breakpoint is verified if ANY port verified it)
                    for (let i = 0; i < clientLines.length; i++) {
                        const existing = allResults[i];
                        const current = results[i];
                        
                        if (!existing) {
                            allResults[i] = current;
                        } else if (current.verified) {
                            allResults[i] = current; // Prefer verified
                        }
                    }
                    
                    // Sync breakpoints to DayZ
                    await port.syncBreakpoints();
                }

                response.body = { breakpoints: allResults };
                const verifiedCount = allResults.filter(bp => bp.verified).length;
                Logger.info(`Breakpoints set successfully: ${verifiedCount}/${clientLines.length} verified`);
            }
        } catch (error) {
            Logger.error(`Failed to set breakpoints:`, error);
            // Mark all breakpoints as unverified on error
            const breakpoints = clientLines.map((line) => ({
                verified: false,
                line: line,
                message: `Error: ${error}`
            }));
            response.body = { breakpoints };
        }

        this.sendResponse(response);
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        // DayZ has a single main thread
        response.body = {
            threads: [new Thread(EnScriptDebugSession.THREAD_ID, 'Main Thread')]
        };
        this.sendResponse(response);
    }

    protected stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        _args: DebugProtocol.StackTraceArguments
    ): void {
        const stackFrames: StackFrame[] = [];

        // Convert stored callstack to VSCode stack frames
        for (let i = 0; i < this._currentCallstack.length; i++) {
            const entry = this._currentCallstack[i];
            const className = entry.className.trim() || '<global>';
            const funcName = entry.functionName.trim() || '<unknown>';
            const name = className === '<global>' ? funcName : `${className}.${funcName}`;

            // Create source reference if we have file/line info
            let source: Source | undefined;
            let line = 0;
            let column = 0;

            if (entry.filePath && entry.line) {
                source = new Source(
                    entry.filePath.split(/[\\/]/).pop() || entry.filePath, // just filename for display
                    entry.filePath // full path
                );
                line = entry.line;
                column = 0;
            }

            stackFrames.push(new StackFrame(
                i,
                name,
                source,
                line,
                column
            ));
        }

        response.body = {
            stackFrames: stackFrames,
            totalFrames: stackFrames.length
        };
        this.sendResponse(response);
    }

    protected scopesRequest(
        response: DebugProtocol.ScopesResponse,
        _args: DebugProtocol.ScopesArguments
    ): void {
        response.body = {
            scopes: [
                new Scope('Local', this._variableHandles.create('local'), false)
            ]
        };
        this.sendResponse(response);
    }

    protected variablesRequest(
        response: DebugProtocol.VariablesResponse,
        _args: DebugProtocol.VariablesArguments
    ): void {
        const variablesMap = new Map<string, DebugProtocol.Variable>();

        // Convert watchpoints to variables and deduplicate by name
        for (const wp of this._currentWatchpoints) {
            // Parse display value (format: "type varname = value")
            const displayValue = wp.DisplayValue || '';
            const parts = displayValue.split('=');

            let name = `var_${wp.Number}`;
            let value = displayValue;
            let type = '';

            if (parts.length >= 2) {
                // Left side contains "type varname", right side contains value
                const leftSide = parts[0].trim();
                const rightSide = parts.slice(1).join('=').trim();
                
                // Split left side to get type and variable name
                const leftParts = leftSide.split(/\s+/);
                if (leftParts.length >= 2) {
                    type = leftParts[0];
                    name = leftParts.slice(1).join(' ');
                    value = rightSide;
                } else {
                    // Fallback if no type found
                    name = leftSide;
                    value = rightSide;
                }
            }

            // Deduplicate: only keep the first occurrence of each variable name
            if (!variablesMap.has(name)) {
                variablesMap.set(name, {
                    name: name,
                    type: type || undefined,
                    value: value,
                    variablesReference: 0
                });
            }
        }

        response.body = {
            variables: Array.from(variablesMap.values())
        };
        this.sendResponse(response);
    }

    protected async continueRequest(
        response: DebugProtocol.ContinueResponse,
        _args: DebugProtocol.ContinueArguments
    ): Promise<void> {
        try {
            for (const [port, _] of this._connectedPorts) {
                await port.continue();
            }
        } catch (error) {
            Logger.error('Failed to send Continue command:', error);
        }
        this.sendResponse(response);
    }

    protected async nextRequest(
        response: DebugProtocol.NextResponse,
        _args: DebugProtocol.NextArguments
    ): Promise<void> {
        try {
            for (const [port, _] of this._connectedPorts) {
                await port.stepOver();
            }
        } catch (error) {
            Logger.error('Failed to send Step Over command:', error);
        }
        this.sendResponse(response);
    }

    protected async stepInRequest(
        response: DebugProtocol.StepInResponse,
        _args: DebugProtocol.StepInArguments
    ): Promise<void> {
        try {
            for (const [port, _] of this._connectedPorts) {
                await port.stepIn();
            }
        } catch (error) {
            Logger.error('Failed to send Step In command:', error);
        }
        this.sendResponse(response);
    }

    protected async stepOutRequest(
        response: DebugProtocol.StepOutResponse,
        _args: DebugProtocol.StepOutArguments
    ): Promise<void> {
        try {
            for (const [port, _] of this._connectedPorts) {
                await port.stepOut();
            }
        } catch (error) {
            Logger.error('Failed to send Step Out command:', error);
        }
        this.sendResponse(response);
    }

    protected async customRequest(
        command: string,
        response: DebugProtocol.Response,
        args: any
    ): Promise<void> {
        if (command === 'executeReplCode') {
            await this.handleReplExecution(response, args);
        } else {
            super.customRequest(command, response, args);
        }
    }

    private async handleReplExecution(
        response: DebugProtocol.Response,
        args: { code: string; module: string }
    ): Promise<void> {
        Logger.info(`REPL execution requested: module=${args.module}, code length=${args.code.length}`);

        try {
            if (this._connectedPorts.size === 0) {
                response.success = false;
                response.message = 'No DayZ connection';
                this.sendResponse(response);
                return;
            }

            const code = args.code;
            const module = args.module || 'Mission';

            // Execute code on all connected ports
            for (const [port, _] of this._connectedPorts) {
                await port.executeCode(code, module);
            }

            response.success = true;
            response.body = {
                result: `Executed on ${module}`,
                module: module,
                code: code
            };

            // Send output event to debug console as well
            this.sendEvent(new OutputEvent(
                `[REPL] [${module}] ${code}\n`,
                'console'
            ));

            Logger.info(`REPL execution completed successfully on ${module}`);
        } catch (error) {
            Logger.error('REPL execution failed:', error);
            response.success = false;
            response.message = `Error: ${error}`;
        }

        this.sendResponse(response);
    }

    protected async evaluateRequest(
        response: DebugProtocol.EvaluateResponse,
        args: DebugProtocol.EvaluateArguments
    ): Promise<void> {
        Logger.info(`Evaluate requested: "${args.expression}" (context: ${args.context})`);

        try {
            // For watch/hover, try to find the variable in current watchpoints
            if (args.context === 'watch' || args.context === 'hover') {
                // Search for the variable in watchpoints
                for (const wp of this._currentWatchpoints) {
                    const displayValue = wp.DisplayValue || '';
                    const parts = displayValue.split('=');
                    
                    if (parts.length >= 2) {
                        // Parse "type varname = value" format
                        const leftSide = parts[0].trim();
                        const varValue = parts.slice(1).join('=').trim();
                        
                        // Extract variable name (after type declaration)
                        const leftParts = leftSide.split(/\s+/);
                        const varName = leftParts.length >= 2 ? leftParts.slice(1).join(' ') : leftSide;
                        
                        if (varName === args.expression) {
                            response.body = {
                                result: varValue,
                                variablesReference: 0
                            };
                            this.sendResponse(response);
                            return;
                        }
                    }
                }
                
                // Variable not found in watchpoints
                response.body = {
                    result: 'not available',
                    variablesReference: 0
                };
            } 
            // For REPL, execute the code in DayZ
            else if (args.context === 'repl') {
                if (this._connectedPorts.size === 0) {
                    response.body = {
                        result: 'Error: No DayZ connection',
                        variablesReference: 0
                    };
                } else {
                    // Execute code on all connected ports
                    const code = args.expression;
                    
                    for (const [port, _] of this._connectedPorts) {
                        await port.executeCode(code);
                    }

                    // Note: Results appear in DayZ console
                    response.body = {
                        result: `Executed: ${args.expression}`,
                        variablesReference: 0
                    };
                }
            } 
            else {
                // Unknown context
                response.body = {
                    result: 'not available',
                    variablesReference: 0
                };
            }
        } catch (error) {
            Logger.error('Failed to evaluate expression:', error);
            response.body = {
                result: `Error: ${error}`,
                variablesReference: 0
            };
        }

        this.sendResponse(response);
    }

    /**
     * Send output from DayZ to the debug console
     */
    public sendOutput(message: string, category: 'console' | 'stdout' | 'stderr' = 'console'): void {
        this.sendEvent(new OutputEvent(message + '\n', category));
    }
}

// Start the debug adapter (run as stdio server)
EnScriptDebugSession.run(EnScriptDebugSession);
