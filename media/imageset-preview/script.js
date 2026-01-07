const vscode = acquireVsCodeApi();
const imageSetData = {{imageSetData}};

let selectedImageIndex = null;
let currentZoom = 1.0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let scrollStartX = 0;
let scrollStartY = 0;

function initializePreview() {
    if (!imageSetData) {
        document.getElementById('error-container').textContent = 'Failed to parse .imageset file';
        document.getElementById('error-container').style.display = 'block';
        return;
    }

    // Update toolbar
    document.getElementById('imageset-name').textContent = imageSetData.name || '-';
    document.getElementById('imageset-size').textContent = 
        `${imageSetData.refSize.width}x${imageSetData.refSize.height}`;
    document.getElementById('image-count').textContent = imageSetData.images.length;
    document.getElementById('texture-count').textContent = imageSetData.textures.length;
    document.getElementById('sidebar-count').textContent = imageSetData.images.length;

    // Populate image list
    const imageList = document.getElementById('image-list');
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
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = imageSetData.refSize.width;
    canvas.height = imageSetData.refSize.height;

    // Fill with checker pattern
    drawCheckerPattern(ctx, canvas.width, canvas.height);

    // Try to load texture if available
    if (imageSetData.textures.length > 0 && imageSetData.textureData) {
        loadTexture(imageSetData.textureData);
    } else if (imageSetData.textures.length > 0) {
        document.getElementById('texture-path').textContent = imageSetData.textures[0].path;
        document.getElementById('no-texture-container').style.display = 'block';
    }

    document.getElementById('zoom-wrapper').style.display = 'inline-block';

    // Draw image boxes
    renderBoxes();

    // Set up controls
    document.getElementById('show-boxes').addEventListener('change', renderBoxes);
    document.getElementById('show-labels').addEventListener('change', renderBoxes);
    document.getElementById('zoom-slider').addEventListener('input', (e) => {
        currentZoom = e.target.value / 100;
        document.getElementById('zoom-value').textContent = e.target.value + '%';
        applyZoom();
        renderBoxes(); // Re-render boxes to update label scaling
    });
}

function drawCheckerPattern(ctx, width, height) {
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

function loadTexture(textureData) {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    
    // Check if this is RGBA data (will be much larger than base64 image)
    // RGBA data size = width * height * 4
    const expectedRGBASize = canvas.width * canvas.height * 4;
    const decodedSize = textureData.length * 0.75; // Approximate base64 decoded size
    
    if (Math.abs(decodedSize - expectedRGBASize) < 1000) {
        // It's RGBA data - decode and render
        const binaryString = atob(textureData);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        const imageData = new ImageData(
            new Uint8ClampedArray(bytes),
            canvas.width,
            canvas.height
        );
        
        ctx.putImageData(imageData, 0, 0);
    } else {
        // It's a regular image format (PNG/JPG) - load as image
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0);
        };
        img.src = 'data:image/png;base64,' + textureData;
    }
    
    document.getElementById('no-texture-container').style.display = 'none';
}

function renderBoxes() {
    const overlay = document.getElementById('boxes-overlay');
    const showBoxes = document.getElementById('show-boxes').checked;
    const showLabels = document.getElementById('show-labels').checked;
    
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

function selectImage(index) {
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

function applyZoom() {
    const zoomWrapper = document.getElementById('zoom-wrapper');
    const wrapper = document.getElementById('canvas-wrapper');
    const canvas = document.getElementById('canvas');
    
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

function setupDragNavigation() {
    const previewPanel = document.querySelector('.preview-panel');
    const zoomWrapper = document.getElementById('zoom-wrapper');
    if (!previewPanel || !zoomWrapper) return;
    
    const handleMouseDown = (e) => {
        // Only drag if clicking on the zoom wrapper or canvas (not boxes)
        if (e.target.closest('.image-box')) return;
        
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        scrollStartX = previewPanel.scrollLeft;
        scrollStartY = previewPanel.scrollTop;
        zoomWrapper.classList.add('dragging');
        e.preventDefault();
    };

    const handleMouseMove = (e) => {
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

// Initialize on load
initializePreview();
setupDragNavigation();
