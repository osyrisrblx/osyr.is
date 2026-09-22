export function showHeadUnavailable() {
	const stage = document.querySelector<HTMLDivElement>('#head-stage')!;
	stage.dataset.state = 'unavailable';
	document.querySelector<HTMLCanvasElement>('#head-canvas')!.hidden = true;
	document.querySelector('#scene-status')!.textContent =
		'The interactive head is unavailable.';
	document.querySelector('#head-help')!.textContent =
		'The interactive head is unavailable.';
}
