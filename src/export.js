export async function exportGIF(renderer, camera, scene, layerVisualGroup, totalLayers, onProgress) {
    onProgress(0, '准备导出 GIF...');

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

    onProgress(5, '渲染帧中...');

    layerVisualGroup.children.forEach(child => { child.visible = false; });

    for (let i = 0; i < totalLayers; i += step) {
        const layerChild = layerVisualGroup.getObjectByName(`layer-${i}`);
        if (layerChild) layerChild.visible = true;

        offscreenRenderer.render(scene, offscreenCamera);

        const dataURL = offscreenRenderer.domElement.toDataURL('image/png');
        frames.push(dataURL);

        const progress = 5 + Math.round((i / totalLayers) * 60);
        onProgress(progress, `渲染帧 ${Math.floor(i / step) + 1}/${Math.ceil(totalLayers / step)}...`);

        await new Promise(resolve => setTimeout(resolve, 10));
    }

    layerVisualGroup.children.forEach((child, i) => {
        const orig = originalVisibility.find(o => o.child === child);
        if (orig) child.visible = orig.visible;
    });

    offscreenRenderer.dispose();

    onProgress(70, '编码 GIF...');

    const GIFConstructor = window.GIF;

    if (!GIFConstructor) {
        downloadAsPNGGrid(frames, targetWidth, targetHeight, onProgress);
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
            const gifProgress = 70 + Math.round(p * 25);
            onProgress(gifProgress, `编码 GIF ${Math.round(p * 100)}%...`);
        });

        gif.on('finished', (blob) => {
            onProgress(100, '下载完成');
            downloadBlob(blob, `3d_print_timelapse_${Date.now()}.gif`);
        });

        const frameDelay = Math.max(10, Math.round(300 / frames.length));
        const loadedImages = [];
        let imagesLoaded = 0;

        frames.forEach((dataURL, i) => {
            const img = new Image();
            img.onload = () => {
                loadedImages[i] = img;
                imagesLoaded++;
                if (imagesLoaded === frames.length) {
                    loadedImages.forEach(limg => {
                        if (limg) gif.addFrame(limg, { delay: frameDelay });
                    });
                    gif.render();
                }
            };
            img.onerror = () => {
                imagesLoaded++;
                if (imagesLoaded === frames.length) {
                    const validImages = loadedImages.filter(Boolean);
                    if (validImages.length > 0) {
                        validImages.forEach(limg => gif.addFrame(limg, { delay: frameDelay }));
                        gif.render();
                    } else {
                        downloadAsPNGGrid(frames, targetWidth, targetHeight, onProgress);
                    }
                }
            };
            img.src = dataURL;
        });
    } catch (err) {
        downloadAsPNGGrid(frames, targetWidth, targetHeight, onProgress);
    }
}

export async function exportPNGFrames(renderer, camera, scene, layerVisualGroup, totalLayers, onProgress) {
    onProgress(0, '准备导出 PNG 序列...');

    const zipReady = typeof JSZip !== 'undefined';
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

    onProgress(5, '渲染帧中...');

    layerVisualGroup.children.forEach(child => { child.visible = false; });

    const frameBlobs = [];
    let actualIdx = 0;

    for (let i = 0; i < totalLayers; i += step) {
        const layerChild = layerVisualGroup.getObjectByName(`layer-${i}`);
        if (layerChild) layerChild.visible = true;

        offscreenRenderer.render(scene, offscreenCamera);

        const blob = await new Promise(resolve => {
            offscreenRenderer.domElement.toBlob(resolve, 'image/png');
        });

        if (blob) {
            frameBlobs.push({ blob, index: actualIdx });
        }

        actualIdx++;
        const progress = 5 + Math.round((i / totalLayers) * 85);
        onProgress(progress, `渲染帧 ${actualIdx}/${Math.ceil(totalLayers / step)}...`);

        await new Promise(resolve => setTimeout(resolve, 10));
    }

    layerVisualGroup.children.forEach((child, i) => {
        const orig = originalVisibility.find(o => o.child === child);
        if (orig) child.visible = orig.visible;
    });

    offscreenRenderer.dispose();

    onProgress(92, '打包下载中...');

    if (frameBlobs.length === 1) {
        downloadBlob(frameBlobs[0].blob, `3d_print_layer_000.png`);
        onProgress(100, '下载完成');
    } else if (zipReady) {
        try {
            const zip = new JSZip();
            frameBlobs.forEach(({ blob, index }) => {
                const padded = String(index).padStart(4, '0');
                zip.file(`frame_${padded}.png`, blob);
            });
            const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
                const pct = 92 + Math.round(meta.percent * 0.08);
                onProgress(pct, `ZIP 压缩 ${meta.percent}%...`);
            });
            onProgress(100, '下载完成');
            downloadBlob(zipBlob, `3d_print_frames_${Date.now()}.zip`);
        } catch (err) {
            downloadFrameBlobs(frameBlobs, onProgress);
        }
    } else {
        downloadFrameBlobs(frameBlobs, onProgress);
    }
}

function downloadFrameBlobs(frameBlobs, onProgress) {
    onProgress(95, '逐个下载帧...');
    frameBlobs.forEach(({ blob, index }, i) => {
        setTimeout(() => {
            const padded = String(index).padStart(4, '0');
            downloadBlob(blob, `3d_print_frame_${padded}.png`);
            if (i === frameBlobs.length - 1) {
                onProgress(100, `已下载 ${frameBlobs.length} 帧`);
            }
        }, i * 200);
    });
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadAsPNGGrid(frames, frameWidth, frameHeight, onProgress) {
    onProgress(95, '生成 PNG 网格...');

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
                onProgress(100, '下载完成');
                canvas.toBlob(blob => {
                    if (blob) {
                        downloadBlob(blob, `3d_print_timelapse_grid_${Date.now()}.png`);
                    }
                });
            }
        };
        img.src = dataURL;
    });
}