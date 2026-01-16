import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getNonce } from '../util';
import { Disposable } from './dispose';
import { WebviewCollection } from './WebviewCollection';
import { ModelCfgParser, ModelCfgData } from './model-cfg-parser';


// Incoming messages (webview -> extension)
interface ReadyMessage {
    type: 'ready';
}

interface TextureRequestMessage {
    type: 'requestTexture';
    path: string;
    requestId: string;
}

interface MaterialRequestMessage {
    type: 'requestMaterial';
    path: string;
    requestId: string;
}

interface ModelCfgRequestMessage {
    type: 'requestModelCfg';
    requestId: string;
    modelName: string;
}

interface OpenFileMessage {
    type: 'openFile';
    path: string;
}

type IncomingMessages = ReadyMessage | TextureRequestMessage | MaterialRequestMessage | ModelCfgRequestMessage | OpenFileMessage;

// Incoming messages (extension -> webview)
interface InitMessage {
    type: 'init';
    data: Uint8Array;
}

type TextureResponseMessage = {
    type: 'textureResponse';
    requestId: string;
    path: string;
    data: Uint8Array;
    error?: never;
} | {
    type: 'textureResponse';
    requestId: string;
    error: string;
    path?: never;
    data?: never;
};

type MaterialResponseMessage = {
    type: 'materialResponse';
    requestId: string;
    path: string;
    content: string;
    error?: never;
} | {
    type: 'materialResponse';
    requestId: string;
    error: string;
    path?: never;
    content?: never;
};

type ModelCfgResponseMessage = {
    type: 'modelCfgResponse';
    requestId: string;
    data: ModelCfgData;
    error?: never;
} | {
    type: 'modelCfgResponse';
    requestId: string;
    error: string;
    data?: never;
};

type OutgoingMessage = InitMessage | TextureResponseMessage | MaterialResponseMessage | ModelCfgResponseMessage;

/**
 * Custom readonly editor for P3D files.
 * Displays 3D model using Three.js in a webview.
 */
export class ModelPreviewWebview implements vscode.CustomReadonlyEditorProvider<ModelDocument> {
    private static readonly viewType = 'enscript.modelPreview';

    /**
     * Tracks all known webviews
     */
    private readonly webviews = new WebviewCollection();

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new ModelPreviewWebview(context);

        const providerRegistration = vscode.window.registerCustomEditorProvider(
            ModelPreviewWebview.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true, // Keep state for 3D viewer
                },
                supportsMultipleEditorsPerDocument: false,
            }
        );

        return providerRegistration;
    }

    constructor(private readonly context: vscode.ExtensionContext) { }

    private sendMessage(panel: vscode.WebviewPanel, message: OutgoingMessage): void {
        panel.webview.postMessage(message);
    }

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<ModelDocument> {
        return await ModelDocument.create(uri);
    }

    async resolveCustomEditor(
        document: ModelDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Add the webview to our internal set of active webviews
        this.webviews.add(document.uri, webviewPanel);

        webviewPanel.webview.options = {
            enableScripts: true,
        };

        webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, webviewPanel, e));
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
        webviewPanel.webview.onDidReceiveMessage(e => {
            if (e.type === 'ready') {
                this.sendMessage(webviewPanel, { type: 'init', data: document.content });
            }
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();

        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'out', 'media', 'model-preview', 'script.js'));
        const commonStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'media', 'common.css'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'media', 'model-preview', 'style.css'));

        const htmlPath = path.join(this.context.extensionPath, 'media', 'model-preview', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        html = html.replace(/{{cspSource}}/g, webview.cspSource);
        html = html.replace(/{{cspNonce}}/g, `'nonce-${nonce}'`);
        html = html.replace(/{{nonce}}/g, nonce);
        html = html.replace(/{{scriptUri}}/g, scriptUri.toString());
        html = html.replace(/{{commonStyleUri}}/g, commonStyleUri.toString());
        html = html.replace(/{{styleUri}}/g, styleUri.toString());

        return html;
    }

    private async onMessage(document: ModelDocument, panel: vscode.WebviewPanel, message: IncomingMessages) {
        switch (message.type) {
            case 'requestTexture':
                await this.handleTextureRequest(panel, message.path, message.requestId);
                return;
            case 'requestMaterial':
                await this.handleMaterialRequest(panel, message.path, message.requestId);
                return;
            case 'requestModelCfg':
                await this.handleModelCfgRequest(panel, document.uri, message.requestId, message.modelName);
                return;
            case 'openFile':
                await this.handleOpenFile(message.path);
                return;
        }
    }

    private async handleTextureRequest(panel: vscode.WebviewPanel, texturePath: string, requestId: string): Promise<void> {
        try {
            const resolvedPath = this.resolveResourcePath(texturePath);
            if (!resolvedPath) {
                this.sendMessage(panel, {
                    type: 'textureResponse',
                    requestId,
                    error: `Texture not found: ${texturePath}`
                });
                return;
            }

            const fileBuffer = fs.readFileSync(resolvedPath);
            const uint8Array = new Uint8Array(fileBuffer);

            this.sendMessage(panel, {
                type: 'textureResponse',
                requestId,
                data: uint8Array,
                path: texturePath
            });
        } catch (error) {
            this.sendMessage(panel, {
                type: 'textureResponse',
                requestId,
                error: `Failed to load texture: ${(error as Error).message}`
            });
        }
    }

    private async handleMaterialRequest(panel: vscode.WebviewPanel, materialPath: string, requestId: string): Promise<void> {
        try {
            const resolvedPath = this.resolveResourcePath(materialPath);
            if (!resolvedPath) {
                this.sendMessage(panel, {
                    type: 'materialResponse',
                    requestId,
                    error: `Material not found: ${materialPath}`
                });
                return;
            }

            const content = fs.readFileSync(resolvedPath, 'utf-8');

            this.sendMessage(panel, {
                type: 'materialResponse',
                requestId,
                content,
                path: materialPath
            });
        } catch (error) {
            this.sendMessage(panel, {
                type: 'materialResponse',
                requestId,
                error: `Failed to load material: ${(error as Error).message}`
            });
        }
    }

    private async handleModelCfgRequest(panel: vscode.WebviewPanel, modelUri: vscode.Uri, requestId: string, modelName: string): Promise<void> {
        try {
            // Look for model.cfg in the same directory as the p3d file
            const modelDir = path.dirname(modelUri.fsPath);
            const modelCfgPath = path.join(modelDir, 'model.cfg');

            if (!fs.existsSync(modelCfgPath)) {
                this.sendMessage(panel, {
                    type: 'modelCfgResponse',
                    requestId,
                    error: `model.cfg not found in: ${modelDir}`
                });
                return;
            }

            // Parse model.cfg using ModelCfgParser and filter for the specific model
            const allData = ModelCfgParser.parse(modelCfgPath);
            
            // Find the matching model
            const model = allData.models[modelName];
            if (!model) {
                this.sendMessage(panel, {
                    type: 'modelCfgResponse',
                    requestId,
                    error: `Model "${modelName}" not found in model.cfg`
                });
                return;
            }

            // Get the skeleton for this model
            const skeleton = allData.skeletons[model.skeletonName];

            // Return only the relevant model and skeleton
            const data: ModelCfgData = {
                skeletons: skeleton ? { [model.skeletonName]: skeleton } : {},
                models: { [modelName]: model }
            };

            this.sendMessage(panel, {
                type: 'modelCfgResponse',
                requestId,
                data
            });
        } catch (error) {
            this.sendMessage(panel, {
                type: 'modelCfgResponse',
                requestId,
                error: `Failed to parse model.cfg: ${(error as Error).message}`
            });
        }
    }

    private resolveResourcePath(resourcePath: string): string | null {
        // Normalize path separators
        const normalizedPath = resourcePath.replace(/[\\/]/g, path.sep);

        for (const root of this.modRoots) {
            const fullPath = path.join(root, normalizedPath);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }

        return null;
    }

    private async handleOpenFile(filePath: string): Promise<void> {
        try {
            const resolvedPath = this.resolveResourcePath(filePath);
            if (!resolvedPath) {
                vscode.window.showWarningMessage(`File not found: ${filePath}`);
                return;
            }

            const uri = vscode.Uri.file(resolvedPath);
            await vscode.window.showTextDocument(uri, { preview: false });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${(error as Error).message}`);
        }
    }

    private get modRoots(): string[] {
        const config = vscode.workspace.getConfiguration('enscript');
        return config.get<string[]>('modRoots', ['P:\\']);
    }
}

/**
 * Document representing a P3D file.
 */
class ModelDocument extends Disposable implements vscode.CustomDocument {
    private _content: Uint8Array | undefined;

    private constructor(public readonly uri: vscode.Uri) {
        super();
    }

    static async create(uri: vscode.Uri): Promise<ModelDocument> {
        const document = new ModelDocument(uri);
        await document.load();
        return document;
    }

    private async load(): Promise<void> {
        const filePath = this.uri.fsPath;

        // Read file content
        const fileBuffer = fs.readFileSync(filePath);

        const magic = fileBuffer.toString('ascii', 0, 4);
        if (magic !== 'MLOD') {
            throw new Error('Only MLOD (editable) P3D files are supported.');
        }

        this._content = new Uint8Array(fileBuffer);
    }

    public get content(): Uint8Array {
        if (!this._content) {
            throw new Error('Document not loaded');
        }
        return this._content;
    }
}
