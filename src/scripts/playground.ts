import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { showHeadUnavailable } from './playground-status';

export async function initPlayground() {
  const stage = document.querySelector<HTMLDivElement>('#head-stage')!;
  const canvas = document.querySelector<HTMLCanvasElement>('#head-canvas')!;
  const status = document.querySelector<HTMLParagraphElement>('#scene-status')!;
  const motionPreference = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  );
  let renderer: THREE.WebGLRenderer | undefined;
  let model: THREE.Group | undefined;
  let texture: THREE.Texture | undefined;
  let material: THREE.MeshToonMaterial | undefined;
  let outlineMaterial: THREE.ShaderMaterial | undefined;
  let gradient: THREE.DataTexture | undefined;
  let frame = 0;
  let disposed = false;
  let observer: ResizeObserver | undefined;
  let trackingTimeout: ReturnType<typeof setTimeout> | undefined;
  let loadTimeout: ReturnType<typeof setTimeout> | undefined;
  const events = new AbortController();
  const eventOptions = { signal: events.signal };

  function disposeObject(object: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      geometries.add(child.geometry);
      for (const entry of Array.isArray(child.material)
        ? child.material
        : [child.material])
        materials.add(entry);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const entry of materials) entry.dispose();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(loadTimeout);
    clearTimeout(trackingTimeout);
    cancelAnimationFrame(frame);
    observer?.disconnect();
    events.abort();
    if (model) disposeObject(model);
    gradient?.dispose();
    texture?.dispose();
    renderer?.dispose();
  }

  function stopRendering() {
    showHeadUnavailable();
    dispose();
  }

  // Cover context loss and navigation even while assets are still in flight.
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      stopRendering();
    },
    eventOptions,
  );
  window.addEventListener(
    'pagehide',
    (event) => {
      if (!event.persisted) dispose();
    },
    eventOptions,
  );

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    camera.position.set(0, 0, 4.6);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-3, 5, 4);
    scene.add(key);

    loadTimeout = setTimeout(stopRendering, 15_000);
    await Promise.all([
      new OBJLoader().loadAsync('/assets/biggerhead.obj').then((loaded) => {
        if (disposed) disposeObject(loaded);
        else model = loaded;
      }),
      new THREE.TextureLoader()
        .loadAsync('/assets/biggerhead-texture-upscaled.webp')
        .then((loaded) => {
          if (disposed) loaded.dispose();
          else texture = loaded;
        }),
    ]);
    clearTimeout(loadTimeout);
    if (disposed) return;
    if (!model || !texture)
      throw new Error('Could not load the BiggerHead assets.');
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    gradient = new THREE.DataTexture(
      new Uint8Array([75, 75, 75, 255, 165, 165, 165, 255, 255, 255, 255, 255]),
      3,
      1,
      THREE.RGBAFormat,
    );
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
    material = new THREE.MeshToonMaterial({
      map: texture,
      gradientMap: gradient,
    });
    // Expand the back faces along their normals to draw an ink silhouette.
    outlineMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `void main() {
        vec3 expanded = position + normal * 0.018;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(expanded, 1.0);
      }`,
      fragmentShader: `void main() { gl_FragColor = vec4(0.086, 0.086, 0.086, 1.0); }`,
    });
    const meshes: THREE.Mesh[] = [];
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const oldMaterials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const oldMaterial of oldMaterials) oldMaterial.dispose();
        child.material = material!;
        meshes.push(child);
      }
    });
    const bounds = new THREE.Box3().setFromObject(model);
    model.position.sub(bounds.getCenter(new THREE.Vector3()));
    for (const mesh of meshes)
      mesh.add(new THREE.Mesh(mesh.geometry, outlineMaterial));
    const centered = new THREE.Group();
    centered.add(model);
    // The Studio export faces almost along -X. Turn the original face toward the camera.
    centered.rotation.y = 1.424;
    centered.scale.setScalar(3.7 / bounds.getSize(new THREE.Vector3()).y);
    const head = new THREE.Group();
    head.add(centered);
    scene.add(head);

    let yaw = -0.22;
    let pitch = 0.13;
    let targetYaw = yaw;
    let targetPitch = pitch;
    let velocity = 0;
    let pointerId: number | undefined;
    let lastX = 0;
    let lastY = 0;
    let lastMoveTime = 0;
    let tracking = true;
    let mouseX = 0.5;
    let mouseY = 0.5;
    let previousTime = 0;
    let isVisible = true;
    let ready = false;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoverPosition: { x: number; y: number } | undefined;

    function hitsHead(x: number, y: number) {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((x - rect.left) / rect.width) * 2 - 1,
        -((y - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(meshes, false).length > 0;
    }

    function updateCursor() {
      canvas.dataset.interaction =
        pointerId !== undefined
          ? 'drag'
          : hoverPosition && hitsHead(hoverPosition.x, hoverPosition.y)
            ? 'hover'
            : 'none';
    }

    function resize() {
      if (disposed) return;
      const { width, height } = stage.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.position.z = width <= 600 ? 6 : 4.6;
      // Keep the crop tied to the poster height, including on ultrawide screens.
      // A view offset translates the projection without changing the viewing angle.
      camera.setViewOffset(
        width,
        height,
        height * (width <= 600 ? 0.2 : 0.32) - width / 2,
        height * (width <= 600 ? 0.01 : 0.04),
        width,
        height,
      );
      camera.updateProjectionMatrix();
      renderer!.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer!.setSize(width, height, false);
      requestRender();
    }

    function requestRender() {
      if (!frame && !disposed && !document.hidden && isVisible)
        frame = requestAnimationFrame(render);
    }

    function render(time: number) {
      frame = 0;
      if (disposed) return;
      const dt = previousTime
        ? Math.min((time - previousTime) / 1000, 0.05)
        : 1 / 60;
      previousTime = time;
      const reduceMotion = motionPreference.matches;
      if (pointerId === undefined && !reduceMotion) {
        targetYaw += velocity * dt;
        velocity *= Math.exp(-4 * dt);
      }
      const ease = reduceMotion ? 1 : 1 - Math.exp(-8 * dt);
      yaw = THREE.MathUtils.lerp(yaw, targetYaw, ease);
      pitch = THREE.MathUtils.lerp(pitch, targetPitch, ease);
      head.rotation.set(pitch, yaw, 0);
      head.position.y = reduceMotion ? 0 : Math.sin(time * 0.0006) * 0.015;
      renderer!.render(scene, camera);
      updateCursor();
      if (!ready) {
        ready = true;
        stage.dataset.state = 'ready';
        status.textContent =
          'BiggerHead is ready. Drag to spin, or focus the head and use the arrow keys.';
      }
      if (!reduceMotion) requestRender();
    }

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
      if (isVisible) requestRender();
      else {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    visibilityObserver.observe(stage);
    events.signal.addEventListener(
      'abort',
      () => visibilityObserver.disconnect(),
      { once: true },
    );
    observer = new ResizeObserver(resize);
    observer.observe(stage);
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          cancelAnimationFrame(frame);
          frame = 0;
        } else {
          previousTime = 0;
          requestRender();
        }
      },
      eventOptions,
    );
    motionPreference.addEventListener(
      'change',
      () => {
        velocity = 0;
        requestRender();
      },
      eventOptions,
    );

    function updateTrackingTarget() {
      targetYaw = -0.22 + (mouseX - 0.5) * 0.18;
      targetPitch = 0.13 + (mouseY - 0.5) * 0.08;
    }

    function scheduleTracking() {
      clearTimeout(trackingTimeout);
      trackingTimeout = setTimeout(() => {
        if (pointerId !== undefined) return;
        tracking = true;
        velocity = 0;
        if (motionPreference.matches) return;
        // Avoid replaying complete rotations when returning from a long spin.
        yaw =
          -0.22 +
          THREE.MathUtils.euclideanModulo(yaw + 0.22 + Math.PI, Math.PI * 2) -
          Math.PI;
        updateTrackingTarget();
        requestRender();
      }, 3000);
    }

    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (
          !event.isPrimary ||
          event.button !== 0 ||
          !hitsHead(event.clientX, event.clientY)
        )
          return;
        clearTimeout(trackingTimeout);
        pointerId = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        lastX = event.clientX;
        lastY = event.clientY;
        lastMoveTime = event.timeStamp;
        tracking = false;
        velocity = 0;
        updateCursor();
        canvas.focus({ preventScroll: true });
      },
      eventOptions,
    );
    canvas.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerType === 'mouse') {
          hoverPosition = { x: event.clientX, y: event.clientY };
          updateCursor();
        }
        if (event.pointerId !== pointerId) return;
        const deltaX = event.clientX - lastX;
        targetYaw += deltaX * 0.009;
        targetPitch = THREE.MathUtils.clamp(
          targetPitch + (event.clientY - lastY) * 0.005,
          -0.8,
          0.8,
        );
        const elapsed = Math.max(
          (event.timeStamp - lastMoveTime) / 1000,
          1 / 120,
        );
        velocity = THREE.MathUtils.clamp((deltaX * 0.009) / elapsed, -8, 8);
        lastX = event.clientX;
        lastY = event.clientY;
        lastMoveTime = event.timeStamp;
        requestRender();
      },
      eventOptions,
    );
    canvas.addEventListener(
      'pointerleave',
      () => {
        hoverPosition = undefined;
        updateCursor();
      },
      eventOptions,
    );
    function releasePointer(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      pointerId = undefined;
      if (
        event.type !== 'pointerup' ||
        event.timeStamp - lastMoveTime > 80 ||
        motionPreference.matches
      )
        velocity = 0;
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
      scheduleTracking();
      updateCursor();
    }
    canvas.addEventListener('pointerup', releasePointer, eventOptions);
    canvas.addEventListener('pointercancel', releasePointer, eventOptions);
    canvas.addEventListener('lostpointercapture', releasePointer, eventOptions);
    document.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerType !== 'mouse') return;
        mouseX = THREE.MathUtils.clamp(event.clientX / innerWidth, 0, 1);
        mouseY = THREE.MathUtils.clamp(event.clientY / innerHeight, 0, 1);
        if (!tracking || motionPreference.matches) return;
        updateTrackingTarget();
      },
      eventOptions,
    );

    canvas.addEventListener(
      'keydown',
      (event) => {
        if (
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        tracking = false;
        velocity = 0;
        if (event.key === 'ArrowLeft') targetYaw -= 0.2;
        if (event.key === 'ArrowRight') targetYaw += 0.2;
        if (event.key === 'ArrowUp') targetPitch -= 0.15;
        if (event.key === 'ArrowDown') targetPitch += 0.15;
        targetPitch = THREE.MathUtils.clamp(targetPitch, -0.8, 0.8);
        scheduleTracking();
        requestRender();
      },
      eventOptions,
    );

    canvas.hidden = false;
    resize();
  } catch (error) {
    console.warn('BiggerHead could not start:', error);
    stopRendering();
  }
}
