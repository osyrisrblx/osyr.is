import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { showHeadUnavailable } from './playground-status';

export async function initPlayground() {
  const stage = document.querySelector<HTMLDivElement>('#head-stage')!;
  const canvas = document.querySelector<HTMLCanvasElement>('#head-canvas')!;
  const status = document.querySelector<HTMLParagraphElement>('#scene-status')!;
  const sleepSymbols = document.querySelector<HTMLDivElement>('#head-sleep')!;
  const motionPreference = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  );
  let renderer: THREE.WebGLRenderer | undefined;
  let model: THREE.Group | undefined;
  let texture: THREE.Texture | undefined;
  let dizzyTexture: THREE.Texture | undefined;
  let blinkTexture: THREE.Texture | undefined;
  let heartTexture: THREE.Texture | undefined;
  let winkTexture: THREE.Texture | undefined;
  let sleepTexture: THREE.Texture | undefined;
  let material: THREE.MeshToonMaterial | undefined;
  let outlineMaterial: THREE.ShaderMaterial | undefined;
  let gradient: THREE.DataTexture | undefined;
  let frame = 0;
  let disposed = false;
  let observer: ResizeObserver | undefined;
  let trackingTimeout: ReturnType<typeof setTimeout> | undefined;
  let loadTimeout: ReturnType<typeof setTimeout> | undefined;
  let shakeTimeout: ReturnType<typeof setTimeout> | undefined;
  let recoveryTimeout: ReturnType<typeof setTimeout> | undefined;
  let blinkTimeout: ReturnType<typeof setTimeout> | undefined;
  let blinkEndTimeout: ReturnType<typeof setTimeout> | undefined;
  let sleepTimeout: ReturnType<typeof setTimeout> | undefined;
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
    clearTimeout(shakeTimeout);
    clearTimeout(recoveryTimeout);
    clearTimeout(blinkTimeout);
    clearTimeout(blinkEndTimeout);
    clearTimeout(sleepTimeout);
    sleepSymbols.hidden = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    events.abort();
    if (model) disposeObject(model);
    gradient?.dispose();
    texture?.dispose();
    dizzyTexture?.dispose();
    blinkTexture?.dispose();
    heartTexture?.dispose();
    winkTexture?.dispose();
    sleepTexture?.dispose();
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
    let pressX = 0;
    let pressY = 0;
    let pressTime = 0;
    let dragged = false;
    let dragPitch = pitch;
    let pitchVelocity = 0;
    let boopStartedAt: number | undefined;
    let tracking = true;
    let mouseX = 0.5;
    let mouseY = 0.5;
    let previousTime = 0;
    let isVisible = true;
    let ready = false;
    let expression: 'normal' | 'dizzy' | 'shaking' | 'sleeping' = 'normal';
    let sleepAmount = 0;
    let spinDistance = 0;
    let lastSpinTime = 0;
    let shakeStartedAt = 0;
    let eyeGesture: 'blink' | 'wink' | undefined;
    let idleBlinkCount = 0;
    let hoveredLink: HTMLAnchorElement | undefined;
    let focusedLink: HTMLAnchorElement | undefined;
    const pitchLimit = 0.55;
    const boopDuration = 600;
    const spinThreshold = Math.PI * 4;
    const shakeDuration = 800;
    const sleepDelay = 60_000;
    const sleepAnchor = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoverPosition: { x: number; y: number } | undefined;

    function loadFaceTexture(
      path: string,
      onLoad: (loaded: THREE.Texture) => void,
    ) {
      new THREE.TextureLoader()
        .loadAsync(path)
        .then((loaded) => {
          if (disposed) {
            loaded.dispose();
            return;
          }
          loaded.colorSpace = THREE.SRGBColorSpace;
          loaded.anisotropy = renderer!.capabilities.getMaxAnisotropy();
          // Upload before the first expression change to avoid a first-use hitch.
          renderer!.initTexture(loaded);
          onLoad(loaded);
        })
        .catch(() => {
          // Optional expressions must not interrupt the main head if they fail.
        });
    }

    function activeLink() {
      return hoveredLink ?? focusedLink;
    }

    function updateFace() {
      sleepSymbols.hidden = expression !== 'sleeping';
      if (expression === 'sleeping') {
        material!.map = sleepTexture!;
        stage.dataset.expression = 'sleeping';
      } else if (expression === 'normal') {
        const hearts =
          pointerId === undefined &&
          activeLink()?.classList.contains('support-link') &&
          heartTexture;
        if (eyeGesture === 'blink' && blinkTexture) {
          material!.map = blinkTexture;
          stage.dataset.expression = 'blink';
        } else if (hearts) {
          material!.map = hearts;
          stage.dataset.expression = 'hearts';
        } else if (eyeGesture === 'wink' && winkTexture) {
          material!.map = winkTexture;
          stage.dataset.expression = 'wink';
        } else {
          material!.map = texture!;
          stage.dataset.expression = 'normal';
        }
      } else {
        material!.map = dizzyTexture!;
        stage.dataset.expression = expression;
      }
      requestRender();
    }

    function cancelBlink() {
      clearTimeout(blinkTimeout);
      clearTimeout(blinkEndTimeout);
      if (eyeGesture) {
        eyeGesture = undefined;
        updateFace();
      }
    }

    function closeEyes(gesture: 'blink' | 'wink', duration: number) {
      eyeGesture = gesture;
      updateFace();
      blinkEndTimeout = setTimeout(() => {
        eyeGesture = undefined;
        updateFace();
        scheduleBlink();
      }, duration);
    }

    function cancelBoop() {
      boopStartedAt = undefined;
      head.scale.setScalar(1);
      stage.dataset.gesture = 'none';
    }

    function boop() {
      cancelBlink();
      velocity = 0;
      if (!motionPreference.matches) {
        boopStartedAt = performance.now();
        stage.dataset.gesture = 'boop';
      }
      closeEyes('blink', 140);
      status.textContent = 'Boop!';
      requestRender();
    }

    function scheduleBlink() {
      clearTimeout(blinkTimeout);
      if (
        !blinkTexture ||
        expression === 'sleeping' ||
        motionPreference.matches ||
        disposed ||
        !isVisible ||
        document.hidden
      )
        return;
      blinkTimeout = setTimeout(
        () => {
          if (
            expression !== 'normal' ||
            pointerId !== undefined ||
            !tracking ||
            activeLink() ||
            boopStartedAt !== undefined
          ) {
            scheduleBlink();
            return;
          }
          idleBlinkCount++;
          const wink = idleBlinkCount % 5 === 0 && winkTexture;
          closeEyes(wink ? 'wink' : 'blink', wink ? 260 : 140);
        },
        6000 + Math.random() * 4000,
      );
    }

    function setExpression(next: typeof expression) {
      cancelBlink();
      expression = next;
      updateFace();
    }

    function wakeHead() {
      if (expression !== 'sleeping') return;
      setExpression('normal');
      if (!motionPreference.matches) updateTrackingTarget();
      scheduleBlink();
      status.textContent = 'BiggerHead is awake.';
    }

    function scheduleSleep() {
      clearTimeout(sleepTimeout);
      if (disposed || motionPreference.matches || !isVisible || document.hidden)
        return;
      sleepTimeout = setTimeout(() => {
        if (
          !sleepTexture ||
          pointerId !== undefined ||
          expression !== 'normal' ||
          !tracking ||
          boopStartedAt !== undefined
        ) {
          scheduleSleep();
          return;
        }
        velocity = 0;
        pitchVelocity = 0;
        normalizeYaw();
        targetYaw = -0.22;
        targetPitch = 0.35;
        setExpression('sleeping');
        status.textContent = 'BiggerHead is taking a nap.';
      }, sleepDelay);
    }

    function recordActivity() {
      wakeHead();
      scheduleSleep();
    }

    function pauseSleep() {
      clearTimeout(sleepTimeout);
      wakeHead();
    }

    // Capture input before head/link handlers so waking never consumes the action.
    for (const event of [
      'pointermove',
      'pointerdown',
      'pointerup',
      'keydown',
      'wheel',
      'scroll',
      'focusin',
    ]) {
      document.addEventListener(event, recordActivity, {
        ...eventOptions,
        capture: true,
        passive: true,
      });
    }

    function recordSpin(angle: number) {
      if (expression !== 'normal' || angle === 0) return;
      const now = performance.now();
      spinDistance = Math.max(0, spinDistance - (now - lastSpinTime) * 0.002);
      spinDistance += Math.abs(angle);
      lastSpinTime = now;
      if (spinDistance >= spinThreshold && dizzyTexture) becomeDizzy();
    }

    function becomeDizzy() {
      if (expression !== 'normal') return;
      cancelBoop();
      setExpression('dizzy');
      status.textContent = 'Whoa, dizzy!';
    }

    function finishDizziness(resumeTracking = true) {
      clearTimeout(shakeTimeout);
      clearTimeout(recoveryTimeout);
      shakeTimeout = undefined;
      recoveryTimeout = undefined;
      spinDistance = 0;
      velocity = 0;
      tracking = resumeTracking;
      setExpression('normal');
      if (resumeTracking) {
        if (!motionPreference.matches) updateTrackingTarget();
        scheduleBlink();
      } else {
        yaw = head.rotation.y;
        pitch = head.rotation.x;
        targetYaw = yaw;
        targetPitch = pitch;
      }
      pitchVelocity = 0;
      status.textContent = 'BiggerHead is feeling better.';
    }

    function recoverFromDizziness() {
      clearTimeout(shakeTimeout);
      clearTimeout(recoveryTimeout);
      velocity = 0;
      if (!motionPreference.matches) {
        normalizeYaw();
        updateTrackingTarget();
      }
      // Hold the spiral face before a short, diminishing left-right shake.
      shakeTimeout = setTimeout(() => {
        if (motionPreference.matches) {
          finishDizziness();
          return;
        }
        shakeStartedAt = performance.now();
        setExpression('shaking');
        recoveryTimeout = setTimeout(finishDizziness, shakeDuration);
      }, 1200);
      requestRender();
    }

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
      if (tracking && !motionPreference.matches) updateTrackingTarget();
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
      sleepAmount = reduceMotion
        ? 0
        : THREE.MathUtils.lerp(
            sleepAmount,
            expression === 'sleeping' ? 1 : 0,
            1 - Math.exp(-2 * dt),
          );
      if (pointerId === undefined && !reduceMotion) {
        const spin = velocity * dt;
        targetYaw += spin;
        velocity *= Math.exp(-4 * dt);
        recordSpin(spin);
      }
      const ease = reduceMotion
        ? 1
        : 1 - Math.exp(-(expression === 'sleeping' ? 2 : 8) * dt);
      yaw = THREE.MathUtils.lerp(yaw, targetYaw, ease);
      if (
        reduceMotion ||
        pointerId !== undefined ||
        expression === 'sleeping'
      ) {
        pitch = THREE.MathUtils.lerp(pitch, targetPitch, ease);
        pitchVelocity = 0;
      } else {
        // Small steps keep the spring stable even on a slow frame.
        const steps = Math.ceil(dt / (1 / 120));
        const step = dt / steps;
        for (let i = 0; i < steps; i++) {
          pitchVelocity +=
            ((targetPitch - pitch) * 180 - pitchVelocity * 23) * step;
          pitch += pitchVelocity * step;
        }
      }
      const shakeProgress = THREE.MathUtils.clamp(
        (time - shakeStartedAt) / shakeDuration,
        0,
        1,
      );
      const shake =
        expression === 'shaking' && !reduceMotion
          ? Math.sin(shakeProgress * Math.PI * 6) *
            Math.sin(shakeProgress * Math.PI) *
            0.18
          : 0;
      const dip =
        expression === 'shaking' && !reduceMotion
          ? Math.sin(shakeProgress * Math.PI) * 0.18
          : 0;
      head.rotation.set(pitch + dip, yaw + shake, -sleepAmount * 0.045);
      head.position.y = reduceMotion
        ? 0
        : Math.sin(time * 0.0006) * 0.015 + sleepAmount * 0.05;
      if (boopStartedAt !== undefined) {
        const progress = (time - boopStartedAt) / boopDuration;
        if (progress >= 1 || reduceMotion) {
          cancelBoop();
        } else {
          const squish =
            Math.sin(progress * Math.PI * 3) *
            Math.exp(-progress * 5) *
            (1 - progress) *
            0.13;
          head.scale.set(1 + squish * 0.4, 1 - squish, 1 + squish * 0.4);
        }
      }
      renderer!.render(scene, camera);
      if (expression === 'sleeping') {
        // Keep the little trail near the temple, clear of the intro on narrow screens.
        sleepAnchor.set(-1.1, 0.95, 1);
        head.localToWorld(sleepAnchor);
        sleepAnchor.project(camera);
        const { width, height } = stage.getBoundingClientRect();
        const x = THREE.MathUtils.clamp(
          ((sleepAnchor.x + 1) / 2) * width,
          width * (width <= 600 ? 0.62 : 0.42),
          width - (width <= 600 ? 90 : 120),
        );
        const y = THREE.MathUtils.clamp(
          ((1 - sleepAnchor.y) / 2) * height,
          width <= 600 ? 200 : 220,
          height * 0.48,
        );
        sleepSymbols.style.transform = `translate(${x}px, ${y}px)`;
      }
      updateCursor();
      if (!ready) {
        ready = true;
        stage.dataset.state = 'ready';
        status.textContent =
          'BiggerHead is ready. Tap to boop, drag to spin, or use the arrow keys and Enter.';
      }
      if (!reduceMotion) requestRender();
    }

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
      if (isVisible) {
        recordActivity();
        requestRender();
        scheduleBlink();
      } else {
        pauseSleep();
        cancelBlink();
        cancelBoop();
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
          pauseSleep();
          cancelBlink();
          cancelBoop();
          cancelAnimationFrame(frame);
          frame = 0;
        } else {
          recordActivity();
          previousTime = 0;
          requestRender();
          scheduleBlink();
        }
      },
      eventOptions,
    );
    motionPreference.addEventListener(
      'change',
      () => {
        velocity = 0;
        pitchVelocity = 0;
        cancelBoop();
        cancelBlink();
        recordActivity();
        if (tracking && !motionPreference.matches) updateTrackingTarget();
        scheduleBlink();
        requestRender();
      },
      eventOptions,
    );

    function updateTrackingTarget() {
      if (expression === 'sleeping') return;
      targetYaw = -0.22 + (mouseX - 0.5) * 0.39;
      targetPitch = 0.13 + (mouseY - 0.5) * 0.24;
    }

    function updateLinkReaction() {
      cancelBlink();
      updateFace();
      scheduleBlink();
    }

    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      'a[href^="https://"]',
    )) {
      link.addEventListener(
        'pointerenter',
        (event) => {
          if (event.pointerType === 'touch') return;
          hoveredLink = link;
          updateLinkReaction();
        },
        eventOptions,
      );
      link.addEventListener(
        'pointerleave',
        () => {
          if (hoveredLink === link) hoveredLink = undefined;
          updateLinkReaction();
        },
        eventOptions,
      );
      link.addEventListener(
        'focus',
        () => {
          focusedLink = link;
          updateLinkReaction();
        },
        eventOptions,
      );
      link.addEventListener(
        'blur',
        () => {
          if (focusedLink === link) focusedLink = undefined;
          updateLinkReaction();
        },
        eventOptions,
      );
    }

    function normalizeYaw() {
      // Return by the shortest turn after any number of complete spins.
      yaw =
        -0.22 +
        THREE.MathUtils.euclideanModulo(yaw + 0.22 + Math.PI, Math.PI * 2) -
        Math.PI;
    }

    function scheduleTracking() {
      clearTimeout(trackingTimeout);
      trackingTimeout = setTimeout(() => {
        if (pointerId !== undefined) return;
        if (expression === 'dizzy') {
          recoverFromDizziness();
          return;
        }
        if (expression !== 'normal') return;
        spinDistance = 0;
        tracking = true;
        velocity = 0;
        if (motionPreference.matches) return;
        normalizeYaw();
        updateTrackingTarget();
        requestRender();
      }, 3000);
    }

    canvas.addEventListener(
      'touchmove',
      (event) => {
        // The canvas fills the hero: only a drag that grabbed the head owns
        // the gesture. Cancel the first touchmove before native scrolling starts.
        if (pointerId !== undefined && event.touches.length === 1)
          event.preventDefault();
      },
      { ...eventOptions, passive: false },
    );
    document.addEventListener(
      'touchstart',
      (event) => {
        // Give two-finger gestures back to the browser, even when the second
        // finger lands outside the canvas. Lifting it must not resume the drag.
        if (event.touches.length > 1) finishDrag();
      },
      { ...eventOptions, passive: true },
    );
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
        cancelBoop();
        cancelBlink();
        if (expression === 'shaking' || shakeTimeout !== undefined)
          finishDizziness(false);
        pointerId = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        lastX = event.clientX;
        lastY = event.clientY;
        lastMoveTime = event.timeStamp;
        pressX = event.clientX;
        pressY = event.clientY;
        pressTime = event.timeStamp;
        dragged = false;
        dragPitch = targetPitch;
        pitchVelocity = 0;
        tracking = false;
        velocity = 0;
        updateCursor();
        canvas.focus({ preventScroll: true });
        updateFace();
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
        if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > 8)
          dragged = true;
        const deltaX = event.clientX - lastX;
        targetYaw += deltaX * 0.009;
        dragPitch += (event.clientY - lastY) * 0.005;
        const excess = Math.max(0, Math.abs(dragPitch) - pitchLimit);
        targetPitch = motionPreference.matches
          ? THREE.MathUtils.clamp(dragPitch, -pitchLimit, pitchLimit)
          : Math.sign(dragPitch) *
            (Math.min(Math.abs(dragPitch), pitchLimit) +
              0.2 * (1 - Math.exp(-excess / 0.3)));
        const elapsed = Math.max(
          (event.timeStamp - lastMoveTime) / 1000,
          1 / 120,
        );
        velocity = THREE.MathUtils.clamp((deltaX * 0.009) / elapsed, -8, 8);
        recordSpin(deltaX * 0.009);
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
      const tapped =
        event.type === 'pointerup' &&
        !dragged &&
        event.timeStamp - pressTime <= 350 &&
        Math.hypot(event.clientX - pressX, event.clientY - pressY) <= 8;
      const keepVelocity =
        event.type === 'pointerup' &&
        event.timeStamp - lastMoveTime <= 80 &&
        !motionPreference.matches;
      finishDrag(tapped, keepVelocity);
    }
    function finishDrag(tapped = false, keepVelocity = false) {
      if (pointerId === undefined) return;
      const releasedPointer = pointerId;
      pointerId = undefined;
      targetPitch = THREE.MathUtils.clamp(targetPitch, -pitchLimit, pitchLimit);
      if (!keepVelocity) velocity = 0;
      if (canvas.hasPointerCapture(releasedPointer))
        canvas.releasePointerCapture(releasedPointer);
      scheduleTracking();
      scheduleBlink();
      if (tapped) boop();
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
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (event.repeat || pointerId !== undefined) return;
          if (expression !== 'normal') finishDizziness(false);
          boop();
          scheduleTracking();
          return;
        }
        if (
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        cancelBoop();
        cancelBlink();
        if (expression === 'shaking' || shakeTimeout !== undefined)
          finishDizziness(false);
        tracking = false;
        velocity = 0;
        if (event.key === 'ArrowLeft') targetYaw -= 0.2;
        if (event.key === 'ArrowRight') targetYaw += 0.2;
        if (event.key === 'ArrowUp') targetPitch -= 0.15;
        if (event.key === 'ArrowDown') targetPitch += 0.15;
        targetPitch = THREE.MathUtils.clamp(
          targetPitch,
          -pitchLimit,
          pitchLimit,
        );
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
          recordSpin(0.2);
        scheduleTracking();
        scheduleBlink();
        requestRender();
      },
      eventOptions,
    );

    canvas.hidden = false;
    stage.dataset.expression = 'normal';
    resize();
    scheduleSleep();
    loadFaceTexture('/assets/biggerhead-texture-dizzy.webp', (loaded) => {
      dizzyTexture = loaded;
    });
    loadFaceTexture('/assets/biggerhead-texture-blink.webp', (loaded) => {
      blinkTexture = loaded;
      scheduleBlink();
    });
    loadFaceTexture('/assets/biggerhead-texture-heart.webp', (loaded) => {
      heartTexture = loaded;
      updateFace();
    });
    loadFaceTexture('/assets/biggerhead-texture-wink.webp', (loaded) => {
      winkTexture = loaded;
    });
    loadFaceTexture('/assets/biggerhead-texture-sleep.webp', (loaded) => {
      sleepTexture = loaded;
    });
  } catch (error) {
    console.warn('BiggerHead could not start:', error);
    stopRendering();
  }
}
