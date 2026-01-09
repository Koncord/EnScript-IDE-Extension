// Adapted from examples/p3d/app.ts for webview context
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Mlod, MlodLod, MLOD } from '@bis-toolkit/p3d';
import { SceneManager } from './SceneManager';
import { DomElements, IDomElements } from './DomElements';
import { UIUtils } from './uiUtils';
import { isProceduralTexture } from './proceduralTextures';
import { MeshPhysicalMaterial } from 'three';
import { ResourceLoader } from './ResourceLoader';

/**
 * Helper to get selected indices from boolean array
 * (getSelectedIndices is not exported from @bis-toolkit/p3d package)
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

export class ModelViewer {
    private sceneManager: SceneManager;
    private dom: IDomElements;
    private ui: UIUtils;
    private currentMesh: THREE.Mesh | null = null;
    private model: Mlod | null = null;
    private wireframeEnabled = false;
    private selectionPoints: THREE.Points | null = null;
    private selectionMesh: THREE.Mesh | null = null;

    constructor(private resourceLoader: ResourceLoader) {
        this.dom = new DomElements();
        this.ui = new UIUtils(this.dom);

        this.sceneManager = new SceneManager({
            canvas: this.dom.canvas,
            container: this.dom.viewerContainer,
            backgroundColor: 0x0F1117,
            ambientLightIntensity: 0.6,
            directionalLightIntensity: 0.8,
            hemisphereIntensity: 0.5,
            showGrid: true,
            showAxes: true
        }, OrbitControls);

        this.setupEventListeners();
        this.sceneManager.startAnimationLoop();
    }

    private setupEventListeners(): void {
        // Setup panel collapse
        this.ui.setupPanelCollapse();
        // LOD selector
        this.dom.lodSelect.addEventListener('change', () => {
            if (this.model) {
                const lodIndex = parseInt(this.dom.lodSelect.value, 10);
                this.displayModel(this.model, lodIndex);
            }
        });

        // Wireframe toggle
        this.dom.wireframeBtn.addEventListener('click', () => {
            this.wireframeEnabled = !this.wireframeEnabled;
            this.setMeshWireframe(this.currentMesh, this.wireframeEnabled);
            this.dom.wireframeBtn.classList.toggle('active', this.wireframeEnabled);
        });

        // Reset camera
        this.dom.resetCameraBtn.addEventListener('click', () => {
            if (this.currentMesh) {
                this.sceneManager.centerCameraOnMesh(this.currentMesh);
            } else {
                this.sceneManager.resetCamera();
            }
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.sceneManager.handleResize(this.dom.canvas, this.dom.viewerContainer);
        });

        // Handle init message from extension
        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.type === 'init') {
                this.loadModel(message.data);
            }
        });

        // Notify extension that webview is ready
        this.resourceLoader.sendReady();
    }

    private async loadModel(data: Uint8Array): Promise<void> {
        try {
            this.model = Mlod.fromBuffer(data);

            this.ui.updateModelInfo(this.model.getStats());
            this.ui.populateLodSelector(this.model.lods.map((lod, index) => ({
                resolutionName: lod.resolutionName || `LOD ${index}`,
                verticesCount: lod.vertices.length,
                facesCount: lod.faces.length
            })));

            await this.loadModelResources(this.model);

            // Display first LOD
            this.displayModel(this.model, 0);
        } catch (error) {
            this.ui.showError(`Failed to load model: ${error}`);
            console.error('Error loading model:', error);
        }
    }

    /**
     * Load textures and materials referenced in the model
     */
    private async loadModelResources(model: Mlod): Promise<void> {
        const allMaterials = model.allMaterials || [];
        console.log('Model allMaterials:', allMaterials);

        const texturePromises: Promise<void>[] = [];

        for (const materialPath of allMaterials) {
            if (materialPath) {
                texturePromises.push(this.resourceLoader.requestMaterial(materialPath));
            }
        }

        for (const lod of model.lods) {
            for (const texturePath of lod.textures) {
                if (texturePath && !isProceduralTexture(texturePath)) {
                    texturePromises.push(this.resourceLoader.requestTexture(texturePath));
                }
            }
        }

        // Wait for all resources to load
        await Promise.race([
            Promise.all(texturePromises),
            new Promise(resolve => setTimeout(resolve, 5000))
        ]);
    }

    private displayModel(model: Mlod, lodIndex: number): void {
        const currentMeshRef = { current: this.currentMesh };

        // Clear selection when switching LODs
        this.clearSelection();
        this.ui.clearSelectionHighlight();

        try {
            if (!model.lods[lodIndex])
                throw new Error(`LOD ${lodIndex} not found`);

            this.sceneManager.displayModel({
                current: this.currentMesh,
                createMeshFn: () => this.createMesh(model.lods[lodIndex])
            });

            this.onLodUpdate(model, lodIndex);

            this.currentMesh = currentMeshRef.current;
        } catch (error) {
            this.ui.showError((error as Error).message);
        }
    }

    private createMesh(lod: MlodLod): THREE.Mesh {
        const geometry = new THREE.BufferGeometry();

        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        const materials: THREE.MeshPhysicalMaterial[] = [];
        const materialMap = new Map<string, number>();

        let vertexCount = 0;

        for (const face of lod.faces) {
            const faceVertices = face.getUsedVertices();

            // Convert face to triangles (tri = 1 triangle, quad = 2 triangles)
            const triangles = face.sidesCnt === 3
                ? [[0, 2, 1]]  // Single triangle with winding order correction
                : [[0, 3, 2], [0, 2, 1]];  // Two triangles from quad

            // Get or create material for this face's material/texture
            const materialKey = (face.material || face.texture || 'default').toLowerCase();
            let materialIndex = materialMap.get(materialKey);
            if (materialIndex === undefined) {
                materialIndex = materials.length;
                materials.push(this.buildMaterial(face.material, face.texture));
                materialMap.set(materialKey, materialIndex);
            }

            const groupStartIndex = indices.length;

            // Build triangles from face vertices
            for (const tri of triangles) {
                for (const vertIndex of tri) {
                    if (vertIndex >= faceVertices.length) continue;

                    const vertex = faceVertices[vertIndex];
                    const point = lod.vertices[vertex.pointIndex];
                    const normal = lod.normals[vertex.normalIndex];

                    // Add position (Z inverted for Three.js coordinate system)
                    positions.push(point.x, point.y, -point.z);

                    // Add normal (X and Y inverted for Three.js coordinate system)
                    if (normal) {
                        normals.push(-normal.x, -normal.y, normal.z);
                    }

                    // Add UV coordinates
                    uvs.push(vertex.u, vertex.v);
                    indices.push(vertexCount++);
                }
            }

            const triangleCount = indices.length - groupStartIndex;
            if (triangleCount > 0) {
                geometry.addGroup(groupStartIndex, triangleCount, materialIndex);
            }
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        if (normals.length === 0) {
            // Compute normals if not provided
            geometry.computeVertexNormals();
        } else {
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        }

        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);

        geometry.computeTangents();

        const mesh = new THREE.Mesh(geometry, materials);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        return mesh;
    }

    private buildMaterial(faceMaterial: string | null, faceTexture: string | null): THREE.MeshPhysicalMaterial {
        console.log('Building material for:', { material: faceMaterial, texture: faceTexture });

        // Use face.material (RVMAT path) directly if available
        const rvmat = faceMaterial ? this.resourceLoader.getMaterials().get(faceMaterial) : null;
        // Fall back to finding diffuse texture
        const diffuseTexture = faceTexture ? this.findTextureByName(faceTexture) : null;

        // Default material properties
        const materialOptions: THREE.MeshPhysicalMaterialParameters = {
            color: diffuseTexture ? 0xFFFFFF : 0x888888,
            metalness: 0.0,
            roughness: 0.7,
            side: THREE.DoubleSide, // TODO: should be FrontSide
            flatShading: false,
            // Shader uses Fresnel-modulated specular
            specularIntensity: 0.5,
            specularColor: new THREE.Color(0.5, 0.5, 0.5),
            clearcoat: 0.0,
            clearcoatRoughness: 0.0,
        };

        if (rvmat) {
            rvmat.applyToMaterial(materialOptions);
            console.log('  Applied RVMAT properties from:', rvmat.filename);
        }

        if (diffuseTexture) {
            materialOptions.map = diffuseTexture;
            materialOptions.transparent = true;
            materialOptions.alphaTest = 0.5;
            materialOptions.depthWrite = true;
        }

        return new THREE.MeshPhysicalMaterial(materialOptions);
    }

    /**
     * Find diffuse texture by name (normalized path lookup)
     */
    private findTextureByName(texturePath: string | null): THREE.Texture | null {
        if (!texturePath) return null;

        const normalizedKey = texturePath.toLowerCase().replace(/\\/g, '/');
        const diffuseTextures = this.resourceLoader.getDiffuseTextures();
        const texture = diffuseTextures.get(normalizedKey);
        if (texture) {
            return texture;
        }

        return null;
    }

    private onLodUpdate(model: Mlod, lodIndex: number): void {
        const lod = model.lods[lodIndex];

        // Update stats
        this.ui.updateLodStats(lod.vertices.length, lod.faces.length);

        // Update materials list
        const materials = model.allMaterials || [];
        this.ui.updateMaterialsList(materials, (path) => {
            this.resourceLoader.openFile(path);
        });

        // Update selections list
        this.ui.updateSelectionsList(lod, (name, active) => {
            console.log('Selection callback triggered:', name, 'active:', active);
            if (active) {
                // Clear previous selection before highlighting new one
                this.clearSelection();
                this.highlightSelection(name, lod);
            } else {
                this.clearSelection();
            }
        });

        this.ui.updatePropertiesList(lod);
    }

    private setMeshWireframe(mesh: THREE.Mesh | null, enabled: boolean): void {
        if (!mesh?.material) return;

        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(material => {
            if (!(material instanceof MeshPhysicalMaterial)) return;
            material.wireframe = enabled;
            material.needsUpdate = true;
        });
    }

    private highlightSelection(selectionName: string, lod: MlodLod): void {
        if (!this.currentMesh) return;

        const namedSelectionTaggs = lod.taggs.filter(
            (tagg): tagg is MLOD.NamedSelectionTagg => tagg.kind === 'NamedSelection'
        );

        const selectionTagg = namedSelectionTaggs.find(tagg => tagg.name === selectionName);
        if (!selectionTagg) return;

        const selectedVertexIndices = getSelectedIndices(selectionTagg.points);
        if (selectedVertexIndices.length === 0) {
            console.warn('No vertices in selection:', selectionName);
            return;
        }

        // Create point cloud from selected vertices
        const points: number[] = [];
        selectedVertexIndices.forEach(index => {
            if (index < lod.vertices.length) {
                const v = lod.vertices[index];
                points.push(v.x, v.y, -v.z); // Z inverted for Three.js
            }
        });

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));

        const material = new THREE.PointsMaterial({
            color: 0xff00ff,
            size: 0.015,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.8
        });

        this.selectionPoints = new THREE.Points(geometry, material);

        // Apply same transformation as the main mesh
        if (this.currentMesh) {
            this.selectionPoints.position.copy(this.currentMesh.position);
            this.selectionPoints.quaternion.copy(this.currentMesh.quaternion);
        }

        this.sceneManager.scene.add(this.selectionPoints);

        // Create face mesh for selected faces
        const selectedFaceIndices = getSelectedIndices(selectionTagg.faces);
        if (selectedFaceIndices.length > 0) {
            const facePositions: number[] = [];
            const faceIndices: number[] = [];
            let vertexOffset = 0;

            selectedFaceIndices.forEach((faceIdx: number) => {
                if (faceIdx >= lod.faces.length) return;

                const face = lod.faces[faceIdx];
                const faceVertices = face.getUsedVertices();

                const triangles = face.sidesCnt === 3
                    ? [[0, 2, 1]]  // Single triangle
                    : [[0, 2, 1], [0, 3, 2]];  // Two triangles from quad

                for (const tri of triangles) {
                    for (const vertIndex of tri) {
                        if (vertIndex >= faceVertices.length) continue;

                        const vertex = faceVertices[vertIndex];
                        const point = lod.vertices[vertex.pointIndex];

                        if (point) {
                            facePositions.push(point.x, point.y, -point.z);
                            faceIndices.push(vertexOffset++);
                        }
                    }
                }
            });

            if (facePositions.length > 0) {
                const faceGeometry = new THREE.BufferGeometry();
                faceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(facePositions, 3));
                faceGeometry.setIndex(faceIndices);
                faceGeometry.computeVertexNormals();

                const faceMaterial = new THREE.MeshBasicMaterial({
                    color: 0xff00ff,
                    transparent: true,
                    opacity: 0.4,
                    side: THREE.DoubleSide,
                    depthTest: true,
                    depthWrite: false,
                    polygonOffset: true,
                    polygonOffsetFactor: -1,
                    polygonOffsetUnits: -1
                });

                this.selectionMesh = new THREE.Mesh(faceGeometry, faceMaterial);
                this.selectionMesh.renderOrder = 999;

                // Apply same transformation as the main mesh
                if (this.currentMesh) {
                    this.selectionMesh.position.copy(this.currentMesh.position);
                    this.selectionMesh.quaternion.copy(this.currentMesh.quaternion);
                }

                this.sceneManager.scene.add(this.selectionMesh);
                console.log(`Highlighted ${selectedFaceIndices.length} faces for selection: ${selectionName}`);
            }
        }

        console.log(`Highlighted ${selectedVertexIndices.length} vertices for selection: ${selectionName}`);
    }

    private clearSelection(): void {
        if (this.selectionPoints) {
            this.selectionPoints.geometry.dispose();
            (this.selectionPoints.material as THREE.Material).dispose();
            this.sceneManager.scene.remove(this.selectionPoints);
            this.selectionPoints = null;
        }
        if (this.selectionMesh) {
            this.selectionMesh.geometry.dispose();
            (this.selectionMesh.material as THREE.Material).dispose();
            this.sceneManager.scene.remove(this.selectionMesh);
            this.selectionMesh = null;
        }
    }
}
