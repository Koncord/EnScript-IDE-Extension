/**
 * Dependency Injection Tokens for LSP Services
 * 
 * Symbols for injecting LSP service dependencies.
 */

export const SERVICE_TYPES = {
    IIndexerService: Symbol.for('IIndexerService'),
    INotificationService: Symbol.for('INotificationService')
};
