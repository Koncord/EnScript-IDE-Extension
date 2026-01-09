import { RvmatStage, RvmatData } from '@bis-toolkit/cppparser';
import { isProceduralTexture } from '../proceduralTextures';
import type { ResourceLoader } from '../ResourceLoader';
import { RvTexture } from './RvTexture';

/**
 * RVMAT texture stage
 */
export interface RvMatStage extends RvmatStage {
    loadedTexture: RvTexture | null;
}

/**
 * Base class for RVMAT materials
 */
export class RvMatBase {
    get stages(): RvMatStage[] {
        return this.data.stages as RvMatStage[];
    }

    get pixelShaderID(): string | undefined {
        return this.data.pixelShaderID;
    }

    get vertexShaderID(): string | undefined {
        return this.data.vertexShaderID;
    }

    protected constructor(
        readonly data: RvmatData,
        readonly filename: string
    ) {
        this.data = data;
        this.filename = filename;
    }

    async loadTextures(resourceLoader: ResourceLoader): Promise<void> {
        const texturePromises: Promise<void>[] = [];
        for (const stage of this.stages) {
            if (stage.texture && !isProceduralTexture(stage.texture)) {
                console.log(`  - Requesting texture: ${stage.texture}`);
                texturePromises.push(resourceLoader.requestTexture(stage.texture));
            }
        }

        if (texturePromises.length > 0) {
            await Promise.race([
                Promise.all(texturePromises),
                new Promise(resolve => setTimeout(resolve, 3000))
            ]);
        }
    }

    generateProceduralTextures(): void {
        for (const stage of this.stages) {
            if (isProceduralTexture(stage.texture)) {
                stage.loadedTexture = RvTexture.fromProceduralString(stage.texture);
            }
        }
    }

    protected getStageByName(name: string): RvMatStage | null {
        return this.stages.find(s => s.name === name) || null;
    }
}
