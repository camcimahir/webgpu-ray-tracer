'use strict';

window.onload = function () {
    main();
};

async function main() {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.getElementById('webgpu-canvas');
    const context = canvas.getContext('gpupresent') || canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    
    context.configure({
        device: device,
        format: canvasFormat,
    });

    // --- FIX 1: Correct IDs to match your HTML ---
    const selectGlassShader = document.getElementById('glass');
    const selectMatteShader = document.getElementById('matte');
    const selectRepeat = document.getElementById('addressmode');
    const selectFilter = document.getElementById('filtermode');
    // Note: 'useTexturing' was missing in HTML, so we default it to true internally
    
    const wgsl = device.createShaderModule({
        code: document.getElementById('wgsl').text,
    });

    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs',
            targets: [{ format: canvasFormat }],
        },
        primitive: {
            topology: 'triangle-strip',
        }, 
    });

    // --- FIX 2: Create TWO buffers to match WGSL @binding(0) and @binding(1) ---
    
    // Buffer for Uniforms_f (Aspect, Cam, Gamma)
    const uniformBufferF = device.createBuffer({
        size: 16, // aligned to 16 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Buffer for Uniforms_ui (Repeat, Linear)
    // Note: Your shader defines these as f32 (floats), so we must use a Float32Array here too
    const uniformBufferUI = device.createBuffer({
        size: 16, 
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // --- FIX 3: Safe Texture Loading ---
    let texture;
    try {
        texture = await load_texture(device, 'grass.jpg');
    } catch (e) {
        console.warn("Could not load grass.jpg, using fallback green color.");
        texture = createFallbackTexture(device);
    }

    // --- FIX 4: Bind Groups must match WGSL Order (0: F, 1: UI, 2: Texture) ---
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: { buffer: uniformBufferF },
            },
            {
                binding: 1,
                resource: { buffer: uniformBufferUI },
            },
            {
                binding: 2,
                resource: texture.createView(),
            },
        ],
    });

    // State Variables
    var aspect = canvas.width / canvas.height;
    var cam_const = 1.0;
    var gamma = 2.2; // 2.2 is standard for gamma correction
    
    var use_repeat = 1; // Default from HTML 'selected'
    var use_linear = 1; // Default from HTML 'selected'

    // Event Listeners
    selectRepeat.addEventListener('change', () => {
        use_repeat = parseInt(selectRepeat.value);
        requestAnimationFrame(animate);
    });

    selectFilter.addEventListener('change', () => {
        use_linear = parseInt(selectFilter.value);
        requestAnimationFrame(animate);
    });

    // Note: The Glass/Matte dropdowns change variables, but your current WGSL 
    // hardcodes shaders (hit.shader = 1 or 5), so these won't visually change the scene 
    // unless you update the WGSL intersect_scene function.
    
    document.onkeydown = (event) => {
        switch (event.key) {
            case 'ArrowUp': cam_const += 0.1; break;
            case 'ArrowDown': cam_const -= 0.1; break;
            case 'ArrowLeft': aspect -= 0.1; break;
            case 'ArrowRight': aspect += 0.1; break;
        }
        requestAnimationFrame(animate);
    };

    function animate() {
        // Write Float Uniforms (Binding 0)
        const dataF = new Float32Array([aspect, cam_const, gamma]);
        device.queue.writeBuffer(uniformBufferF, 0, dataF);

        // Write UI Uniforms (Binding 1) - WGSL expects f32, so we send floats!
        const dataUI = new Float32Array([use_repeat, use_linear]);
        device.queue.writeBuffer(uniformBufferUI, 0, dataUI);

        render(device, context, pipeline, bindGroup);
    }

    // Initial draw
    animate();
}

function render(device, context, pipeline, bindGroup) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                storeOp: 'store',
            },
        ],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4);
    pass.end();
    device.queue.submit([encoder.finish()]);
}

async function load_texture(device, filename) {
    const response = await fetch(filename);
    if (!response.ok) throw new Error("File not found");
    const blob = await response.blob();
    const img = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    const texture = device.createTexture({
        size: [img.width, img.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
        { source: img, flipY: true },
        { texture: texture },
        { width: img.width, height: img.height }
    );
    return texture;
}

// Fallback if image is missing so app doesn't crash
function createFallbackTexture(device) {
    const texture = device.createTexture({
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    // Create a single green pixel
    const data = new Uint8Array([0, 255, 0, 255]); 
    device.queue.writeTexture(
        { texture: texture },
        data,
        { bytesPerRow: 4 },
        { width: 1, height: 1 }
    );
    return texture;
}