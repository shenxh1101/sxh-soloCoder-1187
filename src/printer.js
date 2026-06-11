import * as THREE from 'three';

export function createPrinterModel() {
    const group = new THREE.Group();

    const vatGroup = new THREE.Group();
    const vatWidth = 14;
    const vatDepth = 14;
    const vatHeight = 6;
    const vatWallThickness = 0.5;

    const vatBottom = new THREE.BoxGeometry(vatWidth, vatWallThickness, vatDepth);
    const vatBottomMesh = new THREE.Mesh(vatBottom, new THREE.MeshStandardMaterial({
        color: 0x555566,
        roughness: 0.3,
        metalness: 0.8,
    }));
    vatBottomMesh.position.y = -vatHeight / 2;
    vatBottomMesh.receiveShadow = true;
    vatGroup.add(vatBottomMesh);

    const walls = [
        { w: vatWidth, d: vatWallThickness, x: 0, z: -vatDepth / 2 + vatWallThickness / 2 },
        { w: vatWidth, d: vatWallThickness, x: 0, z: vatDepth / 2 - vatWallThickness / 2 },
        { w: vatWallThickness, d: vatDepth - vatWallThickness * 2, x: -vatWidth / 2 + vatWallThickness / 2, z: 0 },
        { w: vatWallThickness, d: vatDepth - vatWallThickness * 2, x: vatWidth / 2 - vatWallThickness / 2, z: 0 },
    ];

    const wallMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x8899aa,
        roughness: 0.1,
        metalness: 0.05,
        transparent: true,
        opacity: 0.3,
        envMapIntensity: 0.5,
    });

    walls.forEach(wall => {
        const wallGeom = new THREE.BoxGeometry(wall.w, vatHeight, wall.d);
        const wallMesh = new THREE.Mesh(wallGeom, wallMaterial);
        wallMesh.position.set(wall.x, 0, wall.z);
        wallMesh.receiveShadow = true;
        vatGroup.add(wallMesh);
    });

    const resinGeom = new THREE.BoxGeometry(vatWidth - vatWallThickness * 2, 3, vatDepth - vatWallThickness * 2);
    const resinMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x44aacc,
        roughness: 0.1,
        metalness: 0.0,
        transparent: true,
        opacity: 0.18,
        envMapIntensity: 0.3,
    });
    const resinMesh = new THREE.Mesh(resinGeom, resinMaterial);
    resinMesh.position.y = -vatHeight / 2 + 1.5;
    resinMesh.name = 'resin';
    vatGroup.add(resinMesh);

    const resinGlowGeom = new THREE.BoxGeometry(vatWidth - vatWallThickness * 2 - 1, 2.6, vatDepth - vatWallThickness * 2 - 1);
    const resinGlowMat = new THREE.MeshBasicMaterial({
        color: 0x3399bb,
        transparent: true,
        opacity: 0.06,
    });
    const resinGlow = new THREE.Mesh(resinGlowGeom, resinGlowMat);
    resinGlow.position.y = -vatHeight / 2 + 1.4;
    vatGroup.add(resinGlow);

    vatGroup.position.y = 0;
    group.add(vatGroup);

    const pillarGroup = new THREE.Group();
    const pillarHeight = 22;
    const pillarRadius = 0.6;

    const pillarPositions = [
        { x: -vatWidth / 2 - 1.5, z: -vatDepth / 2 - 1.5 },
        { x: -vatWidth / 2 - 1.5, z: vatDepth / 2 + 1.5 },
        { x: vatWidth / 2 + 1.5, z: -vatDepth / 2 - 1.5 },
        { x: vatWidth / 2 + 1.5, z: vatDepth / 2 + 1.5 },
    ];

    const pillarMat = new THREE.MeshStandardMaterial({
        color: 0x8899aa,
        roughness: 0.2,
        metalness: 0.9,
    });

    pillarPositions.forEach(pos => {
        const pillarGeom = new THREE.CylinderGeometry(pillarRadius, pillarRadius, pillarHeight, 16);
        const pillar = new THREE.Mesh(pillarGeom, pillarMat);
        pillar.position.set(pos.x, pillarHeight / 2 - vatHeight / 2 + 1, pos.z);
        pillar.castShadow = true;
        pillar.receiveShadow = true;
        pillarGroup.add(pillar);
    });

    const topPlateGeom = new THREE.BoxGeometry(vatWidth + 3, 0.8, vatDepth + 3);
    const topPlateMesh = new THREE.Mesh(topPlateGeom, pillarMat);
    topPlateMesh.position.y = pillarHeight - vatHeight / 2 + 1;
    topPlateMesh.receiveShadow = true;
    pillarGroup.add(topPlateMesh);

    group.add(pillarGroup);

    const leadScrewGeom = new THREE.CylinderGeometry(0.4, 0.4, pillarHeight, 24);
    const leadScrewMaterial = new THREE.MeshStandardMaterial({
        color: 0xccccdd,
        roughness: 0.1,
        metalness: 0.95,
    });
    const leadScrew = new THREE.Mesh(leadScrewGeom, leadScrewMaterial);
    leadScrew.position.set(0, pillarHeight / 2 - vatHeight / 2 + 1, 0);
    leadScrew.castShadow = true;
    leadScrew.receiveShadow = true;
    leadScrew.name = 'leadScrew';
    group.add(leadScrew);

    for (let i = 0; i < 15; i++) {
        const threadGeom = new THREE.TorusGeometry(0.55, 0.08, 8, 20);
        const thread = new THREE.Mesh(threadGeom, leadScrewMaterial);
        thread.position.y = -vatHeight / 2 + 2 + i * 1.3;
        thread.rotation.x = Math.PI / 2;
        leadScrew.add(thread);
    }

    const platformGroup = new THREE.Group();
    const platformGeom = new THREE.BoxGeometry(10, 0.6, 10);
    const platformMaterial = new THREE.MeshStandardMaterial({
        color: 0x8899aa,
        roughness: 0.25,
        metalness: 0.85,
    });
    const platformMesh = new THREE.Mesh(platformGeom, platformMaterial);
    platformMesh.castShadow = true;
    platformMesh.receiveShadow = true;
    platformGroup.add(platformMesh);

    const armGeom = new THREE.BoxGeometry(1.5, 4, 1.5);
    const armMesh = new THREE.Mesh(armGeom, platformMaterial);
    armMesh.position.y = 2;
    armMesh.position.x = 0;
    armMesh.castShadow = true;
    platformGroup.add(armMesh);

    const connectorGeom = new THREE.TorusGeometry(0.7, 0.2, 8, 16);
    const connectorMesh = new THREE.Mesh(connectorGeom, platformMaterial);
    connectorMesh.position.y = 4;
    connectorMesh.rotation.x = Math.PI / 2;
    platformGroup.add(connectorMesh);

    platformGroup.name = 'buildPlatform';
    platformGroup.position.set(0, 3, 0);
    group.add(platformGroup);

    const projectorGroup = new THREE.Group();
    const projectorBodyGeom = new THREE.BoxGeometry(8, 2, 8);
    const projectorBodyMat = new THREE.MeshStandardMaterial({
        color: 0x333344,
        roughness: 0.5,
        metalness: 0.6,
    });
    const projectorBody = new THREE.Mesh(projectorBodyGeom, projectorBodyMat);
    projectorBody.position.y = -vatHeight / 2 - 3;
    projectorBody.receiveShadow = true;
    projectorGroup.add(projectorBody);

    const lensGeom = new THREE.CylinderGeometry(2, 3, 0.5, 24);
    const lensMat = new THREE.MeshPhysicalMaterial({
        color: 0x444466,
        roughness: 0.05,
        metalness: 0.1,
        transparent: true,
        opacity: 0.5,
    });
    const lens = new THREE.Mesh(lensGeom, lensMat);
    lens.position.y = -vatHeight / 2 - 1.75;
    projectorGroup.add(lens);

    const lightConeGeom = new THREE.CylinderGeometry(0.5, 4, 5, 16, 1, true);
    const lightConeMat = new THREE.MeshBasicMaterial({
        color: 0x9966ff,
        transparent: true,
        opacity: 0.05,
        side: THREE.DoubleSide,
    });
    const lightCone = new THREE.Mesh(lightConeGeom, lightConeMat);
    lightCone.position.y = -vatHeight / 2 + 0.5;
    lightCone.name = 'lightCone';
    projectorGroup.add(lightCone);

    group.add(projectorGroup);

    const topPlatformY = pillarHeight - vatHeight / 2 + 1 - 0.4;
    const bottomPlatformY = 3;
    const resinSurfaceY = -vatHeight / 2 + 3;

    return {
        group,
        platformGroup,
        leadScrew,
        topPlatformY,
        bottomPlatformY,
        resinSurfaceY,
        vatGroup,
        currentLayerHeight: 0.2,
        totalLayers: 0,
        currentPlatformY: 3,
        modelMin: null,
        modelMax: null,

        setModelBounds(min, max) {
            this.modelMin = min.clone();
            this.modelMax = max.clone();
        },

        setTotalLayers(n) {
            this.totalLayers = n;
        },

        setLayerHeight(h) {
            this.currentLayerHeight = h;
        },

        async lowerPlatform() {
            const targetY = this.resinSurfaceY - 1;
            await this._animatePlatform(targetY, 0.8);
        },

        async raiseOneLayer() {
            const targetY = this.platformGroup.position.y + this.currentLayerHeight;
            await this._animatePlatform(targetY, 0.2);
        },

        async raiseToTop() {
            const targetY = this.bottomPlatformY + 6;
            await this._animatePlatform(targetY, 0.8);
        },

        async _animatePlatform(targetY, duration) {
            const self = this;
            const startY = self.platformGroup.position.y;
            const startTime = performance.now();
            const durMs = duration * 1000;

            return new Promise(resolve => {
                const step = () => {
                    const elapsed = performance.now() - startTime;
                    const t = Math.min(elapsed / durMs, 1.0);
                    const eased = 1 - Math.pow(1 - t, 3);
                    const y = startY + (targetY - startY) * eased;
                    self.platformGroup.position.y = y;
                    self.currentPlatformY = y;

                    if (t < 1.0) {
                        requestAnimationFrame(step);
                    } else {
                        self.platformGroup.position.y = targetY;
                        self.currentPlatformY = targetY;
                        resolve();
                    }
                };
                requestAnimationFrame(step);
            });
        },

        resetPosition() {
            this.platformGroup.position.y = 3;
            this.currentPlatformY = 3;
        },
    };
}