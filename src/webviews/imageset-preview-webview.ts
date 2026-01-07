import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Edds } from '@bis-toolkit/edds';
import { getNonce } from '../util';

// Type for parsed ImageSet data
interface ImageSetData {
    name: string;
    refSize: { width: number; height: number };
    textures: Array<{ mpix: number; path: string }>;
    images: Array<{
        name: string;
        pos: { x: number; y: number };
        size: { width: number; height: number };
        flags: number;
    }>;
    groups: unknown[];
}

/**
 * Provider for ImageSet preview.
 * Provides a custom text editor for .imageset files showing the texture with overlaid image regions.
 * 
 * This demonstrates:
 * - Setting up a custom text editor for text-based files
 * - Synchronizing changes between the text document and custom webview
 * - Loading and displaying external texture resources
 */
export class ImageSetPreviewProvider implements vscode.CustomTextEditorProvider {
    private static readonly viewType = 'enscript.imagesetPreview';

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new ImageSetPreviewProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            ImageSetPreviewProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: false,
                },
            }
        );
        return providerRegistration;
    }

    constructor(private readonly context: vscode.ExtensionContext) { }

    /**
     * Called when a custom text editor is opened.
     */
    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };

        // Set up message handling
        webviewPanel.webview.onDidReceiveMessage(async e => {
            if (e.type === 'ready') {
                await this.updateWebviewData(document.uri, webviewPanel);
            }
        });

        // Update webview content based on document
        const updateWebviewData = async () => {
            await this.updateWebviewData(document.uri, webviewPanel);
        };

        // Hook up event handlers to synchronize the webview with the text document
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                updateWebviewData();
            }
        });

        // Make sure we dispose the listener when the editor is closed
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });

        // Set initial HTML (static template)
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
    }

    private async updateWebviewData(uri: vscode.Uri, webviewPanel: vscode.WebviewPanel): Promise<void> {
        try {
            const imageSetData = await this.parseImageSet(uri);
            if (!imageSetData) {
                this.postMessage(webviewPanel, 'error', 'Failed to parse .imageset file');
                return;
            }

            let textureData: string | null = null;
            if (imageSetData.textures.length > 0) {
                textureData = await this.loadTexture(uri, imageSetData.textures[0].path);
            }

            const dataWithTexture = {
                ...imageSetData,
                textureData: textureData
            };

            this.postMessage(webviewPanel, 'init', dataWithTexture);
        } catch (error) {
            this.postMessage(webviewPanel, 'error', `Error: ${error}`);
        }
    }

    private postMessage(panel: vscode.WebviewPanel, type: string, body: unknown): void {
        panel.webview.postMessage({ type, body });
    }

    private async parseImageSet(uri: vscode.Uri): Promise<ImageSetData | null> {
        try {
            // Import parser - use require for dynamic path loading
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const parser = require(path.join(this.context.extensionPath, 'out', 'cli.js'));
            return parser.parseImageSet(uri.fsPath) as ImageSetData | null;
        } catch (error) {
            console.error('Error parsing imageset:', error);
            return null;
        }
    }

    private async loadTexture(imageSetUri: vscode.Uri, texturePath: string): Promise<string | null> {
        try {
            // Remove GUID prefix if present: {GUID}path/to/file.edds
            const cleanPath = texturePath.replace(/^\{[^}]+\}/, '');
            // Normalize path separators
            const normalizedPath = cleanPath.replace(/\//g, path.sep);

            let fullTexturePath: string | null = null;

            // Strategy 1: Try configured mod roots (PRIMARY)
            const config = vscode.workspace.getConfiguration('enscript');
            const modRoots = config.get<string[]>('modRoots', ['P:\\']);
            console.log('[ImageSet] Configured mod roots:', modRoots);

            for (const modRoot of modRoots) {
                const modRootPath = path.join(modRoot, normalizedPath);
                console.log('[ImageSet] Trying mod root path:', modRootPath);
                if (fs.existsSync(modRootPath)) {
                    fullTexturePath = modRootPath;
                    console.log('[ImageSet] Found texture at mod root path');
                    break;
                }
            }

            // Strategy 2: Resolve from workspace/mod root
            if (!fullTexturePath) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(imageSetUri);
                if (workspaceFolder) {
                    const modRootPath = path.join(workspaceFolder.uri.fsPath, normalizedPath);
                    console.log('[ImageSet] Trying workspace path:', modRootPath);
                    if (fs.existsSync(modRootPath)) {
                        fullTexturePath = modRootPath;
                        console.log('[ImageSet] Found texture at workspace path');
                    }
                }
            }

            // Strategy 3: Try relative to imageset file
            if (!fullTexturePath) {
                const imageSetDir = path.dirname(imageSetUri.fsPath);
                const relativePath = path.resolve(imageSetDir, normalizedPath);
                console.log('[ImageSet] Trying relative path:', relativePath);
                if (fs.existsSync(relativePath)) {
                    fullTexturePath = relativePath;
                    console.log('[ImageSet] Found texture at relative path');
                }
            }

            if (!fullTexturePath) {
                console.log('[ImageSet] Texture not found after trying all strategies');
                return null;
            }

            const fileBuffer = fs.readFileSync(fullTexturePath);
            const edds = new Edds();
            edds.read(fileBuffer);
            if (edds.mipmaps.length > 0) {
                const rgba = edds.getRgbaPixelData(0); // Get first mipmap
                return this.rgbaToPngBase64(rgba);
            }

            return null;
        } catch (error) {
            console.error('Error loading texture:', error);
            return null;
        }
    }

    private rgbaToPngBase64(rgba: Uint8Array): string {
        // Send raw RGBA data as base64 - will be converted to ImageData on client side
        return Buffer.from(rgba).toString('base64');
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();

        // Get URIs for resources
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'media', 'imageset-preview', 'script.js'));
        const commonStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'media', 'common.css'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'media', 'imageset-preview', 'style.css'));

        // Load HTML template
        const htmlPath = path.join(this.context.extensionPath, 'media', 'imageset-preview', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        // Replace placeholders
        html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
        html = html.replace(/\{\{cspNonce\}\}/g, `'nonce-${nonce}'`);
        html = html.replace(/\{\{nonce\}\}/g, nonce);
        html = html.replace(/\{\{scriptUri\}\}/g, scriptUri.toString());
        html = html.replace(/\{\{commonStyleUri\}\}/g, commonStyleUri.toString());
        html = html.replace(/\{\{styleUri\}\}/g, styleUri.toString());

        return html;
    }

}
