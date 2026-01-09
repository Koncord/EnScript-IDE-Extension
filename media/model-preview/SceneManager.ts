// Copied from examples/p3d/src/SceneManager.ts
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

/**
 * Scene configuration options
 */
export interface SceneConfig {
    canvas: HTMLCanvasElement;
    container?: HTMLElement;
    backgroundColor?: number;
    ambientLightIntensity?: number;
    directionalLightIntensity?: number;
    hemisphereIntensity?: number;
    showGrid?: boolean;
    showAxes?: boolean;
}

export interface MeshHandler {
    createMeshFn: () => THREE.Mesh;
    current?: THREE.Mesh | null;
}

export class SceneManager {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    stats: Stats;

    constructor(
        config: SceneConfig,
        OrbitControlsClass: typeof OrbitControls
    ) {
        const {
            canvas,
            container,
            backgroundColor = 0x0F1117,
            ambientLightIntensity = 0.6,
            directionalLightIntensity = 0.8,
            hemisphereIntensity = 0.5,
            showGrid = true,
            showAxes = true
        } = config;

        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(backgroundColor);

        // Create camera
        const width = container?.clientWidth || canvas.clientWidth;
        const height = container?.clientHeight || canvas.clientHeight || 1;
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.01, 1000);
        this.camera.position.set(5, 3, 5);

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        // Create controls
        this.controls = new OrbitControlsClass(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.rotateSpeed = 0.6;
        this.controls.zoomSpeed = 1.2;
        this.controls.panSpeed = 0.8;
        this.controls.minDistance = 0.1;
        this.controls.maxDistance = 100;
        this.controls.target.set(0, 1, 0);
        this.controls.update();

        // Add ambient light
        const ambientLight = new THREE.AmbientLight(0xFFFFFF, ambientLightIntensity);
        this.scene.add(ambientLight);

        // Add directional light
        const directionalLight = new THREE.DirectionalLight(0xFFFFFF, directionalLightIntensity);
        directionalLight.position.set(10, 20, 10);
        directionalLight.castShadow = true;
        directionalLight.shadow.camera.near = 0.1;
        directionalLight.shadow.camera.far = 100;
        directionalLight.shadow.camera.left = -20;
        directionalLight.shadow.camera.right = 20;
        directionalLight.shadow.camera.top = 20;
        directionalLight.shadow.camera.bottom = -20;
        this.scene.add(directionalLight);

        // Add hemisphere light
        const hemisphereLight = new THREE.HemisphereLight(0x87CEEB, 0x90EE90, hemisphereIntensity);
        this.scene.add(hemisphereLight);

        // Add grid helper
        if (showGrid) {
            const gridHelper = new THREE.GridHelper(20, 20, 0x888888, 0xCCCCCC);
            this.scene.add(gridHelper);
        }

        // Add axes helper
        if (showAxes) {
            const axesHelper = new THREE.AxesHelper(5);
            this.scene.add(axesHelper);
        }

        // Add stats panel
        this.stats = new Stats();
        this.stats.dom.style.position = 'absolute';
        this.stats.dom.style.top = '0px';
        this.stats.dom.style.left = '0px';
        (container || canvas.parentElement || document.body).appendChild(this.stats.dom);
    }

    handleResize(canvas: HTMLCanvasElement, container?: HTMLElement): void {
        const width = container?.clientWidth || canvas.clientWidth;
        const height = container?.clientHeight || canvas.clientHeight || 1;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    resetCamera(
        position: THREE.Vector3 = new THREE.Vector3(5, 3, 5),
        target: THREE.Vector3 = new THREE.Vector3(0, 1, 0)
    ): void {
        this.camera.position.copy(position);
        this.controls.target.copy(target);
        this.controls.update();
    }

    centerCameraOnMesh(mesh: THREE.Mesh): void {
        const box = new THREE.Box3().setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        const cameraDistance = Math.abs(maxDim / Math.sin(fov / 2)) * 1.5;

        this.camera.position.set(cameraDistance, cameraDistance * 0.5, cameraDistance);
        this.camera.lookAt(0, 0, 0);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    startAnimationLoop(): void {
        const animate = (): void => {
            requestAnimationFrame(animate);

            this.stats.update();
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        };

        animate();
    }

    displayModel(
        meshHandler: MeshHandler,
        options: { preserveView?: boolean } = {}
    ): void {
        const preserveView = !!options.preserveView;
        const prevCameraPos = this.camera.position.clone();
        const prevTarget = this.controls.target.clone();
        const prevMeshQuat = meshHandler.current ? meshHandler.current.quaternion.clone() : null;
        const prevMeshPos = meshHandler.current ? meshHandler.current.position.clone() : null;

        // Remove previous mesh
        if (meshHandler.current) {
            this.scene.remove(meshHandler.current);
            meshHandler.current.geometry.dispose();
            if (Array.isArray(meshHandler.current.material)) {
                meshHandler.current.material.forEach(m => m.dispose());
            } else if (meshHandler.current.material && typeof meshHandler.current.material.dispose === 'function') {
                meshHandler.current.material.dispose();
            }
        }

        // Create and add new mesh
        try {
            meshHandler.current = meshHandler.createMeshFn();
            this.scene.add(meshHandler.current);

            // Center and frame the model
            const box = new THREE.Box3().setFromObject(meshHandler.current);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            if (preserveView && prevMeshPos) {
                // Keep previous position and rotation
                meshHandler.current.position.copy(prevMeshPos);
                if (prevMeshQuat) {
                    meshHandler.current.quaternion.copy(prevMeshQuat);
                }
            } else {
                // Center the model
                meshHandler.current.position.sub(center);
                if (prevMeshQuat) {
                    meshHandler.current.quaternion.copy(prevMeshQuat);
                }
            }

            if (!preserveView) {
                // Position camera
                const maxDim = Math.max(size.x, size.y, size.z);
                const fov = this.camera.fov * (Math.PI / 180);
                const cameraDistance = Math.abs(maxDim / Math.sin(fov / 2)) * 1.5;

                this.camera.position.set(cameraDistance, cameraDistance * 0.5, cameraDistance);
                this.controls.target.set(0, 0, 0);
            } else {
                // Keep prior camera framing
                this.camera.position.copy(prevCameraPos);
                this.controls.target.copy(prevTarget);
            }

            this.camera.lookAt(this.controls.target);
            this.controls.update();
        } catch (error) {
            throw new Error(`Failed to display model: ${(error as Error).message}`);
        }
    }
}
