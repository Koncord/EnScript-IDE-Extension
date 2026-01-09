import type { WebviewApi } from 'vscode-webview';
import { RvMat } from './Rv/RvMat';
import { RvTexture } from './Rv/RvTexture';
import * as THREE from 'three';

// Outgoing messages (webview -> extension)
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

interface OpenFileMessage {
    type: 'openFile';
    path: string;
}

type OutgoingMessage = ReadyMessage | TextureRequestMessage | MaterialRequestMessage | OpenFileMessage;

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

type IncomingMessage = InitMessage | TextureResponseMessage | MaterialResponseMessage;

/**
 * Handles communication with VSCode extension host for loading Model resources
 */
export class ResourceLoader {
    private loadedDiffuseTextures: Map<string, THREE.Texture> = new Map();
    private loadedRvTextures: Map<string, RvTexture> = new Map();
    private loadedMaterials: Map<string, RvMat> = new Map();
    private pendingRequests: Map<string, () => void> = new Map();
    private requestIdCounter = 0;

    constructor(
        private readonly vscode: WebviewApi<void>
    ) {
        this.setupMessageListener();
    }

    /**
     * Send ready message to extension
     */
    sendReady(): void {
        this.sendMessage({ type: 'ready' });
    }

    /**
     * Request to open a file in the editor
     */
    openFile(path: string): void {
        this.sendMessage({ type: 'openFile', path });
    }

    /**
     * Get loaded RvTextures (all PAA textures, including diffuse)
     */
    getRvTextures(): Map<string, RvTexture> {
        return this.loadedRvTextures;
    }

    /**
     * Get loaded diffuse textures (from LOD face textures)
     */
    getDiffuseTextures(): Map<string, THREE.Texture> {
        return this.loadedDiffuseTextures;
    }

    /**
     * Get loaded materials
     */
    getMaterials(): Map<string, RvMat> {
        return this.loadedMaterials;
    }

    /**
     * Request texture from extension
     */
    requestTexture(texturePath: string): Promise<void> {
        return new Promise((resolve) => {
            const requestId = `texture_${this.requestIdCounter++}`;
            this.pendingRequests.set(requestId, resolve);

            this.sendMessage({
                type: 'requestTexture',
                path: texturePath,
                requestId
            });

            this.waitResource(requestId, resolve, 3000);
        });
    }

    /**
     * Request material from extension
     */
    requestMaterial(materialPath: string): Promise<void> {
        return new Promise((resolve) => {
            const requestId = `material_${this.requestIdCounter++}`;
            this.pendingRequests.set(requestId, resolve);

            console.log('Requesting material:', materialPath);
            this.sendMessage({
                type: 'requestMaterial',
                path: materialPath,
                requestId
            });

            this.waitResource(requestId, resolve, 3000);
        });
    }

    private waitResource(requestId: string, resolve: () => void, timeout: number = 3000): void {
        setTimeout(() => {
            if (this.pendingRequests.has(requestId)) {
                this.pendingRequests.delete(requestId);
                resolve();
            }
        }, timeout);
    }

    private sendMessage(message: OutgoingMessage): void {
        this.vscode.postMessage(message);
    }

    private setupMessageListener(): void {
        window.addEventListener('message', (event: MessageEvent<IncomingMessage>) => {
            const message = event.data;
            switch (message.type) {
                case 'textureResponse':
                    this.handleTextureResponse(message);
                    break;
                case 'materialResponse':
                    this.handleMaterialResponse(message);
                    break;
            }
        });
    }

    private handleTextureResponse(message: TextureResponseMessage): void {
        const resolver = this.pendingRequests.get(message.requestId);
        if (resolver) {
            this.pendingRequests.delete(message.requestId);

            if (message.error) {
                console.warn('Texture load error:', message.error);
                resolver();
                return;
            }

            try {
                if (!message.data) {
                    console.warn('No texture data received:', message.path);
                    resolver();
                    return;
                }

                const filename = message.path.split(/[\\/]/).pop()?.toLowerCase() || '';
                const isNormalMap = filename.includes('_nohq');
                const isSmdi = filename.includes('_smdi');

                const rvTexture = RvTexture.fromPaaBuffer(message.data.buffer as ArrayBuffer, isNormalMap, isSmdi);
                const normalizedKey = message.path.toLowerCase().replace(/\\/g, '/');
                this.loadedRvTextures.set(normalizedKey, rvTexture);

                // Check if this texture belongs to any RVMAT stage
                let foundInStage = false;
                for (const [_, rvmat] of this.loadedMaterials) {
                    for (const stage of rvmat.stages) {
                        // Normalize both paths for comparison
                        const stagePath = stage.texture.toLowerCase().replace(/\\/g, '/');
                        if (stagePath === normalizedKey) {
                            // Store RvTexture directly in stage
                            stage.loadedTexture = rvTexture;
                            foundInStage = true;
                            console.log(`Loaded stage texture: ${stage.name} = ${normalizedKey}`);
                        }
                    }
                }

                // If not a stage texture, it's a diffuse texture from LOD faces
                if (!foundInStage) {
                    this.loadedDiffuseTextures.set(normalizedKey, rvTexture.texture!);
                    console.log(`Loaded diffuse texture: ${normalizedKey}`);
                }

                resolver();
            } catch (error) {
                console.error('Failed to create PAA texture:', message.path, error);
                resolver();
            }
        }
    }

    private async handleMaterialResponse(message: MaterialResponseMessage): Promise<void> {
        const resolver = this.pendingRequests.get(message.requestId);
        if (resolver) {
            this.pendingRequests.delete(message.requestId);

            if (message.error) {
                console.warn('Material load error:', message.error);
                resolver();
                return;
            }

            try {
                if (message.content) {
                    // Parse material and generate procedural textures
                    const rvmat = RvMat.fromString(message.content, message.path);

                    // Add to loadedMaterials BEFORE requesting textures
                    // so texture responses can find the material's stages
                    this.loadedMaterials.set(message.path, rvmat);
                    console.log(`Material loaded: ${message.path}, stages:`, rvmat.stages);

                    // Check for fresnel parameters
                    const fresnelParams = rvmat.fresnelParams;
                    if (fresnelParams) {
                        console.log(`  - Detected fresnel: N=${fresnelParams.N}, K=${fresnelParams.K}`);
                    }

                    // Now request file-based stage textures
                    await rvmat.loadTextures(this);
                }
                resolver();
            } catch (error) {
                console.error('Failed to parse material:', error);
                resolver();
            }
        }
    }
}
