import { Hover, HoverParams, MarkupKind, Diagnostic } from 'vscode-languageserver';
import { Logger } from '../../util/logger';
import { diagnosticsCache } from '../../server/cache';
import { DiagnosticRule } from '../../server/diagnostics/rules';
import { IHandlerRegistration, Connection, TextDocuments, TextDocument } from './handler-interfaces';
import { inject, injectable } from 'inversify';
import { IDiagnosticsProvider, TYPES } from '../../server/di';
import { ISymbolOperations } from '../../server/symbols/symbol-operations-interfaces';
import { IDocumentCacheManager } from '../../server/cache/document-cache-interfaces';
import { IIndexerService } from '../services/IIndexerService';
import { SERVICE_TYPES } from '../services/service-types';

@injectable()
export class HoverHandler implements IHandlerRegistration {
    constructor(
        @inject(TYPES.IDiagnosticsProvider) private diagnosticsProvider: IDiagnosticsProvider,
        @inject(TYPES.ISymbolOperations) private symbolOperations: ISymbolOperations,
        @inject(TYPES.IDocumentCacheManager) private documentCacheManager: IDocumentCacheManager,
        @inject(SERVICE_TYPES.IIndexerService) private indexerService: IIndexerService
    ) { }
    register(connection: Connection, documents: TextDocuments<TextDocument>): void {
        connection.onHover(async (params: HoverParams): Promise<Hover | null> => {
            Logger.debug(`🔍 Hover request for ${params.textDocument.uri} at ${params.position.line}:${params.position.character}`);

            try {
                // Wait for indexing to complete before processing hover requests
                await this.indexerService.waitForIndexingToComplete();

                const doc = documents.get(params.textDocument.uri);
                if (!doc) {
                    Logger.warn(`Document not found for hover: ${params.textDocument.uri}`);
                    return null;
                }

                // Ensure the document is analyzed first
                Logger.debug(`Ensuring document is analyzed...`);
                this.documentCacheManager.ensureDocumentParsed(doc);

                // First, try to get regular hover info (symbol information)
                Logger.debug(`Getting hover info from analyzer...`);
                const symbolInfo = await this.symbolOperations.getHover(doc, params.position);

                // Also check if there's a diagnostic at this position
                let diagnosticInfo = '';

                if (this.diagnosticsProvider) {
                    try {
                        Logger.debug(`Getting cached diagnostics for hover...`);
                        // Use getCachedDiagnosticsOnly to avoid triggering diagnostics on every hover
                        const diagnostics = diagnosticsCache.getCachedDiagnosticsOnly(doc) as Diagnostic[];
                        if (diagnostics.length > 0) {
                            Logger.debug(`Found ${diagnostics.length} cached diagnostics`);

                            // Find diagnostics that cover the hover position
                            const relevantDiagnostics = diagnostics.filter((diag: Diagnostic) =>
                                positionInRange(params.position, diag.range)
                            );

                            Logger.debug(`Found ${relevantDiagnostics.length} relevant diagnostics`);

                            if (relevantDiagnostics.length > 0) {
                                const diagnostic = relevantDiagnostics[0];
                                Logger.debug(`Diagnostic code: ${diagnostic.code}`);

                                // Find the rule that created this diagnostic
                                const rules = (this.diagnosticsProvider as unknown as { getAllRules?(): DiagnosticRule[] }).getAllRules?.() || [];
                                const rule = rules.find((r: DiagnosticRule) => r.id === diagnostic.code);

                                if (rule && rule.getDocumentation) {
                                    diagnosticInfo = `\n\n---\n\n**${rule.name || 'Diagnostic Rule'}**\n\n${rule.getDocumentation()}`;
                                    Logger.debug(`Added diagnostic info from rule: ${rule.name}`);
                                } else if (diagnostic.message) {
                                    // Fallback: show diagnostic message if no rule documentation
                                    diagnosticInfo = `\n\n---\n\n**Diagnostic**\n\n${diagnostic.message}`;
                                }
                            }
                        }
                    } catch (error) {
                        Logger.warn('Error getting diagnostic documentation for hover:', error);
                    }
                } else {
                    Logger.debug('No diagnostics provider available');
                }

                // If we have diagnostic info but no symbol info, still show something useful
                if (diagnosticInfo.trim() && !symbolInfo) {
                    Logger.debug('Showing diagnostic-only hover');
                    return {
                        contents: { kind: MarkupKind.Markdown, value: diagnosticInfo }
                    };
                }

                // Combine symbol info and diagnostic info
                const combinedInfo = (symbolInfo || '') + diagnosticInfo;

                if (!combinedInfo.trim()) {
                    return null; // Nothing to show
                }

                return {
                    contents: { kind: MarkupKind.Markdown, value: combinedInfo }
                };
            } catch (error) {
                Logger.error('Error in hover handler:', error);
                return null;
            }
        });
    }
}

function positionInRange(position: { line: number; character: number }, range: { start: { line: number; character: number }; end: { line: number; character: number } }): boolean {
    const { start, end } = range;

    if (position.line < start.line || position.line > end.line) {
        return false;
    }

    if (position.line === start.line && position.character < start.character) {
        return false;
    }

    if (position.line === end.line && position.character > end.character) {
        return false;
    }

    return true;
}

