/// <reference types="@types/vscode-webview" />

interface Mipmap {
    width: number;
    height: number;
    rgba: Uint8Array;
}

interface InitMessage {
    type: 'init';
    body: {
        mipmaps: Mipmap[];
        filename: string;
    };
}

interface ErrorMessage {
    type: 'error';
    body: {
        message: string;
    };
}

enum CurrentChannel {
    Rgb = 'rgb',
    R = 'r',
    G = 'g',
    B = 'b',
    A = 'a'
}

type Message = InitMessage | ErrorMessage;

const vscode = acquireVsCodeApi();

let mipmaps: Mipmap[] = [];
let currentMipLevel = 0;
let currentZoom = 1.0;
let isDragging = false;
let startX: number;
let startY: number;
let currentChannel: CurrentChannel = CurrentChannel.Rgb;
let autoFitEnabled = true;

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: true })!;
const canvasWrapper = document.getElementById('canvas-wrapper') as HTMLDivElement;
const canvasContainer = document.getElementById('canvas-container') as HTMLDivElement;
const mipSelect = document.getElementById('mip-select') as HTMLSelectElement;
const channelSelect = document.getElementById('channel-select') as HTMLSelectElement;
const zoomLevel = document.getElementById('zoom-level') as HTMLSpanElement;
const filenameDisplay = document.getElementById('filename-display') as HTMLSpanElement;
const autoFitCheckbox = document.getElementById('auto-fit-checkbox') as HTMLInputElement;

// Attach button event listeners
document.getElementById('zoom-in')!.addEventListener('click', zoomIn);
document.getElementById('zoom-out')!.addEventListener('click', zoomOut);
document.getElementById('zoom-reset')!.addEventListener('click', resetZoom);
document.getElementById('zoom-fit')!.addEventListener('click', fitToScreen);

// Auto-fit checkbox
autoFitCheckbox.addEventListener('change', (e) => {
    autoFitEnabled = (e.target as HTMLInputElement).checked;
    if (autoFitEnabled) {
        fitToScreen();
    }
});

// Channel selector
channelSelect.addEventListener('change', (e) => {
    currentChannel = (e.target as HTMLSelectElement).value as CurrentChannel;
    renderMipmap();
});

// Handle messages from the extension
window.addEventListener('message', (event: MessageEvent<Message>) => {
    const message = event.data;

    switch (message.type) {
        case 'init':
            handleInit(message.body);
            break;
        case 'error':
            handleError(message.body);
            break;
    }
});

function handleInit(data: { mipmaps: Mipmap[]; filename: string }): void {
    mipmaps = data.mipmaps;
    filenameDisplay.textContent = data.filename;

    // Populate MIP level dropdown
    mipSelect.innerHTML = '';
    mipmaps.forEach((mip, index) => {
        const option = document.createElement('option');
        option.value = index.toString();
        option.textContent = `Level ${index} (${mip.width}×${mip.height})`;
        mipSelect.appendChild(option);
    });

    mipSelect.addEventListener('change', (e) => {
        currentMipLevel = parseInt((e.target as HTMLSelectElement).value);
        renderMipmap();
    });

    // Initial render
    renderMipmap();

    // Fit to screen on load if image is larger than viewport
    const mip = mipmaps[0];
    if (mip.width > canvasContainer.clientWidth - 40 ||
        mip.height > canvasContainer.clientHeight - 40) {
        fitToScreen();
    }
    
    // Show canvas wrapper now that sizing is complete
    canvasWrapper.classList.add('loaded');
}

function handleError(data: { message: string }): void {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.innerHTML = `
        <h3>Error Loading Image</h3>
        <p>${data.message}</p>
    `;
    document.body.innerHTML = '';
    document.body.appendChild(errorDiv);
}

function renderMipmap(): void {
    const mip = mipmaps[currentMipLevel];
    canvas.width = mip.width;
    canvas.height = mip.height;

    // Draw checkerboard background
    const checkerSize = 8;
    const color1 = '#999999';
    const color2 = '#666666';

    for (let y = 0; y < mip.height; y += checkerSize) {
        for (let x = 0; x < mip.width; x += checkerSize) {
            const checkerX = Math.floor(x / checkerSize);
            const checkerY = Math.floor(y / checkerSize);
            ctx.fillStyle = (checkerX + checkerY) % 2 === 0 ? color1 : color2;
            ctx.fillRect(x, y, checkerSize, checkerSize);
        }
    }

    // Create ImageData from RGBA data with channel filtering
    const imageData = ctx.createImageData(mip.width, mip.height);
    imageData.data.set(applyChannelFilter(new Uint8ClampedArray(mip.rgba)));
    ctx.putImageData(imageData, 0, 0);

    updateZoom();
}

function applyChannelFilter(rgba: Uint8ClampedArray): Uint8ClampedArray {
    if (currentChannel === CurrentChannel.Rgb) {
        return rgba;
    }

    const filtered = new Uint8ClampedArray(rgba.length);
    
    for (let i = 0; i < rgba.length; i += 4) {
        const r = rgba[i];
        const g = rgba[i + 1];
        const b = rgba[i + 2];
        const a = rgba[i + 3];

        switch (currentChannel) {
            case CurrentChannel.R:
                filtered[i] = r;
                filtered[i + 1] = r;
                filtered[i + 2] = r;
                filtered[i + 3] = 255;
                break;
            case CurrentChannel.G:
                filtered[i] = g;
                filtered[i + 1] = g;
                filtered[i + 2] = g;
                filtered[i + 3] = 255;
                break;
            case CurrentChannel.B:
                filtered[i] = b;
                filtered[i + 1] = b;
                filtered[i + 2] = b;
                filtered[i + 3] = 255;
                break;
            case CurrentChannel.A:
                filtered[i] = a;
                filtered[i + 1] = a;
                filtered[i + 2] = a;
                filtered[i + 3] = 255;
                break;
        }
    }

    return filtered;
}

function updateZoom(): void {
    canvas.style.transform = `scale(${currentZoom})`;
    canvas.style.transformOrigin = '0 0';
    canvasWrapper.style.width = (canvas.width * currentZoom) + 'px';
    canvasWrapper.style.height = (canvas.height * currentZoom) + 'px';
    zoomLevel.textContent = Math.round(currentZoom * 100) + '%';
}

function zoomIn(): void {
    autoFitEnabled = false;
    autoFitCheckbox.checked = false;
    currentZoom = Math.min(currentZoom * 1.2, 32);
    updateZoom();
}

function zoomOut(): void {
    autoFitEnabled = false;
    autoFitCheckbox.checked = false;
    currentZoom = Math.max(currentZoom / 1.2, 0.1);
    updateZoom();
}

function resetZoom(): void {
    autoFitEnabled = false;
    autoFitCheckbox.checked = false;
    currentZoom = 1.0;
    updateZoom();
}

function fitToScreen(): void {
    const mip = mipmaps[currentMipLevel];
    const containerWidth = canvasContainer.clientWidth - 40;
    const containerHeight = canvasContainer.clientHeight - 40;
    const scaleX = containerWidth / mip.width;
    const scaleY = containerHeight / mip.height;
    currentZoom = Math.min(scaleX, scaleY, 1);
    updateZoom();
}

// Resize observer for auto-fit on viewport changes
const resizeObserver = new ResizeObserver(() => {
    if (autoFitEnabled && mipmaps.length > 0) {
        fitToScreen();
    }
});
resizeObserver.observe(canvasContainer);

// Mouse wheel zoom
canvasContainer.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
            zoomIn();
        } else {
            zoomOut();
        }
    }
});

// Pan with mouse drag
canvasWrapper.addEventListener('mousedown', (e) => {
    isDragging = true;
    canvasWrapper.classList.add('dragging');
    startX = e.pageX - canvasContainer.scrollLeft;
    startY = e.pageY - canvasContainer.scrollTop;
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX - startX;
    const y = e.pageY - startY;
    canvasContainer.scrollLeft = -x;
    canvasContainer.scrollTop = -y;
});

document.addEventListener('mouseup', () => {
    isDragging = false;
    canvasWrapper.classList.remove('dragging');
});

// Tell the extension we're ready to receive data
vscode.postMessage({ type: 'ready' });

export { };
