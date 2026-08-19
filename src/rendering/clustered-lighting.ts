import * as THREE from 'three';
import {
    uniform,
    storage,
    float,
    vec3,
    color,
    positionView,
    Loop,
    uint,
    cameraProjectionMatrix,
    vec4,
    vec2,
    max,
    dot,
    normalize,
    pow,
    mix,
    sin,
    cos,
    smoothstep,
    int,
    log,
    clamp
} from 'three/tsl';
import { CONFIG } from '../core/config/defaults.ts';
import { forEachLocalLight, getLocalLightStats, type LocalLightSnapshot } from './lights.ts';
import { StorageInstancedBufferAttribute } from 'three/webgpu';

export class ClusteredLightingSystem {
    public maxLights: number;
    public maxLightsPerCluster: number;
    public gridX: number;
    public gridY: number;
    public gridZ: number;
    
    private lightData: Float32Array;
    private lightBuffer: StorageInstancedBufferAttribute;
    
    private clusterData: Uint32Array;
    private clusterBuffer: StorageInstancedBufferAttribute;
    
    private numLightsUniform: any;
    private nearUniform: any;
    private farUniform: any;
    private scaleZUniform: any;

    private activeLights: LocalLightSnapshot[] = [];

    constructor(
        maxLights = 128,
        maxLightsPerCluster = 32,
        gridX = 16,
        gridY = 8,
        gridZ = 16
    ) {
        this.maxLights = maxLights;
        this.maxLightsPerCluster = maxLightsPerCluster;
        this.gridX = gridX;
        this.gridY = gridY;
        this.gridZ = gridZ;

        // 12 floats per light
        this.lightData = new Float32Array(this.maxLights * 12);
        this.lightBuffer = new StorageInstancedBufferAttribute(this.lightData, 12);

        // clusterData: (count + maxLightsPerCluster indices) per cluster
        const numClusters = this.gridX * this.gridY * this.gridZ;
        const stride = 1 + this.maxLightsPerCluster;
        this.clusterData = new Uint32Array(numClusters * stride);
        this.clusterBuffer = new StorageInstancedBufferAttribute(this.clusterData, stride);

        this.numLightsUniform = uniform(0);
        this.nearUniform = uniform(1.0);
        this.farUniform = uniform(200.0);
        this.scaleZUniform = uniform(1.0);
    }

    public update(camera: THREE.PerspectiveCamera) {
        const stats = getLocalLightStats();
        // If WebGL or zero lights, do nothing.
        if (stats.webgl || (stats.gpu + stats.decorative) === 0) {
            this.numLightsUniform.value = 0;
            return;
        }

        this.activeLights.length = 0;
        forEachLocalLight((snap) => {
            if (this.activeLights.length < this.maxLights) {
                this.activeLights.push(snap);
            }
        });

        const numLights = this.activeLights.length;
        this.numLightsUniform.value = numLights;

        const vPos = new THREE.Vector3();
        const vDir = new THREE.Vector3();
        for (let i = 0; i < numLights; i++) {
            const snap = this.activeLights[i];
            const offset = i * 12;

            if (snap.parent) {
                snap.parent.updateMatrixWorld();
                if (snap.gpu && snap.kind === 'point') {
                    vPos.setFromMatrixPosition(snap.parent.matrixWorld);
                } else if (!snap.gpu) {
                    vPos.set((snap as any).localX ?? 0, (snap as any).localY ?? 0, (snap as any).localZ ?? 0);
                    vPos.applyMatrix4(snap.parent.matrixWorld);
                } else {
                     vPos.setFromMatrixPosition(snap.parent.matrixWorld);
                }
            } else {
                vPos.set(0, 0, 0);
            }

            this.lightData[offset + 0] = vPos.x;
            this.lightData[offset + 1] = vPos.y;
            this.lightData[offset + 2] = vPos.z;
            this.lightData[offset + 3] = snap.distance || 10.0;

            const r = ((snap.color >> 16) & 255) / 255.0;
            const g = ((snap.color >> 8) & 255) / 255.0;
            const b = (snap.color & 255) / 255.0;
            this.lightData[offset + 4] = r;
            this.lightData[offset + 5] = g;
            this.lightData[offset + 6] = b;
            this.lightData[offset + 7] = snap.intensity;

            if (snap.kind === 'spot') {
                vDir.set(0, -1, 0);
                if (snap.parent) {
                    vDir.transformDirection(snap.parent.matrixWorld).normalize();
                }
                this.lightData[offset + 8] = vDir.x;
                this.lightData[offset + 9] = vDir.y;
                this.lightData[offset + 10] = vDir.z;
                this.lightData[offset + 11] = Math.cos(Math.PI / 4); // Fake cone angle for now
            } else {
                this.lightData[offset + 8] = 0;
                this.lightData[offset + 9] = 0;
                this.lightData[offset + 10] = 0;
                this.lightData[offset + 11] = -1.0; 
            }
        }
        
        // Notify buffer changed
        if (numLights > 0) {
            // Re-creating the buffer is usually required if we modify backing array and want to upload in standard Three.js?
            // WebGPU node backend in three.js typically syncs buffer if needsUpdate = true; wait, no, StorageInstancedBufferAttribute doesn't have needsUpdate, BufferAttribute does.
            // Let's set it.
            (this.lightBuffer as any).needsUpdate = true;
        }

        const near = Math.max(0.1, camera.near);
        const far = camera.far;
        this.nearUniform.value = near;
        this.farUniform.value = far;
        const scaleZ = this.gridZ / Math.log(far / near);
        this.scaleZUniform.value = scaleZ;

        const numClusters = this.gridX * this.gridY * this.gridZ;
        const stride = 1 + this.maxLightsPerCluster;
        for (let i = 0; i < numClusters; i++) {
            this.clusterData[i * stride] = 0;
        }

        const viewMatrix = camera.matrixWorldInverse;
        const pView = new THREE.Vector3();
        
        for (let i = 0; i < numLights; i++) {
            const offset = i * 12;
            const radius = this.lightData[offset + 3];
            pView.set(this.lightData[offset + 0], this.lightData[offset + 1], this.lightData[offset + 2]);
            pView.applyMatrix4(viewMatrix);

            const minZ = -(pView.z + radius);
            const maxZ = -(pView.z - radius);

            if (maxZ < near || minZ > far) continue;

            const sliceMin = Math.max(0, Math.min(this.gridZ - 1, Math.floor(Math.log(Math.max(near, minZ) / near) * scaleZ)));
            const sliceMax = Math.max(0, Math.min(this.gridZ - 1, Math.floor(Math.log(Math.max(near, maxZ) / near) * scaleZ)));

            let minX = 1, minY = 1, maxX = -1, maxY = -1;
            const corners = [
                new THREE.Vector3(pView.x - radius, pView.y - radius, pView.z + radius),
                new THREE.Vector3(pView.x + radius, pView.y - radius, pView.z + radius),
                new THREE.Vector3(pView.x - radius, pView.y + radius, pView.z + radius),
                new THREE.Vector3(pView.x + radius, pView.y + radius, pView.z + radius),
                new THREE.Vector3(pView.x - radius, pView.y - radius, pView.z - radius),
                new THREE.Vector3(pView.x + radius, pView.y - radius, pView.z - radius),
                new THREE.Vector3(pView.x - radius, pView.y + radius, pView.z - radius),
                new THREE.Vector3(pView.x + radius, pView.y + radius, pView.z - radius)
            ];

            for (const c of corners) {
                if (c.z > 0) c.z = -0.001; 
                const p = c.clone().applyMatrix4(camera.projectionMatrix);
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            }

            const tMinX = Math.max(0, Math.min(this.gridX - 1, Math.floor((minX * 0.5 + 0.5) * this.gridX)));
            const tMinY = Math.max(0, Math.min(this.gridY - 1, Math.floor((minY * 0.5 + 0.5) * this.gridY)));
            const tMaxX = Math.max(0, Math.min(this.gridX - 1, Math.floor((maxX * 0.5 + 0.5) * this.gridX)));
            const tMaxY = Math.max(0, Math.min(this.gridY - 1, Math.floor((maxY * 0.5 + 0.5) * this.gridY)));

            for (let z = sliceMin; z <= sliceMax; z++) {
                for (let y = tMinY; y <= tMaxY; y++) {
                    for (let x = tMinX; x <= tMaxX; x++) {
                        const clusterIdx = z * (this.gridX * this.gridY) + y * this.gridX + x;
                        const cOffset = clusterIdx * stride;
                        const count = this.clusterData[cOffset];
                        if (count < this.maxLightsPerCluster) {
                            this.clusterData[cOffset + 1 + count] = i;
                            this.clusterData[cOffset] = count + 1;
                        }
                    }
                }
            }
        }
        
        if (numLights > 0) {
            (this.clusterBuffer as any).needsUpdate = true;
        }
    }

    public getLightingNode(worldPos: any, viewPos: any, worldNormal: any, baseColor: any) {
        const sLightData = storage(this.lightBuffer, 'vec4', this.maxLights * 3);
        const sClusterData = storage(this.clusterBuffer, 'uint', this.gridX * this.gridY * this.gridZ * (1 + this.maxLightsPerCluster));

        const vZ = viewPos.z.negate();
        const zSlice = log(max(this.nearUniform, vZ).div(this.nearUniform)).mul(this.scaleZUniform).floor();
        const zClamped = clamp(zSlice, 0.0, float(this.gridZ - 1));

        const clipPos = vec4(viewPos, 1.0).mul(cameraProjectionMatrix);
        const ndc = clipPos.xyz.div(clipPos.w);
        const screenUv = ndc.xy.mul(0.5).add(0.5);
        const xSlice = clamp(screenUv.x.mul(float(this.gridX)).floor(), 0.0, float(this.gridX - 1));
        const ySlice = clamp(screenUv.y.mul(float(this.gridY)).floor(), 0.0, float(this.gridY - 1));

        const clusterIdx = zClamped.mul(float(this.gridX * this.gridY))
                            .add(ySlice.mul(float(this.gridX)))
                            .add(xSlice);

        const stride = this.maxLightsPerCluster + 1;
        const clusterOffset = uint(clusterIdx).mul(uint(stride));
        const lightCount = sClusterData.element(clusterOffset);

        const totalIllum = vec3(0.0).toVar();

        Loop({ start: uint(0), end: lightCount, type: 'uint', condition: '<' }, ({ i }: any) => {
            const lightIdx = sClusterData.element(clusterOffset.add(1).add(i));
            
            const v0 = sLightData.element(lightIdx.mul(3));
            const v1 = sLightData.element(lightIdx.mul(3).add(1));
            // v2 skipped for now to save lookups if we only do point lights

            const lPos = v0.xyz;
            const lDist = v0.w;
            const lColor = v1.xyz;
            const lIntensity = v1.w;

            const lightVector = lPos.sub(worldPos);
            const dist = lightVector.length();
            const lightDir = lightVector.div(dist);

            const attenuation = clamp(float(1.0).sub(pow(dist.div(lDist), 4.0)), 0.0, 1.0).pow(2.0).div(dist.mul(dist).add(1.0));
            const NdotL = max(dot(worldNormal, lightDir), 0.0);
            
            totalIllum.addAssign(lColor.mul(lIntensity).mul(attenuation).mul(NdotL));
        });

        // Mix clustered illumination onto baseColor
        // Candy style: add to color
        return totalIllum.mul(baseColor);
    }
}

export const globalClusteredLighting = new ClusteredLightingSystem();
