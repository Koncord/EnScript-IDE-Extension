/// <reference types="@types/vscode-webview" />

interface Position {
    x: number;
    y: number;
}

interface Size {
    width: number;
    height: number;
}

interface ImageEntry {
    name: string;
    pos: Position;
    size: Size;
}

interface Texture {
    path: string;
}

interface ImageSetData {
    name: string;
    refSize: Size;
    images: ImageEntry[];
    textures: Texture[];
    textureData?: Uint8Array;
}

interface InitMessage {
    type: 'init';
    body: ImageSetData;
}

interface ErrorMessage {
    type: 'error';
    body: string;
}

type Message = InitMessage | ErrorMessage;

const vscode = acquireVsCodeApi();

let imageSetData: ImageSetData | null = null;
let selectedImageIndex: number | null = null;
let currentZoom = 1.0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let scrollStartX = 0;
let scrollStartY = 0;

// Handle messages from the extension
window.addEventListener('message', (event: MessageEvent<Message>) => {
    const message = event.data;

    switch (message.type) {
        case 'init':
            imageSetData = message.body;
            initializePreview();
            break;
        case 'error':
            document.getElementById('error-container')!.textContent = message.body;
            (document.getElementById('error-container') as HTMLElement).style.display = 'block';
            break;
    }
});

function initializePreview(): void {
    if (!imageSetData) {
        document.getElementById('error-container')!.textContent = 'Failed to parse .imageset file';
        (document.getElementById('error-container') as HTMLElement).style.display = 'block';
        return;
    }

    // Update toolbar
    document.getElementById('imageset-name')!.textContent = imageSetData.name || '-';
    document.getElementById('imageset-size')!.textContent =
        `${imageSetData.refSize.width}x${imageSetData.refSize.height}`;
    document.getElementById('image-count')!.textContent = imageSetData.images.length.toString();
    document.getElementById('texture-count')!.textContent = imageSetData.textures.length.toString();
    document.getElementById('sidebar-count')!.textContent = imageSetData.images.length.toString();

    // Populate image list
    const imageList = document.getElementById('image-list')!;
    imageSetData.images.forEach((img, index) => {
        const li = document.createElement('li');
        li.className = 'image-item';
        li.innerHTML = `
            <div class="image-item-name">${img.name}</div>
            <div class="image-item-details">
                Pos: (${img.pos.x}, ${img.pos.y})<br>
                Size: ${img.size.width}x${img.size.height}
            </div>
        `;
        li.addEventListener('click', () => selectImage(index));
        imageList.appendChild(li);
    });

    // Draw canvas with texture placeholder
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    canvas.width = imageSetData.refSize.width;
    canvas.height = imageSetData.refSize.height;

    // Fill with checker pattern
    drawCheckerPattern(ctx, canvas.width, canvas.height);

    // Try to load texture if available
    if (imageSetData.textures.length > 0 && imageSetData.textureData) {
        loadTexture(imageSetData.textureData);
    } else if (imageSetData.textures.length > 0) {
        document.getElementById('texture-path')!.textContent = imageSetData.textures[0].path;
        (document.getElementById('no-texture-container') as HTMLElement).style.display = 'block';
    }

    (document.getElementById('zoom-wrapper') as HTMLElement).style.display = 'inline-block';

    // Draw image boxes
    renderBoxes();

    // Set up controls
    document.getElementById('show-boxes')!.addEventListener('change', renderBoxes);
    document.getElementById('show-labels')!.addEventListener('change', renderBoxes);
    document.getElementById('zoom-slider')!.addEventListener('input', (e) => {
        const value = (e.target as HTMLInputElement).value;
        currentZoom = parseInt(value) / 100;
        document.getElementById('zoom-value')!.textContent = value + '%';
        applyZoom();
        renderBoxes(); // Re-render boxes to update label scaling
    });
}

function drawCheckerPattern(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const squareSize = 16;
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#444';
    for (let y = 0; y < height; y += squareSize) {
        for (let x = 0; x < width; x += squareSize) {
            if ((x / squareSize + y / squareSize) % 2 === 0) {
                ctx.fillRect(x, y, squareSize, squareSize);
            }
        }
    }
}

function loadTexture(textureData: Uint8Array): void {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;

    const imageData = new ImageData(
        new Uint8ClampedArray(textureData),
        canvas.width,
        canvas.height
    );
    ctx.putImageData(imageData, 0, 0);

    (document.getElementById('no-texture-container') as HTMLElement).style.display = 'none';
}

function renderBoxes(): void {
    if (!imageSetData) return;

    const overlay = document.getElementById('boxes-overlay')!;
    const showBoxes = (document.getElementById('show-boxes') as HTMLInputElement).checked;
    const showLabels = (document.getElementById('show-labels') as HTMLInputElement).checked;

    overlay.innerHTML = '';

    if (!showBoxes) return;

    imageSetData.images.forEach((img, index) => {
        const box = document.createElement('div');
        box.className = 'image-box';
        if (index === selectedImageIndex) {
            box.classList.add('selected');
        }

        box.style.left = img.pos.x + 'px';
        box.style.top = img.pos.y + 'px';
        box.style.width = img.size.width + 'px';
        box.style.height = img.size.height + 'px';

        if (showLabels) {
            const label = document.createElement('div');
            label.className = 'image-box-label';
            label.textContent = img.name;
            // Counter-scale the label to keep it at fixed size
            label.style.transform = `scale(${1 / currentZoom})`;
            // Adjust position so label stays at fixed distance from box
            label.style.top = `${-18 / currentZoom}px`;
            box.appendChild(label);
        }

        box.addEventListener('click', (e) => {
            e.stopPropagation();
            selectImage(index);
        });

        overlay.appendChild(box);
    });
}

function selectImage(index: number): void {
    selectedImageIndex = index;

    // Update sidebar selection
    const items = document.querySelectorAll('.image-item');
    items.forEach((item, i) => {
        item.classList.toggle('selected', i === index);
    });

    // Update boxes
    renderBoxes();

    // Scroll to selected item
    if (items[index]) {
        items[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function applyZoom(): void {
    const zoomWrapper = document.getElementById('zoom-wrapper') as HTMLElement;
    const wrapper = document.getElementById('canvas-wrapper') as HTMLElement;
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;

    // Scale the wrapper visually
    wrapper.style.transform = `scale(${currentZoom})`;
    wrapper.style.transformOrigin = 'top left';

    // Adjust the zoom-wrapper size to match the scaled content
    // This creates the scrollable area
    const scaledWidth = canvas.width * currentZoom;
    const scaledHeight = canvas.height * currentZoom;
    zoomWrapper.style.width = scaledWidth + 'px';
    zoomWrapper.style.height = scaledHeight + 'px';
}

function setupDragNavigation(): void {
    const previewPanel = document.querySelector('.preview-panel') as HTMLElement | null;
    const zoomWrapper = document.getElementById('zoom-wrapper');
    if (!previewPanel || !zoomWrapper) return;

    const handleMouseDown = (e: MouseEvent) => {
        // Only drag if clicking on the zoom wrapper or canvas (not boxes)
        if ((e.target as HTMLElement).closest('.image-box')) return;

        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        scrollStartX = previewPanel.scrollLeft;
        scrollStartY = previewPanel.scrollTop;
        zoomWrapper.classList.add('dragging');
        e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;

        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;

        previewPanel.scrollLeft = scrollStartX - dx;
        previewPanel.scrollTop = scrollStartY - dy;
    };

    const handleMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            zoomWrapper.classList.remove('dragging');
        }
    };

    zoomWrapper.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

// Set up drag navigation on load
setupDragNavigation();

// Signal that the webview is ready to receive data
vscode.postMessage({ type: 'ready' });

export { };
