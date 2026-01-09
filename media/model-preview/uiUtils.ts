import type { IDomElements } from './DomElements';
import type { MlodLod, MLOD } from '@bis-toolkit/p3d';

export interface ModelStats {
    version?: number | string;
    lodCount?: number;
}

export interface LodInfo {
    resolutionName: string;
    verticesCount: number;
    facesCount: number;
}

export interface SelectionInfo {
    name: string;
    faceCount: number;
    vertexCount: number;
}

export interface PropertyInfo {
    name: string;
    value: string;
}

/**
 * Helper to get selected indices from boolean array
 */
function getSelectedIndices(boolArray: boolean[]): number[] {
    const indices: number[] = [];
    for (let i = 0; i < boolArray.length; i++) {
        if (boolArray[i]) {
            indices.push(i);
        }
    }
    return indices;
}

/**
 * UI utilities for Model viewer
 */
export class UIUtils {
    constructor(private dom: IDomElements) { }

    setupPanelCollapse(onPanelToggle?: (collapsed: boolean) => void): void {
        // Panel controls
        this.dom.controlsToggle.addEventListener('click', () => {
            this.dom.controlsPanel.classList.add('hidden');
            this.dom.showPanelBtn.style.display = 'block';
            onPanelToggle?.(true);
        });

        this.dom.showPanelBtn.addEventListener('click', () => {
            this.dom.controlsPanel.classList.remove('hidden');
            this.dom.showPanelBtn.style.display = 'none';
            onPanelToggle?.(false);
        });
    }

    updateModelInfo(stats: ModelStats): void {
        this.dom.version.textContent = stats.version?.toString() || 'Unknown';
        this.dom.lodCount.textContent = stats.lodCount?.toString() || 'Unknown';
    }

    updateLodStats(vertexCount: number, faceCount: number): void {
        this.dom.vertexCount.textContent = vertexCount.toString();
        this.dom.faceCount.textContent = faceCount.toString();
    }

    populateLodSelector(lods: LodInfo[]): void {
        this.dom.lodSelect.innerHTML = '';
        lods.forEach((lod, index) => {
            const option = document.createElement('option');
            option.value = index.toString();
            option.textContent = lod.resolutionName || `LOD ${index}`;
            this.dom.lodSelect.appendChild(option);
        });
    }

    updateMaterialsList(materials: string[], onMaterialClick: (path: string) => void): void {
        if (materials.length === 0) {
            this.dom.materialList.innerHTML = '<div class="material-list-empty">No materials</div>';
            return;
        }

        const template = document.getElementById('material-item-template') as HTMLTemplateElement;
        this.dom.materialList.innerHTML = '';

        materials.forEach((materialPath: string) => {
            const fileName = materialPath.split(/[/\\]/).pop() || materialPath;
            const clone = template.content.cloneNode(true) as DocumentFragment;
            const item = clone.querySelector('.material-item') as HTMLElement;
            const nameEl = clone.querySelector('.material-name') as HTMLElement;
            const pathEl = clone.querySelector('.material-path') as HTMLElement;

            nameEl.textContent = fileName;
            pathEl.textContent = materialPath;
            pathEl.title = materialPath;

            // Add click handler to open material file
            item.addEventListener('click', () => onMaterialClick(materialPath));

            this.dom.materialList.appendChild(clone);
        });
    }

    updateSelectionsList(
        lod: MlodLod,
        onSelectionClick: (name: string, active: boolean, item: HTMLElement) => void
    ): void {
        const selections: SelectionInfo[] = [];

        // Extract named selections from Tagg data
        const namedSelectionTaggs = lod.taggs.filter(
            (tagg): tagg is MLOD.NamedSelectionTagg => tagg.kind === 'NamedSelection'
        );

        namedSelectionTaggs.forEach((tagg) => {
            selections.push({
                name: tagg.name,
                faceCount: getSelectedIndices(tagg.faces).length,
                vertexCount: getSelectedIndices(tagg.points).length
            });
        });

        if (selections.length === 0) {
            this.dom.selectionList.innerHTML = '<div class="selection-list-empty">No selections</div>';
            return;
        }

        const template = document.getElementById('selection-item-template') as HTMLTemplateElement;
        this.dom.selectionList.innerHTML = '';

        selections.forEach((selection) => {
            const clone = template.content.cloneNode(true) as DocumentFragment;
            const item = clone.querySelector('.selection-item') as HTMLElement;
            const nameEl = clone.querySelector('.selection-name') as HTMLElement;
            const infoEl = clone.querySelector('.selection-info') as HTMLElement;

            nameEl.textContent = selection.name;
            infoEl.textContent = `${selection.vertexCount} vertices, ${selection.faceCount} faces`;

            // Add click handler for selection highlighting
            item.addEventListener('click', () => {
                const wasActive = item.classList.contains('active');
                console.log('Selection item clicked:', selection.name, 'wasActive:', wasActive);

                if (wasActive) {
                    // Deselect
                    item.classList.remove('active');
                    onSelectionClick(selection.name, false, item);
                } else {
                    // Clear previous selection
                    this.clearSelectionHighlight();
                    // Highlight new selection
                    item.classList.add('active');
                    onSelectionClick(selection.name, true, item);
                }
            });

            this.dom.selectionList.appendChild(clone);
        });
    }

    clearSelectionHighlight(): void {
        this.dom.selectionList.querySelectorAll('.selection-item').forEach(item => {
            item.classList.remove('active');
        });
    }

    updatePropertiesList(lod: MlodLod): void {
        const uniqueProps = new Map<string, string>();

        // Extract properties from PropertyTaggs
        const propertyTaggs = lod.taggs.filter(
            (tagg): tagg is MLOD.PropertyTagg => tagg.kind === 'Property'
        );

        propertyTaggs.forEach((tagg) => {
            uniqueProps.set(tagg.propName, tagg.propValue);
        });

        if (uniqueProps.size === 0) {
            this.dom.propertyList.innerHTML = '<div class="property-list-empty">No properties</div>';
            return;
        }

        const template = document.getElementById('property-row-template') as HTMLTemplateElement;
        const table = document.createElement('table');
        table.className = 'property-table';

        uniqueProps.forEach((value, name) => {
            const clone = template.content.cloneNode(true) as DocumentFragment;
            const nameCell = clone.querySelector('.property-name') as HTMLElement;
            const valueCell = clone.querySelector('.property-value') as HTMLElement;

            nameCell.textContent = name;
            valueCell.textContent = value;

            table.appendChild(clone);
        });

        this.dom.propertyList.innerHTML = '';
        this.dom.propertyList.appendChild(table);
    }

    showError(message: string): void {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);

        setTimeout(() => {
            errorDiv.remove();
        }, 5000);
    }
}
