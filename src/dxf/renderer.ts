import {DxfArcEntity, DxfBounds, DxfCircleEntity, DxfDocument, DxfEntity, DxfLineEntity, DxfPoint, DxfPolylineEntity} from "./types";

export interface DxfViewport {
	zoom: number;
	panX: number;
	panY: number;
}

export interface DxfMeasurement {
	start: DxfPoint | null;
	end: DxfPoint | null;
	hover: DxfPoint | null;
}

export interface DxfRenderOptions {
	lineColor: string;
	backgroundColor: string;
	padding: number;
	showGridlines: boolean;
	gridSizeMm: number;
	viewport?: DxfViewport;
	measurement?: DxfMeasurement;
}

interface RenderTransform {
	baseScale: number;
	offsetX: number;
	offsetY: number;
	minX: number;
	minY: number;
	canvasWidth: number;
	canvasHeight: number;
	centerX: number;
	centerY: number;
	zoom: number;
	panX: number;
	panY: number;
}

const DEFAULT_VIEWPORT: DxfViewport = {
	zoom: 1,
	panX: 0,
	panY: 0,
};

const MEASUREMENT_COLOR = "#ffd166";
const MEASUREMENT_HOVER_COLOR = "#7bdff2";

export function renderDxf(canvas: HTMLCanvasElement, document: DxfDocument, options: DxfRenderOptions): void {
	const width = Math.max(10, Math.round(canvas.clientWidth));
	const height = Math.max(10, Math.round(canvas.clientHeight));
	const ratio = window.devicePixelRatio || 1;

	canvas.width = Math.round(width * ratio);
	canvas.height = Math.round(height * ratio);

	const context = canvas.getContext("2d");
	if (!context) {
		return;
	}

	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	context.clearRect(0, 0, width, height);
	context.fillStyle = options.backgroundColor;
	context.fillRect(0, 0, width, height);

	const transform = createTransformForCanvas(document, width, height, options);
	if (!transform) {
		return;
	}

	if (options.showGridlines && options.gridSizeMm > 0) {
		drawGrid(context, transform, options.gridSizeMm, options.lineColor);
	}

	context.strokeStyle = options.lineColor;
	context.lineWidth = 1;
	context.lineJoin = "round";
	context.lineCap = "round";

	for (const entity of document.entities) {
		switch (entity.type) {
			case "LINE":
				drawLine(context, entity, transform);
				break;
			case "POLYLINE":
				drawPolyline(context, entity, transform);
				break;
			case "CIRCLE":
				drawCircle(context, entity, transform);
				break;
			case "ARC":
				drawArc(context, entity, transform);
				break;
			default:
				break;
		}
	}

	if (options.measurement && (options.measurement.start || options.measurement.end)) {
		drawMeasurement(context, transform, options.measurement);
	}
}

export function findNearestVertex(
	canvas: HTMLCanvasElement,
	document: DxfDocument,
	options: DxfRenderOptions,
	screenX: number,
	screenY: number,
	maxDistancePx: number,
): DxfPoint | null {
	const width = Math.max(10, Math.round(canvas.clientWidth));
	const height = Math.max(10, Math.round(canvas.clientHeight));
	const transform = createTransformForCanvas(document, width, height, options);
	if (!transform) {
		return null;
	}

	const maxDistanceSquared = Math.max(maxDistancePx, 0) ** 2;
	let bestDistanceSquared = maxDistanceSquared;
	let bestPoint: DxfPoint | null = null;

	for (const vertex of collectVertices(document.entities)) {
		const projected = toScreen(vertex, transform);
		const dx = projected.x - screenX;
		const dy = projected.y - screenY;
		const distanceSquared = dx * dx + dy * dy;
		if (distanceSquared <= bestDistanceSquared) {
			bestDistanceSquared = distanceSquared;
			bestPoint = vertex;
		}
	}

	return bestPoint;
}

function createTransformForCanvas(
	document: DxfDocument,
	width: number,
	height: number,
	options: DxfRenderOptions,
): RenderTransform | null {
	const bounds = computeBounds(document.entities);
	if (!bounds) {
		return null;
	}
	return createTransform(bounds, width, height, options.padding, options.viewport ?? DEFAULT_VIEWPORT);
}

function drawLine(context: CanvasRenderingContext2D, entity: DxfLineEntity, transform: RenderTransform): void {
	const start = toScreen(entity.start, transform);
	const end = toScreen(entity.end, transform);
	context.beginPath();
	context.moveTo(start.x, start.y);
	context.lineTo(end.x, end.y);
	context.stroke();
}

function drawPolyline(context: CanvasRenderingContext2D, entity: DxfPolylineEntity, transform: RenderTransform): void {
	if (entity.points.length < 2) {
		return;
	}

	const firstPoint = entity.points[0];
	if (!firstPoint) {
		return;
	}

	context.beginPath();
	const first = toScreen(firstPoint, transform);
	context.moveTo(first.x, first.y);

	for (let i = 1; i < entity.points.length; i += 1) {
		const vertex = entity.points[i];
		if (!vertex) {
			continue;
		}
		const point = toScreen(vertex, transform);
		context.lineTo(point.x, point.y);
	}

	if (entity.closed) {
		context.closePath();
	}
	context.stroke();
}

function drawCircle(context: CanvasRenderingContext2D, entity: DxfCircleEntity, transform: RenderTransform): void {
	const center = toScreen(entity.center, transform);
	const radius = entity.radius * transform.baseScale * transform.zoom;
	context.beginPath();
	context.arc(center.x, center.y, radius, 0, Math.PI * 2);
	context.stroke();
}

function drawArc(context: CanvasRenderingContext2D, entity: DxfArcEntity, transform: RenderTransform): void {
	const startRad = degToRad(entity.startAngleDeg);
	const sweepRad = computeCounterClockwiseSweep(entity.startAngleDeg, entity.endAngleDeg);
	const segments = Math.max(12, Math.ceil(sweepRad / (Math.PI / 18)));

	context.beginPath();
	for (let i = 0; i <= segments; i += 1) {
		const angle = startRad + (sweepRad * i) / segments;
		const point: DxfPoint = {
			x: entity.center.x + entity.radius * Math.cos(angle),
			y: entity.center.y + entity.radius * Math.sin(angle),
		};
		const screenPoint = toScreen(point, transform);
		if (i === 0) {
			context.moveTo(screenPoint.x, screenPoint.y);
		} else {
			context.lineTo(screenPoint.x, screenPoint.y);
		}
	}
	context.stroke();
}

function drawMeasurement(context: CanvasRenderingContext2D, transform: RenderTransform, measurement: DxfMeasurement): void {
	const start = measurement.start ? toScreen(measurement.start, transform) : null;
	const end = measurement.end ? toScreen(measurement.end, transform) : null;
	const hover = measurement.hover ? toScreen(measurement.hover, transform) : null;

	context.save();
	context.strokeStyle = MEASUREMENT_COLOR;
	context.fillStyle = MEASUREMENT_COLOR;
	context.lineWidth = 1.5;
	context.setLineDash([6, 4]);

	if (start && end) {
		context.beginPath();
		context.moveTo(start.x, start.y);
		context.lineTo(end.x, end.y);
		context.stroke();
	}

	context.setLineDash([]);
	if (start) {
		drawMeasurementHandle(context, start);
	}
	if (end) {
		drawMeasurementHandle(context, end);
	}

	if (hover) {
		drawMeasurementHoverHandle(context, hover);
	}

	context.restore();
}

function drawMeasurementHandle(context: CanvasRenderingContext2D, point: DxfPoint): void {
	context.beginPath();
	context.arc(point.x, point.y, 4, 0, Math.PI * 2);
	context.fill();
}

function drawMeasurementHoverHandle(context: CanvasRenderingContext2D, point: DxfPoint): void {
	context.save();
	context.strokeStyle = MEASUREMENT_HOVER_COLOR;
	context.fillStyle = withAlpha(MEASUREMENT_HOVER_COLOR, 0.2);
	context.lineWidth = 1.5;
	context.beginPath();
	context.arc(point.x, point.y, 7, 0, Math.PI * 2);
	context.fill();
	context.stroke();
	context.restore();
}

function drawGrid(
	context: CanvasRenderingContext2D,
	transform: RenderTransform,
	baseGridSize: number,
	lineColor: string,
): void {
	const visible = computeVisibleWorldBounds(transform);
	const spanX = Math.max(visible.maxX - visible.minX, 1e-6);
	const spanY = Math.max(visible.maxY - visible.minY, 1e-6);
	const stepX = normalizeGridStep(baseGridSize, spanX, 500);
	const stepY = normalizeGridStep(baseGridSize, spanY, 500);

	context.save();
	context.lineWidth = 1;
	context.strokeStyle = withAlpha(lineColor, 0.16);

	const startXIndex = Math.floor(visible.minX / stepX);
	const endXIndex = Math.ceil(visible.maxX / stepX);
	for (let ix = startXIndex; ix <= endXIndex && ix - startXIndex < 5000; ix += 1) {
		const x = ix * stepX;
		const p1 = toScreen({x, y: visible.minY}, transform);
		const p2 = toScreen({x, y: visible.maxY}, transform);
		context.beginPath();
		context.moveTo(p1.x, p1.y);
		context.lineTo(p2.x, p2.y);
		context.stroke();
	}

	const startYIndex = Math.floor(visible.minY / stepY);
	const endYIndex = Math.ceil(visible.maxY / stepY);
	for (let iy = startYIndex; iy <= endYIndex && iy - startYIndex < 5000; iy += 1) {
		const y = iy * stepY;
		const p1 = toScreen({x: visible.minX, y}, transform);
		const p2 = toScreen({x: visible.maxX, y}, transform);
		context.beginPath();
		context.moveTo(p1.x, p1.y);
		context.lineTo(p2.x, p2.y);
		context.stroke();
	}

	context.strokeStyle = withAlpha(lineColor, 0.34);
	if (visible.minX <= 0 && visible.maxX >= 0) {
		const p1 = toScreen({x: 0, y: visible.minY}, transform);
		const p2 = toScreen({x: 0, y: visible.maxY}, transform);
		context.beginPath();
		context.moveTo(p1.x, p1.y);
		context.lineTo(p2.x, p2.y);
		context.stroke();
	}

	if (visible.minY <= 0 && visible.maxY >= 0) {
		const p1 = toScreen({x: visible.minX, y: 0}, transform);
		const p2 = toScreen({x: visible.maxX, y: 0}, transform);
		context.beginPath();
		context.moveTo(p1.x, p1.y);
		context.lineTo(p2.x, p2.y);
		context.stroke();
	}

	context.restore();
}

function createTransform(
	bounds: DxfBounds,
	width: number,
	height: number,
	padding: number,
	viewport: DxfViewport,
): RenderTransform {
	const safePadding = Math.min(Math.max(padding, 0), Math.min(width, height) / 2);
	const worldWidth = Math.max(bounds.maxX - bounds.minX, 1e-6);
	const worldHeight = Math.max(bounds.maxY - bounds.minY, 1e-6);
	const scaleX = (width - safePadding * 2) / worldWidth;
	const scaleY = (height - safePadding * 2) / worldHeight;
	const baseScale = Math.max(1e-6, Math.min(scaleX, scaleY));

	const drawnWidth = worldWidth * baseScale;
	const drawnHeight = worldHeight * baseScale;
	const zoom = clamp(viewport.zoom, 0.02, 200);
	const panX = Number.isFinite(viewport.panX) ? viewport.panX : 0;
	const panY = Number.isFinite(viewport.panY) ? viewport.panY : 0;

	return {
		baseScale,
		offsetX: (width - drawnWidth) / 2,
		offsetY: (height - drawnHeight) / 2,
		minX: bounds.minX,
		minY: bounds.minY,
		canvasWidth: width,
		canvasHeight: height,
		centerX: width / 2,
		centerY: height / 2,
		zoom,
		panX,
		panY,
	};
}

function toScreen(point: DxfPoint, transform: RenderTransform): DxfPoint {
	const base = worldToBase(point, transform);
	return applyViewport(base, transform);
}

function worldToBase(point: DxfPoint, transform: RenderTransform): DxfPoint {
	return {
		x: (point.x - transform.minX) * transform.baseScale + transform.offsetX,
		y: transform.canvasHeight - ((point.y - transform.minY) * transform.baseScale + transform.offsetY),
	};
}

function applyViewport(basePoint: DxfPoint, transform: RenderTransform): DxfPoint {
	return {
		x: transform.centerX + (basePoint.x - transform.centerX) * transform.zoom + transform.panX,
		y: transform.centerY + (basePoint.y - transform.centerY) * transform.zoom + transform.panY,
	};
}

function screenToWorld(screenPoint: DxfPoint, transform: RenderTransform): DxfPoint {
	const baseX = ((screenPoint.x - transform.panX - transform.centerX) / transform.zoom) + transform.centerX;
	const baseY = ((screenPoint.y - transform.panY - transform.centerY) / transform.zoom) + transform.centerY;
	return {
		x: (baseX - transform.offsetX) / transform.baseScale + transform.minX,
		y: ((transform.canvasHeight - baseY) - transform.offsetY) / transform.baseScale + transform.minY,
	};
}

function computeVisibleWorldBounds(transform: RenderTransform): DxfBounds {
	const corners: DxfPoint[] = [
		screenToWorld({x: 0, y: 0}, transform),
		screenToWorld({x: transform.canvasWidth, y: 0}, transform),
		screenToWorld({x: 0, y: transform.canvasHeight}, transform),
		screenToWorld({x: transform.canvasWidth, y: transform.canvasHeight}, transform),
	];

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const point of corners) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}

	return {minX, minY, maxX, maxY};
}

function normalizeGridStep(baseStep: number, span: number, maxLines: number): number {
	let step = Math.max(baseStep, 1e-6);
	while (span / step > maxLines) {
		step *= 2;
	}
	return step;
}

function withAlpha(hexColor: string, alpha: number): string {
	const normalized = normalizeHexColor(hexColor);
	if (!normalized) {
		return `rgba(128, 128, 128, ${clamp(alpha, 0, 1)})`;
	}

	const red = Number.parseInt(normalized.slice(1, 3), 16);
	const green = Number.parseInt(normalized.slice(3, 5), 16);
	const blue = Number.parseInt(normalized.slice(5, 7), 16);
	return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
}

function normalizeHexColor(value: string): string | null {
	const trimmed = value.trim();
	const shortHexMatch = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
	if (shortHexMatch) {
		const shortHex = shortHexMatch[1];
		if (!shortHex) {
			return null;
		}
		const [red, green, blue] = shortHex.split("");
		if (!red || !green || !blue) {
			return null;
		}
		return `#${red}${red}${green}${green}${blue}${blue}`;
	}

	if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
		return trimmed;
	}

	return null;
}

function collectVertices(entities: DxfEntity[]): DxfPoint[] {
	const vertices: DxfPoint[] = [];
	for (const entity of entities) {
		switch (entity.type) {
			case "LINE":
				vertices.push(entity.start, entity.end);
				break;
			case "POLYLINE":
				for (const point of entity.points) {
					vertices.push(point);
				}
				break;
			case "ARC":
				vertices.push(getArcPoint(entity, entity.startAngleDeg), getArcPoint(entity, entity.endAngleDeg));
				break;
			case "CIRCLE":
				break;
			default:
				break;
		}
	}
	return vertices;
}

function getArcPoint(entity: DxfArcEntity, angleDeg: number): DxfPoint {
	const angleRad = degToRad(angleDeg);
	return {
		x: entity.center.x + entity.radius * Math.cos(angleRad),
		y: entity.center.y + entity.radius * Math.sin(angleRad),
	};
}

function computeBounds(entities: DxfEntity[]): DxfBounds | null {
	let bounds: DxfBounds | null = null;

	const includePoint = (point: DxfPoint): void => {
		if (!bounds) {
			bounds = {minX: point.x, minY: point.y, maxX: point.x, maxY: point.y};
			return;
		}
		bounds.minX = Math.min(bounds.minX, point.x);
		bounds.minY = Math.min(bounds.minY, point.y);
		bounds.maxX = Math.max(bounds.maxX, point.x);
		bounds.maxY = Math.max(bounds.maxY, point.y);
	};

	const includeCircle = (center: DxfPoint, radius: number): void => {
		includePoint({x: center.x - radius, y: center.y - radius});
		includePoint({x: center.x + radius, y: center.y + radius});
	};

	for (const entity of entities) {
		switch (entity.type) {
			case "LINE":
				includePoint(entity.start);
				includePoint(entity.end);
				break;
			case "POLYLINE":
				for (const point of entity.points) {
					includePoint(point);
				}
				break;
			case "CIRCLE":
				includeCircle(entity.center, entity.radius);
				break;
			case "ARC":
				includeCircle(entity.center, entity.radius);
				break;
			default:
				break;
		}
	}

	return bounds;
}

function computeCounterClockwiseSweep(startDeg: number, endDeg: number): number {
	const start = normalizeDegrees(startDeg);
	const end = normalizeDegrees(endDeg);
	const delta = (end - start + 360) % 360;
	return degToRad(delta === 0 ? 360 : delta);
}

function normalizeDegrees(value: number): number {
	let normalized = value % 360;
	if (normalized < 0) {
		normalized += 360;
	}
	return normalized;
}

function degToRad(value: number): number {
	return (value * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
