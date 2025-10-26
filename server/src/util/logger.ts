/**
 * Debug logging utility that respects parser configuration
 * 
 * Provides a wrapper around console logging that can be controlled
 * by the debug configuration setting. Supports both LSP connection
 * logging and console fallback for tests.
 */

import { ParserConfig } from '../server/ast/config.js';

// Define LSP Connection interface to avoid requiring LSP types in all contexts
interface LSPConnection {
    sendNotification(method: string, params: unknown): void;
}

/**
 * Log level enumeration
 */
export enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3
}

/**
 * LSP MessageType enumeration matching the protocol specification
 */
export enum MessageType {
    ERROR = 1,
    WARNING = 2,
    INFO = 3,
    LOG = 4
}

/**
 * Logger configuration interface
 */
export interface LoggerConfig {
    /** Whether debug logging is enabled */
    enabled: boolean;
    /** Minimum log level to output */
    level: LogLevel;
    /** Optional prefix for all log messages */
    prefix?: string;
    /** Optional LSP connection for server-to-client logging */
    connection?: LSPConnection;
}

/**
 * Static logger class that provides debug-aware logging
 * 
 * Usage:
 * ```typescript
 * import { Logger } from './util/logger.js';
 * 
 * // Configure logger with parser config
 * Logger.configure(parserConfig);
 * 
 * // Use logging methods
 * Logger.debug('Debug message');
 * Logger.info('Info message');
 * Logger.warn('Warning message');
 * Logger.error('Error message');
 * ```
 */
export class Logger {
    private static config: LoggerConfig = {
        enabled: false,
        level: LogLevel.INFO
    };
    private static manuallySetLevel: boolean = false;
    private static activeTimers: Map<string, string> = new Map();

    /**
     * Configure the logger with parser configuration
     * 
     * @param parserConfig Parser configuration containing debug settings
     * @param options Additional logger options
     */
    static configure(parserConfig: ParserConfig, options?: Partial<LoggerConfig>): void {
        const newConfig = {
            enabled: true, // Always enable logging when explicitly configured
            level: LogLevel.INFO,
            ...options
        };

        // If level was manually set via setLevel(), preserve it
        if (this.manuallySetLevel) {
            newConfig.level = this.config.level;
            // Keep enabled as true when manually configured - don't preserve old false state
            // Preserve connection if it was set
            if (this.config.connection) {
                newConfig.connection = this.config.connection;
            }
        }

        this.config = newConfig;
    }

    /**
     * Set logger configuration directly
     * 
     * @param config Logger configuration
     */
    static setConfig(config: LoggerConfig): void {
        this.config = { ...config };
    }

    /**
     * Set the LSP connection for server-to-client logging
     * 
     * @param connection LSP connection instance
     */
    static setConnection(connection: LSPConnection): void {
        this.config = {
            ...this.config,
            connection
        };
    }

    /**
     * Clear the LSP connection (useful for tests or when connection is lost)
     */
    static clearConnection(): void {
        this.config = {
            ...this.config,
            connection: undefined
        };
    }

    /**
     * Get current logger configuration
     * 
     * @returns Current logger configuration
     */
    static getConfig(): LoggerConfig {
        return { ...this.config };
    }

    /**
     * Convenience method to set just the log level (useful for tests)
     * 
     * @param level Log level as string ('error', 'warn', 'info', 'debug')
     */
    static setLevel(level: LogLevel): void {

        this.config = {
            ...this.config,
            level: level,
            enabled: true // Ensure logging is enabled when setting level
        };

        // Mark that level was manually set to preserve it across configure() calls
        this.manuallySetLevel = true;
    }

    /**
     * Clear the manual level override, allowing configure() to set levels again
     */
    static clearManualLevel(): void {
        this.manuallySetLevel = false;
    }

    /**
     * Check if logging is enabled for the specified level
     * 
     * @param level Log level to check
     * @returns True if logging is enabled for this level
     */
    private static isEnabled(level: LogLevel): boolean {
        return this.config.enabled && level <= this.config.level;
    }

    /**
     * Format log message with optional prefix
     * 
     * @param message Message to format
     * @returns Formatted message
     */
    private static formatMessage(message: string): string {
        const prefix = this.config.prefix;
        return prefix ? `[${prefix}] ${message}` : message;
    }

    /**
     * Send log message via LSP connection or fallback to console
     * 
     * @param level Log level
     * @param message Message to log
     * @param args Additional arguments
     */
    private static sendLogMessage(level: LogLevel, message: string, ...args: unknown[]): void {
        if (!this.isEnabled(level)) {
            return;
        }

        const formattedMessage = this.formatMessage(message);
        const fullMessage = args.length > 0
            ? `${formattedMessage} ${args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' ')}`
            : formattedMessage;

        // Try to use LSP connection first
        if (this.config.connection && typeof this.config.connection.sendNotification === 'function') {
            try {
                let messageType: MessageType;
                switch (level) {
                    case LogLevel.ERROR:
                        messageType = MessageType.ERROR;
                        break;
                    case LogLevel.WARN:
                        messageType = MessageType.WARNING;
                        break;
                    case LogLevel.INFO:
                        messageType = MessageType.INFO;
                        break;
                    case LogLevel.DEBUG:
                        messageType = MessageType.LOG;
                        break;
                    default:
                        messageType = MessageType.INFO;
                }

                this.config.connection.sendNotification('window/logMessage', {
                    type: messageType,
                    message: fullMessage
                });
                return;
            } catch (error) {
                // If LSP logging fails, fall back to console
                console.warn(`[Logger] Failed to send log via LSP connection, falling back to console:`, error);
            }
        }

        // Fallback to console logging
        switch (level) {
            case LogLevel.ERROR:
                console.error(fullMessage);
                break;
            case LogLevel.WARN:
                console.warn(fullMessage);
                break;
            case LogLevel.DEBUG:
                console.log(`DEBUG: ${fullMessage}`);
                break;
            default:
                console.log(fullMessage);
        }
    }

    /**
     * Log debug message
     * 
     * @param message Debug message
     * @param ...args Additional arguments to log
     */
    static debug(message: string, ...args: unknown[]): void {
        this.sendLogMessage(LogLevel.DEBUG, message, ...args);
    }

    /**
     * Log info message
     * 
     * @param message Info message
     * @param ...args Additional arguments to log
     */
    static info(message: string, ...args: unknown[]): void {
        this.sendLogMessage(LogLevel.INFO, message, ...args);
    }

    /**
     * Log warning message
     * 
     * @param message Warning message
     * @param ...args Additional arguments to log
     */
    static warn(message: string, ...args: unknown[]): void {
        this.sendLogMessage(LogLevel.WARN, message, ...args);
    }

    /**
     * Log error message
     * 
     * @param message Error message
     * @param ...args Additional arguments to log
     */
    static error(message: string, ...args: unknown[]): void {
        this.sendLogMessage(LogLevel.ERROR, message, ...args);
    }

    /**
     * Group related log messages
     * 
     * @param label Group label
     */
    static group(label: string): void {
        if (this.config.enabled) {
            console.group(this.formatMessage(label));
        }
    }

    /**
     * End log group
     */
    static groupEnd(): void {
        if (this.config.enabled) {
            console.groupEnd();
        }
    }

    /**
     * Log with timing information
     * 
     * @param label Timer label
     */
    static time(label: string): void {
        // Always format the message consistently
        const formattedLabel = this.formatMessage(label);
        
        // Store the formatted label so we can use the exact same one in timeEnd()
        // This handles cases where the prefix might change between time() and timeEnd()
        this.activeTimers.set(label, formattedLabel);
        
        // Always start the timer, regardless of enabled state
        // This ensures timeEnd() can always properly end it
        console.time(formattedLabel);
    }

    /**
     * End timer and log duration
     * 
     * @param label Timer label
     */
    static timeEnd(label: string): void {
        // Only end timer if it was started, and use the exact same formatted label
        const formattedLabel = this.activeTimers.get(label);
        if (formattedLabel) {
            console.timeEnd(formattedLabel);
            this.activeTimers.delete(label);
        }
    }

    /**
     * Conditionally execute a function only if debug logging is enabled
     * 
     * This is useful for expensive logging operations that should only
     * run when debugging is active.
     * 
     * @param fn Function to execute if debug is enabled
     */
    static debugOnly(fn: () => void): void {
        if (this.config.enabled) {
            fn();
        }
    }

    /**
     * Enable logging temporarily and restore previous state
     * 
     * @param fn Function to execute with logging enabled
     * @returns Result of the function
     */
    static withLogging<T>(fn: () => T): T {
        const previousEnabled = this.config.enabled;
        this.config.enabled = true;

        try {
            return fn();
        } finally {
            this.config.enabled = previousEnabled;
        }
    }
}

/**
 * Convenience function to create a logger instance with a specific prefix
 * 
 * @param prefix Prefix for all log messages
 * @returns Logger class configured with the prefix
 */
export function createLogger(prefix: string) {
    return {
        configure: (parserConfig: ParserConfig, options?: Partial<LoggerConfig>) =>
            Logger.configure(parserConfig, { ...options, prefix }),
        setConfig: (config: LoggerConfig) =>
            Logger.setConfig({ ...config, prefix }),
        setConnection: (connection: LSPConnection) => Logger.setConnection(connection),
        clearConnection: () => Logger.clearConnection(),
        getConfig: () => Logger.getConfig(),
        debug: (message: string, ...args: unknown[]) => Logger.debug(message, ...args),
        info: (message: string, ...args: unknown[]) => Logger.info(message, ...args),
        warn: (message: string, ...args: unknown[]) => Logger.warn(message, ...args),
        error: (message: string, ...args: unknown[]) => Logger.error(message, ...args),
        group: (label: string) => Logger.group(label),
        groupEnd: () => Logger.groupEnd(),
        time: (label: string) => Logger.time(label),
        timeEnd: (label: string) => Logger.timeEnd(label),
        debugOnly: (fn: () => void) => Logger.debugOnly(fn),
        withLogging: <T>(fn: () => T) => Logger.withLogging(fn)
    };
}
