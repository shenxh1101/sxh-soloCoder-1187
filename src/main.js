import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { createPrinterModel } from './printer.js';
import { sliceModel, generateSupports } from './slicer.js';
import { createPresetModel } from './presets.js';
import { initUI, updateProgressUI, updateStatus, updateButtonStates, updateRemainingTime, setExportProgress, updatePhaseStatus, updateTimelineMax, updateTimelineValue } from './ui.js';
import { exportGIF, exportPNGFrames } from './export.js';

const viewport = document.getElementById('viewport');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.setClearColor(0x0d1117);
renderer.localClippingEnabled = true;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, viewport.clientWidth / viewport.clientHeight, 0.5, 200);
camera.position.set(30, 22, 35);
camera.lookAt(0, 2, 0);

const gridHelper = new THREE.GridHelper(40, 40, 0x30363d, 0x1a1f2e);
scene.add(gridHelper);

const ambientLight = new THREE.AmbientLight(0x404060, 1.8);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 4);
keyLight.position.set(15, 20, 15);
keyLight.castShadow = true;
keyLight.shadow.mapSize.width = 2048;
keyLight.shadow.mapSize.height = 2048;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 100;
keyLight.shadow.camera.left = -30;
keyLight.shadow.camera.right = 30;
keyLight.shadow.camera.top = 30;
keyLight.shadow.camera.bottom = -30;
keyLight.shadow.bias = -0.0001;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8899cc, 1.5);
fillLight.position.set(-10, 5, -5);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 2);
rimLight.position.set(0, 3, -15);
scene.add(rimLight);

const uvLight = new THREE.PointLight(0x9b59ff, 8, 20);
uvLight.position.set(0, -2, 0);
scene.add(uvLight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 10;
controls.maxDistance = 80;
controls.maxPolarAngle = Math.PI * 0.7;
controls.update();

let animState = {
    isPaused: false,
    pauseResolve: null,
    stopRequested: false,
    currentPhase: 'idle',
    currentLayer: 0,
    previewLayer: -1,
};

const printer = createPrinterModel();
printer.setAnimState(animState);
scene.add(printer.group);

const modelGroup = new THREE.Group();
modelGroup.name = 'modelGroup';
printer.platformGroup.add(modelGroup);

const layerVisualGroup = new THREE.Group();
layerVisualGroup.name = 'layerVisualGroup';
printer.platformGroup.add(layerVisualGroup);

const supportGroup = new THREE.Group();
supportGroup.name = 'supportGroup';
printer.platformGroup.add(supportGroup);

let slicedLayers = [];
let supports = [];
let totalLayers = 0;
let currentLayer = 0;

let printState = 'idle';
let animationId = null;
let printSpeed = 1.0;
let animationStartTime = 0;
let perLayerAnimDuration = 0.4;

let currentGeometry = null;
let currentMesh = null;
let modelClones = [];
let modelHeight = 0;
let layerHeight = 0.2;

function clearModelGroups() {
    while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        disposeObject(child);
        modelGroup.remove(child);
    }
    while (layerVisualGroup.children.length > 0) {
        const child = layerVisualGroup.children[0];
        disposeObject(child);
        layerVisualGroup.remove(child);
    }
    while (supportGroup.children.length > 0) {
        const child = supportGroup.children[0];
        disposeObject(child);
        supportGroup.remove(child);
    }
    modelClones.forEach(obj => disposeObject(obj));
    modelClones = [];
    slicedLayers = [];
    supports = [];
    totalLayers = 0;
    currentLayer = 0;
    currentGeometry = null;
    currentMesh = null;
    animState.currentLayer = 0;
    animState.previewLayer = -1;
}

function disposeObject(obj) {
    if (!obj) return;
    obj.traverse(child => {
        if (child.geometry) {
            child.geometry.dispose();
        }
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => {
                    Object.values(m).forEach(v => {
                        if (v && v.isTexture) v.dispose();
                    });
                    m.dispose();
                });
            } else {
                Object.values(child.material).forEach(v => {
                    if (v && v.isTexture) v.dispose();
                });
                child.material.dispose();
            }
        }
    });
}

function resetPrint() {
    clearModelGroups();
    printer.resetPosition();
    updateProgressUI(0, 0, 0);
    updateStatus('idle');
    updateButtonStates('idle');
    updateRemainingTime('--:--');
    updatePhaseStatus('');
    updateTimelineMax(0);
    updateTimelineValue(0);
    printState = 'idle';
    animState.isPaused = false;
    animState.pauseResolve = null;
    animState.stopRequested = false;
    animState.currentPhase = 'idle';
    animState.currentLayer = 0;
    animState.previewLayer = -1;
    printer.setAnimState(animState);
}

async function loadModel(geometry) {
    resetPrint();

    layerHeight = parseFloat(document.getElementById('layer-height').value) || 0.2;

    geometry.computeBoundingBox();
    geometry.center();

    const bbox = geometry.boundingBox;
    modelHeight = bbox.max.y - bbox.min.y;
    totalLayers = Math.max(1, Math.ceil(modelHeight / layerHeight));

    geometry.computeBoundingBox();
    const bottomOffset = -bbox.min.y;
    geometry.translate(0, bottomOffset, 0);
    geometry.computeBoundingBox();

    currentGeometry = geometry;

    const clippingPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    const material = new THREE.MeshStandardMaterial({
        color: 0xaabbcc,
        roughness: 0.5,
        metalness: 0.1,
        transparent: true,
        opacity: 0.85,
        clippingPlanes: [clippingPlane],
        clipShadows: true,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = true;
    currentMesh = mesh;
    modelGroup.add(mesh);

    printer.setModelBounds(geometry.boundingBox.min, geometry.boundingBox.max);
    printer.setTotalLayers(totalLayers);
    printer.setLayerHeight(layerHeight);

    slicedLayers = sliceModel(geometry, layerHeight);
    supports = generateSupports(geometry, layerHeight);

    buildSupportVisuals(supports);
    buildLayerVisuals(slicedLayers);

    updateProgressUI(0, 0, totalLayers);
    updateStatus('idle');
    updateButtonStates('ready');
    updateTimelineMax(0);
    updateTimelineValue(0);

    return { layerHeight, modelHeight, totalLayers };
}

function buildSupportVisuals(supports) {
    supports.forEach(s => {
        const height = s.top.y - s.bottom.y;
        const geom = new THREE.CylinderGeometry(s.radiusBottom, s.radiusTop, height, 6, 4);
        const mat = new THREE.MeshStandardMaterial({
            color: 0xddaa33,
            roughness: 0.6,
            metalness: 0.1,
            transparent: true,
            opacity: 0.7,
        });
        const cone = new THREE.Mesh(geom, mat);
        cone.position.set(
            s.top.x,
            (s.top.y + s.bottom.y) / 2,
            s.top.z
        );
        cone.castShadow = true;
        cone.receiveShadow = true;
        supportGroup.add(cone);
    });
}

function buildLayerVisuals(layers) {
    layers.forEach((layer, index) => {
        const layerData = layer.loops;
        if (layerData.length === 0) return;

        const group = new THREE.Group();
        group.name = `layer-${index}`;
        group.visible = false;

        layerData.forEach(loopData => {
            const outerLoop = loopData.outer;
            if (outerLoop.length < 3) return;

            const shape = new THREE.Shape();
            shape.moveTo(outerLoop[0].x, outerLoop[0].y);
            for (let i = 1; i < outerLoop.length; i++) {
                shape.lineTo(outerLoop[i].x, outerLoop[i].y);
            }
            shape.closePath();

            if (loopData.holes && loopData.holes.length > 0) {
                loopData.holes.forEach(holeLoop => {
                    if (holeLoop.length < 3) return;
                    const hole = new THREE.Path();
                    hole.moveTo(holeLoop[0].x, holeLoop[0].y);
                    for (let i = 1; i < holeLoop.length; i++) {
                        hole.lineTo(holeLoop[i].x, holeLoop[i].y);
                    }
                    hole.closePath();
                    shape.holes.push(hole);
                });
            }

            const extrudeSettings = { steps: 1, depth: layer.thickness, bevelEnabled: false };
            const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            geom.translate(0, 0, -layer.thickness / 2);
            geom.rotateX(-Math.PI / 2);
            geom.translate(0, layer.height, 0);

            const mat = new THREE.MeshStandardMaterial({
                color: 0x5bc0de,
                roughness: 0.3,
                metalness: 0.05,
                transparent: true,
                opacity: 0.6,
                side: THREE.DoubleSide,
                depthWrite: false,
            });

            const mesh = new THREE.Mesh(geom, mat);
            mesh.renderOrder = 1;
            mesh.material.depthTest = true;
            group.add(mesh);
        });

        layerVisualGroup.add(group);
    });
}

function showLayerVisual(index) {
    const child = layerVisualGroup.getObjectByName(`layer-${index}`);
    if (child) child.visible = true;
}

function hideLayerVisual(index) {
    const child = layerVisualGroup.getObjectByName(`layer-${index}`);
    if (child) child.visible = false;
}

function hideAllLayerVisuals() {
    layerVisualGroup.children.forEach(c => { c.visible = false; });
}

function showAllLayerVisuals() {
    layerVisualGroup.children.forEach(c => { c.visible = true; });
}

function setModelClipping(revealY) {
    if (!currentMesh || !currentMesh.material) return;
    currentMesh.material.clippingPlanes[0] = new THREE.Plane(new THREE.Vector3(0, -1, 0), revealY);
    currentMesh.material.needsUpdate = true;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(16, ms * 1000)));
}

function checkPause() {
    return new Promise(resolve => {
        if (animState.isPaused) {
            animState.pauseResolve = resolve;
        } else {
            resolve();
        }
    });
}

function resolvePause() {
    if (animState.pauseResolve) {
        const r = animState.pauseResolve;
        animState.pauseResolve = null;
        r();
    }
}

function animate() {
    animationId = requestAnimationFrame(animate);
    controls.update();

    if (uvLight) {
        const time = performance.now() * 0.001;
        const targetIntensity = (printState === 'printing' || printState === 'complete') ? 8 : 3;
        uvLight.intensity += (targetIntensity - uvLight.intensity) * 0.05;
        uvLight.position.y = -2 + Math.sin(time * 0.5) * 0.3;
    }

    renderer.render(scene, camera);
}

async function startPrint() {
    if (printState === 'printing') return;
    if (printState === 'paused') {
        resumePrint();
        return;
    }
    if (!currentGeometry) {
        const preset = document.querySelector('.preset-item.active');
        const presetName = preset ? preset.dataset.preset : 'gear';
        const geom = createPresetModel(presetName);
        await loadModel(geom);
    }

    hideAllLayerVisuals();
    if (currentMesh) {
        setModelClipping(-999);
    }

    runPrintAnimation();
}

async function runPrintAnimation() {
    printState = 'printing';
    animState.isPaused = false;
    animState.stopRequested = false;
    animState.currentLayer = 0;
    animState.previewLayer = -1;
    updateStatus('printing');
    updateButtonStates('printing');
    updateTimelineMax(totalLayers);
    updateTimelineValue(0);
    animationStartTime = performance.now();

    updatePhaseStatus('lowering');
    const lowered = await printer.lowerPlatform();
    if (animState.stopRequested || !lowered) {
        handleAnimationStop();
        return;
    }

    const exposureTime = parseFloat(document.getElementById('exposure-time').value) || 2.5;

    for (let layer = 0; layer < totalLayers; layer++) {
        if (animState.stopRequested) break;

        updatePhaseStatus('lifting');
        const lifted = await printer.raiseOneLayer();
        if (animState.stopRequested || !lifted) break;

        await checkPause();
        if (animState.stopRequested) break;

        updatePhaseStatus('exposure');
        const revealY = (layer + 1) * printer.currentLayerHeight;
        setModelClipping(revealY);
        showLayerVisual(layer);

        animState.currentLayer = layer + 1;
        currentLayer = layer + 1;
        const progress = Math.round((currentLayer / totalLayers) * 100);
        const elapsed = (performance.now() - animationStartTime) / 1000;
        const remaining = totalLayers > 0 && currentLayer > 0
            ? Math.max(0, (elapsed / currentLayer) * (totalLayers - currentLayer))
            : 0;
        const remainingStr = remaining < 60
            ? `${Math.round(remaining)}s`
            : `${Math.floor(remaining / 60)}m ${Math.round(remaining % 60)}s`;

        updateProgressUI(progress, currentLayer, totalLayers);
        updateRemainingTime(remainingStr);
        updateTimelineValue(currentLayer);

        const exposureDur = exposureTime / printSpeed;
        const exposureStart = performance.now();
        while ((performance.now() - exposureStart) / 1000 < exposureDur) {
            if (animState.stopRequested) break;
            if (animState.isPaused) {
                await checkPause();
                continue;
            }
            await delay(0.05);
        }

        if (animState.stopRequested) break;

        await checkPause();
        if (animState.stopRequested) break;

        updatePhaseStatus('retraction');
        await delay(perLayerAnimDuration / printSpeed);

        await checkPause();
        if (animState.stopRequested) break;
    }

    if (animState.stopRequested) {
        handleAnimationStop();
        return;
    }

    updatePhaseStatus('raising');
    await printer.raiseToTop();

    if (currentMesh) {
        currentMesh.material.clippingPlanes = [];
        currentMesh.material.needsUpdate = true;
    }
    hideAllLayerVisuals();

    printState = 'complete';
    animState.currentPhase = 'complete';
    updateStatus('complete');
    updateButtonStates('complete');
    updateProgressUI(100, totalLayers, totalLayers);
    updateRemainingTime('完成');
    updatePhaseStatus('');
    updateTimelineMax(totalLayers);
    updateTimelineValue(totalLayers);
}

function handleAnimationStop() {
    printState = 'idle';
    animState.isPaused = false;
    animState.stopRequested = false;
    if (animState.pauseResolve) {
        animState.pauseResolve();
        animState.pauseResolve = null;
    }
    resetPrint();
    updateStatus('idle');
    updateButtonStates('idle');
    updateProgressUI(0, 0, 0);
    updateRemainingTime('--:--');
    updatePhaseStatus('');
}

function pausePrint() {
    if (printState !== 'printing') return;
    animState.isPaused = true;
    animState.currentPhase = 'paused';
    updateStatus('paused');
    updateButtonStates('paused');
    updatePhaseStatus('paused');
    printState = 'paused';
    updateTimelineMax(currentLayer);
    updateTimelineValue(currentLayer);
}

function resumePrint() {
    if (printState !== 'paused') return;
    animState.isPaused = false;
    animState.previewLayer = -1;
    updateStatus('printing');
    updateButtonStates('printing');
    printState = 'printing';
    setModelClipping(currentLayer * printer.currentLayerHeight);
    hideAllLayerVisuals();
    for (let i = 0; i < currentLayer; i++) {
        showLayerVisual(i);
    }
    updateTimelineValue(currentLayer);
    resolvePause();
}

function stopPrint() {
    animState.stopRequested = true;
    animState.isPaused = false;
    resolvePause();
    printState = 'idle';
    resetPrint();
    updateStatus('idle');
    updateButtonStates('idle');
    updateProgressUI(0, 0, 0);
    updateRemainingTime('--:--');
    updatePhaseStatus('');
}

function previewLayer(layerIndex) {
    if (printState !== 'paused') return;
    const idx = Math.max(0, Math.min(currentLayer, layerIndex));
    animState.previewLayer = idx;

    const revealY = idx * printer.currentLayerHeight;
    setModelClipping(revealY);

    hideAllLayerVisuals();
    for (let i = 0; i < idx; i++) {
        showLayerVisual(i);
    }

    const platformY = printer.resinSurfaceY + idx * printer.currentLayerHeight;
    printer.platformGroup.position.y = Math.min(platformY, printer.bottomPlatformY + 6);
    printer.currentPlatformY = printer.platformGroup.position.y;

    const elapsed = (performance.now() - animationStartTime) / 1000;
    const remaining = totalLayers > 0 && idx > 0
        ? Math.max(0, (elapsed / currentLayer) * (totalLayers - idx))
        : 0;
    const remainingStr = remaining < 60
        ? `${Math.round(remaining)}s`
        : `${Math.floor(remaining / 60)}m ${Math.round(remaining % 60)}s`;

    const progress = totalLayers > 0 ? Math.round((idx / totalLayers) * 100) : 0;
    updateProgressUI(progress, idx, totalLayers);
    updateRemainingTime(remainingStr);
    updateStatus('paused', `预览第 ${idx} 层（共 ${currentLayer} 层已打印）`);
}

function restoreFromPreview() {
    if (animState.previewLayer < 0) return;
    animState.previewLayer = -1;

    setModelClipping(currentLayer * printer.currentLayerHeight);
    hideAllLayerVisuals();
    for (let i = 0; i < currentLayer; i++) {
        showLayerVisual(i);
    }

    const platformY = currentLayer * printer.currentLayerHeight;
    printer.platformGroup.position.y = Math.min(printer.resinSurfaceY + platformY, printer.bottomPlatformY + 6);
    printer.currentPlatformY = printer.platformGroup.position.y;

    const progress = totalLayers > 0 ? Math.round((currentLayer / totalLayers) * 100) : 0;
    const elapsed = (performance.now() - animationStartTime) / 1000;
    const remaining = totalLayers > 0 && currentLayer > 0
        ? Math.max(0, (elapsed / currentLayer) * (totalLayers - currentLayer))
        : 0;
    const remainingStr = remaining < 60
        ? `${Math.round(remaining)}s`
        : `${Math.floor(remaining / 60)}m ${Math.round(remaining % 60)}s`;

    updateProgressUI(progress, currentLayer, totalLayers);
    updateRemainingTime(remainingStr);
    updateStatus('paused');
    updateTimelineValue(currentLayer);
}

async function handleFileUpload(file) {
    if (!file.name.toLowerCase().endsWith('.stl')) {
        alert('请上传 .stl 格式的文件');
        return;
    }

    updateStatus('idle', '加载 STL 文件中...');

    try {
        const arrayBuffer = await file.arrayBuffer();
        const loader = new STLLoader();
        const geometry = loader.parse(arrayBuffer);
        geometry.computeVertexNormals();

        await loadModel(geometry);
        updateStatus('idle', `已加载: ${file.name}`);
    } catch (err) {
        updateStatus('error', 'STL 加载失败');
    }
}

async function handlePresetSelect(presetName) {
    document.querySelectorAll('.preset-item').forEach(el => el.classList.remove('active'));
    const el = document.querySelector(`[data-preset="${presetName}"]`);
    if (el) el.classList.add('active');

    updateStatus('idle', '生成预设模型中...');
    const geom = createPresetModel(presetName);
    await loadModel(geom);
    updateStatus('idle');
}

function handleExport(format) {
    if (printState !== 'complete') {
        alert('请等待打印完成后再导出');
        return;
    }
    if (format === 'gif') {
        exportGIF(renderer, camera, scene, layerVisualGroup, totalLayers, setExportProgress);
    } else if (format === 'png') {
        exportPNGFrames(renderer, camera, scene, layerVisualGroup, totalLayers, setExportProgress);
    }
}

initUI({
    onStart: startPrint,
    onPause: pausePrint,
    onResume: resumePrint,
    onStop: stopPrint,
    onReset: () => {
        stopPrint();
        const preset = document.querySelector('.preset-item.active');
        const presetName = preset ? preset.dataset.preset : 'gear';
        const geom = createPresetModel(presetName);
        loadModel(geom);
    },
    onSpeedChange: (speed) => {
        printSpeed = speed;
        document.getElementById('speed-value').textContent = `${speed}x`;
    },
    onPresetSelect: handlePresetSelect,
    onFileUpload: handleFileUpload,
    onExport: handleExport,
    onTimelineChange: previewLayer,
    onTimelineRestore: restoreFromPreview,
});

async function init() {
    animate();
    const geom = createPresetModel('gear');
    await loadModel(geom);
}

window.addEventListener('resize', () => {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
});

init();