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
        const classified = classifyLoops(loops);
        layers.push({
            height: planeY,
            thickness: layerHeight,
            loops: classified.loops,
            outerLoops: classified.outerLoops,
            holes: classified.holes,
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

function signedAreaXZ(loop) {
    if (loop.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < loop.length - 1; i++) {
        const j = i + 1;
        area += loop[i].x * loop[j].y - loop[j].x * loop[i].y;
    }
    return area / 2;
}

function pointInLoopXZ(point, loop) {
    let inside = false;
    const n = loop.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = loop[i].x, zi = loop[i].y;
        const xj = loop[j].x, zj = loop[j].y;
        if ((zi > point.y) !== (zj > point.y) &&
            point.x < (xj - xi) * (point.y - zi) / (zj - zi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

function classifyLoops(loops) {
    if (loops.length === 0) return { loops: [], outerLoops: [], holes: [] };

    const classified = loops.map((loop, idx) => {
        const area = signedAreaXZ(loop);
        return {
            loop,
            index: idx,
            signedArea: area,
            isOuter: area > 0,
        };
    });

    const outerLoops = classified.filter(c => c.isOuter);
    const holeLoops = classified.filter(c => !c.isOuter);

    const holeAssignments = new Map();
    outerLoops.forEach(outer => {
        holeAssignments.set(outer.index, []);
    });

    holeLoops.forEach(hole => {
        let bestOuter = null;
        let bestArea = Infinity;

        for (const outer of outerLoops) {
            if (pointInLoopXZ(hole.loop[0], outer.loop)) {
                const outerArea = Math.abs(outer.signedArea);
                if (outerArea < bestArea) {
                    bestArea = outerArea;
                    bestOuter = outer;
                }
            }
        }

        if (bestOuter) {
            holeAssignments.get(bestOuter.index).push(hole);
        }
    });

    const resultLoops = outerLoops.map(outer => ({
        outer: outer.loop,
        holes: (holeAssignments.get(outer.index) || []).map(h => h.loop),
        isOuter: true,
    }));

    return {
        loops: resultLoops,
        outerLoops: outerLoops.map(o => o.loop),
        holes: holeLoops.map(h => h.loop),
    };
}

export function generateSupports(geometry, layerHeight) {
    const positions = geometry.getAttribute('position');
    const index = geometry.index;
    const bbox = geometry.boundingBox;

    const supports = [];
    const supportSet = new Set();
    const gridSize = 1.5;
    const overhangThreshold = -0.35;

    const triangleCount = index ? index.count / 3 : positions.count / 3;
    const overhangTriangles = [];

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

        const ab = new THREE.Vector3().subVectors(b, a);
        const ac = new THREE.Vector3().subVectors(c, a);
        const normal = new THREE.Vector3().crossVectors(ab, ac).normalize();

        if (normal.y < overhangThreshold) {
            const centroid = new THREE.Vector3(
                (a.x + b.x + c.x) / 3,
                (a.y + b.y + c.y) / 3,
                (a.z + b.z + c.z) / 3
            );

            if (centroid.y > bbox.min.y + layerHeight * 3) {
                overhangTriangles.push({
                    centroid,
                    normal,
                    area: ab.clone().cross(ac).length() / 2,
                });
            }
        }
    }

    overhangTriangles.sort((a, b) => a.centroid.y - b.centroid.y);

    const bottomY = bbox.min.y;
    const maxHeight = bbox.max.y - bottomY;

    for (const tri of overhangTriangles) {
        const gridX = Math.round(tri.centroid.x / gridSize);
        const gridZ = Math.round(tri.centroid.z / gridSize);
        const key = `${gridX},${gridZ}`;

        if (supportSet.has(key)) continue;

        if (supportSet.size > 0) {
            let tooClose = false;
            for (const existingKey of supportSet) {
                const [ex, ez] = existingKey.split(',').map(Number);
                const dx = gridX - ex;
                const dz = gridZ - ez;
                if (Math.sqrt(dx * dx + dz * dz) < 0.8) {
                    tooClose = true;
                    break;
                }
            }
            if (tooClose) continue;
        }

        supportSet.add(key);

        const height = tri.centroid.y - bottomY;
        if (height < layerHeight * 2) continue;

        const tipRadius = layerHeight * 0.6;
        const baseRadius = Math.min(layerHeight * 1.8, height * 0.08);

        supports.push({
            top: tri.centroid.clone(),
            bottom: new THREE.Vector3(tri.centroid.x, bottomY, tri.centroid.z),
            radiusTop: tipRadius,
            radiusBottom: baseRadius,
        });
    }

    return supports;
}