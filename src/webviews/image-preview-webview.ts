import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Paa } from '@bis-toolkit/paa';
import { Edds } from '@bis-toolkit/edds';
import { getNonce } from '../util';
import { Disposable } from './dispose';

/**
 * Custom readonly editor for PAA and EDDS files.
 * Converts them to BMP format and displays using a webview with image.
 */
export class ImagePreviewWebview implements vscode.CustomReadonlyEditorProvider<ImageDocument> {
    private static readonly viewType = 'enscript.imagePreview';

    /**
     * Tracks all known webviews
     */
    private readonly webviews = new WebviewCollection();

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new ImagePreviewWebview(context);
        
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            ImagePreviewWebview.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: false, // Avoid using this unless absolutely necessary
                },
                supportsMultipleEditorsPerDocument: true,
            }
        );

        return providerRegistration;
    }

    constructor(private readonly context: vscode.ExtensionContext) {}

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<ImageDocument> {
        return await ImageDocument.create(uri);
    }

    async resolveCustomEditor(
        document: ImageDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Add the webview to our internal set of active webviews
        this.webviews.add(document.uri, webviewPanel);

        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };

        // Set up message handling
        webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, webviewPanel, e));

        // Set initial HTML
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
        
        // Wait for the webview to be properly ready before sending data
        webviewPanel.webview.onDidReceiveMessage(e => {
            if (e.type === 'ready') {
                this.postMessage(webviewPanel, 'init', {
                    filename: path.basename(document.uri.fsPath),
                    mipmaps: document.mipmaps.map(mip => ({
                        width: mip.width,
                        height: mip.height,
                        rgba: mip.rgba
                    }))
                });
            }
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();
        
        // Get URIs for resources
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'out', 'media', 'image-preview', 'script.js'));
        const commonStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'media', 'common.css'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'media', 'image-preview', 'style.css'));
        
        // Load HTML template
        const htmlPath = path.join(this.context.extensionPath, 'media', 'image-preview', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        
        // Replace placeholders
        html = html.replace(/{{cspSource}}/g, webview.cspSource);
        html = html.replace(/{{cspNonce}}/g, `'nonce-${nonce}'`);
        html = html.replace(/{{nonce}}/g, nonce);
        html = html.replace(/{{scriptUri}}/g, scriptUri.toString());
        html = html.replace(/{{commonStyleUri}}/g, commonStyleUri.toString());
        html = html.replace(/{{styleUri}}/g, styleUri.toString());
        
        return html;
    }

    /**
     * Post a message to a webview.
     */
    private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
        panel.webview.postMessage({ type, body });
    }

    /**
     * Handle messages from the webview.
     */
    private onMessage(document: ImageDocument, panel: vscode.WebviewPanel, message: any) {
        switch (message.type) {
            case 'log':
                // Handle logging from webview for debugging
                console.log('[ImagePreview Webview]', message.body);
                return;
        }
    }
}

/**
 * Document representing an image file (PAA or EDDS).
 * Handles loading and storing mipmap data from the file.
 */
class ImageDocument extends Disposable implements vscode.CustomDocument {
    private _mipmaps: Array<{ width: number; height: number; rgba: Uint8Array }> | undefined;

    private constructor(public readonly uri: vscode.Uri) {
        super();
    }

    static async create(uri: vscode.Uri): Promise<ImageDocument> {
        const document = new ImageDocument(uri);
        await document.load();
        return document;
    }

    private async load(): Promise<void> {
        const filePath = this.uri.fsPath;
        const ext = path.extname(filePath).toLowerCase();
        const fileBuffer = fs.readFileSync(filePath);

        const mipmaps: Array<{ width: number; height: number; rgba: Uint8Array }> = [];

        if (ext === '.paa') {
            const paa = new Paa();
            paa.read(fileBuffer);
            
            if (paa.mipmaps.length === 0) {
                throw new Error('PAA file has no mipmaps');
            }
            
            // Load all mipmap levels
            for (let i = 0; i < paa.mipmaps.length; i++) {
                const mipmap = paa.mipmaps[i];
                const argb = paa.getArgb32PixelData(fileBuffer, i);
                const rgba = this.argbToRgba(argb, mipmap.width, mipmap.height);
                mipmaps.push({
                    width: mipmap.width,
                    height: mipmap.height,
                    rgba
                });
            }
        } else if (ext === '.edds') {
            const edds = new Edds();
            edds.read(fileBuffer);
            
            // Load all mipmap levels
            for (let i = 0; i < edds.mipmaps.length; i++) {
                const rgba = edds.getRgbaPixelData(i);
                const mipmap = edds.mipmaps[i];
                mipmaps.push({
                    width: mipmap.width,
                    height: mipmap.height,
                    rgba
                });
            }
        } else {
            throw new Error(`Unsupported file format: ${ext}`);
        }

        this._mipmaps = mipmaps;
    }

    public get mipmaps(): Array<{ width: number; height: number; rgba: Uint8Array }> {
        if (!this._mipmaps) {
            throw new Error('Document not loaded');
        }
        return this._mipmaps;
    }

    private argbToRgba(argb: Uint8Array, width: number, height: number): Uint8Array {
        const rgba = new Uint8Array(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            const srcIdx = i * 4;
            const dstIdx = i * 4;
            rgba[dstIdx + 0] = argb[srcIdx + 2]; // R
            rgba[dstIdx + 1] = argb[srcIdx + 1]; // G
            rgba[dstIdx + 2] = argb[srcIdx + 0]; // B
            rgba[dstIdx + 3] = argb[srcIdx + 3]; // A
        }
        return rgba;
    }
}

/**
 * Tracks all webviews for image preview.
 */
class WebviewCollection {
    private readonly _webviews = new Set<{
        readonly resource: string;
        readonly webviewPanel: vscode.WebviewPanel;
    }>();

    /**
     * Get all known webviews for a given uri.
     */
    public *get(uri: vscode.Uri): Iterable<vscode.WebviewPanel> {
        const key = uri.toString();
        for (const entry of this._webviews) {
            if (entry.resource === key) {
                yield entry.webviewPanel;
            }
        }
    }

    /**
     * Add a new webview to the collection.
     */
    public add(uri: vscode.Uri, webviewPanel: vscode.WebviewPanel) {
        const entry = { resource: uri.toString(), webviewPanel };
        this._webviews.add(entry);

        webviewPanel.onDidDispose(() => {
            this._webviews.delete(entry);
        });
    }
}
