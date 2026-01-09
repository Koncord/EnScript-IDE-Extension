import * as THREE from 'three';
import { RvmatParser } from '@bis-toolkit/cppparser';
import { RvMatBase, RvMatStage } from './RvMatBase';

/**
 * RvMat - Real Virtuality Material
 * 
 * Represents DayZ Super material with shader properties and texture stages.
 */
export class RvMat extends RvMatBase {
    /** Ambient color [r, g, b, a] */
    get ambient(): number[] | null {
        return this.data.ambient || null;
    }

    /** Diffuse color [r, g, b, a] */
    get diffuse(): number[] | null {
        return this.data.diffuse || null;
    }

    /** Forced diffuse color [r, g, b, a] */
    get forcedDiffuse(): number[] | null {
        return this.data.forcedDiffuse || null;
    }

    /** Emissive color [r, g, b, a] */
    get emissive(): number[] | null {
        return this.data.emmisive || null;
    }

    /** Specular color [r, g, b] */
    get specular(): number[] | null {
        return this.data.specular || null;
    }

    /** Specular power */
    get specularPower(): number | null {
        return this.data.specularPower || null;
    }

    /**
     * Parse RVMAT from string content (loaded from extension host)
     * Only supports 'Super' shader materials
     * 
     * @param content - RVMAT file content
     * @param filename - Material filename
     */
    static fromString(
        content: string,
        filename: string = '<rvmat>'
    ): RvMat {
        const data = RvmatParser.parse(content, filename);

        // Only support Super shader materials
        if (data.pixelShaderID !== 'Super' || data.vertexShaderID !== 'Super') {
            console.warn(`Material ${filename} uses unsupported shader (Pixel: ${data.pixelShaderID}, Vertex: ${data.vertexShaderID}). Only 'Super' shader is supported.`);
        }

        const rvmat = new RvMat(data, filename);
        // Generate procedural textures immediately
        rvmat.generateProceduralTextures();

        return rvmat;
    }

    /**
     * Get specular color as THREE.Color
     */
    getSpecularColor(): THREE.Color | null {
        if (!this.specular || this.specular.length < 3) {
            return null;
        }
        return new THREE.Color(this.specular[0], this.specular[1], this.specular[2]);
    }

    /**
     * Get average specular intensity
     */
    getSpecularIntensity(): number {
        if (!this.specular || this.specular.length < 3) {
            return 0;
        }
        return (this.specular[0] + this.specular[1] + this.specular[2]) / 3;
    }

    /**
     * Get emissive color as THREE.Color
     */
    getEmissiveColor(): THREE.Color | null {
        if (!this.emissive || this.emissive.length < 3) {
            return null;
        }
        return new THREE.Color(this.emissive[0], this.emissive[1], this.emissive[2]);
    }

    /**
     * Get emissive intensity (max component)
     */
    getEmissiveIntensity(): number {
        if (!this.emissive || this.emissive.length < 3) {
            return 0;
        }
        return Math.max(this.emissive[0], this.emissive[1], this.emissive[2]);
    }

    /**
     * Get ambient color as THREE.Color
     */
    getAmbientColor(): THREE.Color | null {
        if (!this.ambient || this.ambient.length < 3) {
            return null;
        }
        return new THREE.Color(this.ambient[0], this.ambient[1], this.ambient[2]);
    }

    /**
     * Get diffuse color as THREE.Color
     */
    getDiffuseColor(): THREE.Color | null {
        if (!this.diffuse || this.diffuse.length < 3) {
            return null;
        }
        return new THREE.Color(this.diffuse[0], this.diffuse[1], this.diffuse[2]);
    }

    /**
     * Get forced diffuse color as THREE.Color
     */
    getForcedDiffuseColor(): THREE.Color | null {
        if (!this.forcedDiffuse || this.forcedDiffuse.length < 3) {
            return null;
        }
        return new THREE.Color(this.forcedDiffuse[0], this.forcedDiffuse[1], this.forcedDiffuse[2]);
    }

    /**
     * Calculate roughness from specular power
     * Based on shader formula: shininess = smdi.y * specularPower
     */
    getRoughness(): number {
        if (!this.specularPower || this.specularPower <= 0) {
            return 0.5; // Default mid-range roughness
        }
        return RvMat.shininessToRoughness(this.specularPower);
    }

    get normalMapStage(): RvMatStage | null {
        return this.getStageByName('Stage1');
    }

    get detailStage(): RvMatStage | null {
        return this.getStageByName('Stage2');
    }

    get macroStage(): RvMatStage | null {
        return this.getStageByName('Stage3');
    }

    get ambientStage(): RvMatStage | null {
        return this.getStageByName('Stage4');
    }

    get specularStage(): RvMatStage | null {
        return this.getStageByName('Stage5');
    }

    get fresnelStage(): RvMatStage | null {
        return this.getStageByName('Stage6');
    }

    get environmentStage(): RvMatStage | null {
        return this.getStageByName('Stage7');
    }

    /**
     * Get fresnel parameters (N = IOR, K = extinction coefficient)
     */
    get fresnelParams(): { N: number; K: number } | null {
        return this.fresnelStage?.loadedTexture?.fresnelParams || null;
    }

    /**
     * Check if this material uses the supported 'Super' shader
     */
    isSupported(): boolean {
        return this.pixelShaderID === 'Super' && this.vertexShaderID === 'Super';
    }

    /**
     * Apply material properties to THREE.js MeshPhysicalMaterial parameters
     * Only applies properties if material uses 'Super' shader
     * Uses calculations from reversed HLSL
     */
    applyToMaterial(materialOptions: THREE.MeshPhysicalMaterialParameters): void {
        // Only apply properties for Super shader materials
        if (!this.isSupported()) {
            console.warn(`Skipping material application for ${this.filename} - uses unsupported shader (Pixel: ${this.pixelShaderID}, Vertex: ${this.vertexShaderID})`);
            return;
        }

        // Apply fresnel IOR if available
        const fresnelParams = this.fresnelParams;
        if (fresnelParams) {
            // Use the refractive index from fresnel texture
            materialOptions.ior = fresnelParams.N;

            // K (extinction coefficient) suggests metallic/conductive material
            // In THREE.js, we approximate this using metalness
            // High K values (> 0.5) typically indicate metals
            if (fresnelParams.K > 0.5) {
                materialOptions.metalness = Math.min(fresnelParams.K, 1.0);
                console.log(`Applied fresnel IOR: ${fresnelParams.N}, metalness from K: ${materialOptions.metalness.toFixed(3)}`);
            } else {
                console.log(`Applied fresnel IOR: ${fresnelParams.N}`);
            }
        }

        // Specular properties (from Mat.cSpecular in shader)
        if (this.specular && this.specular.length >= 3) {
            materialOptions.specularColor = this.getSpecularColor()!;

            // The shader multiplies specular by Fresnel term
            // Use specular intensity weighted by RGB average
            materialOptions.specularIntensity = this.getSpecularIntensity();

            // Convert specular power (w component) to roughness
            // Shader: shininess = smdi.y * specularPower
            if (this.specularPower !== null && this.specularPower > 0) {
                materialOptions.roughness = RvMat.shininessToRoughness(this.specularPower);
            }
        }

        // Emissive properties (from Mat.cEmission in shader)
        if (this.emissive && this.emissive.length >= 3) {
            const [r, g, b] = this.emissive;
            const intensity = Math.max(r, g, b);
            if (intensity > 0.01) {
                materialOptions.emissive = new THREE.Color(r, g, b);
                materialOptions.emissiveIntensity = intensity;
            }
        }

        // Forced diffuse (additive diffuse lighting in shader)
        if (this.forcedDiffuse && this.forcedDiffuse.length >= 3) {
            const [r, g, b] = this.forcedDiffuse;
            const intensity = Math.max(r, g, b);
            if (intensity > 0.01) {
                // This is added to diffuse in shader, could brighten base color slightly
                // For PBR, we can blend it into emissive as ambient lighting
                if (!materialOptions.emissive) {
                    materialOptions.emissive = new THREE.Color(r * 0.5, g * 0.5, b * 0.5);
                    materialOptions.emissiveIntensity = intensity * 0.5;
                }
            }
        }

        // Derive PBR maps from SMDI texture if available
        // SMDI channel usage from shader (samples .yz - G and B channels):
        // - smdi.x (G channel, index 1): Specular intensity for Fresnel
        // - smdi.y (B channel, index 2): Shininess (converted to roughness)
        // - R channel (index 0): Unused in shader
        const smdiMaps = this.specularStage?.loadedTexture?.smdiMaps;
        if (smdiMaps) {
            // Modulate maps by RVMAT material properties
            // Use average specular color as scalar for metalness
            if (Array.isArray(this.specular) && this.specular.length >= 3) {
                const s = Math.max(
                    0,
                    Math.min(1, (this.specular[0] + this.specular[1] + this.specular[2]) / 3)
                );
                const mData = smdiMaps.specularMap.image.data;
                if (mData !== null) {
                    for (let i = 0; i < mData.length; i++) {
                        mData[i] = Math.max(0, Math.min(255, Math.round(mData[i] * s)));
                    }
                    smdiMaps.specularMap.needsUpdate = true;
                }
            }

            // Use specularPower to bias roughness (high power => lower roughness)
            if (typeof this.specularPower === 'number') {
                const normalized = Math.log(this.specularPower + 1) / Math.log(1001);
                const roughnessScale = Math.max(0.1, 1 - normalized);
                const rData = smdiMaps.shininessMap.image.data;
                if (rData !== null) {
                    for (let i = 0; i < rData.length; i++) {
                        rData[i] = Math.max(0, Math.min(255, Math.round(rData[i] * roughnessScale)));
                    }
                }
                smdiMaps.shininessMap.needsUpdate = true;
            }

            materialOptions.metalnessMap = smdiMaps.specularMap;
            materialOptions.roughnessMap = smdiMaps.shininessMap;
            console.log('  Applied SMDI');
        }

        // Apply other stage textures to material
        const normalStage = this.normalMapStage;
        if (normalStage?.loadedTexture) {
            materialOptions.normalMap = normalStage.loadedTexture.texture;
            materialOptions.normalScale = new THREE.Vector2(1, -1);
            materialOptions.normalMapType = THREE.TangentSpaceNormalMap;
            console.log('  Applied normal');
        }

        const aoStage = this.ambientStage;
        if (aoStage?.loadedTexture) {
            materialOptions.aoMap = aoStage.loadedTexture.texture;
            materialOptions.aoMapIntensity = 1.0;
            console.log('  Applied AO');
        }

        const envStage = this.environmentStage;
        if (envStage?.loadedTexture) {
            materialOptions.envMap = envStage.loadedTexture.texture;
            materialOptions.envMapIntensity = 1.0;
            console.log('  Applied environment map');
        }
    }

    /**
     * Convert shader shininess to PBR roughness
     * Based on shader formula: shininess = smdi.y * specularPower
     * where specularPower is typically in range [1, 128]
     */
    static shininessToRoughness(shininess: number): number {
        // Shader uses pow(NdotH, shininess) for specular
        // Three.js roughness is approximately: roughness = sqrt(2 / (shininess + 2))
        // Clamp shininess to reasonable range
        const clampedShininess = Math.max(1, Math.min(shininess, 256));
        return Math.sqrt(2 / (clampedShininess + 2));
    }
}
