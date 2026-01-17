import * as THREE from 'three';
import { ChannelSwizzler, Paa } from '@bis-toolkit/paa';
import { ProceduralTextureFormat, generateProceduralTexture, parseProceduralTexture } from '../proceduralTextures';

export interface SmdiMaps {
    specularMap: THREE.DataTexture;
    shininessMap: THREE.DataTexture;
}

export enum TextureType {
    Paa,
    Procedural
}

export class RvTexture {
    smdiMaps?: SmdiMaps;

    private constructor(
        readonly texture: THREE.Texture | null,
        readonly type: TextureType,
        readonly canvas: HTMLCanvasElement | null = null,
        readonly fresnelParams: { N: number; K: number } | null = null,
        isSmdi: boolean = false
    ) {
        this.texture = texture;
        this.type = type;
        this.canvas = canvas;
        this.fresnelParams = fresnelParams;
        if (isSmdi && this.texture) {
            this.createSmdiMaps();
        }
    }

    static fromPaaBuffer(buffer: ArrayBuffer, isNormalMap: boolean = false, isSmdi: boolean = false): RvTexture {
        const uint8Buffer = new Uint8Array(buffer);
        const paa = new Paa();
        paa.read(uint8Buffer);
        const canvas = RvTexture.paaToCanvas(paa, uint8Buffer);

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.flipY = false;

        if (isNormalMap) {
            texture.colorSpace = THREE.LinearSRGBColorSpace; // Normal maps are linear data
        }

        texture.needsUpdate = true;

        return new RvTexture(texture, TextureType.Paa, canvas, null, isSmdi);
    }

    /**
     * Create RvTexture from procedural texture string
     * 
     * e.g., ``#(argb,8,8,3)color(0.5,0.5,1,1,NOHQ)`` or ``#(ai,8,8,1)fresnel(1.5,0.0)``
     */
    static fromProceduralString(proceduralString: string): RvTexture | null {
        const procData = parseProceduralTexture(proceduralString);
        if (!procData) return null;

        if (procData.format === ProceduralTextureFormat.Fresnel) {
            const fresnelParams = { N: procData.N || 1.5, K: procData.K || 0.0 };
            return new RvTexture(null, TextureType.Procedural, null, fresnelParams);
        }

        const texture = generateProceduralTexture(procData);
        return new RvTexture(texture, TextureType.Procedural, null, null, procData.type === 'smdi');
    }

    private createSmdiMaps() {
        // Get canvas from PAA or create from standard texture
        let canvas: HTMLCanvasElement;
        if (this.canvas) {
            canvas = this.canvas;
        } else {
            const img = this.texture?.image as HTMLImageElement;
            canvas = RvTexture.imageToCanvas(img);
        }

        const specularMap = RvTexture.createGrayTextureFromChannel(canvas, 1, false);
        const shininessMap = RvTexture.createGrayTextureFromChannel(canvas, 2, true); // inverted

        this.smdiMaps = {
            specularMap,
            shininessMap
        };
    }

    /**
     * Get canvas - creates one from image if needed
     */
    getCanvas(): HTMLCanvasElement {
        if (this.canvas) {
            return this.canvas;
        }
        const img = this.texture?.image as HTMLImageElement;
        return RvTexture.imageToCanvas(img);
    }

    /**
     * Dispose of texture resources
     */
    dispose(): void {
        this.texture?.dispose();
        if (this.smdiMaps) {
            this.smdiMaps.specularMap.dispose();
            this.smdiMaps.shininessMap.dispose();
        }
    }

    // Static utility methods

    /**
     * Convert PAA file to Canvas
     */
    private static paaToCanvas(paa: Paa, buffer: Uint8Array): HTMLCanvasElement {
        if (!paa.mipmaps || paa.mipmaps.length === 0) {
            throw new Error('PAA file has no mipmaps');
        }

        const canvas = document.createElement('canvas');
        const mipmap = paa.mipmaps[0];
        canvas.width = mipmap.width;
        canvas.height = mipmap.height;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Failed to get 2D context');

        const imageData = ctx.createImageData(mipmap.width, mipmap.height);

        // Get RGBA pixel data from PAA
        const rgbaData = mipmap.getRgba32PixelData(buffer);
        ChannelSwizzler.apply(rgbaData, paa.channelSwizzle);
        // Some PAA sources come out as BGRA; swap R/B to match canvas expectation
        for (let i = 0; i < rgbaData.length; i += 4) {
            const r = rgbaData[i];
            rgbaData[i] = rgbaData[i + 2];
            rgbaData[i + 2] = r;
        }
        imageData.data.set(rgbaData);

        ctx.putImageData(imageData, 0, 0);

        return canvas;
    }

    /**
     * Load an image element from a URL
     */
    static loadImageElement(url: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    }

    /**
     * Convert image element to canvas
     */
    static imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Failed to get 2D context');
        ctx.drawImage(img, 0, 0);
        return canvas;
    }

    /**
     * Create a grayscale texture from a specific channel
     */
    static createGrayTextureFromChannel(
        canvas: HTMLCanvasElement,
        channelIndex: number,
        invert = false
    ): THREE.DataTexture {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Failed to get 2D context');

        const { width, height } = canvas;
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const out = new Uint8Array(width * height);

        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
            const v = data[i + channelIndex];
            out[j] = invert ? 255 - v : v;
        }

        const tex = new THREE.DataTexture(out, width, height, THREE.RedFormat, THREE.UnsignedByteType);
        tex.colorSpace = THREE.LinearSRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.flipY = false;
        tex.needsUpdate = true;

        return tex;
    }
}
