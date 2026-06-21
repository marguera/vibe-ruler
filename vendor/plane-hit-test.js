// Adapted from immersive-web/webxr-samples/js/hit-test.js (IWCG MIT License).
// Synchronous raycast against WebXR detectedPlanes — used when native hit-test
// has no result yet but ARCore has already mapped floor/wall surfaces.

function transformPointByMatrix(matrix, input) {
    return {
        x: matrix[0] * input.x + matrix[4] * input.y + matrix[8] * input.z + matrix[12] * input.w,
        y: matrix[1] * input.x + matrix[5] * input.y + matrix[9] * input.z + matrix[13] * input.w,
        z: matrix[2] * input.x + matrix[6] * input.y + matrix[10] * input.z + matrix[14] * input.w,
        w: matrix[3] * input.x + matrix[7] * input.y + matrix[11] * input.z + matrix[15] * input.w,
    };
}

function sub(lhs, rhs) {
    return { x: lhs.x - rhs.x, y: lhs.y - rhs.y, z: lhs.z - rhs.z, w: lhs.w - rhs.w };
}

function add(lhs, rhs) {
    return { x: lhs.x + rhs.x, y: lhs.y + rhs.y, z: lhs.z + rhs.z, w: lhs.w + rhs.w };
}

function mul(vector, scalar) {
    return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar, w: vector.w };
}

function dot(lhs, rhs) {
    return lhs.x * rhs.x + lhs.y * rhs.y + lhs.z * rhs.z;
}

function cross(lhs, rhs) {
    return {
        x: lhs.y * rhs.z - lhs.z * rhs.y,
        y: lhs.z * rhs.x - lhs.x * rhs.z,
        z: lhs.x * rhs.y - lhs.y * rhs.x,
        w: 0,
    };
}

function length(vector) {
    return Math.sqrt(dot(vector, vector));
}

function normalize(vector) {
    const l = length(vector);
    return mul(vector, 1.0 / l);
}

function normalizePerspective(point) {
    if (point.w === 0 || point.w === 1) {
        return point;
    }
    return { x: point.x / point.w, y: point.y / point.w, z: point.z / point.w, w: 1 };
}

function calculateHitMatrix(rayVector, planeNormal, point) {
    const rayProjection = sub(rayVector, mul(planeNormal, dot(rayVector, planeNormal)));
    const y = planeNormal;
    const z = normalize({ x: -rayProjection.x, y: -rayProjection.y, z: -rayProjection.z, w: rayProjection.w });
    const x = normalize(cross(y, z));

    const hitMatrix = new Float32Array(16);
    hitMatrix[0] = x.x;
    hitMatrix[1] = x.y;
    hitMatrix[2] = x.z;
    hitMatrix[4] = y.x;
    hitMatrix[5] = y.y;
    hitMatrix[6] = y.z;
    hitMatrix[8] = z.x;
    hitMatrix[9] = z.y;
    hitMatrix[10] = z.z;
    hitMatrix[12] = point.x;
    hitMatrix[13] = point.y;
    hitMatrix[14] = point.z;
    hitMatrix[15] = 1;
    return hitMatrix;
}

function hitTestPlane(frame, ray, plane, frameOfReference) {
    const planePose = frame.getPose(plane.planeSpace, frameOfReference);
    if (!planePose) {
        return null;
    }

    const planeNormal = transformPointByMatrix(
        planePose.transform.matrix,
        { x: 0, y: 1, z: 0, w: 0 }
    );
    const planeCenter = normalizePerspective(
        transformPointByMatrix(planePose.transform.matrix, { x: 0, y: 0, z: 0, w: 1 })
    );

    const numerator = dot(sub(planeCenter, ray.origin), planeNormal);
    const denominator = dot(ray.direction, planeNormal);

    if (Math.abs(denominator) < 0.0001) {
        return null;
    }

    const distance = numerator / denominator;
    if (distance < 0) {
        return null;
    }

    const point = add(ray.origin, mul(ray.direction, distance));
    const pointOnPlane = transformPointByMatrix(planePose.transform.inverse.matrix, point);

    return {
        distance,
        plane,
        point,
        point_on_plane: pointOnPlane,
        hitMatrix: calculateHitMatrix(ray.direction, planeNormal, point),
    };
}

export function hitTestDetectedPlanes(frame, ray, frameOfReference) {
    const planes = frame.detectedPlanes;
    if (!planes || planes.size === 0) {
        return [];
    }

    const results = [];
    for (const plane of planes) {
        const result = hitTestPlane(frame, ray, plane, frameOfReference);
        if (result && result.point) {
            results.push(result);
        }
    }

    results.sort((left, right) => left.distance - right.distance);
    return results;
}

function crossProduct2d(lhs, rhs) {
    return lhs.x * rhs.z - lhs.z * rhs.x;
}

export function filterPlaneHitResults(hitTestResults, keepLastHorizontalPlane = false) {
    const filtered = hitTestResults.filter((hitTestResult) => {
        const polygon = hitTestResult.plane.polygon;
        const hitPoint = hitTestResult.point_on_plane;
        let side = 0;
        let previousPoint = polygon[polygon.length - 1];

        for (let i = 0; i < polygon.length; i++) {
            const currentPoint = polygon[i];
            const segment = sub(currentPoint, previousPoint);
            const segmentDirection = normalize(segment);
            const turnDirection = normalize(sub(hitPoint, currentPoint));
            const cosine = crossProduct2d(segmentDirection, turnDirection);

            if (side === 0) {
                side = cosine > 0 ? 1 : 2;
            } else if ((cosine > 0 && side === 2) || (cosine < 0 && side === 1)) {
                return false;
            }

            previousPoint = currentPoint;
        }

        return true;
    });

    if (keepLastHorizontalPlane && hitTestResults.length > 0) {
        const lastHorizontal = hitTestResults.slice().reverse().find(
            (element) => element.plane.orientation === 'horizontal'
        );
        if (lastHorizontal && !filtered.includes(lastHorizontal)) {
            filtered.push(lastHorizontal);
        }
    }

    return filtered;
}
