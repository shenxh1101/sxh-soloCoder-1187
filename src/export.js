import * as THREE from 'three';

const RES_PRESETS = {
    '480p': { w: 854, h: 480 },
    '720p': { w: 1280, h: 720 },
    '1080p': { w: 1920, h: 1080 },
};

function getResolution(key) {
    return RES_PRESETS[key] || RES_PRESETS['480p'];
}

function detectVideoCodec() {
    const mp4Codecs = [
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4;codecs=avc1.4d002a',
        'video/mp4;codecs=avc1.640028',
        'video/mp4;codecs=avc1.64001f',
        'video/mp4',
    ];
    for (const codec of mp4Codecs) {
        if (MediaRecorder.isTypeSupported(codec)) {
            return { mimeType: codec, ext: 'mp4', label: 'MP4 (H.264)' };
        }
    }
    const webmCodecs = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
    ];
    for (const codec of webmCodecs) {
        if (MediaRecorder.isTypeSupported(codec)) {
            return { mimeType: codec, ext: 'webm', label: 'WebM (VP9)' };
        }
    }
    return { mimeType: 'video/webm', ext: 'webm', label: 'WebM' };
}

export async function runExport(options) {
    const {
        format, fps, resolution, watermark,
        renderer, camera, scene,
        layerVisualGroup, supportGroup, modelGroup,
        totalLayers, currentLayer, onProgress,
    } = options;

    onProgress(0, '初始化导出...');

    const res = getResolution(resolution);
    const aspect = res.w / res.h;
    const step = Math.max(1, Math.floor(totalLayers / Math.min(totalLayers, 200)));

    const originalVisibility = [];
    layerVisualGroup.children.forEach(c => originalVisibility.push({ child: c, visible: c.visible }));

    const offscreenRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    offscreenRenderer.setSize(res.w, res.h);
    offscreenRenderer.setClearColor(0x0d1117);
    offscreenRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    offscreenRenderer.toneMappingExposure = 1.2;

    const offscreenCamera = camera.clone();
    offscreenCamera.aspect = aspect;
    offscreenCamera.updateProjectionMatrix();

    if (format === 'video') {
        const codec = detectVideoCodec();
        await exportVideo(offscreenRenderer, offscreenCamera, scene, layerVisualGroup, watermark, totalLayers, step, fps, codec, onProgress);
    } else {
        const frames = await renderFrames(offscreenRenderer, offscreenCamera, scene, layerVisualGroup, watermark, totalLayers, step, onProgress);

        layerVisualGroup.children.forEach(child => {
            const orig = originalVisibility.find(o => o.child === child);
            if (orig) child.visible = orig.visible;
        });

        if (format === 'gif') {
            await encodeGIF(frames, res.w, res.h, fps, onProgress);
        } else if (format === 'png') {
            await packagePNG(frames, res.w, res.h, onProgress);
        }
    }

    layerVisualGroup.children.forEach(child => {
        const orig = originalVisibility.find(o => o.child === child);
        if (orig) child.visible = orig.visible;
    });

    offscreenRenderer.dispose();
}

async function renderFrames(renderer, camera, scene, group, watermark, totalLayers, step, onProgress) {
    const frames = [];
    onProgress(5, '渲染帧中...');

    group.children.forEach(c => { c.visible = false; });

    let frameIdx = 0;
    for (let i = 0; i < totalLayers; i += step) {
        const child = group.getObjectByName(`layer-${i}`);
        if (child) child.visible = true;

        renderer.render(scene, camera);

        if (watermark) {
            drawWatermark(renderer.domElement, i + 1, totalLayers);
        }

        const dataURL = renderer.domElement.toDataURL('image/png');
        frames.push(dataURL);

        frameIdx++;
        const pct = 5 + Math.round((i / totalLayers) * 70);
        onProgress(pct, `渲染帧 ${frameIdx}/${Math.ceil(totalLayers / step)}...`);

        await new Promise(r => setTimeout(r, 10));
    }

    return frames;
}

async function encodeGIF(frames, width, height, fps, onProgress) {
    onProgress(75, '准备编码 GIF...');

    const GIFConstructor = window.GIF;
    if (!GIFConstructor) {
        downloadAsGrid(frames, width, height, onProgress);
        return;
    }

    try {
        const frameDelay = Math.max(1, Math.round(100 / fps));
        const gif = new GIFConstructor({
            workers: 2,
            quality: 10,
            width,
            height,
            workerScript: 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js',
            repeat: 0,
        });

        gif.on('progress', (p) => {
            onProgress(75 + Math.round(p * 20), `编码 GIF ${Math.round(p * 100)}%...`);
        });

        gif.on('finished', (blob) => {
            onProgress(100, 'GIF 下载完成');
            downloadBlob(blob, `print_timelapse_${Date.now()}.gif`);
        });

        const imgs = [];
        let loaded = 0;
        frames.forEach((url, i) => {
            const img = new Image();
            img.onload = () => {
                imgs[i] = img;
                loaded++;
                if (loaded === frames.length) {
                    imgs.forEach(limg => { if (limg) gif.addFrame(limg, { delay: frameDelay }); });
                    gif.render();
                }
            };
            img.onerror = () => {
                loaded++;
                if (loaded === frames.length) {
                    const valid = imgs.filter(Boolean);
                    if (valid.length > 0) {
                        valid.forEach(limg => gif.addFrame(limg, { delay: frameDelay }));
                        gif.render();
                    } else {
                        downloadAsGrid(frames, width, height, onProgress);
                    }
                }
            };
            img.src = url;
        });
    } catch (e) {
        downloadAsGrid(frames, width, height, onProgress);
    }
}

async function packagePNG(frames, width, height, onProgress) {
    onProgress(80, '准备打包 PNG...');

    if (frames.length === 1) {
        const blob = dataURLToBlob(frames[0]);
        downloadBlob(blob, `print_frame_0000.png`);
        onProgress(100, 'PNG 下载完成');
        return;
    }

    const zipReady = typeof JSZip !== 'undefined';
    if (!zipReady) {
        downloadFramesSequential(frames, onProgress);
        return;
    }

    try {
        const zip = new JSZip();
        frames.forEach((url, i) => {
            const padded = String(i).padStart(4, '0');
            zip.file(`frame_${padded}.png`, dataURLToBlob(url), { binary: true });
        });

        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (meta) => {
            onProgress(80 + Math.round(meta.percent * 0.15), `ZIP 压缩 ${meta.percent}%...`);
        });

        onProgress(100, 'PNG 序列下载完成');
        downloadBlob(zipBlob, `print_frames_${Date.now()}.zip`);
    } catch (e) {
        downloadFramesSequential(frames, onProgress);
    }
}

async function exportVideo(renderer, camera, scene, group, watermark, totalLayers, step, fps, codec, onProgress) {
    onProgress(5, `准备录制 ${codec.label}...`);

    group.children.forEach(c => { c.visible = false; });

    const stream = renderer.domElement.captureStream(fps);

    let recorder;
    try {
        recorder = new MediaRecorder(stream, {
            mimeType: codec.mimeType,
            videoBitsPerSecond: 5000000,
        });
    } catch (e) {
        const fallbackCodec = { mimeType: 'video/webm', ext: 'webm', label: 'WebM' };
        recorder = new MediaRecorder(stream, {
            mimeType: fallbackCodec.mimeType,
            videoBitsPerSecond: 5000000,
        });
        codec = fallbackCodec;
    }

    const chunks = [];

    recorder.ondataavailable = e => {
        if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
        const blob = new Blob(chunks, { type: codec.mimeType });
        onProgress(100, `视频 (${codec.label}) 下载完成`);
        downloadBlob(blob, `print_timelapse_${Date.now()}.${codec.ext}`);
    };

    recorder.onerror = (e) => {
        onProgress(100, `录制失败: ${e.error ? e.error.message : '未知错误'}`);
    };

    recorder.start();

    let frameIdx = 0;
    for (let i = 0; i < totalLayers; i += step) {
        const child = group.getObjectByName(`layer-${i}`);
        if (child) child.visible = true;

        renderer.render(scene, camera);

        if (watermark) {
            drawWatermark(renderer.domElement, i + 1, totalLayers);
        }

        frameIdx++;
        const pct = 5 + Math.round((i / totalLayers) * 85);
        onProgress(pct, `录制 ${codec.label} 帧 ${frameIdx}/${Math.ceil(totalLayers / step)}...`);

        await new Promise(r => setTimeout(r, 1000 / fps));
    }

    onProgress(92, '编码视频中...');

    await new Promise(r => setTimeout(r, 500));

    if (recorder.state === 'recording') {
        recorder.requestData();
        await new Promise(r => setTimeout(r, 300));
        recorder.stop();
    }
}

function drawWatermark(canvas, layerNum, totalLayers) {
    try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        const fontSize = Math.max(14, Math.round(h * 0.035));
        ctx.save();
        ctx.font = `bold ${fontSize}px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 2;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        const text = `层 ${layerNum}/${totalLayers}`;
        ctx.strokeText(text, w - 10, h - 8);
        ctx.fillText(text, w - 10, h - 8);
        ctx.restore();
    } catch (e) {
    }
}

function dataURLToBlob(dataURL) {
    const parts = dataURL.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const bytes = atob(parts[1]);
    const buf = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    return new Blob([buf], { type: mime });
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadAsGrid(frames, fw, fh, onProgress) {
    onProgress(95, '生成 PNG 预览网格...');
    const cols = 5;
    const rows = Math.ceil(frames.length / cols);
    const canvas = document.createElement('canvas');
    canvas.width = fw * cols;
    canvas.height = fh * rows;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let loaded = 0;
    frames.forEach((url, i) => {
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh);
            loaded++;
            if (loaded === frames.length) {
                onProgress(100, '网格预览下载完成');
                canvas.toBlob(blob => {
                    if (blob) downloadBlob(blob, `print_grid_${Date.now()}.png`);
                });
            }
        };
        img.src = url;
    });
}

function downloadFramesSequential(frames, onProgress) {
    frames.forEach((url, i) => {
        setTimeout(() => {
            const padded = String(i).padStart(4, '0');
            downloadBlob(dataURLToBlob(url), `print_frame_${padded}.png`);
            if (i === frames.length - 1) {
                onProgress(100, `已下载 ${frames.length} 帧 PNG`);
            }
        }, i * 200);
    });
}