import * as fs from 'fs';
import { Parser as CppParser, Preprocessor, CfgClass, CfgArrayVariable, CfgSimpleVariable } from '@bis-toolkit/cppparser';

export type AnimationType =
    | 'rotation' | 'rotationX' | 'rotationY' | 'rotationZ'
    | 'translation' | 'translationX' | 'translationY' | 'translationZ'
    | 'hide' | 'direct';

export type SourceAddress = 'clamp' | 'loop' | 'mirror';

interface BaseAnimationDefinition {
    source: string;
    selection: string;
    axis?: string;
    begin?: string;
    end?: string;
    memory?: boolean;
    animPeriod?: number;
    minValue?: number;
    maxValue?: number;
    phaseBeg?: number;
    phaseEnd?: number;
    sourceAddress?: SourceAddress;
}

interface RotationAnimation extends BaseAnimationDefinition {
    type: 'rotation' | 'rotationX' | 'rotationY' | 'rotationZ';
    angle0?: number;
    angle1?: number | string; // Can be number or expression like "rad -360"
}

interface TranslationAnimation extends BaseAnimationDefinition {
    type: 'translation' | 'translationX' | 'translationY' | 'translationZ';
    offset0?: number;
    offset1?: number;
}

interface HideAnimation extends BaseAnimationDefinition {
    type: 'hide';
    hideValue?: number;
    unHideValue?: number;
}

interface DirectAnimation extends BaseAnimationDefinition {
    type: 'direct';
    axisPos?: number[];
    axisDir?: number[];
    angle?: number;
    axisOffset?: number;
}

export type AnimationDefinition =
    | RotationAnimation
    | TranslationAnimation
    | HideAnimation
    | DirectAnimation;

// Helper type for parsing - includes all possible animation properties
type AnimationBuilder = Partial<BaseAnimationDefinition> & {
    type?: AnimationType;
    angle0?: number;
    angle1?: number | string;
    offset0?: number;
    offset1?: number;
    hideValue?: number;
    unHideValue?: number;
    axisPos?: number[];
    axisDir?: number[];
    angle?: number;
    axisOffset?: number;
};

export interface SkeletonDefinition {
    bones: Array<{ name: string; parent: string }>;
    skeletonInherit?: string;
    isDiscrete?: number;
}

export interface ModelDefinition {
    skeletonName: string;
    sections: string[];
    sectionsInherit?: string;
    animations?: Record<string, AnimationDefinition>;
}

export interface ModelCfgData {
    skeletons: Record<string, SkeletonDefinition>;
    models: Record<string, ModelDefinition>;
}

/**
 * Parser for model.cfg files containing skeleton and model definitions.
 */
export class ModelCfgParser {
    /**
     * Parse a model.cfg file and extract skeleton and model information
     * @param modelCfgPath Path to the model.cfg file
     * @returns Parsed model configuration data
     */
    static parse(modelCfgPath: string): ModelCfgData {
        if (!fs.existsSync(modelCfgPath)) {
            throw new Error(`model.cfg not found: ${modelCfgPath}`);
        }

        // Parse model.cfg using cppparser with preprocessor
        const preprocessor = new Preprocessor({});
        const processedContent = preprocessor.preprocess(modelCfgPath);
        const parser = new CppParser(processedContent, modelCfgPath);
        const doc = parser.parse();

        // Extract skeleton and model data
        const skeletons: Record<string, SkeletonDefinition> = {};
        const models: Record<string, ModelDefinition> = {};

        for (const stmt of doc.statements) {
            if (stmt.kind === 'class') {
                const classStmt = stmt as CfgClass;

                if (classStmt.name === 'cfgSkeletons' || classStmt.name === 'CfgSkeletons') {
                    this.parseSkeletons(classStmt, skeletons);
                } else if (classStmt.name === 'CfgModels' || classStmt.name === 'cfgModels') {
                    this.parseModels(classStmt);
                }
            }
        }

        return { skeletons, models };
    }

    /**
     * Parse skeleton definitions from CfgSkeletons class
     */
    private static parseSkeletons(
        cfgSkeletons: CfgClass,
        skeletons: Record<string, SkeletonDefinition>
    ): void {
        for (const [skeletonName, skeletonData] of cfgSkeletons.properties) {
            if (skeletonData.kind === 'class') {
                const skeletonClass = skeletonData as CfgClass;
                const skeleton: SkeletonDefinition = {
                    bones: []
                };

                // Parse SkeletonBones array
                const bonesArray = skeletonClass.properties.get('SkeletonBones') ||
                    skeletonClass.properties.get('skeletonBones');

                if (bonesArray && bonesArray.kind === 'array') {
                    const bonesVar = bonesArray as CfgArrayVariable;

                    // SkeletonBones is array of pairs: ["boneName", "parentName", "bone2", "parent2", ...]
                    for (let i = 0; i < bonesVar.values.length; i += 2) {
                        const boneName = bonesVar.values[i] as string;
                        const parentName = (bonesVar.values[i + 1] as string) || '';
                        skeleton.bones.push({ name: boneName, parent: parentName });
                    }
                }

                // Parse optional properties
                const skeletonInherit = skeletonClass.properties.get('skeletonInherit');
                if (skeletonInherit && skeletonInherit.kind === 'variable') {
                    skeleton.skeletonInherit = (skeletonInherit as CfgSimpleVariable).value as string;
                }

                const isDiscrete = skeletonClass.properties.get('isDiscrete');
                if (isDiscrete && isDiscrete.kind === 'variable') {
                    skeleton.isDiscrete = (isDiscrete as CfgSimpleVariable).value as number;
                }

                skeletons[skeletonName] = skeleton;
            }
        }
    }

    /**
     * Parse model definitions from CfgModels class
     */
    private static parseModels(
        cfgModels: CfgClass
    ): void {
        for (const [_modelName, modelData] of cfgModels.properties) {
            if (modelData.kind === 'class') {
                const modelClass = modelData as CfgClass;
                const model: ModelDefinition = {
                    skeletonName: '',
                    sections: []
                };

                // Parse skeletonName
                const skeletonNameProp = modelClass.properties.get('skeletonName');
                if (skeletonNameProp && skeletonNameProp.kind === 'variable') {
                    model.skeletonName = (skeletonNameProp as CfgSimpleVariable).value as string;
                }

                // Parse sections array
                const sectionsProp = modelClass.properties.get('sections');
                if (sectionsProp && sectionsProp.kind === 'array') {
                    model.sections = (sectionsProp as CfgArrayVariable).values as string[];
                }

                // Parse sectionsInherit
                const sectionsInherit = modelClass.properties.get('sectionsInherit');
                if (sectionsInherit && sectionsInherit.kind === 'variable') {
                    model.sectionsInherit = (sectionsInherit as CfgSimpleVariable).value as string;
                }

                // Parse Animations class
                const animationsClass = modelClass.properties.get('Animations');
                if (animationsClass && animationsClass.kind === 'class') {
                    model.animations = this.parseAnimations(animationsClass as CfgClass);
                }
            }
        }
    }

    /**
     * Parse Animations class containing animation definitions
     */
    private static parseAnimations(animationsClass: CfgClass): Record<string, AnimationDefinition> {
        const animations: Record<string, AnimationDefinition> = {};

        for (const [animName, animData] of animationsClass.properties) {
            if (animData.kind === 'class') {
                const animClass = animData as CfgClass;
                const animation: AnimationBuilder = {};

                // Parse all animation properties
                for (const [propName, propValue] of animClass.properties) {
                    if (propValue.kind === 'variable') {
                        const value = (propValue as CfgSimpleVariable).value;
                        if (value === null) continue;

                        switch (propName) {
                            case 'type':
                                animation.type = value as AnimationType;
                                break;
                            case 'source':
                                animation.source = value as string;
                                break;
                            case 'selection':
                                animation.selection = value as string;
                                break;
                            case 'axis':
                                animation.axis = value as string;
                                break;
                            case 'begin':
                                animation.begin = value as string;
                                break;
                            case 'end':
                                animation.end = value as string;
                                break;
                            case 'memory':
                                animation.memory = value as boolean;
                                break;
                            case 'animPeriod':
                                animation.animPeriod = value as number;
                                break;
                            case 'minValue':
                                animation.minValue = value as number;
                                break;
                            case 'maxValue':
                                animation.maxValue = value as number;
                                break;
                            case 'phaseBeg':
                                animation.phaseBeg = value as number;
                                break;
                            case 'phaseEnd':
                                animation.phaseEnd = value as number;
                                break;
                            case 'sourceAddress':
                                animation.sourceAddress = value as SourceAddress;
                                break;
                            case 'angle0':
                                animation.angle0 = value as number;
                                break;
                            case 'angle1':
                                if (typeof value === 'number' || typeof value === 'string') {
                                    animation.angle1 = value; // Can be number or string like "rad 90"
                                }
                                break;
                            case 'offset0':
                                animation.offset0 = value as number;
                                break;
                            case 'offset1':
                                animation.offset1 = value as number;
                                break;
                            case 'hideValue':
                                animation.hideValue = value as number;
                                break;
                            case 'unHideValue':
                                animation.unHideValue = value as number;
                                break;
                            case 'angle':
                                animation.angle = value as number;
                                break;
                            case 'axisOffset':
                                animation.axisOffset = value as number;
                                break;
                        }
                    } else if (propValue.kind === 'array') {
                        const arrayValue = (propValue as CfgArrayVariable).values;

                        switch (propName) {
                            case 'axisPos':
                                animation.axisPos = arrayValue as number[];
                                break;
                            case 'axisDir':
                                animation.axisDir = arrayValue as number[];
                                break;
                        }
                    }
                }

                // Only add if required properties are present
                if (animation.type && animation.source && animation.selection) {
                    animations[animName] = animation as AnimationDefinition;
                }
            }
        }

        return animations;
    }

    static buildBoneHierarchy(skeletonData: { bones: Array<{ name: string; parent: string }> }): Map<string, string[]> {
        const hierarchy = new Map<string, string[]>();

        // Build parent -> children mapping
        for (const bone of skeletonData.bones) {
            const parent = bone.parent || 'root';
            if (!hierarchy.has(parent)) {
                hierarchy.set(parent, []);
            }
            hierarchy.get(parent)!.push(bone.name);
        }

        return hierarchy;
    }
}
