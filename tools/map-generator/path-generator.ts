/**
 * Path Generator - A* pathfinding for roads and rivers
 * Creates organic paths with Bezier smoothing and elevation awareness
 */

import { NoiseGenerator } from './biome-generator.ts';

export interface PathPoint {
    x: number;
    y: number;
    z: number;
}

export interface Path {
    type: 'road' | 'river' | 'bridge' | 'tunnel';
    points: PathPoint[];
    width: number;
    startPOI?: string;
    endPOI?: string;
}

export interface PathfindingNode {
    x: number;
    z: number;
    g: number; // Cost from start
    h: number; // Heuristic to end
    f: number; // Total cost
    parent?: PathfindingNode;
    elevation: number;
}

export interface PathGeneratorOptions {
    seed: number;
    bounds: {
        minX: number;
        minZ: number;
        maxX: number;
        maxZ: number;
    };
    elevationFn: (x: number, z: number) => number;
    waterLevel?: number;
}

export class PathGenerator {
    private noise: NoiseGenerator;
    private bounds: PathGeneratorOptions['bounds'];
    private elevationFn: (x: number, z: number) => number;
    private waterLevel: number;
    private gridResolution: number = 2; // Grid cell size for pathfinding

    constructor(options: PathGeneratorOptions) {
        this.noise = new NoiseGenerator(options.seed);
        this.bounds = options.bounds;
        this.elevationFn = options.elevationFn;
        this.waterLevel = options.waterLevel ?? -1;
    }

    /**
     * Calculate path cost based on terrain characteristics
     */
    private calculateCost(x: number, z: number, type: 'road' | 'river'): number {
        const elevation = this.elevationFn(x, z);
        let cost = 1;

        if (type === 'road') {
            // Roads prefer flat terrain
            const slope = this.calculateSlope(x, z);
            cost += slope * 10;
            
            // Roads avoid water
            if (elevation < this.waterLevel) {
                cost += 100;
            }
            
            // Slight preference for lower elevations
            cost += elevation * 0.1;
            
        } else if (type === 'river') {
            // Rivers flow downhill - prefer lower elevations
            cost -= elevation * 0.5;
            
            // Rivers avoid going uphill
            const slope = this.calculateSlope(x, z);
            if (slope > 0.3) {
                cost += slope * 20;
            }
            
            // Rivers like to meander
            const meanderNoise = this.noise.noise2D(x * 0.05, z * 0.05);
            cost += meanderNoise * 2;
        }

        // Add some randomness for natural feel
        cost += (Math.random() - 0.5) * 0.5;

        return Math.max(0.1, cost);
    }

    /**
     * Calculate slope at a position
     */
    private calculateSlope(x: number, z: number): number {
        const delta = 1;
        const e = this.elevationFn(x, z);
        const ex = this.elevationFn(x + delta, z);
        const ez = this.elevationFn(x, z + delta);
        
        const slopeX = Math.abs(ex - e) / delta;
        const slopeZ = Math.abs(ez - e) / delta;
        
        return Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);
    }

    /**
     * A* pathfinding algorithm
     */
    private findPath(start: PathPoint, end: PathPoint, type: 'road' | 'river'): PathPoint[] {
        const openSet: PathfindingNode[] = [];
        const closedSet = new Set<string>();
        
        const startNode: PathfindingNode = {
            x: start.x,
            z: start.z,
            g: 0,
            h: this.heuristic(start, end),
            f: 0,
            elevation: this.elevationFn(start.x, start.z)
        };
        startNode.f = startNode.g + startNode.h;
        openSet.push(startNode);

        const getKey = (n: PathfindingNode) => `${Math.round(n.x / this.gridResolution)},${Math.round(n.z / this.gridResolution)}`;

        while (openSet.length > 0) {
            // Get node with lowest f score
            let currentIndex = 0;
            for (let i = 1; i < openSet.length; i++) {
                if (openSet[i].f < openSet[currentIndex].f) {
                    currentIndex = i;
                }
            }
            const current = openSet[currentIndex];

            // Check if we reached the goal
            const distToEnd = Math.sqrt(
                Math.pow(current.x - end.x, 2) + 
                Math.pow(current.z - end.z, 2)
            );
            if (distToEnd < this.gridResolution * 2) {
                return this.reconstructPath(current, start);
            }

            openSet.splice(currentIndex, 1);
            closedSet.add(getKey(current));

            // Explore neighbors
            const neighbors = this.getNeighbors(current);
            for (const neighbor of neighbors) {
                const neighborKey = getKey(neighbor);
                
                if (closedSet.has(neighborKey)) continue;

                const tentativeG = current.g + this.calculateCost(neighbor.x, neighbor.z, type);

                const existingOpen = openSet.find(n => getKey(n) === neighborKey);
                if (!existingOpen || tentativeG < existingOpen.g) {
                    neighbor.g = tentativeG;
                    neighbor.h = this.heuristic(neighbor, end);
                    neighbor.f = neighbor.g + neighbor.h;
                    neighbor.parent = current;
                    neighbor.elevation = this.elevationFn(neighbor.x, neighbor.z);

                    if (!existingOpen) {
                        openSet.push(neighbor);
                    }
                }
            }
        }

        // No path found - return straight line
        return [start, end];
    }

    /**
     * Get neighboring nodes for pathfinding
     */
    private getNeighbors(node: PathfindingNode): PathfindingNode[] {
        const neighbors: PathfindingNode[] = [];
        const step = this.gridResolution;

        const directions = [
            { dx: step, dz: 0 },
            { dx: -step, dz: 0 },
            { dx: 0, dz: step },
            { dx: 0, dz: -step },
            { dx: step, dz: step },
            { dx: step, dz: -step },
            { dx: -step, dz: step },
            { dx: -step, dz: -step }
        ];

        for (const dir of directions) {
            const x = node.x + dir.dx;
            const z = node.z + dir.dz;

            // Check bounds
            if (x < this.bounds.minX || x > this.bounds.maxX ||
                z < this.bounds.minZ || z > this.bounds.maxZ) {
                continue;
            }

            neighbors.push({
                x,
                z,
                g: 0,
                h: 0,
                f: 0,
                elevation: 0
            });
        }

        return neighbors;
    }

    /**
     * Heuristic function (Euclidean distance)
     */
    private heuristic(a: PathfindingNode, b: PathPoint): number {
        return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.z - b.z, 2));
    }

    /**
     * Reconstruct path from end node
     */
    private reconstructPath(end: PathfindingNode, start: PathPoint): PathPoint[] {
        const path: PathPoint[] = [];
        let current: PathfindingNode | undefined = end;

        while (current) {
            path.unshift({
                x: current.x,
                y: current.elevation,
                z: current.z
            });
            current = current.parent;
        }

        // Ensure start point is included
        if (path.length === 0 || path[0].x !== start.x || path[0].z !== start.z) {
            path.unshift(start);
        }

        return path;
    }

    /**
     * Smooth path using Catmull-Rom spline or Bezier curves
     */
    private smoothPath(points: PathPoint[], tension: number = 0.5): PathPoint[] {
        if (points.length < 3) return points;

        const smoothed: PathPoint[] = [];
        smoothed.push(points[0]); // Keep first point

        // Use Catmull-Rom splines for smooth interpolation
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[Math.min(points.length - 1, i + 2)];

            // Add interpolated points
            const segments = 3;
            for (let t = 1; t <= segments; t++) {
                const tt = t / segments;
                const point = this.catmullRom(p0, p1, p2, p3, tt, tension);
                
                // Sample elevation at this point
                point.y = this.elevationFn(point.x, point.z);
                
                smoothed.push(point);
            }
        }

        return smoothed;
    }

    /**
     * Catmull-Rom spline interpolation
     */
    private catmullRom(p0: PathPoint, p1: PathPoint, p2: PathPoint, p3: PathPoint, t: number, tension: number): PathPoint {
        const tt = t * t;
        const ttt = tt * t;

        const q0 = -tension * t + 2 * tension * tt - tension * ttt;
        const q1 = 1 + (tension - 3) * tt + (2 - tension) * ttt;
        const q2 = tension * t + (3 - 2 * tension) * tt + (tension - 2) * ttt;
        const q3 = -tension * tt + tension * ttt;

        return {
            x: q0 * p0.x + q1 * p1.x + q2 * p2.x + q3 * p3.x,
            y: q0 * p0.y + q1 * p1.y + q2 * p2.y + q3 * p3.y,
            z: q0 * p0.z + q1 * p1.z + q2 * p2.z + q3 * p3.z
        };
    }

    /**
     * Detect where bridges or tunnels are needed
     */
    private detectStructures(path: PathPoint[], type: 'road' | 'river'): { path: PathPoint[]; structures: Path[] } {
        const structures: Path[] = [];
        const modifiedPath: PathPoint[] = [];
        
        let i = 0;
        while (i < path.length) {
            const point = path[i];
            const elevation = point.y;

            // Check if we need a bridge (road over water)
            if (type === 'road' && elevation < this.waterLevel) {
                const bridgeStart = Math.max(0, i - 2);
                const bridgeEnd = Math.min(path.length - 1, i + 2);
                
                // Create bridge segment
                const bridgePoints: PathPoint[] = [];
                for (let j = bridgeStart; j <= bridgeEnd; j++) {
                    bridgePoints.push({
                        x: path[j].x,
                        y: this.waterLevel + 2, // Bridge above water
                        z: path[j].z
                    });
                }

                structures.push({
                    type: 'bridge',
                    points: bridgePoints,
                    width: 3
                });

                // Skip bridge section in main path
                i = bridgeEnd + 1;
                continue;
            }

            // Check if we need a tunnel (road through mountain)
            if (type === 'road' && elevation > 20) {
                const tunnelStart = Math.max(0, i - 3);
                const tunnelEnd = Math.min(path.length - 1, i + 3);
                
                const tunnelPoints: PathPoint[] = [];
                for (let j = tunnelStart; j <= tunnelEnd; j++) {
                    tunnelPoints.push({
                        x: path[j].x,
                        y: path[j].y - 3, // Tunnel through mountain
                        z: path[j].z
                    });
                }

                structures.push({
                    type: 'tunnel',
                    points: tunnelPoints,
                    width: 4
                });

                i = tunnelEnd + 1;
                continue;
            }

            modifiedPath.push(point);
            i++;
        }

        return { path: modifiedPath, structures };
    }

    /**
     * Generate a path between two points
     */
    generatePath(start: PathPoint, end: PathPoint, type: 'road' | 'river', options: {
        width?: number;
        smooth?: boolean;
        addStructures?: boolean;
        startPOI?: string;
        endPOI?: string;
    } = {}): Path[] {
        const { 
            width = type === 'road' ? 3 : 6, 
            smooth = true, 
            addStructures = true,
            startPOI,
            endPOI
        } = options;

        // Find base path using A*
        let points = this.findPath(start, end, type);

        // Smooth the path
        if (smooth) {
            points = this.smoothPath(points);
        }

        const paths: Path[] = [];

        // Detect and add structures if needed
        if (addStructures && type === 'road') {
            const { path: modifiedPath, structures } = this.detectStructures(points, type);
            points = modifiedPath;
            paths.push(...structures);
        }

        // Add main path
        paths.unshift({
            type,
            points,
            width,
            startPOI,
            endPOI
        });

        return paths;
    }

    /**
     * Generate a network of paths connecting multiple points
     */
    generatePathNetwork(points: PathPoint[], type: 'road' | 'river', options: {
        width?: number;
        connectAll?: boolean; // If true, connect all points; if false, create minimum spanning tree
    } = {}): Path[] {
        const { width = 3, connectAll = false } = options;
        const paths: Path[] = [];

        if (points.length < 2) return paths;

        if (connectAll) {
            // Connect all points to all others
            for (let i = 0; i < points.length; i++) {
                for (let j = i + 1; j < points.length; j++) {
                    const pathSegments = this.generatePath(points[i], points[j], type, { width });
                    paths.push(...pathSegments);
                }
            }
        } else {
            // Minimum spanning tree using greedy approach
            const connected = new Set<number>([0]);
            const remaining = new Set<number>(
                Array.from({ length: points.length - 1 }, (_, i) => i + 1)
            );

            while (remaining.size > 0) {
                let bestDist = Infinity;
                let bestFrom = -1;
                let bestTo = -1;

                for (const from of connected) {
                    for (const to of remaining) {
                        const dist = Math.sqrt(
                            Math.pow(points[from].x - points[to].x, 2) +
                            Math.pow(points[from].z - points[to].z, 2)
                        );
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestFrom = from;
                            bestTo = to;
                        }
                    }
                }

                if (bestFrom !== -1 && bestTo !== -1) {
                    const pathSegments = this.generatePath(
                        points[bestFrom], 
                        points[bestTo], 
                        type, 
                        { width }
                    );
                    paths.push(...pathSegments);
                    connected.add(bestTo);
                    remaining.delete(bestTo);
                }
            }
        }

        return paths;
    }

    /**
     * Generate a meandering river
     */
    generateRiver(start: PathPoint, end: PathPoint, options: {
        width?: number;
        meanderAmount?: number;
    } = {}): Path[] {
        const { width = 6, meanderAmount = 10 } = options;

        // Add meander points
        const directDist = Math.sqrt(
            Math.pow(end.x - start.x, 2) + 
            Math.pow(end.z - start.z, 2)
        );
        const numMeanders = Math.floor(directDist / 30);

        const meanderPoints: PathPoint[] = [start];
        
        for (let i = 1; i <= numMeanders; i++) {
            const t = i / (numMeanders + 1);
            const baseX = start.x + (end.x - start.x) * t;
            const baseZ = start.z + (end.z - start.z) * t;
            
            // Perpendicular offset for meander
            const perpX = -(end.z - start.z) / directDist;
            const perpZ = (end.x - start.x) / directDist;
            
            const offset = (Math.random() - 0.5) * 2 * meanderAmount;
            
            meanderPoints.push({
                x: baseX + perpX * offset,
                y: this.elevationFn(baseX + perpX * offset, baseZ + perpZ * offset),
                z: baseZ + perpZ * offset
            });
        }

        meanderPoints.push(end);

        // Generate path through meander points
        const paths: Path[] = [];
        for (let i = 0; i < meanderPoints.length - 1; i++) {
            const segments = this.generatePath(meanderPoints[i], meanderPoints[i + 1], 'river', { width });
            paths.push(...segments);
        }

        return paths;
    }
}

export default PathGenerator;
