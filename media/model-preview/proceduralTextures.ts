import * as THREE from 'three';

export enum ProceduralTextureFormat {
    Color,
    Fresnel
}

/**
 * Parsed procedural texture data
 */
export interface ProceduralTextureData {
    format: ProceduralTextureFormat;
    width: number;
    height: number;
}

export interface ProceduralColorTextureData extends ProceduralTextureData {
    format: ProceduralTextureFormat.Color;
    // Color format
    r?: number;
    g?: number;
    b?: number;
    a?: number;
    type?: string;  // CO, NOHQ, DT, SMDI, AS, MC, etc.
}

export interface ProceduralFresnelTextureData extends ProceduralTextureData {
    format: ProceduralTextureFormat.Fresnel;
    // Fresnel format
    N?: number;  // Index of refraction
    K?: number;  // Extinction coefficient
}

/**
 * Parse procedural texture definition from RVMAT
 * 
 * Formats:
 *   - Color: #(argb,width,height,mips)color(r,g,b,a,type)
 *   - Fresnel: #(ai,width,height,mips)fresnel(N,K)
 * 
 * @param textureString - The texture definition string from RVMAT
 * @returns Parsed data or null if not a procedural texture
 */
export function parseProceduralTexture(textureString: string): ProceduralColorTextureData | ProceduralFresnelTextureData | null {
    if (!isProceduralTexture(textureString)) return null;

    // Match header: #(type,width,height,mips)
    const headerMatch = textureString.match(/#\((\w+),(\d+),(\d+),(\d+)\)/);
    if (!headerMatch) return null;

    const textureType = headerMatch[1];
    const width = parseInt(headerMatch[2]) || 8;
    const height = parseInt(headerMatch[3]) || 8;

    // Try color function
    const colorContentMatch = textureString.match(/color\(([\d.]+),([\d.]+),([\d.]+),([\d.]+)(?:,(\w+))?\)/);
    if (colorContentMatch) {
        if (textureType !== 'argb') {
            console.warn('Not supported: color texture with type', textureType);
            return null;
        }
        const r = parseFloat(colorContentMatch[1]);
        const g = parseFloat(colorContentMatch[2]);
        const b = parseFloat(colorContentMatch[3]);
        const a = parseFloat(colorContentMatch[4]);
        const type = colorContentMatch[5] || '';
        return { width, height, r, g, b, a, type, format: ProceduralTextureFormat.Color } satisfies ProceduralColorTextureData;
    }

    // Try fresnel function
    const fresnelContentMatch = textureString.match(/fresnel\(([\d.]+),([\d.]+)\)/);
    if (fresnelContentMatch) {
        if (textureType !== 'ai') {
            console.warn('Not supported: fresnel texture with type', textureType);
            return null;
        }
        const N = parseFloat(fresnelContentMatch[1]); // Index of refraction
        const K = parseFloat(fresnelContentMatch[2]); // Extinction coefficient
        return { width, height, N, K, format: ProceduralTextureFormat.Fresnel } satisfies ProceduralFresnelTextureData;
    }

    return null;
}

/**
 * Generate a THREE.js texture from procedural texture data
 * 
 * @param data - Parsed procedural texture data
 * @returns THREE.js DataTexture
 */
export function generateProceduralTexture(data: ProceduralColorTextureData): THREE.DataTexture {
    // Generate color texture
    const width = data.width || 8;
    const height = data.height || 8;
    const size = width * height * 4;
    const pixels = new Uint8Array(size);

    const rByte = Math.floor((data.r || 0) * 255);
    const gByte = Math.floor((data.g || 0) * 255);
    const bByte = Math.floor((data.b || 0) * 255);
    const aByte = Math.floor((data.a || 1) * 255);

    for (let i = 0; i < size; i += 4) {
        pixels[i] = rByte;
        pixels[i + 1] = gByte;
        pixels[i + 2] = bByte;
        pixels[i + 3] = aByte;
    }

    const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
    texture.needsUpdate = true;

    console.log(`Generated procedural texture: ${data.type} - ${width}x${height} - rgba(${rByte},${gByte},${bByte},${aByte})`);

    return texture;
}

/**
 * Check if a texture string is a procedural texture definition
 */
export function isProceduralTexture(textureString: string): boolean {
    return textureString.startsWith('#(');
}

/**
 * Convert a DataTexture to a data URL for preview purposes
 * Creates a canvas and draws the texture data to it
 */
export function dataTextureToDataUrl(texture: THREE.DataTexture): string {
    const canvas = document.createElement('canvas');
    const width = texture.image.width;
    const height = texture.image.height;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return '';
    }

    // Create ImageData from texture's pixel data
    const imageData = ctx.createImageData(width, height);
    const data = texture.image.data;

    if (data) {
        // Copy pixel data
        for (let i = 0; i < data.length; i++) {
            imageData.data[i] = data[i];
        }
    }

    // Put image data on canvas
    ctx.putImageData(imageData, 0, 0);

    // Convert to data URL
    return canvas.toDataURL('image/png');
}
