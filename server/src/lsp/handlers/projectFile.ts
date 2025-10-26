/**
 * LSP handler for project file information
 */

import { RequestHandler } from 'vscode-languageserver';
import { IHandlerRegistration, Connection, TextDocuments, TextDocument } from './handler-interfaces';
import { inject, injectable } from 'inversify';
import { IWorkspaceManager } from '../../server/workspace/workspace-interfaces';
import { TYPES } from '../../server/di';

// Custom request type for project file information
export interface ProjectFileInfoRequest {
    method: 'enscript/projectFileInfo';
}

export interface ProjectFileInfoResponse {
    hasProjectFile: boolean;
    projectFilePath?: string;
    scriptPaths: string[];
    dependencies: string[];
    mods: Array<{
        name: string;
        dir: string;
        type: string;
        scriptModules: Array<{
            name: string;
            files: string[];
        }>;
    }>;
}

/**
 * Register project file info handler
 */
@injectable()
export class ProjectFileHandler implements IHandlerRegistration {
    constructor(
        @inject(TYPES.IWorkspaceManager) private workspaceManager: IWorkspaceManager
    ) {}
    register(connection: Connection, _documents: TextDocuments<TextDocument>): void {
        const projectFileInfoHandler: RequestHandler<void, ProjectFileInfoResponse, void> =
            async (): Promise<ProjectFileInfoResponse> => {
                // TODO: Implement proper project manager integration
                // Currently analyzer methods return unknown/stub values

                const response: ProjectFileInfoResponse = {
                    hasProjectFile: this.workspaceManager.hasProjectFile(),
                    scriptPaths: this.workspaceManager.getProjectScriptPaths(),
                    dependencies: [], // this.workspaceManager.getProjectDependencies() returns unknown[]
                    mods: []
                };

                // TODO: Implement project file parsing and mod information extraction
                // For now, return basic response without project file details

                return response;
            };

        connection.onRequest('enscript/projectFileInfo', projectFileInfoHandler);

        // Also register a refresh command
        connection.onRequest('enscript/refreshProjectFile', async (): Promise<boolean> => {
            // TODO: Implement proper project file refresh
            // this.workspaceManager.refreshProjectFile() returns unknown, not boolean
            return true; // Temporary placeholder
        });
    }
}
