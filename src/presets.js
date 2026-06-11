import * as THREE from 'three';

export function createPresetModel(name) {
    switch (name) {
        case 'gear':
            return createGear();
        case 'torus':
            return createTorusKnot();
        case 'figure':
            return createFigure();
        case 'vase':
            return createVase();
        default:
            return createGear();
    }
}

function createGear() {
    const bodyShape = new THREE.Shape();
    const radius = 4;
    const innerRadius = 2.5;
    const teeth = 16;
    const toothDepth = 0.8;

    for (let i = 0; i <= teeth * 2; i++) {
        const angle = (i / (teeth * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? radius + toothDepth : radius;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) bodyShape.moveTo(x, y);
        else bodyShape.lineTo(x, y);
    }
    bodyShape.closePath();

    const hole = new THREE.Path();
    hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
    bodyShape.holes.push(hole);

    const extrudeSettings = {
        steps: 1,
        depth: 1.5,
        bevelEnabled: true,
        bevelThickness: 0.15,
        bevelSize: 0.1,
        bevelSegments: 5
    };
    const baseGeom = new THREE.ExtrudeGeometry(bodyShape, extrudeSettings);
    baseGeom.rotateX(-Math.PI / 2);

    const mergedGeom = mergeGeometries(baseGeom, [
        { pos: [0, 0, 0], scale: [1, 1, 1] },
        { pos: [0, 1.5, 0], scale: [0.7, 0.6, 0.7] },
        { pos: [0, 2.1, 0], scale: [0.35, 0.4, 0.35] },
    ]);
    mergedGeom.computeVertexNormals();
    return mergedGeom;
}

function createTorusKnot() {
    const geometry = new THREE.TorusKnotGeometry(3, 0.8, 100, 16, 2, 3);
    return geometry;
}

function createFigure() {
    const headGeom = new THREE.SphereGeometry(1.6, 32, 32);
    headGeom.translate(0, 8.5, 0);

    const bodyGeom = new THREE.CylinderGeometry(1.2, 1.6, 4, 24, 8);
    bodyGeom.translate(0, 5.5, 0);

    const neckGeom = new THREE.CylinderGeometry(0.5, 0.7, 1.0, 16);
    neckGeom.translate(0, 7.2, 0);

    const legLGeom = new THREE.CylinderGeometry(0.5, 0.55, 3.5, 16);
    legLGeom.translate(-0.7, 2.0, 0);

    const legRGeom = new THREE.CylinderGeometry(0.5, 0.55, 3.5, 16);
    legRGeom.translate(0.7, 2.0, 0);

    const armLGeom = new THREE.CylinderGeometry(0.35, 0.4, 3.0, 16);
    armLGeom.translate(-1.8, 6.0, 0);

    const armRGeom = new THREE.CylinderGeometry(0.35, 0.4, 3.0, 16);
    armRGeom.translate(1.8, 6.0, 0);

    const baseGeom = new THREE.CylinderGeometry(1.8, 2.0, 0.4, 32);
    baseGeom.translate(0, 0.2, 0);

    const geometries = [headGeom, bodyGeom, neckGeom, legLGeom, legRGeom, armLGeom, armRGeom, baseGeom];
    return mergeGeometriesList(geometries);
}

function createVase() {
    const points = [];
    const segments = 40;
    const height = 10;
    const baseRadius = 2.5;
    const bellyRadius = 3.5;
    const neckRadius = 1.2;
    const topRadius = 1.5;

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const y = t * height;

        let r;
        if (t < 0.15) {
            r = baseRadius + (t / 0.15) * (bellyRadius - baseRadius);
        } else if (t < 0.45) {
            r = bellyRadius;
        } else if (t < 0.7) {
            const s = (t - 0.45) / 0.25;
            r = bellyRadius + s * (neckRadius - bellyRadius);
        } else {
            const s = (t - 0.7) / 0.3;
            r = neckRadius + s * (topRadius - neckRadius);
        }

        r *= (0.9 + Math.random() * 0.1);
        points.push(new THREE.Vector2(r, y));
    }

    const geometry = new THREE.LatheGeometry(points, 48);
    return geometry;
}

function mergeGeometries(baseGeom, transforms) {
    const allGeoms = transforms.map(t => {
        const geom = baseGeom.clone();
        const matrix = new THREE.Matrix4().compose(
            new THREE.Vector3(t.pos[0], t.pos[1], t.pos[2]),
            new THREE.Quaternion(),
            new THREE.Vector3(t.scale[0], t.scale[1], t.scale[2])
        );
        geom.applyMatrix4(matrix);
        return geom;
    });
    return mergeGeometriesList(allGeoms);
}

function mergeGeometriesList(geometries) {
    const mergedPositions = [];
    const mergedNormals = [];
    const mergedIndex = [];

    geometries.forEach(geom => {
        const posAttr = geom.getAttribute('position');
        const normAttr = geom.getAttribute('normal');
        const idxAttr = geom.index;

        const vertexOffset = mergedPositions.length / 3;

        for (let i = 0; i < posAttr.count; i++) {
            mergedPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));

            if (normAttr) {
                mergedNormals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
            }
        }

        if (idxAttr) {
            for (let i = 0; i < idxAttr.count; i++) {
                mergedIndex.push(idxAttr.getX(i) + vertexOffset);
            }
        } else {
            for (let i = 0; i < posAttr.count; i++) {
                mergedIndex.push(i + vertexOffset);
            }
        }
    });

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(mergedPositions, 3));
    if (mergedNormals.length > 0) {
        merged.setAttribute('normal', new THREE.Float32BufferAttribute(mergedNormals, 3));
    }
    merged.setIndex(mergedIndex);
    merged.computeBoundingBox();
    return merged;
}