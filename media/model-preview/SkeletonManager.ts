import { ModelCfgData } from '../../src/webviews/model-cfg-parser';

export interface BoneNode {
    name: string;
    parent: string;
    children: string[];
}

export class SkeletonManager {
    private modelCfgData: ModelCfgData | null = null;
    private boneHierarchies: Map<string, Map<string, BoneNode>> = new Map();

    /**
     * Load model configuration data
     */
    loadModelCfg(modelCfgData: ModelCfgData): void {
        this.modelCfgData = modelCfgData;
        this.buildBoneHierarchies();
        this.logModelCfgInfo();
    }

    /**
     * Build bone hierarchies for all skeletons
     */
    private buildBoneHierarchies(): void {
        if (!this.modelCfgData) return;

        for (const [skeletonName, skeletonData] of Object.entries(this.modelCfgData.skeletons)) {
            const hierarchy = new Map<string, BoneNode>();

            // Create bone nodes
            for (const bone of skeletonData.bones) {
                hierarchy.set(bone.name, {
                    name: bone.name,
                    parent: bone.parent || '',
                    children: []
                });
            }

            // Build parent-child relationships
            for (const bone of skeletonData.bones) {
                const parentName = bone.parent || '';
                if (parentName && hierarchy.has(parentName)) {
                    hierarchy.get(parentName)!.children.push(bone.name);
                }
            }

            this.boneHierarchies.set(skeletonName, hierarchy);
        }
    }

    /**
     * Log model configuration information to console
     */
    private logModelCfgInfo(): void {
        if (!this.modelCfgData) return;

        console.log('Model configuration loaded successfully');
        console.log('Skeletons:', this.modelCfgData.skeletons);
        console.log('Models:', this.modelCfgData.models);

        for (const [skeletonName, skeletonData] of Object.entries(this.modelCfgData.skeletons)) {
            console.log(`Skeleton "${skeletonName}" has ${skeletonData.bones.length} bones:`);
            for (const bone of skeletonData.bones) {
                console.log(`  - Bone "${bone.name}" parent: "${bone.parent || '(root)'}"`);
            }
        }

        for (const [modelName, modelData] of Object.entries(this.modelCfgData.models)) {
            console.log(`Model "${modelName}" uses skeleton "${modelData.skeletonName}"`);
            if (modelData.animations) {
                const animCount = Object.keys(modelData.animations).length;
                console.log(`  - Has ${animCount} animations`);
            }
        }
    }

    /**
     * Get skeleton definition by name
     */
    getSkeleton(skeletonName: string) {
        return this.modelCfgData?.skeletons[skeletonName];
    }

    /**
     * Get model definition by name
     */
    getModel(modelName: string) {
        return this.modelCfgData?.models[modelName];
    }

    /**
     * Get bone hierarchy for a skeleton
     */
    getBoneHierarchy(skeletonName: string): Map<string, BoneNode> | undefined {
        return this.boneHierarchies.get(skeletonName);
    }

    /**
     * Get all root bones (bones with no parent) for a skeleton
     */
    getRootBones(skeletonName: string): string[] {
        const hierarchy = this.boneHierarchies.get(skeletonName);
        if (!hierarchy) return [];

        return Array.from(hierarchy.values())
            .filter(bone => !bone.parent)
            .map(bone => bone.name);
    }

    /**
     * Get all children of a bone
     */
    getBoneChildren(skeletonName: string, boneName: string): string[] {
        const hierarchy = this.boneHierarchies.get(skeletonName);
        if (!hierarchy) return [];

        const bone = hierarchy.get(boneName);
        return bone?.children || [];
    }

    /**
     * Check if model.cfg data is loaded
     */
    hasData(): boolean {
        return this.modelCfgData !== null;
    }
}
