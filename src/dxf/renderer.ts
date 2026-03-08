import {DxfArcEntity, DxfBounds, DxfCircleEntity, DxfCurveEntity, DxfDocument, DxfEntity, DxfLineEntity, DxfPoint, DxfPolylineEntity} from "./types";

export interface DxfViewport {
	zoom: number;
	panX: number;
	panY: number;
}

export interface DxfVertexHit {
	point: DxfPoint;
	distancePx: number;
}

export interface DxfCurveHit {
	curve: DxfCurveEntity;
	distancePx: number;
}

export interface DxfMeasurement {
	start: DxfPoint | null;
	end: DxfPoint | null;
	hoverVertex: DxfPoint | null;
	hoverCurve: DxfCurveEntity | null;
	diameter: DxfCurveEntity | null;
	label: string | null;
	labelKind: "distance" | "diameter" | "components" | null;
	componentLabelX: string | null;
	componentLabelY: string | null;
}

export interface DxfRenderOptions {
	lineColor: string;
	backgroundColor: string;
	measurementColor: string;
	padding: number;
	showGridlines: boolean;
	gridSizeWorldUnits: number;
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

const DEFAULT_MEASUREMENT_COLOR = "#ffd166";
const CURVE_MEASUREMENT_HOVER_COLOR = "#ff7b72";

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

	if (options.showGridlines && options.gridSizeWorldUnits > 0) {
		drawGrid(context, transform, options.gridSizeWorldUnits, options.lineColor);
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

	if (
		options.measurement
		&& (options.measurement.start
			|| options.measurement.end
			|| options.measurement.hoverVertex
			|| options.measurement.hoverCurve
			|| options.measurement.diameter)
	) {
		drawMeasurement(context, transform, options.measurement, options.measurementColor);
	}
}

export function findNearestVertexHit(
	canvas: HTMLCanvasElement,
	document: DxfDocument,
	options: DxfRenderOptions,
	screenX: number,
	screenY: number,
	maxDistancePx: number,
): DxfVertexHit | null {
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

	if (!bestPoint) {
		return null;
	}

	return {
		point: bestPoint,
		distancePx: Math.sqrt(bestDistanceSquared),
	};
}

export function findNearestCurveHit(
	canvas: HTMLCanvasElement,
	document: DxfDocument,
	options: DxfRenderOptions,
	screenX: number,
	screenY: number,
	maxDistancePx: number,
): DxfCurveHit | null {
	const width = Math.max(10, Math.round(canvas.clientWidth));
	const height = Math.max(10, Math.round(canvas.clientHeight));
	const transform = createTransformForCanvas(document, width, height, options);
	if (!transform) {
		return null;
	}

	const maxDistance = Math.max(maxDistancePx, 0);
	const worldPoint = screenToWorld({x: screenX, y: screenY}, transform);
	let bestDistance = maxDistance;
	let bestCurve: DxfCurveEntity | null = null;

	for (const curve of collectCurves(document.entities)) {
		if (curve.type === "ARC" && !isAngleWithinArc(getAngleDeg(curve.center, worldPoint), curve.startAngleDeg, curve.endAngleDeg)) {
			continue;
		}

		const center = toScreen(curve.center, transform);
		const radiusPx = curve.radius * transform.baseScale * transform.zoom;
		if (radiusPx <= 0) {
			continue;
		}

		const distanceFromCenter = Math.hypot(screenX - center.x, screenY - center.y);
		const distanceFromCurve = Math.abs(distanceFromCenter - radiusPx);
		if (distanceFromCurve <= bestDistance) {
			bestDistance = distanceFromCurve;
			bestCurve = curve;
		}
	}

	if (!bestCurve) {
		return null;
	}

	return {
		curve: bestCurve,
		distancePx: bestDistance,
	};
}

export function stabilizeViewportForResize(
	document: DxfDocument,
	options: DxfRenderOptions,
	viewport: DxfViewport,
	previousWidth: number,
	previousHeight: number,
	nextWidth: number,
	nextHeight: number,
): DxfViewport {
	const safePreviousWidth = Math.max(10, Math.round(previousWidth));
	const safePreviousHeight = Math.max(10, Math.round(previousHeight));
	const safeNextWidth = Math.max(10, Math.round(nextWidth));
	const safeNextHeight = Math.max(10, Math.round(nextHeight));

	if (safePreviousWidth === safeNextWidth && safePreviousHeight === safeNextHeight) {
		return viewport;
	}

	const previousTransform = createTransformForSize(document, safePreviousWidth, safePreviousHeight, options);
	const nextTransform = createTransformForSize(document, safeNextWidth, safeNextHeight, options);
	if (!previousTransform || !nextTransform) {
		return viewport;
	}

	const centerWorld = screenToWorld({
		x: previousTransform.canvasWidth / 2,
		y: previousTransform.canvasHeight / 2,
	}, previousTransform);
	const basePointAtNextSize = worldToBase(centerWorld, nextTransform);
	const previousPixelsPerUnit = previousTransform.baseScale * previousTransform.zoom;
	const nextZoom = clamp(previousPixelsPerUnit / nextTransform.baseScale, 0.02, 200);

	return {
		zoom: nextZoom,
		panX: -(basePointAtNextSize.x - nextTransform.centerX) * nextZoom,
		panY: -(basePointAtNextSize.y - nextTransform.centerY) * nextZoom,
	};
}

function createTransformForCanvas(
	document: DxfDocument,
	width: number,
	height: number,
	options: DxfRenderOptions,
): RenderTransform | null {
	return createTransformForSize(document, width, height, options);
}

function createTransformForSize(
	document: DxfDocument,
	width: number,
	height: number,
	options: DxfRenderOptions,
): RenderTransform | null {
	const bounds = computeEntityBounds(document.entities);
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

function drawMeasurement(
	context: CanvasRenderingContext2D,
	transform: RenderTransform,
	measurement: DxfMeasurement,
	measurementColorRaw: string,
): void {
	const measurementColor = normalizeHexColor(measurementColorRaw) ?? DEFAULT_MEASUREMENT_COLOR;
	const start = measurement.start ? toScreen(measurement.start, transform) : null;
	const end = measurement.end ? toScreen(measurement.end, transform) : null;
	const hoverVertex = measurement.hoverVertex ? toScreen(measurement.hoverVertex, transform) : null;

	context.save();
	context.strokeStyle = measurementColor;
	context.fillStyle = measurementColor;
	context.lineWidth = 1.5;
	context.setLineDash([6, 4]);

	if (start && end) {
		if (measurement.labelKind === "components") {
			drawComponentMeasurementGuide(context, start, end);
		} else {
			context.beginPath();
			context.moveTo(start.x, start.y);
			context.lineTo(end.x, end.y);
			context.stroke();
		}
	}

	context.setLineDash([]);
	if (start) {
		drawMeasurementHandle(context, start);
	}
	if (end) {
		drawMeasurementHandle(context, end);
	}

	if (measurement.diameter) {
		drawCurveMeasurement(context, transform, measurement.diameter, measurementColor, true);
	}

	if (hoverVertex) {
		drawMeasurementHoverHandle(context, hoverVertex, measurementColor);
	}

	if (measurement.hoverCurve && measurement.hoverCurve !== measurement.diameter) {
		drawCurveMeasurement(context, transform, measurement.hoverCurve, CURVE_MEASUREMENT_HOVER_COLOR, false);
	}

	if (measurement.label || measurement.componentLabelX || measurement.componentLabelY) {
		if (measurement.labelKind === "diameter" && measurement.diameter && measurement.label) {
			drawCurveMeasurementLabel(context, transform, measurement.diameter, measurement.label, measurementColor);
		} else if (measurement.labelKind === "components" && start && end) {
			drawComponentMeasurementLabels(
				context,
				transform,
				start,
				end,
				measurement.componentLabelX,
				measurement.componentLabelY,
				measurementColor,
			);
		} else if (start && end && measurement.label) {
			drawLinearMeasurementLabel(context, transform, start, end, measurement.label, measurementColor);
		}
	}

	context.restore();
}

function drawMeasurementHandle(context: CanvasRenderingContext2D, point: DxfPoint): void {
	context.beginPath();
	context.arc(point.x, point.y, 4, 0, Math.PI * 2);
	context.fill();
}

function drawMeasurementHoverHandle(context: CanvasRenderingContext2D, point: DxfPoint, color: string): void {
	context.save();
	context.strokeStyle = color;
	context.fillStyle = withAlpha(color, 0.25);
	context.lineWidth = 1.5;
	context.beginPath();
	context.arc(point.x, point.y, 7, 0, Math.PI * 2);
	context.fill();
	context.stroke();
	context.restore();
}

function drawCurveMeasurement(
	context: CanvasRenderingContext2D,
	transform: RenderTransform,
	curve: DxfCurveEntity,
	color: string,
	drawDiameterGuide: boolean,
): void {
	context.save();
	context.strokeStyle = color;
	context.fillStyle = color;
	context.lineWidth = 2;
	context.setLineDash(drawDiameterGuide ? [6, 4] : []);

	if (curve.type === "CIRCLE") {
		const center = toScreen(curve.center, transform);
		const radius = curve.radius * transform.baseScale * transform.zoom;
		context.beginPath();
		context.arc(center.x, center.y, radius, 0, Math.PI * 2);
		context.stroke();
		if (drawDiameterGuide) {
			context.beginPath();
			context.moveTo(center.x - radius, center.y);
			context.lineTo(center.x + radius, center.y);
			context.stroke();
			drawMeasurementHandle(context, center);
		}
		context.restore();
		return;
	}

	const startRad = degToRad(curve.startAngleDeg);
	const sweepRad = computeCounterClockwiseSweep(curve.startAngleDeg, curve.endAngleDeg);
	const segments = Math.max(12, Math.ceil(sweepRad / (Math.PI / 18)));
	context.beginPath();
	for (let i = 0; i <= segments; i += 1) {
		const angle = startRad + (sweepRad * i) / segments;
		const point = toScreen({
			x: curve.center.x + curve.radius * Math.cos(angle),
			y: curve.center.y + curve.radius * Math.sin(angle),
		}, transform);
		if (i === 0) {
			context.moveTo(point.x, point.y);
		} else {
			context.lineTo(point.x, point.y);
		}
	}
	context.stroke();

	if (drawDiameterGuide) {
		const center = toScreen(curve.center, transform);
		const radius = curve.radius * transform.baseScale * transform.zoom;
		context.beginPath();
		context.moveTo(center.x - radius, center.y);
		context.lineTo(center.x + radius, center.y);
		context.stroke();
		drawMeasurementHandle(context, center);
	}

	context.restore();
}

function drawLinearMeasurementLabel(
	context: CanvasRenderingContext2D,
	transform: RenderTransform,
	start: DxfPoint,
	end: DxfPoint,
	label: string,
	measurementColor: string,
): void {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const length = Math.hypot(dx, dy);
	if (length <= 1e-6) {
		return;
	}

	const fontSize = getMeasurementFontSize(transform.zoom);
	const midpoint = {
		x: (start.x + end.x) / 2,
		y: (start.y + end.y) / 2,
	};

	context.save();
	prepareMeasurementLabelText(context, fontSize);
	const textWidth = context.measureText(label).width;
	const needsOffset = length < textWidth + 28;
	const normalX = -dy / length;
	const normalY = dx / length;
	const offset = needsOffset ? Math.max(18, fontSize * 1.5) : 0;
	drawMeasurementLabelBubble(context, label, midpoint.x + normalX * offset, midpoint.y + normalY * offset, fontSize, measurementColor);
	context.restore();
}

function drawComponentMeasurementGuide(
	context: CanvasRenderingContext2D,
	start: DxfPoint,
	end: DxfPoint,
): void {
	const corner: DxfPoint = {x: end.x, y: start.y};
	context.beginPath();
	context.moveTo(start.x, start.y);
	context.lineTo(corner.x, corner.y);
	context.lineTo(end.x, end.y);
	context.stroke();
}

function drawComponentMeasurementLabels(
	context: CanvasRenderingContext2D,
	transform: RenderTransform,
	start: DxfPoint,
	end: DxfPoint,
	xLabel: string | null,
	yLabel: string | null,
	measurementColor: string,
): void {
	const fontSize = getMeasurementFontSize(transform.zoom);
	const dx = end.x - start.x;
	const dy = end.y - start.y;

	context.save();
	prepareMeasurementLabelText(context, fontSize);

	if (xLabel) {
		const horizontalLength = Math.abs(dx);
		const horizontalTextWidth = context.measureText(xLabel).width;
		const horizontalOffset = horizontalLength < horizontalTextWidth + 24 ? Math.max(24, fontSize * 1.8) : Math.max(18, fontSize * 1.4);
		const xAnchor = horizontalLength <= 1e-6 ? start.x : start.x + dx / 2;
		const yAnchor = start.y + (dy >= 0 ? -horizontalOffset : horizontalOffset);
		drawMeasurementLabelBubble(context, xLabel, xAnchor, yAnchor, fontSize, measurementColor);
	}

	if (yLabel) {
		const verticalLength = Math.abs(dy);
		const verticalOffset = verticalLength < fontSize * 2 + 20 ? Math.max(26, fontSize * 2) : Math.max(20, fontSize * 1.6);
		const xAnchor = end.x + (dx >= 0 ? verticalOffset : -verticalOffset);
		const yAnchor = verticalLength <= 1e-6 ? end.y : start.y + dy / 2;
		drawMeasurementLabelBubble(context, yLabel, xAnchor, yAnchor, fontSize, measurementColor);
	}

	context.restore();
}

function drawCurveMeasurementLabel(
	context: CanvasRenderingContext2D,
	transform: RenderTransform,
	curve: DxfCurveEntity,
	label: string,
	measurementColor: string,
): void {
	const fontSize = getMeasurementFontSize(transform.zoom);
	const center = toScreen(curve.center, transform);
	const radius = curve.radius * transform.baseScale * transform.zoom;

	context.save();
	prepareMeasurementLabelText(context, fontSize);
	const textWidth = context.measureText(label).width;

	if (curve.type === "CIRCLE" && radius * 2 >= textWidth + 24 && radius >= fontSize * 1.2) {
		drawMeasurementLabelBubble(context, label, center.x, center.y, fontSize, measurementColor);
		context.restore();
		return;
	}

	if (curve.type === "ARC") {
		const anchor = getArcLabelAnchor(center, radius, curve.startAngleDeg, curve.endAngleDeg, fontSize);
		drawMeasurementLabelBubble(context, label, anchor.x, anchor.y, fontSize, measurementColor);
		context.restore();
		return;
	}

	drawMeasurementLabelBubble(context, label, center.x, center.y - radius - fontSize * 1.6, fontSize, measurementColor);
	context.restore();
}

function getArcLabelAnchor(
	center: DxfPoint,
	radius: number,
	startAngleDeg: number,
	endAngleDeg: number,
	fontSize: number,
): DxfPoint {
	const sweep = computeCounterClockwiseSweep(startAngleDeg, endAngleDeg);
	const midAngle = degToRad(startAngleDeg) + sweep / 2;
	const distance = radius + fontSize * 1.8;
	return {
		x: center.x + Math.cos(midAngle) * distance,
		y: center.y - Math.sin(midAngle) * distance,
	};
}

function prepareMeasurementLabelText(context: CanvasRenderingContext2D, fontSize: number): void {
	context.font = `600 ${fontSize}px system-ui, sans-serif`;
	context.textAlign = "center";
	context.textBaseline = "middle";
}

function drawMeasurementLabelBubble(
	context: CanvasRenderingContext2D,
	label: string,
	x: number,
	y: number,
	fontSize: number,
	measurementColor: string,
): void {
	const textWidth = context.measureText(label).width;
	const paddingX = Math.max(8, fontSize * 0.55);
	const paddingY = Math.max(5, fontSize * 0.35);
	const boxWidth = textWidth + paddingX * 2;
	const boxHeight = fontSize + paddingY * 2;
	const radius = Math.min(10, boxHeight / 2);

	context.save();
	context.fillStyle = "rgba(16, 19, 26, 0.9)";
	context.strokeStyle = withAlpha(measurementColor, 0.9);
	context.lineWidth = 1;
	roundRect(context, x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight, radius);
	context.fill();
	context.stroke();
	context.fillStyle = measurementColor;
	context.fillText(label, x, y);
	context.restore();
}

function roundRect(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
): void {
	const safeRadius = Math.min(radius, width / 2, height / 2);
	context.beginPath();
	context.moveTo(x + safeRadius, y);
	context.lineTo(x + width - safeRadius, y);
	context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
	context.lineTo(x + width, y + height - safeRadius);
	context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
	context.lineTo(x + safeRadius, y + height);
	context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
	context.lineTo(x, y + safeRadius);
	context.quadraticCurveTo(x, y, x + safeRadius, y);
	context.closePath();
}

function getMeasurementFontSize(zoom: number): number {
	return clamp(12 + Math.log2(Math.max(zoom, 0.125) * 2) * 1.2, 11, 18);
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

function collectCurves(entities: DxfEntity[]): DxfCurveEntity[] {
	const curves: DxfCurveEntity[] = [];
	for (const entity of entities) {
		if (entity.type === "CIRCLE" || entity.type === "ARC") {
			curves.push(entity);
		}
	}
	return curves;
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

function getAngleDeg(center: DxfPoint, point: DxfPoint): number {
	return normalizeAngleDeg((Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI);
}

function isAngleWithinArc(angleDeg: number, startAngleDeg: number, endAngleDeg: number): boolean {
	const normalizedAngle = normalizeAngleDeg(angleDeg);
	const start = normalizeAngleDeg(startAngleDeg);
	const sweep = computeCounterClockwiseSweep(startAngleDeg, endAngleDeg);
	const delta = normalizeAngleDeg(normalizedAngle - start);
	return delta <= sweep + 1e-6;
}

function normalizeAngleDeg(angleDeg: number): number {
	const normalized = angleDeg % 360;
	return normalized < 0 ? normalized + 360 : normalized;
}

export function computeEntityBounds(entities: DxfEntity[]): DxfBounds | null {
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

export function countRenderablePrimitives(entities: DxfEntity[]): number {
	let count = 0;

	for (const entity of entities) {
		switch (entity.type) {
			case "LINE":
			case "CIRCLE":
			case "ARC":
				count += 1;
				break;
			case "POLYLINE":
				count += Math.max(entity.points.length - 1, 0) + (entity.closed ? 1 : 0);
				break;
			default:
				break;
		}
	}

	return count;
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
