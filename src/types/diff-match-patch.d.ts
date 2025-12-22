declare module 'diff-match-patch' {
    export class diff_match_patch {
        Diff_Timeout: number;
        Diff_EditCost: number;
        Match_Threshold: number;
        Match_Distance: number;
        Patch_DeleteThreshold: number;
        Patch_Margin: number;
        Match_MaxBits: number;

        diff_main(text1: string, text2: string, checklines?: boolean, deadline?: number): Array<[number, string]>;
        diff_cleanupSemantic(diffs: Array<[number, string]>): void;
        diff_cleanupEfficiency(diffs: Array<[number, string]>): void;
        patch_make(text1: string, text2: string): any[];
        patch_toText(patches: any[]): string;
    }

    export const DIFF_DELETE: number;
    export const DIFF_INSERT: number;
    export const DIFF_EQUAL: number;
}
