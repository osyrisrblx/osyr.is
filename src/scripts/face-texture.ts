import * as THREE from 'three';

/** Rasterize the SVG face crop into one reusable GPU texture. */
export class FaceTexture extends THREE.CanvasTexture {
	private context: CanvasRenderingContext2D;
	private face: HTMLImageElement;

	constructor(face: HTMLImageElement, anisotropy: number) {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 1;
		super(canvas);
		const context = canvas.getContext('2d');
		if (!context)
			throw new Error('Could not create the face texture canvas.');
		this.context = context;
		this.face = face;
		this.colorSpace = THREE.SRGBColorSpace;
		this.anisotropy = anisotropy;

		// The SVG viewBox crops (680, 530, 320, 320) out of the original
		// 1254-square atlas. Preserve its UV placement; clamp the red border
		// over the rest of the head instead of allocating empty atlas pixels.
		this.repeat.setScalar(1254 / 320);
		this.offset.set(-680 / 320, -(1254 - 530 - 320) / 320);
	}

	setFace(face: HTMLImageElement) {
		if (this.face === face) return;
		this.face = face;
		this.draw();
	}

	resize(physicalHeight: number, maxTextureSize: number) {
		// The camera framing follows the stage height. Use power-of-two tiers
		// to avoid reallocating for every resize pixel, bounded by GPU limits.
		const size = Math.min(
			4096,
			maxTextureSize,
			2 ** Math.ceil(Math.log2(Math.max(512, physicalHeight))),
		);
		if (this.image.width === size) return;
		// Three.js requires disposal before changing an uploaded texture's size.
		this.dispose();
		this.image.width = this.image.height = size;
		this.draw();
	}

	private draw() {
		this.context.drawImage(
			this.face,
			0,
			0,
			this.image.width,
			this.image.height,
		);
		this.needsUpdate = true;
	}
}
