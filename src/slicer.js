import * as THREE from 'three';

export function sliceModel(geometry, layerHeight) {
    const bbox = geometry.boundingBox;
    const minY = bbox.min.y;
    const maxY = bbox.max.y;
    const numLayers = Math.max(1, Math.ceil((maxY - minY) / layerHeight));

    const positions = geometry.getAttribute('position');
    const index = geometry.index;
    const layers = [];

    for (let layer = 0; layer < numLayers; layer++) {
        const planeY = minY + layer * layerHeight + layerHeight / 2;
        const segments = [];

        const triangleCount = index ? index.count / 3 : positions.count / 3;

        for (let t = 0; t < triangleCount; t++) {
            let i0, i1, i2;
            if (index) {
                i0 = index.getX(t * 3);
                i1 = index.getX(t * 3 + 1);
                i2 = index.getX(t * 3 + 2);
            } else {
                i0 = t * 3;
                i1 = t * 3 + 1;
                i2 = t * 3 + 2;
            }

            const a = new THREE.Vector3(positions.getX(i0), positions.getY(i0), positions.getZ(i0));
            const b = new THREE.Vector3(positions.getX(i1), positions.getY(i1), positions.getZ(i1));
            const c = new THREE.Vector3(positions.getX(i2), positions.getY(i2), positions.getZ(i2));

            const intersection = intersectTriangleWithPlane(a, b, c, planeY);
            if (intersection.length === 2) {
                segments.push(intersection);
            }
        }

        const loops = connectSegmentsIntoLoops(segments);
        layers.push({
            height: planeY,
            thickness: layerHeight,
            loops,
        });
    }

    return layers;
}

function intersectTriangleWithPlane(a, b, c, planeY) {
    const dist = [a.y - planeY, b.y - planeY, c.y - planeY];

    const above = dist.map(d => d > 0);
    const below = dist.map(d => d < 0);
    const on = dist.map(d => Math.abs(d) < 1e-6);

    if (above.every(v => v) || below.every(v => v)) {
        return [];
    }

    const points = [];
    const edges = [[a, b, dist[0], dist[1]], [b, c, dist[1], dist[2]], [c, a, dist[2], dist[0]]];

    for (const [p1, p2, d1, d2] of edges) {
        if (Math.abs(d1) < 1e-6 && Math.abs(d2) < 1e-6) {
            points.push(new THREE.Vector2(p1.x, p1.z), new THREE.Vector2(p2.x, p2.z));
        } else if (Math.abs(d1) < 1e-6) {
            points.push(new THREE.Vector2(p1.x, p1.z));
        } else if (Math.abs(d2) < 1e-6) {
            points.push(new THREE.Vector2(p2.x, p2.z));
        } else if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) {
            const t = d1 / (d1 - d2);
            const ix = p1.x + t * (p2.x - p1.x);
            const iz = p1.z + t * (p2.z - p1.z);
            points.push(new THREE.Vector2(ix, iz));
        }
    }

    if (points.length < 2) return [];

    const unique = [];
    for (const p of points) {
        let isDuplicate = false;
        for (const u of unique) {
            if (p.distanceTo(u) < 1e-4) { isDuplicate = true; break; }
        }
        if (!isDuplicate) unique.push(p);
    }

    if (unique.length >= 2) {
        return [unique[0], unique[unique.length - 1]];
    }
    return [];
}

function connectSegmentsIntoLoops(segments) {
    if (segments.length === 0) return [];
    if (segments.length > 50000) {
        console.warn(`Slicing: too many segments (${segments.length}), skipping loop connection`);
        return [];
    }

    const EPS = 0.01;
    const MAX_LOOPS = 200;
    const MAX_INNER_ITER = 10000;
    const loops = [];
    const used = new Array(segments.length).fill(false);

    while (loops.length < MAX_LOOPS) {
        let startIdx = -1;
        for (let i = 0; i < segments.length; i++) {
            if (!used[i]) { startIdx = i; break; }
        }
        if (startIdx === -1) break;

        const loop = [];
        let currentEnd = segments[startIdx][1].clone();
        loop.push(segments[startIdx][0].clone());
        used[startIdx] = true;

        let found = true;
        let innerIter = 0;
        while (found && loop.length < segments.length && innerIter < MAX_INNER_ITER) {
            innerIter++;
            found = false;
            let bestIdx = -1;
            let bestDist = Infinity;
            let nextEnd = null;

            const epsSq = EPS * EPS;

            for (let i = 0; i < segments.length; i++) {
                if (used[i]) continue;

                const d1 = currentEnd.distanceToSquared(segments[i][0]);
                const d2 = currentEnd.distanceToSquared(segments[i][1]);

                if (d1 < bestDist && d1 < epsSq) {
                    bestDist = d1;
                    bestIdx = i;
                    nextEnd = segments[i][1].clone();
                }
                if (d2 < bestDist && d2 < epsSq) {
                    bestDist = d2;
                    bestIdx = i;
                    nextEnd = segments[i][0].clone();
                }
            }

            if (bestIdx >= 0) {
                loop.push(currentEnd.clone());
                currentEnd = nextEnd;
                used[bestIdx] = true;
                found = true;
            }
        }

        if (loop.length >= 3) {
            const isClosed = loop[0].distanceToSquared(currentEnd) < EPS * EPS;
            if (isClosed) loop.push(loop[0].clone());
            loops.push(loop);
        }
    }

    return loops;
}

export function generateSupports(geometry, layerHeight) {
    const positions = geometry.getAttribute('position');
    const index = geometry.index;
    const bbox = geometry.boundingBox;

    const supports = [];
    const supportSet = new Set();
    const gridSize = 2.0;
    const overhangAngle = Math.PI / 4;

    const triangleCount = index ? index.count / 3 : positions.count / 3;

    const downVector = new THREE.Vector3(0, -1, 0);

    const rays = [];
    for (let x = bbox.min.x; x <= bbox.max.x; x += gridSize * 0.5) {
        for (let z = bbox.min.z; z <= bbox.max.z; z += gridSize * 0.5) {
            rays.push(new THREE.Vector3(x, bbox.max.y, z));
        }
    }

    const samplePoints = [];
    for (const origin of rays) {
        for (const offset of [
            [0, 0], [gridSize * 0.25, 0], [-gridSize * 0.25, 0],
            [0, gridSize * 0.25], [0, -gridSize * 0.25]
        ]) {
            samplePoints.push(
                new THREE.Vector3(origin.x + offset[0], origin.y, origin.z + offset[1])
            );
        }
    }

    const raycaster = new THREE.Raycaster();
    const geomMesh = new THREE.Mesh(geometry);

    for (const origin of samplePoints) {
        raycaster.set(origin, new THREE.Vector3(0, -1, 0));
        const hits = raycaster.intersectObject(geomMesh, false);

        if (hits.length > 0) {
            const hit = hits[0];
            if (hit.face && hit.face.normal) {
                const normal = hit.face.normal.clone();
                const angleFromDown = Math.acos(Math.abs(normal.dot(downVector)));

                if (angleFromDown > overhangAngle) {
                    const key = `${Math.round(hit.point.x / gridSize)},${Math.round(hit.point.z / gridSize)}`;
                    if (!supportSet.has(key)) {
                        supportSet.add(key);
                        const bottomY = bbox.min.y - 1;
                        const height = hit.point.y - bottomY;

                        if (height > layerHeight * 2) {
                            const support = {
                                top: hit.point.clone(),
                                bottom: new THREE.Vector3(hit.point.x, bottomY, hit.point.z),
                                radiusTop: layerHeight * 0.8,
                                radiusBottom: layerHeight * 1.5,
                            };
                            supports.push(support);
                        }
                    }
                }
            }
        }
    }

    return supports;
}