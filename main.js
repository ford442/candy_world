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

// Vertex shader - sharp, faceted lighting
const vertexShaderSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec3 aColor;
    
    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;
    
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vPosition;
    
    void main() {
        gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
        vColor = aColor;
        vNormal = aNormal;
        vPosition = aPosition;
    }
`;

// Fragment shader - flat shading for sharp look
const fragmentShaderSource = `
    precision mediump float;
    
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vPosition;
    
    void main() {
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float diff = max(dot(normalize(vNormal), lightDir), 0.0);
        vec3 ambient = vColor * 0.4;
        vec3 diffuse = vColor * diff * 0.8;
        gl_FragColor = vec4(ambient + diffuse, 1.0);
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

// Create cube geometry (rudimentary shape)
function createCube(size, color) {
    const s = size / 2;
    const positions = [
        // Front
        -s, -s, s,  s, -s, s,  s, s, s,  -s, s, s,
        // Back
        -s, -s, -s,  -s, s, -s,  s, s, -s,  s, -s, -s,
        // Top
        -s, s, -s,  -s, s, s,  s, s, s,  s, s, -s,
        // Bottom
        -s, -s, -s,  s, -s, -s,  s, -s, s,  -s, -s, s,
        // Right
        s, -s, -s,  s, s, -s,  s, s, s,  s, -s, s,
        // Left
        -s, -s, -s,  -s, -s, s,  -s, s, s,  -s, s, -s
    ];
    
    const normals = [
        0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
        0, 0, -1,  0, 0, -1,  0, 0, -1,  0, 0, -1,
        0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
        0, -1, 0,  0, -1, 0,  0, -1, 0,  0, -1, 0,
        1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,
        -1, 0, 0,  -1, 0, 0,  -1, 0, 0,  -1, 0, 0
    ];
    
    const indices = [
        0,1,2, 0,2,3,    4,5,6, 4,6,7,    8,9,10, 8,10,11,
        12,13,14, 12,14,15,    16,17,18, 16,18,19,    20,21,22, 20,22,23
    ];
    
    const colors = [];
    for (let i = 0; i < 24; i++) {
        colors.push(color[0], color[1], color[2]);
    }
    
    return { positions, normals, indices, colors };
}

// Create pyramid geometry
function createPyramid(size, color) {
    const h = size;
    const b = size / 2;
    const positions = [
        // Base
        -b, 0, -b,  b, 0, -b,  b, 0, b,  -b, 0, b,
        // Apex (4 copies for different faces)
        0, h, 0,  0, h, 0,  0, h, 0,  0, h, 0
    ];
    
    const normals = [
        0, -1, 0,  0, -1, 0,  0, -1, 0,  0, -1, 0,
        0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0
    ];
    
    const indices = [
        0, 1, 2,  0, 2, 3,  // Base
        0, 4, 1,  1, 5, 2,  2, 6, 3,  3, 7, 0  // Sides
    ];
    
    const colors = [];
    for (let i = 0; i < 8; i++) {
        colors.push(color[0], color[1], color[2]);
    }
    
    return { positions, normals, indices, colors };
}

// Candy colors (RGB values 0-1)
const candyColors = [
    [1.0, 0.41, 0.71],  // Pink
    [1.0, 0.08, 0.58],  // Deep pink
    [1.0, 0.39, 0.28],  // Tomato
    [1.0, 0.84, 0.0],   // Gold
    [1.0, 0.55, 0.0],   // Orange
    [0.58, 0.44, 0.86], // Purple
    [0.0, 0.81, 0.82],  // Cyan
    [0.20, 0.80, 0.20]  // Lime
];

// Create world objects
const worldObjects = [];

// Ground plane
const groundSize = 200;
const groundPositions = [
    -groundSize, 0, -groundSize,
    groundSize, 0, -groundSize,
    groundSize, 0, groundSize,
    -groundSize, 0, groundSize
];
const groundNormals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
const groundIndices = [0, 1, 2, 0, 2, 3];
const groundColors = [0.56, 0.93, 0.56,  0.56, 0.93, 0.56,  0.56, 0.93, 0.56,  0.56, 0.93, 0.56];

// Add candy objects
for (let i = 0; i < 50; i++) {
    const x = (Math.random() - 0.5) * 180;
    const z = (Math.random() - 0.5) * 180;
    const color = candyColors[Math.floor(Math.random() * candyColors.length)];
    const size = 2 + Math.random() * 3;
    const type = Math.random() > 0.5 ? 'cube' : 'pyramid';
    
    const geometry = type === 'cube' ? createCube(size, color) : createPyramid(size, color);
    
    worldObjects.push({
        geometry,
        x, y: size / 2, z,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.02
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
    // Clear
    gl.clearColor(0.53, 0.81, 0.92, 1.0);
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
    
    // View matrix (camera)
    const viewMatrix = mat4.create();
    mat4.identity(viewMatrix);
    mat4.rotateY(viewMatrix, viewMatrix, -camera.rotY);
    mat4.translate(viewMatrix, viewMatrix, [-camera.x, -camera.y, -camera.z]);
    
    // Draw ground
    const groundModelView = mat4.create();
    mat4.multiply(groundModelView, viewMatrix, mat4.identity(mat4.create()));
    drawGeometry(groundPositions, groundNormals, groundIndices, groundColors, groundModelView);
    
    // Draw candy objects
    worldObjects.forEach(obj => {
        obj.rotation += obj.rotationSpeed;
        
        const modelMatrix = mat4.create();
        mat4.identity(modelMatrix);
        mat4.translate(modelMatrix, modelMatrix, [obj.x, obj.y, obj.z]);
        mat4.rotateY(modelMatrix, modelMatrix, obj.rotation);
        
        const modelViewMatrix = mat4.create();
        mat4.multiply(modelViewMatrix, viewMatrix, modelMatrix);
        
        drawGeometry(obj.geometry.positions, obj.geometry.normals, obj.geometry.indices, obj.geometry.colors, modelViewMatrix);
    });
    
    requestAnimationFrame(render);
}

function drawGeometry(positions, normals, indices, colors, modelViewMatrix) {
    // Position buffer
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aPosition);
    
    // Normal buffer
    const normBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
    gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aNormal);
    
    // Color buffer
    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aColor);
    
    // Index buffer
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    
    // Set model-view matrix
    gl.uniformMatrix4fv(uModelViewMatrix, false, modelViewMatrix);
    
    // Draw
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
}

// Start rendering
render();
