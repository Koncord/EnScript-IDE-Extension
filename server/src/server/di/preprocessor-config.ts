/**
 * Preprocessor Configuration Service
 */

import { injectable } from 'inversify';

export interface IPreprocessorConfig {
    setDefinitions(definitions: string[]): void;
    getDefinitions(): string[];
}

/**
 * Service that holds and manages preprocessor definitions
 */
@injectable()
export class PreprocessorConfig implements IPreprocessorConfig {
    private definitions: string[] = [];

    /**
     * Set the preprocessor definitions
     */
    public setDefinitions(definitions: string[]): void {
        this.definitions = definitions;
    }

    /**
     * Get the current preprocessor definitions
     */
    public getDefinitions(): string[] {
        return this.definitions;
    }
}
