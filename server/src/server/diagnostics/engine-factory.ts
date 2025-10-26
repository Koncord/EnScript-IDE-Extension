/**
 * Diagnostic Engine Factory
 * 
 * Factory for creating diagnostic engine instances with DI support.
 */

import { injectable } from 'inversify';
import { DiagnosticEngine } from './engine';
import {
    IDiagnosticEngine,
    IDiagnosticEngineFactory,
    DiagnosticEngineOptions
} from './engine-interfaces';

/**
 * Factory for creating diagnostic engines
 */
@injectable()
export class DiagnosticEngineFactory implements IDiagnosticEngineFactory {
    /**
     * Create a new diagnostic engine with the given options
     */
    create(options?: DiagnosticEngineOptions): IDiagnosticEngine {
        return new DiagnosticEngine(options);
    }
}
