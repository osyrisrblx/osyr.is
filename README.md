# osyr.is

BiggerHead's six expressions are editable vector artwork in
`public/assets/biggerhead-texture-*.svg`. They contain paths and shapes only,
with no embedded raster images, filters, fonts, or external resources.

The SVGs retain coordinates from the original 1254 × 1254 UV atlas, cropped to
`viewBox="680 530 320 320"`. Keep that viewBox and the solid red border when
editing expressions: `src/scripts/face-texture.ts` maps the crop back onto the
original OBJ UVs and clamps its border over the rest of the head. The artwork
appears upside down in the source because that is how the exported UVs are laid
out.

Three.js still uploads pixels to WebGL; SVG files alone do not make a texture
resolution-independent. `FaceTexture` draws the active SVG into one reusable
canvas, sized to the stage's physical height in 512–4096 pixel tiers and limited
by the GPU's maximum texture size. Resizing or changing displays redraws from the
vector source. Expressions share that canvas and GPU texture rather than keeping
six high-resolution copies. Large displays may use more GPU memory for fidelity;
the SVG download sizes do not describe GPU memory use.

Use `npm run dev` for development, `npm test` for the build and Chromium/Firefox
browser tests, and `npm run format:check` for formatting. The SVG rasterization
regressions cover sharp edges at Retina resolution, display changes, expression
changes, and GPU size limits.
