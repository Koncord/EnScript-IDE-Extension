/**
 * Basic C-style preprocessor for CFG files
 * Handles #define, #ifdef, #ifndef, #else, #endif, #include
 * Complex macros currently not supported
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface PreprocessorOptions {
    defines?: Map<string, string>;
    includePaths?: string[];
}

export class Preprocessor {
    private defines: Map<string, string>;
    private conditionStack: boolean[];
    private skipLines: boolean;
    private processedFiles: Set<string>;
    private includePaths: string[];

    constructor(options: PreprocessorOptions = {}) {
        this.defines = new Map(options.defines || []);
        this.conditionStack = [];
        this.skipLines = false;
        this.processedFiles = new Set();
        this.includePaths = options.includePaths || [];
    }

    public preprocess(filePath: string): string {
        const input = readFileSync(filePath, 'utf8');
        const lines = input.split('\n');
        const output: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (line.startsWith('#')) {
                const directive = this.parseDirective(line);
                if (!directive) {
                    // Invalid directive, treat as comment
                    continue;
                }

                this.processDirective(directive, output, filePath);
            } else {
                if (!this.skipLines) {
                    // Apply defines
                    let processedLine = line;
                    for (const [key, value] of this.defines) {
                        processedLine = processedLine.replace(new RegExp(`\\b${key}\\b`, 'g'), value);
                    }
                    output.push(processedLine);
                }
            }
        }

        return output.join('\n');
    }

    private processDirective(directive: Directive, output: string[], currentFile: string): void {
        switch (directive.type) {
            case 'define':
                if (!this.skipLines) {
                    this.defines.set(directive.name!, directive.value || '');
                }
                break;
            case 'undef':
                if (!this.skipLines) {
                    this.defines.delete(directive.name!);
                }
                break;
            case 'ifdef':
                this.conditionStack.push(this.skipLines);
                this.skipLines = this.skipLines || !this.defines.has(directive.name!);
                break;

            case 'ifndef':
                this.conditionStack.push(this.skipLines);
                this.skipLines = this.skipLines || this.defines.has(directive.name!);
                break;

            case 'else':
                if (this.conditionStack.length > 0) {
                    this.skipLines = !this.skipLines;
                }
                break;

            case 'endif':
                if (this.conditionStack.length > 0) {
                    this.skipLines = this.conditionStack.pop()!;
                }
                break;

            case 'include':
                if (!this.skipLines && directive.file) {
                    const fullPath = currentFile ? resolve(currentFile, '..', directive.file) : directive.file;
                    if (this.processedFiles.has(fullPath)) {
                        console.warn(`Recursive include detected for ${directive.file}, skipping`);
                    } else {
                        try {
                            this.processedFiles.add(fullPath);
                            const includedContent = this.loadAndPreprocessFile(directive.file, currentFile);
                            output.push(includedContent);
                        } catch (error) {
                            // For now, ignore include errors
                            console.warn(`Failed to include ${directive.file}: ${error}`);
                        }
                    }
                }
                break;

            default:
                // Unknown directive, skip
                break;
        }
    }

    private parseDirective(line: string): Directive | null {
        const parts = line.split(/\s+/);
        if (parts.length === 0) return null;

        const type = parts[0].substring(1); // Remove #

        switch (type) {
            case 'define':
                if (parts.length >= 2) {
                    const name = parts[1];
                    const value = parts.slice(2).join(' ');
                    return { type: 'define', name, value };
                }
                break;
            case 'undef':
                if (parts.length >= 2) {
                    return { type: 'undef', name: parts[1] };
                }
                break;
            case 'ifdef':
            case 'ifndef':
                if (parts.length >= 2) {
                    return { type, name: parts[1] };
                }
                break;

            case 'else':
                return { type: 'else' };

            case 'endif':
                return { type: 'endif' };

            case 'include':
                // Parse #include "file" or #include <file>
                const includeMatch = line.match(/^#include\s+["<]([^">]+)[">]$/);
                if (includeMatch) {
                    const file = includeMatch[1];
                    const isQuoted = line.includes('"');
                    if (isQuoted) {
                        return { type: 'include', file };
                    }
                    // Skip angle bracket includes
                }
                break;
        }

        return null;
    }

    private loadAndPreprocessFile(includePath: string, currentFile: string): string {
        let fullPath: string;

        if (currentFile) {
            // Resolve relative to current file
            fullPath = resolve(currentFile, '..', includePath);
        } else {
            // Use include paths or current directory
            fullPath = includePath;
            for (const includePath of this.includePaths) {
                const candidate = resolve(includePath, includePath);
                try {
                    readFileSync(candidate, 'utf8');
                    fullPath = candidate;
                    break;
                } catch {
                    // Continue
                }
            }
        }

        return this.preprocess(fullPath);
    }
}

interface Directive {
    type: 'define' | 'undef' | 'ifdef' | 'ifndef' | 'else' | 'endif' | 'include';
    name?: string;
    value?: string;
    file?: string;
}
