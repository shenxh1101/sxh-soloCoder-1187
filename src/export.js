export async function exportGIF(renderer, camera, scene, layerVisualGroup, totalLayers, currentLayer, onProgress) {
    const frames = [];
    const frameCount = Math.min(totalLayers, 200);
    const step = Math.max(1, Math.floor(totalLayers / frameCount));

    const originalVisibility = [];
    layerVisualGroup.children.forEach(child => {
        originalVisibility.push({ child, visible: child.visible });
    });

    const width = renderer.domElement.width;
    const height = renderer.domElement.height;
    const targetWidth = 480;
    const targetHeight = Math.round(height * (targetWidth / width));

    const offscreenRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    offscreenRenderer.setSize(targetWidth, targetHeight);
    offscreenRenderer.setClearColor(0x0d1117);
    offscreenRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    offscreenRenderer.toneMappingExposure = 1.2;

    const offscreenCamera = camera.clone();
    offscreenCamera.aspect = targetWidth / targetHeight;
    offscreenCamera.updateProjectionMatrix();

    onProgress(5);

    layerVisualGroup.children.forEach(child => { child.visible = false; });

    for (let i = 0; i < totalLayers; i += step) {
        const layerChild = layerVisualGroup.getObjectByName(`layer-${i}`);
        if (layerChild) layerChild.visible = true;

        offscreenRenderer.render(scene, offscreenCamera);

        const dataURL = offscreenRenderer.domElement.toDataURL('image/png');
        frames.push(dataURL);

        const progress = 5 + Math.round((i / totalLayers) * 80);
        onProgress(progress);

        await new Promise(resolve => setTimeout(resolve, 10));
    }

    layerVisualGroup.children.forEach((child, i) => {
        const orig = originalVisibility.find(o => o.child === child);
        if (orig) child.visible = orig.visible;
    });

    offscreenRenderer.dispose();

    onProgress(90);

    const GIFConstructor = window.GIF;
    if (!GIFConstructor) {
        fallbackExport(frames, targetWidth, targetHeight, onProgress);
        return;
    }

    try {
        const gif = new GIFConstructor({
            workers: 2,
            quality: 8,
            width: targetWidth,
            height: targetHeight,
            workerScript: 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js',
        });

        gif.on('progress', (p) => {
            const gifProgress = 90 + Math.round(p * 10);
            onProgress(gifProgress);
        });

        gif.on('finished', (blob) => {
            onProgress(100);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `3d_print_timelapse_${Date.now()}.gif`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });

        gif.on('error', (err) => {
            console.error('GIF encoding error:', err);
            fallbackExport(frames, targetWidth, targetHeight, onProgress);
        });

        const frameDelay = Math.max(10, Math.round(200 / frames.length));
        const loadedImages = [];
        let imagesLoaded = 0;

        frames.forEach((dataURL, i) => {
            const img = new Image();
            img.onload = () => {
                loadedImages[i] = img;
                imagesLoaded++;
                if (imagesLoaded === frames.length) {
                    loadedImages.forEach(limg => {
                        gif.addFrame(limg, { delay: frameDelay });
                    });
                    gif.render();
                }
            };
            img.onerror = () => {
                imagesLoaded++;
                if (imagesLoaded === frames.length) {
                    loadedImages.forEach(limg => {
                        if (limg) gif.addFrame(limg, { delay: frameDelay });
                    });
                    gif.render();
                }
            };
            img.src = dataURL;
        });
    } catch (err) {
        console.error('GIF export error:', err);
        fallbackExport(frames, targetWidth, targetHeight, onProgress);
    }
}

function fallbackExport(frames, frameWidth, frameHeight, onProgress) {
    onProgress(95);

    const cols = 5;
    const rows = Math.ceil(frames.length / cols);
    const canvas = document.createElement('canvas');
    canvas.width = frameWidth * cols;
    canvas.height = frameHeight * rows;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let loaded = 0;
    frames.forEach((dataURL, i) => {
        const img = new Image();
        img.onload = () => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            ctx.drawImage(img, col * frameWidth, row * frameHeight, frameWidth, frameHeight);
            loaded++;
            if (loaded === frames.length) {
                onProgress(100);
                const url = canvas.toDataURL('image/png');
                const a = document.createElement('a');
                a.href = url;
                a.download = `3d_print_timelapse_${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
        };
        img.onerror = () => {
            loaded++;
            if (loaded === frames.length) {
                onProgress(100);
                const url = canvas.toDataURL('image/png');
                const a = document.createElement('a');
                a.href = url;
                a.download = `3d_print_timelapse_${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
        };
        img.src = dataURL;
    });
}