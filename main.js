// Candy World - A 3D WebGL Experience
// Rudimentary but sharp graphics using raw WebGL

const canvas = document.getElementById('glCanvas');
const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

if (!gl) {
    alert('WebGL not supported in your browser!');
}

// Set canvas size
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Matrix math utilities
const mat4 = {
    create: function() {
        return new Float32Array(16);
    },
    identity: function(out) {
        out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
        out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
        return out;
    },
    perspective: function(out, fovy, aspect, near, far) {
        const f = 1.0 / Math.tan(fovy / 2);
        out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[10] = (far + near) / (near - far); out[11] = -1;
        out[12] = 0; out[13] = 0; out[14] = (2 * far * near) / (near - far); out[15] = 0;
        return out;
    },
    translate: function(out, a, v) {
        const x = v[0], y = v[1], z = v[2];
        out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
        out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
        out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
        out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
        for (let i = 0; i < 12; i++) out[i] = a[i];
        return out;
    },
    rotateY: function(out, a, rad) {
        const s = Math.sin(rad), c = Math.cos(rad);
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        out[0] = a00 * c + a20 * s;
        out[1] = a01 * c + a21 * s;
        out[2] = a02 * c + a22 * s;
        out[3] = a03 * c + a23 * s;
        out[8] = a20 * c - a00 * s;
        out[9] = a21 * c - a01 * s;
        out[10] = a22 * c - a02 * s;
        out[11] = a23 * c - a03 * s;
        if (a !== out) {
            out[4] = a[4]; out[5] = a[5]; out[6] = a[6]; out[7] = a[7];
            out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
        }
        return out;
    },
    multiply: function(out, a, b) {
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
        
        let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
        out[0] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
        out[1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
        out[2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
        out[3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
        
        b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
        out[4] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
        out[5] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
        out[6] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
        out[7] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
        
        b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
        out[8] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
        out[9] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
        out[10] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
        out[11] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
        
        b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
        out[12] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
        out[13] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
        out[14] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
        out[15] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
        return out;
    }
};

// Vertex shader - smooth lighting with glossy highlights
const vertexShaderSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec3 aColor;
    
    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;
    uniform vec3 uCameraPos;
    
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vViewDir;
    
    void main() {
        vec4 worldPos = uModelViewMatrix * vec4(aPosition, 1.0);
        gl_Position = uProjectionMatrix * worldPos;
        vColor = aColor;
        vNormal = mat3(uModelViewMatrix) * aNormal;
        vPosition = worldPos.xyz;
        vViewDir = normalize(uCameraPos - worldPos.xyz);
    }
`;

// Fragment shader - smooth shading with specular highlights for glossy look
const fragmentShaderSource = `
    precision mediump float;
    
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vViewDir;
    
    void main() {
        vec3 normal = normalize(vNormal);
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        vec3 viewDir = normalize(vViewDir);
        
        // Ambient
        vec3 ambient = vColor * 0.5;
        
        // Diffuse (smooth)
        float diff = max(dot(normal, lightDir), 0.0);
        vec3 diffuse = vColor * diff * 0.6;
        
        // Specular (glossy highlights)
        vec3 reflectDir = reflect(-lightDir, normal);
        float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);
        vec3 specular = vec3(1.0, 1.0, 1.0) * spec * 0.4;
        
        // Fresnel-like rim lighting for extra glossiness
        float rim = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);
        vec3 rimColor = vColor * rim * 0.3;
        
        gl_FragColor = vec4(ambient + diffuse + specular + rimColor, 1.0);
    }
`;

// Compile shader
function compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

// Create shader program
const vertexShader = compileShader(gl, vertexShaderSource, gl.VERTEX_SHADER);
const fragmentShader = compileShader(gl, fragmentShaderSource, gl.FRAGMENT_SHADER);
const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);

if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
}

gl.useProgram(program);

// Get attribute and uniform locations
const aPosition = gl.getAttribLocation(program, 'aPosition');
const aNormal = gl.getAttribLocation(program, 'aNormal');
const aColor = gl.getAttribLocation(program, 'aColor');
const uModelViewMatrix = gl.getUniformLocation(program, 'uModelViewMatrix');
const uProjectionMatrix = gl.getUniformLocation(program, 'uProjectionMatrix');
const uCameraPos = gl.getUniformLocation(program, 'uCameraPos');

// Create smooth sphere geometry (rounded shapes for nature-like look)
function createSphere(radius, segments, color) {
    const positions = [];
    const normals = [];
    const indices = [];
    const colors = [];
    
    // Generate vertices
    for (let lat = 0; lat <= segments; lat++) {
        const theta = lat * Math.PI / segments;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        
        for (let lon = 0; lon <= segments; lon++) {
            const phi = lon * 2 * Math.PI / segments;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);
            
            const x = cosPhi * sinTheta;
            const y = cosTheta;
            const z = sinPhi * sinTheta;
            
            positions.push(radius * x, radius * y, radius * z);
            normals.push(x, y, z);
            colors.push(color[0], color[1], color[2]);
        }
    }
    
    // Generate indices
    for (let lat = 0; lat < segments; lat++) {
        for (let lon = 0; lon < segments; lon++) {
            const first = (lat * (segments + 1)) + lon;
            const second = first + segments + 1;
            
            indices.push(first, second, first + 1);
            indices.push(second, second + 1, first + 1);
        }
    }
    
    return { positions, normals, indices, colors };
}

// Create smooth cylinder geometry (for tree trunks)
function createCylinder(radiusTop, radiusBottom, height, segments, color) {
    const positions = [];
    const normals = [];
    const indices = [];
    const colors = [];
    
    // Generate side vertices
    for (let y = 0; y <= segments; y++) {
        const v = y / segments;
        const radius = radiusBottom + (radiusTop - radiusBottom) * v;
        const py = height * v;
        
        for (let x = 0; x <= segments; x++) {
            const u = x / segments;
            const theta = u * Math.PI * 2;
            
            const px = radius * Math.cos(theta);
            const pz = radius * Math.sin(theta);
            
            positions.push(px, py, pz);
            normals.push(Math.cos(theta), 0, Math.sin(theta));
            colors.push(color[0], color[1], color[2]);
        }
    }
    
    // Generate indices for sides
    for (let y = 0; y < segments; y++) {
        for (let x = 0; x < segments; x++) {
            const a = y * (segments + 1) + x;
            const b = a + segments + 1;
            
            indices.push(a, b, a + 1);
            indices.push(b, b + 1, a + 1);
        }
    }
    
    return { positions, normals, indices, colors };
}

// Create mushroom/tree cap (hemisphere)
function createDome(radius, segments, color) {
    const positions = [];
    const normals = [];
    const indices = [];
    const colors = [];
    
    // Generate vertices for hemisphere
    for (let lat = 0; lat <= segments / 2; lat++) {
        const theta = lat * Math.PI / segments;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        
        for (let lon = 0; lon <= segments; lon++) {
            const phi = lon * 2 * Math.PI / segments;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);
            
            const x = cosPhi * sinTheta;
            const y = cosTheta;
            const z = sinPhi * sinTheta;
            
            positions.push(radius * x, radius * y, radius * z);
            normals.push(x, y, z);
            colors.push(color[0], color[1], color[2]);
        }
    }
    
    // Generate indices
    for (let lat = 0; lat < segments / 2; lat++) {
        for (let lon = 0; lon < segments; lon++) {
            const first = (lat * (segments + 1)) + lon;
            const second = first + segments + 1;
            
            indices.push(first, second, first + 1);
            indices.push(second, second + 1, first + 1);
        }
    }
    
    return { positions, normals, indices, colors };
}

// Nature colors - pastel and soft (RGB values 0-1)
const treeCapColors = [
    [0.65, 0.85, 0.45],  // Lime green
    [0.55, 0.80, 0.40],  // Green
    [0.70, 0.88, 0.50],  // Light green
];

const trunkColor = [0.60, 0.45, 0.35];  // Brown trunk

const rockColors = [
    [0.75, 0.60, 0.80],  // Light purple
    [0.85, 0.70, 0.85],  // Pink-purple
    [0.70, 0.55, 0.75],  // Purple
];

const mushroomColors = [
    [0.95, 0.75, 0.80],  // Light pink
    [0.85, 0.65, 0.75],  // Pink
    [0.90, 0.70, 0.75],  // Rose
];

const flowerColors = [
    [1.0, 0.60, 0.40],   // Orange
    [0.95, 0.85, 0.35],  // Yellow
    [0.90, 0.50, 0.65],  // Pink
];

// Create world objects with cached buffers
const worldObjects = [];

// Helper to create and cache WebGL buffers for geometry
function createBuffers(geometry) {
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.positions), gl.STATIC_DRAW);
    
    const normBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.normals), gl.STATIC_DRAW);
    
    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.colors), gl.STATIC_DRAW);
    
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geometry.indices), gl.STATIC_DRAW);
    
    return {
        position: posBuffer,
        normal: normBuffer,
        color: colorBuffer,
        index: indexBuffer,
        indexCount: geometry.indices.length
    };
}

// Ground plane - rolling hills effect
const groundSize = 200;
const groundGeometry = {
    positions: [
        -groundSize, 0, -groundSize,
        groundSize, 0, -groundSize,
        groundSize, 0, groundSize,
        -groundSize, 0, groundSize
    ],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 3],
    colors: [0.75, 0.88, 0.45,  0.75, 0.88, 0.45,  0.75, 0.88, 0.45,  0.75, 0.88, 0.45] // Pastel green
};
const groundBuffers = createBuffers(groundGeometry);

// Add trees (mushroom-style with rounded caps)
for (let i = 0; i < 25; i++) {
    const x = (Math.random() - 0.5) * 180;
    const z = (Math.random() - 0.5) * 180;
    const treeHeight = 3 + Math.random() * 4;
    const capRadius = 2 + Math.random() * 2;
    
    // Tree trunk
    const trunk = createCylinder(0.3, 0.5, treeHeight, 12, trunkColor);
    worldObjects.push({
        buffers: createBuffers(trunk),
        x, y: 0, z,
        rotation: 0,
        rotationSpeed: 0
    });
    
    // Tree cap (dome)
    const capColor = treeCapColors[Math.floor(Math.random() * treeCapColors.length)];
    const cap = createDome(capRadius, 16, capColor);
    worldObjects.push({
        buffers: createBuffers(cap),
        x, y: treeHeight, z,
        rotation: 0,
        rotationSpeed: 0
    });
}

// Add rocks (smooth spheres flattened)
for (let i = 0; i < 20; i++) {
    const x = (Math.random() - 0.5) * 180;
    const z = (Math.random() - 0.5) * 180;
    const size = 1 + Math.random() * 2;
    const color = rockColors[Math.floor(Math.random() * rockColors.length)];
    
    const rock = createSphere(size, 8, color);
    worldObjects.push({
        buffers: createBuffers(rock),
        x, y: size * 0.3, z,  // Partially embedded in ground
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: 0
    });
}

// Add mushrooms (small sphere on cylinder)
for (let i = 0; i < 15; i++) {
    const x = (Math.random() - 0.5) * 180;
    const z = (Math.random() - 0.5) * 180;
    const stemHeight = 1 + Math.random() * 1.5;
    const capRadius = 0.8 + Math.random() * 0.8;
    
    // Mushroom stem
    const stem = createCylinder(0.2, 0.25, stemHeight, 8, [0.95, 0.92, 0.88]);
    worldObjects.push({
        buffers: createBuffers(stem),
        x, y: 0, z,
        rotation: 0,
        rotationSpeed: 0
    });
    
    // Mushroom cap
    const capColor = mushroomColors[Math.floor(Math.random() * mushroomColors.length)];
    const cap = createDome(capRadius, 12, capColor);
    worldObjects.push({
        buffers: createBuffers(cap),
        x, y: stemHeight, z,
        rotation: 0,
        rotationSpeed: 0
    });
}

// Add flower-like spheres
for (let i = 0; i < 20; i++) {
    const x = (Math.random() - 0.5) * 180;
    const z = (Math.random() - 0.5) * 180;
    const size = 0.4 + Math.random() * 0.4;
    const color = flowerColors[Math.floor(Math.random() * flowerColors.length)];
    
    const flower = createSphere(size, 8, color);
    worldObjects.push({
        buffers: createBuffers(flower),
        x, y: 0.5 + Math.random() * 0.5, z,
        rotation: 0,
        rotationSpeed: 0.01 + Math.random() * 0.02
    });
}

// Add clouds (floating spheres in the sky)
const cloudColor = [0.95, 0.95, 0.92];  // Off-white
for (let i = 0; i < 12; i++) {
    const x = (Math.random() - 0.5) * 200;
    const z = (Math.random() - 0.5) * 200;
    const y = 15 + Math.random() * 10;
    const size = 3 + Math.random() * 3;
    
    const cloud = createSphere(size, 10, cloudColor);
    worldObjects.push({
        buffers: createBuffers(cloud),
        x, y, z,
        rotation: 0,
        rotationSpeed: 0
    });
}

// Add some larger decorative spheres (like in the reference image)
for (let i = 0; i < 8; i++) {
    const x = (Math.random() - 0.5) * 160;
    const z = (Math.random() - 0.5) * 160;
    const size = 2 + Math.random() * 3;
    const color = [...treeCapColors, ...rockColors, ...mushroomColors][Math.floor(Math.random() * 9)];
    
    const sphere = createSphere(size, 12, color);
    worldObjects.push({
        buffers: createBuffers(sphere),
        x, y: size, z,
        rotation: 0,
        rotationSpeed: 0.005 + Math.random() * 0.01
    });
}

// Camera position and rotation
let camera = {
    x: 0, y: 5, z: 20,
    rotY: 0,
    rotX: 0
};

// Movement
const keys = { w: false, s: false, a: false, d: false, ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
let mouseX = 0, mouseY = 0;
let pointerLocked = false;

canvas.addEventListener('click', () => {
    canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
});

document.addEventListener('mousemove', (e) => {
    if (pointerLocked) {
        camera.rotY -= e.movementX * 0.002;
        camera.rotX -= e.movementY * 0.002;
        camera.rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotX));
    }
});

document.addEventListener('keydown', (e) => { if (e.key in keys) keys[e.key] = true; });
document.addEventListener('keyup', (e) => { if (e.key in keys) keys[e.key] = false; });

// Enable depth test for proper 3D
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);

// Main render loop
function render() {
    // Clear with pastel sky color
    gl.clearColor(0.96, 0.93, 0.84, 1.0);  // Soft beige/cream sky
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    // Update camera movement
    const moveSpeed = 0.2;
    if (keys.w || keys.ArrowUp) {
        camera.x -= Math.sin(camera.rotY) * moveSpeed;
        camera.z -= Math.cos(camera.rotY) * moveSpeed;
    }
    if (keys.s || keys.ArrowDown) {
        camera.x += Math.sin(camera.rotY) * moveSpeed;
        camera.z += Math.cos(camera.rotY) * moveSpeed;
    }
    if (keys.a || keys.ArrowLeft) {
        camera.x -= Math.cos(camera.rotY) * moveSpeed;
        camera.z += Math.sin(camera.rotY) * moveSpeed;
    }
    if (keys.d || keys.ArrowRight) {
        camera.x += Math.cos(camera.rotY) * moveSpeed;
        camera.z -= Math.sin(camera.rotY) * moveSpeed;
    }
    
    // Keep camera above ground
    if (camera.y < 2) camera.y = 2;
    
    // Projection matrix
    const projectionMatrix = mat4.create();
    mat4.perspective(projectionMatrix, Math.PI / 4, canvas.width / canvas.height, 0.1, 500);
    gl.uniformMatrix4fv(uProjectionMatrix, false, projectionMatrix);
    
    // Pass camera position for specular lighting
    gl.uniform3f(uCameraPos, camera.x, camera.y, camera.z);
    
    // View matrix (camera)
    const viewMatrix = mat4.create();
    mat4.identity(viewMatrix);
    mat4.rotateY(viewMatrix, viewMatrix, -camera.rotY);
    mat4.translate(viewMatrix, viewMatrix, [-camera.x, -camera.y, -camera.z]);
    
    // Draw ground
    const groundModelView = mat4.create();
    mat4.multiply(groundModelView, viewMatrix, mat4.identity(mat4.create()));
    drawWithBuffers(groundBuffers, groundModelView);
    
    // Draw world objects
    worldObjects.forEach(obj => {
        obj.rotation += obj.rotationSpeed;
        
        const modelMatrix = mat4.create();
        mat4.identity(modelMatrix);
        mat4.translate(modelMatrix, modelMatrix, [obj.x, obj.y, obj.z]);
        mat4.rotateY(modelMatrix, modelMatrix, obj.rotation);
        
        const modelViewMatrix = mat4.create();
        mat4.multiply(modelViewMatrix, viewMatrix, modelMatrix);
        
        drawWithBuffers(obj.buffers, modelViewMatrix);
    });
    
    requestAnimationFrame(render);
}

function drawWithBuffers(buffers, modelViewMatrix) {
    // Bind position buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aPosition);
    
    // Bind normal buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
    gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aNormal);
    
    // Bind color buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aColor);
    
    // Bind index buffer
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
    
    // Set model-view matrix
    gl.uniformMatrix4fv(uModelViewMatrix, false, modelViewMatrix);
    
    // Draw
    gl.drawElements(gl.TRIANGLES, buffers.indexCount, gl.UNSIGNED_SHORT, 0);
}

// Start rendering
render();
