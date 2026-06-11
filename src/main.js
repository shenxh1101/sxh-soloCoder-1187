import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { createPrinterModel } from './printer.js';
import { sliceModel, generateSupports } from './slicer.js';
import { createPresetModel } from './presets.js';
import { initUI, updateProgressUI, updateStatus, updateButtonStates, updateRemainingTime, setExportProgress, updatePhaseStatus, updateTimelineMax, updateTimelineValue, updateTimelineInfo, updateInspectStats } from './ui.js';
import { runExport, detectVideoCodec } from './export.js';

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
let modelHeight = 0;
let layerHeight = 0.2;
let exposureTime = 2.5;
let currentModelName = '';

let printState = 'idle';
let animationId = null;
let printSpeed = 1.0;
let animationStartTime = 0;
let perLayerAnimDuration = 0.4;
let printStartTime = 0;
let printEndTime = 0;

let currentGeometry = null;
let currentMesh = null;
let modelClones = [];
let layerPhaseLog = [];

let inspectState = {
    active: false,
    cutHeight: 0,
    viewMode: 'model',
};

function clearModelGroups() {
    while (modelGroup.children.length > 0) {
        disposeObject(modelGroup.children[0]);
        modelGroup.remove(modelGroup.children[0]);
    }
    while (layerVisualGroup.children.length > 0) {
        disposeObject(layerVisualGroup.children[0]);
        layerVisualGroup.remove(layerVisualGroup.children[0]);
    }
    while (supportGroup.children.length > 0) {
        disposeObject(supportGroup.children[0]);
        supportGroup.remove(supportGroup.children[0]);
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
    layerPhaseLog = [];
}

function disposeObject(obj) {
    if (!obj) return;
    obj.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => {
                    Object.values(m).forEach(v => { if (v && v.isTexture) v.dispose(); });
                    m.dispose();
                });
            } else {
                Object.values(child.material).forEach(v => { if (v && v.isTexture) v.dispose(); });
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
    updateTimelineInfo('');
    updateInspectStats('', '', '');
    printState = 'idle';
    animState.isPaused = false;
    animState.pauseResolve = null;
    animState.stopRequested = false;
    animState.currentPhase = 'idle';
    animState.currentLayer = 0;
    animState.previewLayer = -1;
    printer.setAnimState(animState);
    exitInspectionMode();
    printStartTime = 0;
    printEndTime = 0;
    currentModelName = '';
}

async function loadModel(geometry, modelName) {
    resetPrint();
    layerHeight = parseFloat(document.getElementById('layer-height').value) || 0.2;
    exposureTime = parseFloat(document.getElementById('exposure-time').value) || 2.5;
    currentModelName = modelName || '自定义模型';

    geometry.computeBoundingBox();
    geometry.center();
    const bbox = geometry.boundingBox;
    modelHeight = bbox.max.y - bbox.min.y;
    totalLayers = Math.max(1, Math.ceil(modelHeight / layerHeight));

    geometry.translate(0, -bbox.min.y, 0);
    geometry.computeBoundingBox();
    currentGeometry = geometry;

    const clippingPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    const material = new THREE.MeshStandardMaterial({
        color: 0xaabbcc, roughness: 0.5, metalness: 0.1,
        transparent: true, opacity: 0.85,
        clippingPlanes: [clippingPlane], clipShadows: true, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.visible = true;
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
    updateTimelineInfo('');
    return { layerHeight, modelHeight, totalLayers };
}

function buildSupportVisuals(supports) {
    supports.forEach(s => {
        const h = s.top.y - s.bottom.y;
        const g = new THREE.CylinderGeometry(s.radiusBottom, s.radiusTop, h, 6, 4);
        const m = new THREE.MeshStandardMaterial({ color: 0xddaa33, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.7 });
        const cone = new THREE.Mesh(g, m);
        cone.position.set(s.top.x, (s.top.y + s.bottom.y) / 2, s.top.z);
        cone.castShadow = true; cone.receiveShadow = true;
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
            for (let i = 1; i < outerLoop.length; i++) shape.lineTo(outerLoop[i].x, outerLoop[i].y);
            shape.closePath();
            if (loopData.holes && loopData.holes.length > 0) {
                loopData.holes.forEach(holeLoop => {
                    if (holeLoop.length < 3) return;
                    const hole = new THREE.Path();
                    hole.moveTo(holeLoop[0].x, holeLoop[0].y);
                    for (let i = 1; i < holeLoop.length; i++) hole.lineTo(holeLoop[i].x, holeLoop[i].y);
                    hole.closePath();
                    shape.holes.push(hole);
                });
            }
            const es = { steps: 1, depth: layer.thickness, bevelEnabled: false };
            const geom = new THREE.ExtrudeGeometry(shape, es);
            geom.translate(0, 0, -layer.thickness / 2);
            geom.rotateX(-Math.PI / 2);
            geom.translate(0, layer.height, 0);
            const mat = new THREE.MeshStandardMaterial({ color: 0x5bc0de, roughness: 0.3, metalness: 0.05, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.renderOrder = 1; mesh.material.depthTest = true;
            group.add(mesh);
        });
        layerVisualGroup.add(group);
    });
}

function showLayerVisual(index) { const c = layerVisualGroup.getObjectByName(`layer-${index}`); if (c) c.visible = true; }
function hideLayerVisual(index) { const c = layerVisualGroup.getObjectByName(`layer-${index}`); if (c) c.visible = false; }
function hideAllLayerVisuals() { layerVisualGroup.children.forEach(c => { c.visible = false; }); }
function showAllLayerVisuals() { layerVisualGroup.children.forEach(c => { c.visible = true; }); }

function setModelClipping(revealY) {
    if (!currentMesh || !currentMesh.material) return;
    if (!currentMesh.material.clippingPlanes || currentMesh.material.clippingPlanes.length === 0) {
        currentMesh.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), revealY)];
    } else {
        currentMesh.material.clippingPlanes[0] = new THREE.Plane(new THREE.Vector3(0, -1, 0), revealY);
    }
    currentMesh.material.needsUpdate = true;
}

function clearModelClipping() {
    if (!currentMesh || !currentMesh.material) return;
    currentMesh.material.clippingPlanes = [];
    currentMesh.material.needsUpdate = true;
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(16, ms * 1000))); }

function checkPause() {
    return new Promise(resolve => {
        if (animState.isPaused) { animState.pauseResolve = resolve; } else { resolve(); }
    });
}

function resolvePause() {
    if (animState.pauseResolve) { const r = animState.pauseResolve; animState.pauseResolve = null; r(); }
}

function animate() {
    animationId = requestAnimationFrame(animate);
    controls.update();
    if (uvLight) {
        const t = performance.now() * 0.001;
        uvLight.intensity += (printState === 'printing' || printState === 'complete' ? 8 : 3 - uvLight.intensity) * 0.05;
        uvLight.position.y = -2 + Math.sin(t * 0.5) * 0.3;
    }
    renderer.render(scene, camera);
}

async function startPrint() {
    if (printState === 'printing') return;
    if (printState === 'paused') { resumePrint(); return; }
    if (!currentGeometry) {
        const preset = document.querySelector('.preset-item.active');
        const pn = preset ? preset.dataset.preset : 'gear';
        await loadModel(createPresetModel(pn), pn);
    }
    exitInspectionMode();
    hideAllLayerVisuals();
    if (currentMesh) setModelClipping(-999);
    runPrintAnimation();
}

async function runPrintAnimation() {
    printState = 'printing';
    animState.isPaused = false;
    animState.stopRequested = false;
    animState.currentLayer = 0;
    animState.previewLayer = -1;
    layerPhaseLog = [];
    updateStatus('printing');
    updateButtonStates('printing');
    updateTimelineMax(totalLayers);
    updateTimelineValue(0);
    updateTimelineInfo('');
    printStartTime = performance.now();
    animationStartTime = printStartTime;

    updatePhaseStatus('lowering');
    const lowered = await printer.lowerPlatform();
    if (animState.stopRequested || !lowered) { handleAnimationStop(); return; }

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

        const elapsed = (performance.now() - animationStartTime) / 1000;
        const remaining = totalLayers > 0 && currentLayer > 0 ? Math.max(0, (elapsed / currentLayer) * (totalLayers - currentLayer)) : 0;
        const remainingStr = remaining < 60 ? `${Math.round(remaining)}s` : `${Math.floor(remaining / 60)}m ${Math.round(remaining % 60)}s`;

        updateProgressUI(Math.round((currentLayer / totalLayers) * 100), currentLayer, totalLayers);
        updateRemainingTime(remainingStr);
        updateTimelineValue(currentLayer);

        layerPhaseLog.push({ layer: currentLayer, phase: 'exposure' });

        const expStart = performance.now();
        while ((performance.now() - expStart) / 1000 < exposureTime / printSpeed) {
            if (animState.stopRequested) break;
            if (animState.isPaused) { await checkPause(); continue; }
            await delay(0.05);
        }
        if (animState.stopRequested) break;
        await checkPause();
        if (animState.stopRequested) break;

        updatePhaseStatus('retraction');
        layerPhaseLog.push({ layer: currentLayer, phase: 'retraction' });
        await delay(perLayerAnimDuration / printSpeed);
        await checkPause();
        if (animState.stopRequested) break;
    }

    if (animState.stopRequested) { handleAnimationStop(); return; }

    updatePhaseStatus('raising');
    await printer.raiseToTop();
    clearModelClipping();
    hideAllLayerVisuals();

    printEndTime = performance.now();
    printState = 'complete';
    animState.currentPhase = 'complete';
    updateStatus('complete');
    updateButtonStates('complete');
    updateProgressUI(100, totalLayers, totalLayers);
    updateRemainingTime('完成');
    updatePhaseStatus('');
    updateTimelineMax(totalLayers);
    updateTimelineValue(totalLayers);
    updateTimelineInfo('点击"成品检查"查看内部结构');
}

function getPhaseAtLayer(layerIdx) {
    if (layerIdx <= 0) return 'lowering';
    if (totalLayers <= 0) return 'exposure';
    const ratio = layerIdx / totalLayers;
    if (ratio < 0.15) return 'lifting';
    if (ratio < 0.50) return 'exposure';
    if (ratio < 0.85) return 'retraction';
    return 'exposure';
}

function getPhaseLabel(phase) {
    return { lowering: '平台下降', lifting: '平台抬升', exposure: 'UV曝光固化', retraction: '回落等待' }[phase] || phase;
}

function handleAnimationStop() {
    printState = 'idle';
    animState.isPaused = false;
    animState.stopRequested = false;
    if (animState.pauseResolve) { animState.pauseResolve(); animState.pauseResolve = null; }
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
    updateTimelineInfo('拖动滑块预览已打印层');
}

function resumePrint() {
    if (printState !== 'paused') return;
    animState.isPaused = false;
    animState.previewLayer = -1;

    setModelClipping(currentLayer * printer.currentLayerHeight);
    hideAllLayerVisuals();
    for (let i = 0; i < currentLayer; i++) showLayerVisual(i);

    const platformY = printer.resinSurfaceY - 1 + currentLayer * printer.currentLayerHeight;
    printer.platformGroup.position.y = Math.min(platformY, printer.bottomPlatformY + 6);
    printer.currentPlatformY = printer.platformGroup.position.y;

    const progress = totalLayers > 0 ? Math.round((currentLayer / totalLayers) * 100) : 0;
    const elapsed = (performance.now() - animationStartTime) / 1000;
    const remaining = totalLayers > 0 && currentLayer > 0
        ? Math.max(0, (elapsed / currentLayer) * (totalLayers - currentLayer)) : 0;
    const remainingStr = remaining < 60 ? `${Math.round(remaining)}s` : `${Math.floor(remaining / 60)}m ${Math.round(remaining % 60)}s`;

    updateProgressUI(progress, currentLayer, totalLayers);
    updateRemainingTime(remainingStr);
    updateTimelineValue(currentLayer);
    updateTimelineInfo('');
    updateStatus('printing');
    updatePhaseStatus('exposure');
    updateButtonStates('printing');
    printState = 'printing';
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
    for (let i = 0; i < idx; i++) showLayerVisual(i);

    const platformY = printer.resinSurfaceY - 1 + idx * printer.currentLayerHeight;
    printer.platformGroup.position.y = Math.min(platformY, printer.bottomPlatformY + 6);
    printer.currentPlatformY = printer.platformGroup.position.y;

    const elapsed = (performance.now() - animationStartTime) / 1000;
    const elapsedStr = elapsed < 60 ? `${Math.round(elapsed)}s` : `${Math.floor(elapsed / 60)}m ${Math.round(elapsed % 60)}s`;
    const remaining = totalLayers > 0 && idx > 0 ? Math.max(0, (elapsed / currentLayer) * (totalLayers - idx)) : 0;
    const remainingStr = remaining < 60 ? `${Math.round(remaining)}s` : `${Math.floor(remaining / 60)}m ${Math.round(remaining % 60)}s`;

    const layerHeightMm = (idx * printer.currentLayerHeight).toFixed(2);
    const phase = getPhaseAtLayer(idx);
    const phaseLabel = getPhaseLabel(phase);

    updateProgressUI(Math.round((idx / Math.max(1, totalLayers)) * 100), idx, totalLayers);
    updateRemainingTime(remainingStr);
    updateTimelineValue(idx);

    const info = `层 ${idx}/${currentLayer} | 高度 ${layerHeightMm}mm | 阶段: ${phaseLabel}`;
    const info2 = `已用 ${elapsedStr} | 剩余 ${remainingStr}`;
    updateTimelineInfo(info + '\n' + info2);
    updatePhaseStatus(phase);
    updateStatus('paused', `预览第 ${idx} 层（实际 ${currentLayer} 层）| ${phaseLabel}`);
}

function restoreFromPreview() {
    if (animState.previewLayer < 0) return;
    animState.previewLayer = -1;

    setModelClipping(currentLayer * printer.currentLayerHeight);
    hideAllLayerVisuals();
    for (let i = 0; i < currentLayer; i++) showLayerVisual(i);

    const platformY = printer.resinSurfaceY - 1 + currentLayer * printer.currentLayerHeight;
    printer.platformGroup.position.y = Math.min(platformY, printer.bottomPlatformY + 6);
    printer.currentPlatformY = printer.platformGroup.position.y;

    const progress = totalLayers > 0 ? Math.round((currentLayer / totalLayers) * 100) : 0;
    const elapsed = (performance.now() - animationStartTime) / 1000;
    const remaining = totalLayers > 0 && currentLayer > 0
        ? Math.max(0, (elapsed / currentLayer) * (totalLayers - currentLayer)) : 0;
    const remainingStr = remaining < 60 ? `${Math.round(remaining)}s` : `${Math.floor(remaining / 60)}m ${Math.round(remaining % 60)}s`;

    updateProgressUI(progress, currentLayer, totalLayers);
    updateRemainingTime(remainingStr);
    updateTimelineValue(currentLayer);
    updateTimelineInfo('拖动滑块预览已打印层');
    updateStatus('paused');
    updatePhaseStatus('paused');
}

function enterInspectionMode() {
    if (printState !== 'complete') return;
    inspectState.active = true;
    inspectState.viewMode = 'model';
    inspectState.cutHeight = modelHeight / 2;

    if (currentMesh && currentMesh.material) {
        currentMesh.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), modelHeight)];
        currentMesh.material.side = THREE.DoubleSide;
        currentMesh.material.needsUpdate = true;
    }

    showAllLayerVisuals();
    modelGroup.visible = true;
    layerVisualGroup.visible = false;
    supportGroup.visible = false;

    updateButtonStates('inspect');
    updateStatus('complete', '质检台 - 拖动剖切滑块查看内部');
    updateInspectUI();
}

function exitInspectionMode() {
    if (!inspectState.active) return;
    inspectState.active = false;

    if (currentMesh && currentMesh.material) {
        currentMesh.material.clippingPlanes = [];
        currentMesh.material.side = THREE.DoubleSide;
        currentMesh.material.needsUpdate = true;
    }

    hideAllLayerVisuals();
    modelGroup.visible = true;
    layerVisualGroup.visible = false;
    supportGroup.visible = false;

    if (printState === 'complete') { updateButtonStates('complete'); updateStatus('complete'); }
    updateInspectStats('', '', '');
}

function setInspectionCut(normalizedHeight) {
    if (!inspectState.active) return;
    inspectState.cutHeight = normalizedHeight * modelHeight;
    const cutY = inspectState.cutHeight;

    if (currentMesh && currentMesh.material) {
        if (!currentMesh.material.clippingPlanes || currentMesh.material.clippingPlanes.length === 0) {
            currentMesh.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), cutY)];
        } else {
            currentMesh.material.clippingPlanes[0] = new THREE.Plane(new THREE.Vector3(0, -1, 0), cutY);
        }
        currentMesh.material.needsUpdate = true;
    }

    computeInspectionStats(cutY);
    updateInspectUI();
}

function computeInspectionStats(cutY) {
    let layerIdx = -1;
    let minDist = Infinity;
    for (let i = 0; i < slicedLayers.length; i++) {
        const dist = Math.abs(slicedLayers[i].height - cutY);
        if (dist < minDist) { minDist = dist; layerIdx = i; }
    }
    if (layerIdx < 0 || layerIdx >= slicedLayers.length) { updateInspectStats('--', '--', '--'); return; }

    const layer = slicedLayers[layerIdx];
    let totalArea = 0;
    layer.loops.forEach(loopData => {
        const outerArea = Math.abs(polygonAreaXZ(loopData.outer));
        let holeArea = 0;
        if (loopData.holes) loopData.holes.forEach(hole => { holeArea += Math.abs(polygonAreaXZ(hole)); });
        totalArea += Math.max(0, outerArea - holeArea);
    });
    const holeCount = layer.holes ? layer.holes.length : 0;
    const supportContacts = supports.filter(s => Math.abs(s.top.y - cutY) < layerHeight * 2).length;

    updateInspectStats(
        totalArea > 0 ? `${(totalArea * 100).toFixed(1)} mm²` : '--',
        `${holeCount} 个`,
        `${supportContacts} 个触点`
    );
}

function polygonAreaXZ(loop) {
    if (loop.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < loop.length - 1; i++) {
        area += loop[i].x * loop[i + 1].y - loop[i + 1].x * loop[i].y;
    }
    return area / 2;
}

function setInspectViewMode(mode) {
    if (!inspectState.active) return;
    inspectState.viewMode = mode;
    modelGroup.visible = mode === 'model' || mode === 'all';
    layerVisualGroup.visible = mode === 'layers' || mode === 'all';
    supportGroup.visible = mode === 'supports' || mode === 'all';
    updateInspectUI();
}

function updateInspectUI() {
    const cutMm = inspectState.cutHeight.toFixed(2);
    const normalized = modelHeight > 0 ? Math.round((inspectState.cutHeight / modelHeight) * 100) : 50;
    const label = document.getElementById('inspect-cut-label');
    if (label) label.textContent = `${normalized}% (${cutMm}mm)`;
    updateStatus('complete', `质检台 | 剖切 ${cutMm}mm | 视图: ${inspectState.viewMode}`);
}

async function generateReport() {
    if (printState !== 'complete') { alert('请等待打印完成后再生成报告'); return; }

    setExportProgress(0, '正在渲染报告预览图...');

    const origModelVis = modelGroup.visible;
    const origLayerVis = layerVisualGroup.visible;
    const origSuppVis = supportGroup.visible;
    const origClip = currentMesh && currentMesh.material
        ? currentMesh.material.clippingPlanes.slice() : [];

    modelGroup.visible = true;
    layerVisualGroup.visible = false;
    supportGroup.visible = false;
    if (currentMesh && currentMesh.material) {
        currentMesh.material.clippingPlanes = [];
        currentMesh.material.needsUpdate = true;
    }
    renderer.render(scene, camera);
    const imgOverall = renderer.domElement.toDataURL('image/jpeg', 0.85);
    setExportProgress(25, '渲染截面图...');

    if (currentMesh && currentMesh.material) {
        currentMesh.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), modelHeight * 0.5)];
        currentMesh.material.side = THREE.DoubleSide;
        currentMesh.material.needsUpdate = true;
    }
    layerVisualGroup.visible = true;
    renderer.render(scene, camera);
    const imgSection = renderer.domElement.toDataURL('image/jpeg', 0.85);
    setExportProgress(50, '渲染支撑图...');

    modelGroup.visible = false;
    layerVisualGroup.visible = false;
    supportGroup.visible = true;
    if (currentMesh && currentMesh.material) {
        currentMesh.material.clippingPlanes = [];
        currentMesh.material.needsUpdate = true;
    }
    renderer.render(scene, camera);
    const imgSupports = renderer.domElement.toDataURL('image/jpeg', 0.85);
    setExportProgress(75, '生成报告...');

    modelGroup.visible = origModelVis;
    layerVisualGroup.visible = origLayerVis;
    supportGroup.visible = origSuppVis;
    if (currentMesh && currentMesh.material) {
        currentMesh.material.clippingPlanes = origClip;
        currentMesh.material.side = THREE.DoubleSide;
        currentMesh.material.needsUpdate = true;
    }

    const totalElapsed = (printEndTime - printStartTime) / 1000;
    const totalTimeStr = totalElapsed < 60
        ? `${Math.round(totalElapsed)}s`
        : `${Math.floor(totalElapsed / 60)}m ${Math.round(totalElapsed % 60)}s`;

    const supportCount = supports.length;
    let riskLevel = '低';
    let riskNote = '模型结构稳定，打印成功率较高。';
    if (supportCount > 20) { riskLevel = '中'; riskNote = '存在较多悬垂区域，建议检查支撑是否充分。'; }
    if (supportCount > 50) { riskLevel = '高'; riskNote = '大量悬垂区域，强烈建议增加支撑密度或调整模型方向。'; }
    if (totalLayers > 500) { riskLevel = riskLevel === '低' ? '中' : riskLevel; riskNote += ' 层数较多，建议使用高质量树脂并注意温度控制。'; }

    const now = new Date().toLocaleString('zh-CN');
    const riskClass = riskLevel === '高' ? 'high' : riskLevel === '中' ? 'mid' : 'low';

    const reportHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>3D打印结果报告</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;background:#0d1117;color:#c9d1d9;padding:40px;max-width:900px;margin:auto}
h1{color:#58a6ff;font-size:24px;margin-bottom:8px;border-bottom:2px solid #30363d;padding-bottom:12px}
h2{color:#8b949e;font-size:14px;font-weight:400;margin-bottom:24px}
h3{color:#58a6ff;font-size:16px;margin:24px 0 12px;border-bottom:1px solid #21262d;padding-bottom:8px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.item{background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:12px}
.item-label{font-size:11px;color:#8b949e;margin-bottom:4px}
.item-value{font-size:16px;font-weight:600;color:#58a6ff}
.risk-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-weight:600;font-size:12px}
.risk-low{color:#3fb950;background:rgba(63,185,80,0.15)}
.risk-mid{color:#d29922;background:rgba(210,153,34,0.15)}
.risk-high{color:#f85149;background:rgba(248,81,73,0.15)}
.note{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;margin-top:12px;font-size:13px;line-height:1.6}
.img-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px}
.img-card{background:#0d1117;border:1px solid #21262d;border-radius:6px;overflow:hidden}
.img-card img{width:100%;display:block}
.img-card-label{padding:6px;font-size:10px;color:#8b949e;text-align:center}
.footer{text-align:center;color:#484f58;font-size:11px;margin-top:32px;padding-top:16px;border-top:1px solid #21262d}
</style>
</head>
<body>
<h1>🔬 光固化3D打印结果报告</h1>
<h2>生成时间: ${now}</h2>
<div class="card">
<h3>📋 基本信息</h3>
<div class="grid">
<div class="item"><div class="item-label">模型名称</div><div class="item-value" style="font-size:14px">${currentModelName}</div></div>
<div class="item"><div class="item-label">总层数</div><div class="item-value">${totalLayers}</div></div>
<div class="item"><div class="item-label">层厚</div><div class="item-value">${layerHeight.toFixed(2)} mm</div></div>
<div class="item"><div class="item-label">模型高度</div><div class="item-value">${modelHeight.toFixed(2)} mm</div></div>
<div class="item"><div class="item-label">曝光时间</div><div class="item-value">${exposureTime.toFixed(1)} s</div></div>
<div class="item"><div class="item-label">总耗时</div><div class="item-value">${totalTimeStr}</div></div>
</div>
</div>
<div class="card">
<h3>🔧 支撑与风险</h3>
<div class="grid">
<div class="item"><div class="item-label">支撑数量</div><div class="item-value">${supportCount} 个</div></div>
<div class="item"><div class="item-label">失败风险</div><div class="item-value"><span class="risk-badge risk-${riskClass}">${riskLevel}</span></div></div>
</div>
<div class="note"><strong>⚠️ 风险提示：</strong>${riskNote}</div>
</div>
<div class="card">
<h3>📸 预览图</h3>
<div class="img-grid">
<div class="img-card"><img src="${imgOverall}" alt="成品整体"><div class="img-card-label">成品整体视图</div></div>
<div class="img-card"><img src="${imgSection}" alt="剖切截面"><div class="img-card-label">50% 剖切截面</div></div>
<div class="img-card"><img src="${imgSupports}" alt="支撑结构"><div class="img-card-label">支撑结构视图</div></div>
</div>
</div>
<div class="footer"><p>由 光固化3D打印机模拟器 自动生成</p></div>
</body>
</html>`;

    const blob = new Blob([reportHTML], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `print_report_${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    setExportProgress(100, '报告已生成并下载');
    updateStatus('complete', '报告已生成并下载');
}

async function handleFileUpload(file) {
    if (!file.name.toLowerCase().endsWith('.stl')) { alert('请上传 .stl 格式的文件'); return; }
    updateStatus('idle', '加载 STL 文件中...');
    try {
        const ab = await file.arrayBuffer();
        const geo = new STLLoader().parse(ab);
        geo.computeVertexNormals();
        await loadModel(geo, file.name);
        updateStatus('idle', `已加载: ${file.name}`);
    } catch (e) { updateStatus('error', 'STL 加载失败'); }
}

async function handlePresetSelect(presetName) {
    document.querySelectorAll('.preset-item').forEach(el => el.classList.remove('active'));
    const el = document.querySelector(`[data-preset="${presetName}"]`);
    if (el) el.classList.add('active');
    updateStatus('idle', '生成预设模型中...');
    await loadModel(createPresetModel(presetName), presetName);
    updateStatus('idle');
}

function handleExport() {
    if (printState !== 'complete' && printState !== 'paused') {
        alert('请等待打印完成后再导出'); return;
    }
    const format = document.getElementById('export-format').value;
    if (format === 'video') {
        const codec = detectVideoCodec();
        if (!codec.isMP4) {
            alert('⚠️ 当前浏览器不支持 MP4 录制（需要 Safari 或特定 Chrome/Edge 版本）。请改用 GIF 或 PNG 帧序列格式。');
            return;
        }
    }
    const fps = parseInt(document.getElementById('export-fps').value) || 10;
    const resolution = document.getElementById('export-resolution').value;
    const watermark = document.getElementById('export-watermark').checked;
    const exportLayers = printState === 'paused' ? currentLayer : totalLayers;

    setExportProgress(0, '正在初始化导出...');
    runExport({
        format, fps, resolution, watermark,
        renderer, camera, scene, layerVisualGroup, supportGroup, modelGroup,
        totalLayers: exportLayers, currentLayer: exportLayers,
        onProgress: (pct, txt) => setExportProgress(pct, txt),
    }).catch(err => setExportProgress(100, `导出失败: ${err.message}`));
}

initUI({
    onStart: startPrint,
    onPause: pausePrint,
    onResume: resumePrint,
    onStop: stopPrint,
    onReset: () => {
        stopPrint();
        const preset = document.querySelector('.preset-item.active');
        const pn = preset ? preset.dataset.preset : 'gear';
        loadModel(createPresetModel(pn), pn);
    },
    onSpeedChange: speed => {
        printSpeed = speed;
        document.getElementById('speed-value').textContent = `${speed}x`;
    },
    onPresetSelect: handlePresetSelect,
    onFileUpload: handleFileUpload,
    onExport: handleExport,
    onTimelineChange: previewLayer,
    onTimelineRestore: restoreFromPreview,
    onInspectEnter: enterInspectionMode,
    onInspectExit: exitInspectionMode,
    onInspectCut: setInspectionCut,
    onInspectView: setInspectViewMode,
    onReport: generateReport,
});

async function init() {
    animate();
    await loadModel(createPresetModel('gear'), 'gear');
}

window.addEventListener('resize', () => {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
});

init();