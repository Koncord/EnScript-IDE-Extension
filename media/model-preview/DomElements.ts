// Adapted from examples/p3d/src/DomElements.ts for webview context
export interface IDomElements {
    canvas: HTMLCanvasElement;
    viewerContainer: HTMLElement;
    controlsPanel: HTMLElement;
    controlsToggle: HTMLElement;
    showPanelBtn: HTMLElement;
    version: HTMLElement;
    lodCount: HTMLElement;
    vertexCount: HTMLElement;
    faceCount: HTMLElement;
    lodSelect: HTMLSelectElement;
    wireframeBtn: HTMLButtonElement;
    resetCameraBtn: HTMLButtonElement;
    materialList: HTMLElement;
    propertyList: HTMLElement;
    selectionList: HTMLElement;
}

export class DomElements implements IDomElements {
    canvas: HTMLCanvasElement;
    viewerContainer: HTMLElement;
    controlsPanel: HTMLElement;
    controlsToggle: HTMLElement;
    showPanelBtn: HTMLElement;
    version: HTMLElement;
    lodCount: HTMLElement;
    vertexCount: HTMLElement;
    faceCount: HTMLElement;
    lodSelect: HTMLSelectElement;
    wireframeBtn: HTMLButtonElement;
    resetCameraBtn: HTMLButtonElement;
    materialList: HTMLElement;
    propertyList: HTMLElement;
    selectionList: HTMLElement;

    constructor() {
        this.canvas = this.getElementById<HTMLCanvasElement>('canvas');
        if (!this.canvas.parentElement) {
            throw new Error('Canvas element has no parent');
        }
        this.viewerContainer = this.canvas.parentElement;
        this.controlsPanel = this.getElementById('controlsPanel')!;
        this.controlsToggle = this.getElementById('controlsToggle');
        this.showPanelBtn = this.getElementById('showPanelBtn');

        this.version = this.getElementById('version');
        this.lodCount = this.getElementById('lodCount');
        this.vertexCount = this.getElementById('vertexCount');
        this.faceCount = this.getElementById('faceCount');
        this.lodSelect = this.getElementById<HTMLSelectElement>('lodSelect');

        this.wireframeBtn = this.getElementById<HTMLButtonElement>('wireframeBtn');
        this.resetCameraBtn = this.getElementById<HTMLButtonElement>('resetCameraBtn');
        this.materialList = this.getElementById('materialList');
        this.propertyList = this.getElementById('propertyList');
        this.selectionList = this.getElementById('selectionList');
    }

    private getElementById<T extends HTMLElement>(id: string): T {
        const elem = document.getElementById(id);
        if (!elem) {
            throw new Error(`Element with ID "${id}" not found`);
        }
        return elem as T;
    }
}
