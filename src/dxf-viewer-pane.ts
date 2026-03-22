import {Component, setIcon} from "obsidian";
import {parseDxf} from "./dxf/parser";
import {
	computeEntityBounds,
	countRenderablePrimitives,
	DxfRenderOptions,
	DxfViewport,
	findNearestCurveHit,
	findNearestVertexHit,
	renderDxf,
	stabilizeViewportForResize,
} from "./dxf/renderer";
import {DxfCurveEntity, DxfDocument, DxfDrawingUnit, DxfPoint} from "./dxf/types";
import DxfViewerPlugin from "./main";

const INCH_IN_MM = 25.4;
const FOOT_IN_MM = 304.8;
const MILE_IN_MM = 1_609_344;
const VERTEX_HIT_RADIUS_PX = 14;
const CURVE_HIT_RADIUS_PX = 10;

type DrawingUnitOverride = "auto" | "mm" | "inch";

interface MeasurementDisplay {
	kind: "distance" | "diameter" | "components";
	text: string | null;
	xText: string | null;
	yText: string | null;
}

export class DxfViewerPane extends Component {
	plugin: DxfViewerPlugin;
	containerEl: HTMLElement;
	private readonly embedMode: boolean;
	private canvasFrameEl: HTMLDivElement | null = null;
	private canvasEl: HTMLCanvasElement | null = null;
	private summaryEl: HTMLDivElement | null = null;
	private measureButtonEl: HTMLButtonElement | null = null;
	private componentMeasureButtonEl: HTMLButtonElement | null = null;
	private zoomAllButtonEl: HTMLButtonElement | null = null;
	private helpButtonEl: HTMLButtonElement | null = null;
	private helpPopoverEl: HTMLDivElement | null = null;
	private unitButtonEl: HTMLButtonElement | null = null;
	private unitPopoverEl: HTMLDivElement | null = null;
	private drawingUnitSelectEl: HTMLSelectElement | null = null;
	private rawData = "";
	private parsedDocument: DxfDocument | null = null;
	private parseError: string | null = null;
	private viewport: DxfViewport = createDefaultViewport();
	private measureModeEnabled = false;
	private componentMeasureModeEnabled = false;
	private helpVisible = false;
	private unitMenuVisible = false;
	private drawingUnitOverride: DrawingUnitOverride = "auto";
	private measureStart: DxfPoint | null = null;
	private measureEnd: DxfPoint | null = null;
	private hoverVertex: DxfPoint | null = null;
	private hoverCurve: DxfCurveEntity | null = null;
	private diameterMeasurement: DxfCurveEntity | null = null;
	private isPanning = false;
	private pointerDragged = false;
	private activePointerId: number | null = null;
	private pointerDownButton: number | null = null;
	private pointerDownX = 0;
	private pointerDownY = 0;
	private lastPointerX = 0;
	private lastPointerY = 0;
	private lastCanvasWidth = 0;
	private lastCanvasHeight = 0;
	private viewportDirty = false;
	private resizeObserver: ResizeObserver | null = null;
	private visibilityObserver: IntersectionObserver | null = null;
	private pendingRenderFrame = 0;
	private pendingAutoFitTimeouts: number[] = [];

	constructor(containerEl: HTMLElement, plugin: DxfViewerPlugin, options?: {embed?: boolean}) {
		super();
		this.containerEl = containerEl;
		this.plugin = plugin;
		this.embedMode = options?.embed ?? false;
	}

	onload(): void {
		this.containerEl.empty();
		this.containerEl.addClass("dxf-viewer");
		this.containerEl.classList.toggle("dxf-viewer--embed", this.embedMode);

		this.canvasFrameEl = this.containerEl.createDiv({cls: "dxf-viewer__canvas-frame"});
		this.canvasEl = this.canvasFrameEl.createEl("canvas", {cls: "dxf-viewer__canvas"});
		this.measureButtonEl = this.canvasFrameEl.createEl("button", {cls: "dxf-viewer__measure-button dxf-viewer__measure-button--overlay"});
		this.measureButtonEl.type = "button";
		this.componentMeasureButtonEl = this.canvasFrameEl.createEl("button", {cls: "dxf-viewer__overlay-button dxf-viewer__component-button"});
		this.componentMeasureButtonEl.type = "button";
		const componentIconEl = this.componentMeasureButtonEl.createDiv({cls: "dxf-viewer__component-icon"});
		componentIconEl.createDiv({cls: "dxf-viewer__component-axis dxf-viewer__component-axis--x"});
		componentIconEl.createDiv({cls: "dxf-viewer__component-axis dxf-viewer__component-axis--y"});
		componentIconEl.createSpan({cls: "dxf-viewer__component-axis-label dxf-viewer__component-axis-label--x", text: "x"});
		componentIconEl.createSpan({cls: "dxf-viewer__component-axis-label dxf-viewer__component-axis-label--y", text: "y"});
		this.zoomAllButtonEl = this.canvasFrameEl.createEl("button", {cls: "dxf-viewer__overlay-button dxf-viewer__zoom-all-button"});
		this.zoomAllButtonEl.type = "button";
		this.helpButtonEl = this.canvasFrameEl.createEl("button", {cls: "dxf-viewer__overlay-button dxf-viewer__help-button"});
		this.helpButtonEl.type = "button";
		this.helpButtonEl.setText("?");
		this.helpPopoverEl = this.canvasFrameEl.createDiv({cls: "dxf-viewer__help-popover"});
		this.unitButtonEl = this.canvasFrameEl.createEl("button", {cls: "dxf-viewer__unit-button"});
		this.unitButtonEl.type = "button";
		const unitIconEl = this.unitButtonEl.createDiv({cls: "dxf-viewer__unit-button-icon"});
		unitIconEl.createSpan({cls: "dxf-viewer__unit-button-glyph", text: "in"});
		unitIconEl.createSpan({cls: "dxf-viewer__unit-button-glyph", text: "mm"});
		this.unitPopoverEl = this.canvasFrameEl.createDiv({cls: "dxf-viewer__unit-popover"});
		this.drawingUnitSelectEl = this.unitPopoverEl.createEl("select", {cls: "dxf-viewer__unit-select"});
		this.drawingUnitSelectEl.createEl("option", {value: "auto", text: "Auto"});
		this.drawingUnitSelectEl.createEl("option", {value: "mm", text: "Millimeters"});
		this.drawingUnitSelectEl.createEl("option", {value: "inch", text: "Inches"});
		this.drawingUnitSelectEl.value = this.drawingUnitOverride;
		this.summaryEl = this.canvasFrameEl.createDiv({cls: "dxf-viewer__status"});

		this.registerDomEvent(window, "resize", () => this.renderCurrentData());
		if (typeof ResizeObserver !== "undefined") {
			this.resizeObserver = new ResizeObserver(() => this.scheduleRenderCurrentData());
			this.resizeObserver.observe(this.canvasFrameEl);
		}
		if (this.embedMode && typeof IntersectionObserver !== "undefined") {
			this.visibilityObserver = new IntersectionObserver((entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) {
					return;
				}
				this.refitIfViewportUntouched();
			});
			this.visibilityObserver.observe(this.canvasFrameEl);
		}
		this.registerDomEvent(this.measureButtonEl, "click", this.toggleMeasureMode);
		this.registerDomEvent(this.componentMeasureButtonEl, "click", this.toggleComponentMeasureMode);
		this.registerDomEvent(this.zoomAllButtonEl, "click", this.zoomAll);
		this.registerDomEvent(this.helpButtonEl, "click", this.toggleHelp);
		this.registerDomEvent(this.unitButtonEl, "click", this.toggleUnitMenu);
		this.registerDomEvent(this.drawingUnitSelectEl, "change", this.onDrawingUnitChange);
		this.registerDomEvent(document, "pointerdown", this.onDocumentPointerDown);
		this.registerDomEvent(this.canvasEl, "pointerdown", this.onPointerDown);
		this.registerDomEvent(this.canvasEl, "pointermove", this.onPointerMove);
		this.registerDomEvent(this.canvasEl, "pointerup", this.onPointerUp);
		this.registerDomEvent(this.canvasEl, "pointercancel", this.onPointerUp);
		this.registerDomEvent(this.canvasEl, "lostpointercapture", this.onPointerUp);
		this.registerDomEvent(this.canvasEl, "pointerleave", this.onPointerLeave);
		this.registerDomEvent(this.canvasEl, "wheel", this.onWheel, {passive: false});
		this.registerDomEvent(this.canvasEl, "dblclick", this.onDoubleClick);

		this.updateMeasureButtonUi();
		this.reparseData();
		this.renderCurrentData();
	}

	onunload(): void {
		this.containerEl.empty();
		this.canvasFrameEl = null;
		this.canvasEl = null;
		this.measureButtonEl = null;
		this.componentMeasureButtonEl = null;
		this.zoomAllButtonEl = null;
		this.helpButtonEl = null;
		this.helpPopoverEl = null;
		this.unitButtonEl = null;
		this.unitPopoverEl = null;
		this.drawingUnitSelectEl = null;
		this.summaryEl = null;
		this.lastCanvasWidth = 0;
		this.lastCanvasHeight = 0;
		if (this.pendingRenderFrame) {
			window.cancelAnimationFrame(this.pendingRenderFrame);
			this.pendingRenderFrame = 0;
		}
		this.clearPendingAutoFitTimeouts();
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.visibilityObserver?.disconnect();
		this.visibilityObserver = null;
		this.stopPanning();
	}

	setRawData(data: string): void {
		if (data !== this.rawData) {
			this.resetViewport();
			this.resetMeasurement();
			this.lastCanvasWidth = 0;
			this.lastCanvasHeight = 0;
		}

		this.rawData = data;
		this.reparseData();
		this.renderCurrentData();
		this.scheduleRenderCurrentData();
		this.scheduleAutoFitSettlingPasses();
	}

	clear(): void {
		this.rawData = "";
		this.parsedDocument = null;
		this.parseError = null;
		this.resetViewport();
		this.resetMeasurement();
		this.lastCanvasWidth = 0;
		this.lastCanvasHeight = 0;
		this.renderCurrentData();
	}

	refreshView(): void {
		this.renderCurrentData();
	}

	private readonly toggleMeasureMode = (): void => {
		this.measureModeEnabled = !this.measureModeEnabled;
		if (!this.measureModeEnabled) {
			this.componentMeasureModeEnabled = false;
			this.resetMeasurement();
		}
		this.updateMeasureButtonUi();
		this.updateComponentMeasureButtonUi();
		this.renderCurrentData();
	};

	private readonly toggleComponentMeasureMode = (): void => {
		if (!this.measureModeEnabled) {
			return;
		}

		this.componentMeasureModeEnabled = !this.componentMeasureModeEnabled;
		this.updateComponentMeasureButtonUi();
		this.renderCurrentData();
	};

	private readonly toggleHelp = (): void => {
		this.helpVisible = !this.helpVisible;
		this.updateHelpButtonUi();
		this.renderCurrentData();
	};

	private readonly zoomAll = (): void => {
		this.resetViewport();
		this.renderCurrentData();
	};

	private readonly toggleUnitMenu = (event: MouseEvent): void => {
		event.preventDefault();
		this.unitMenuVisible = !this.unitMenuVisible;
		this.updateDrawingUnitSelectUi();
	};

	private readonly onDrawingUnitChange = (): void => {
		if (!this.drawingUnitSelectEl) {
			return;
		}

		this.drawingUnitOverride = this.drawingUnitSelectEl.value === "inch" || this.drawingUnitSelectEl.value === "mm"
			? this.drawingUnitSelectEl.value
			: "auto";
		this.unitMenuVisible = false;
		this.renderCurrentData();
	};

	private readonly onDocumentPointerDown = (event: PointerEvent): void => {
		if (!this.unitMenuVisible) {
			return;
		}

		const target = event.target;
		if (!(target instanceof Node)) {
			return;
		}

		if (this.unitButtonEl?.contains(target) || this.unitPopoverEl?.contains(target)) {
			return;
		}

		this.unitMenuVisible = false;
		this.updateDrawingUnitSelectUi();
	};

	private readonly onPointerDown = (event: PointerEvent): void => {
		if (!this.canvasEl) {
			return;
		}
		if (event.button !== 0 && event.button !== 1) {
			return;
		}

		this.isPanning = true;
		this.pointerDragged = false;
		this.pointerDownButton = event.button;
		this.activePointerId = event.pointerId;
		this.pointerDownX = event.clientX;
		this.pointerDownY = event.clientY;
		this.lastPointerX = event.clientX;
		this.lastPointerY = event.clientY;
		this.canvasEl.setPointerCapture(event.pointerId);
		event.preventDefault();
	};

	private readonly onPointerMove = (event: PointerEvent): void => {
		this.updateHoverVertex(event.clientX, event.clientY);

		if (!this.isPanning || this.activePointerId !== event.pointerId) {
			return;
		}

		if (!this.pointerDragged) {
			const movedX = event.clientX - this.pointerDownX;
			const movedY = event.clientY - this.pointerDownY;
			if (Math.hypot(movedX, movedY) < 3) {
				return;
			}
			this.pointerDragged = true;
		}

		const deltaX = event.clientX - this.lastPointerX;
		const deltaY = event.clientY - this.lastPointerY;
		this.lastPointerX = event.clientX;
		this.lastPointerY = event.clientY;
		this.viewport.panX += deltaX;
		this.viewport.panY += deltaY;
		this.viewportDirty = true;
		this.renderCurrentData();
	};

	private readonly onPointerUp = (event: PointerEvent): void => {
		if (this.activePointerId !== event.pointerId) {
			return;
		}

		if (!this.pointerDragged && this.pointerDownButton === 0) {
			this.handleMeasurementClick(event.clientX, event.clientY);
		}

		this.stopPanning();
	};

	private readonly onPointerLeave = (): void => {
		if (!this.measureModeEnabled) {
			return;
		}
		if (this.hoverVertex || this.hoverCurve) {
			this.hoverVertex = null;
			this.hoverCurve = null;
			this.renderCurrentData();
		}
	};

	private readonly onWheel = (event: WheelEvent): void => {
		if (!this.canvasEl) {
			return;
		}

		event.preventDefault();
		if (event.ctrlKey || event.metaKey) {
			const zoomFactor = Math.exp(-event.deltaY * 0.002);
			this.zoomAt(event.clientX, event.clientY, zoomFactor);
			return;
		}

		const deltaScale = this.deltaModeToPixels(event.deltaMode);
		this.viewport.panX -= event.deltaX * deltaScale;
		this.viewport.panY -= event.deltaY * deltaScale;
		this.viewportDirty = true;
		this.renderCurrentData();
	};

	private readonly onDoubleClick = (event: MouseEvent): void => {
		if (!this.measureModeEnabled) {
			return;
		}

		event.preventDefault();
		this.resetMeasurement();
		this.renderCurrentData();
	};

	private handleMeasurementClick(clientX: number, clientY: number): void {
		if (!this.measureModeEnabled || !this.canvasEl || !this.parsedDocument) {
			return;
		}

		const {vertex: nearestVertex, curve: nearestCurve} = this.getMeasurementTargetsAtClient(clientX, clientY);
		if (this.measureStart && !this.measureEnd) {
			if (nearestVertex) {
				this.measureEnd = nearestVertex;
				this.hoverVertex = nearestVertex;
				this.hoverCurve = null;
				this.diameterMeasurement = null;
				this.renderCurrentData();
				return;
			}

			if (nearestCurve) {
				if (samePoint(this.measureStart, nearestCurve.center)) {
					this.hoverVertex = null;
					this.hoverCurve = nearestCurve;
					this.diameterMeasurement = nearestCurve;
					this.renderCurrentData();
					return;
				}

				this.measureEnd = nearestCurve.center;
				this.hoverVertex = null;
				this.hoverCurve = null;
				this.diameterMeasurement = null;
				this.renderCurrentData();
				return;
			}

			this.renderCurrentData();
			return;
		}

		if (nearestVertex) {
			this.measureStart = nearestVertex;
			this.measureEnd = null;
			this.hoverVertex = nearestVertex;
			this.hoverCurve = null;
			this.diameterMeasurement = null;
			this.renderCurrentData();
			return;
		}

		if (!nearestCurve) {
			this.renderCurrentData();
			return;
		}

		this.measureStart = nearestCurve.center;
		this.measureEnd = null;
		this.hoverVertex = null;
		this.hoverCurve = nearestCurve;
		this.diameterMeasurement = nearestCurve;
		this.renderCurrentData();
	}

	private getMeasurementTargetsAtClient(clientX: number, clientY: number): {vertex: DxfPoint | null; curve: DxfCurveEntity | null} {
		if (!this.canvasEl || !this.parsedDocument) {
			return {vertex: null, curve: null};
		}

		const {canvasX, canvasY} = this.clientToCanvasPoint(clientX, clientY);
		const renderOptions = this.createRenderOptions();
		const vertexHit = findNearestVertexHit(
			this.canvasEl,
			this.parsedDocument,
			renderOptions,
			canvasX,
			canvasY,
			VERTEX_HIT_RADIUS_PX,
		);
		const curveHit = findNearestCurveHit(
			this.canvasEl,
			this.parsedDocument,
			renderOptions,
			canvasX,
			canvasY,
			CURVE_HIT_RADIUS_PX,
		);
		if (vertexHit && curveHit) {
			const vertexScore = vertexHit.distancePx / VERTEX_HIT_RADIUS_PX;
			const curveScore = curveHit.distancePx / CURVE_HIT_RADIUS_PX;
			if (curveScore <= vertexScore) {
				return {vertex: null, curve: curveHit.curve};
			}

			return {vertex: vertexHit.point, curve: null};
		}

		return {
			vertex: vertexHit?.point ?? null,
			curve: curveHit?.curve ?? null,
		};
	}

	private updateHoverVertex(clientX: number, clientY: number): void {
		if (!this.measureModeEnabled || !this.parsedDocument) {
			return;
		}

		const {vertex: nextHoverVertex, curve: nextHoverCurve} = this.getMeasurementTargetsAtClient(clientX, clientY);
		if (samePoint(nextHoverVertex, this.hoverVertex) && sameCurve(nextHoverCurve, this.hoverCurve)) {
			return;
		}
		this.hoverVertex = nextHoverVertex;
		this.hoverCurve = nextHoverCurve;
		this.renderCurrentData();
	}

	private stopPanning(): void {
		this.isPanning = false;
		this.pointerDragged = false;
		this.activePointerId = null;
		this.pointerDownButton = null;
	}

	private resetViewport(): void {
		this.viewport = createDefaultViewport();
		this.viewportDirty = false;
	}

	private resetMeasurement(): void {
		this.measureStart = null;
		this.measureEnd = null;
		this.hoverVertex = null;
		this.hoverCurve = null;
		this.diameterMeasurement = null;
	}

	private scheduleRenderCurrentData(): void {
		if (this.pendingRenderFrame) {
			window.cancelAnimationFrame(this.pendingRenderFrame);
		}

		this.pendingRenderFrame = window.requestAnimationFrame(() => {
			this.pendingRenderFrame = 0;
			this.renderCurrentData();
		});
	}

	private scheduleAutoFitSettlingPasses(): void {
		this.clearPendingAutoFitTimeouts();
		if (!this.embedMode || !this.rawData.trim()) {
			return;
		}

		for (const delayMs of [0, 50, 150, 350]) {
			const timeoutId = window.setTimeout(() => {
				this.refitIfViewportUntouched();
			}, delayMs);
			this.pendingAutoFitTimeouts.push(timeoutId);
		}
	}

	private clearPendingAutoFitTimeouts(): void {
		for (const timeoutId of this.pendingAutoFitTimeouts) {
			window.clearTimeout(timeoutId);
		}
		this.pendingAutoFitTimeouts = [];
	}

	private refitIfViewportUntouched(): void {
		if (this.viewportDirty || !this.parsedDocument) {
			return;
		}

		this.resetViewport();
		this.lastCanvasWidth = 0;
		this.lastCanvasHeight = 0;
		this.renderCurrentData();
	}

	private zoomAt(clientX: number, clientY: number, factor: number): void {
		if (!this.canvasEl) {
			return;
		}

		const currentZoom = this.viewport.zoom;
		const nextZoom = clamp(currentZoom * factor, 0.02, 200);
		if (Math.abs(nextZoom - currentZoom) < 1e-6) {
			return;
		}

		const rect = this.canvasEl.getBoundingClientRect();
		const cursorX = clientX - rect.left;
		const cursorY = clientY - rect.top;
		const centerX = this.canvasEl.clientWidth / 2;
		const centerY = this.canvasEl.clientHeight / 2;
		const oldPanX = this.viewport.panX;
		const oldPanY = this.viewport.panY;

		this.viewport.zoom = nextZoom;
		this.viewport.panX = cursorX - centerX - ((cursorX - centerX - oldPanX) / currentZoom) * nextZoom;
		this.viewport.panY = cursorY - centerY - ((cursorY - centerY - oldPanY) / currentZoom) * nextZoom;
		this.viewportDirty = true;
		this.renderCurrentData();
	}

	private deltaModeToPixels(deltaMode: number): number {
		if (!this.canvasEl) {
			return 1;
		}
		if (deltaMode === 1) {
			return 16;
		}
		if (deltaMode === 2) {
			return this.canvasEl.clientHeight;
		}
		return 1;
	}

	private reparseData(): void {
		if (!this.rawData.trim()) {
			this.parsedDocument = null;
			this.parseError = null;
			return;
		}

		try {
			this.parsedDocument = parseDxf(this.rawData);
			this.parseError = null;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown parsing error";
			this.parsedDocument = null;
			this.parseError = message;
		}
	}

	private clientToCanvasPoint(clientX: number, clientY: number): {canvasX: number; canvasY: number} {
		const rect = this.canvasEl?.getBoundingClientRect();
		if (!rect) {
			return {canvasX: 0, canvasY: 0};
		}

		return {
			canvasX: clientX - rect.left,
			canvasY: clientY - rect.top,
		};
	}

	private createRenderOptions(): DxfRenderOptions {
		const measurementLabel = this.getCurrentMeasurementDisplay();
		return {
			lineColor: this.plugin.settings.lineColor,
			backgroundColor: this.plugin.settings.backgroundColor,
			measurementColor: this.plugin.settings.measurementColor,
			padding: this.plugin.settings.padding,
			showGridlines: this.plugin.settings.showGridlines,
			gridSizeWorldUnits: 1,
			viewport: this.viewport,
			measurement: {
				start: this.measureStart,
				end: this.measureEnd,
				hoverVertex: this.measureModeEnabled ? this.hoverVertex : null,
				hoverCurve: this.measureModeEnabled ? this.hoverCurve : null,
				diameter: this.diameterMeasurement,
				label: measurementLabel?.text ?? null,
				labelKind: measurementLabel?.kind ?? null,
				componentLabelX: measurementLabel?.xText ?? null,
				componentLabelY: measurementLabel?.yText ?? null,
			},
		};
	}

	private updateMeasureButtonUi(): void {
		if (!this.measureButtonEl) {
			return;
		}

		this.measureButtonEl.empty();
		setIcon(this.measureButtonEl, this.measureModeEnabled ? "crosshair" : "ruler");
		this.measureButtonEl.classList.toggle("is-active", this.measureModeEnabled);
		this.measureButtonEl.setAttribute("aria-label", this.measureModeEnabled ? "Disable measure mode" : "Enable measure mode");
		this.measureButtonEl.setAttribute("aria-pressed", this.measureModeEnabled ? "true" : "false");
		this.measureButtonEl.title = this.measureModeEnabled ? "Measure mode on" : "Measure mode off";
	}

	private updateComponentMeasureButtonUi(): void {
		if (!this.componentMeasureButtonEl) {
			return;
		}

		const visible = this.measureModeEnabled;
		this.componentMeasureButtonEl.classList.toggle("is-visible", visible);
		this.componentMeasureButtonEl.classList.toggle("is-active", visible && this.componentMeasureModeEnabled);
		this.componentMeasureButtonEl.setAttribute("aria-hidden", visible ? "false" : "true");
		this.componentMeasureButtonEl.setAttribute("aria-label", this.componentMeasureModeEnabled ? "Disable component measurement mode" : "Enable component measurement mode");
		this.componentMeasureButtonEl.setAttribute("aria-pressed", this.componentMeasureModeEnabled ? "true" : "false");
		this.componentMeasureButtonEl.title = this.componentMeasureModeEnabled ? "Component measurement mode on" : "Component measurement mode off";
	}

	private updateZoomAllButtonUi(): void {
		if (!this.zoomAllButtonEl) {
			return;
		}

		this.zoomAllButtonEl.empty();
		setIcon(this.zoomAllButtonEl, "maximize");
		this.zoomAllButtonEl.setAttribute("aria-label", "Zoom all");
		this.zoomAllButtonEl.title = "Zoom all";
	}

	private updateHelpButtonUi(): void {
		if (!this.helpButtonEl) {
			return;
		}

		this.helpButtonEl.classList.toggle("is-active", this.helpVisible);
		this.helpButtonEl.setAttribute("aria-label", this.helpVisible ? "Hide help" : "Show help");
		this.helpButtonEl.setAttribute("aria-pressed", this.helpVisible ? "true" : "false");
		this.helpButtonEl.title = this.helpVisible ? "Hide help" : "Show help";
	}

	private renderCurrentData(): void {
		if (!this.canvasEl || !this.summaryEl || !this.helpPopoverEl) {
			return;
		}

		this.updateDrawingUnitSelectUi();
		this.updateHelpButtonUi();
		this.updateComponentMeasureButtonUi();
		this.updateZoomAllButtonUi();
		this.renderHelpPopover();

		if (!this.rawData.trim()) {
			this.summaryEl.setText("No DXF content loaded.");
			this.summaryEl.classList.add("is-detail");
			this.recordCanvasSize();
			this.canvasEl.getContext("2d")?.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
			return;
		}

		if (this.parseError) {
			this.summaryEl.setText(`Failed to parse dxf: ${this.parseError}`);
			this.summaryEl.classList.add("is-detail");
			this.recordCanvasSize();
			this.canvasEl.getContext("2d")?.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
			return;
		}

		if (!this.parsedDocument) {
			this.summaryEl.setText("No entities.");
			this.summaryEl.classList.remove("is-detail");
			this.recordCanvasSize();
			this.canvasEl.getContext("2d")?.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
			return;
		}

		this.summaryEl.setText(this.getDrawingSummaryText());
		this.summaryEl.classList.remove("is-detail");

		this.stabilizeCanvasViewportIfNeeded();
		renderDxf(this.canvasEl, this.parsedDocument, this.createRenderOptions());
	}

	private getDrawingMillimetersPerUnit(): number {
		return getMillimetersPerDrawingUnit(this.getEffectiveDrawingUnit());
	}

	private updateDrawingUnitSelectUi(): void {
		if (!this.drawingUnitSelectEl || !this.unitButtonEl || !this.unitPopoverEl) {
			return;
		}

		this.drawingUnitSelectEl.value = this.drawingUnitOverride;
		const detectedUnit = this.parsedDocument?.drawingUnit ?? null;
		const buttonTitle = detectedUnit
			? `Drawing units. Auto detected unit: ${formatDrawingUnitLabel(detectedUnit)}`
			: "Drawing units";
		this.drawingUnitSelectEl.title = buttonTitle;
		this.unitButtonEl.title = buttonTitle;
		this.unitButtonEl.setAttribute("aria-label", buttonTitle);
		this.unitButtonEl.setAttribute("aria-expanded", this.unitMenuVisible ? "true" : "false");
		this.unitButtonEl.classList.toggle("is-active", this.unitMenuVisible);
		this.unitPopoverEl.classList.toggle("is-visible", this.unitMenuVisible);
	}

	private getDrawingSummaryText(): string {
		if (!this.parsedDocument) {
			return "No entities.";
		}

		const bounds = computeEntityBounds(this.parsedDocument.entities);
		const entityCount = countRenderablePrimitives(this.parsedDocument.entities);
		if (!bounds) {
			return `${entityCount} ${entityCount === 1 ? "entity" : "entities"}`;
		}

		const displayUnit = this.getPrimaryMeasurementUnit();
		const drawingMillimetersPerUnit = this.getDrawingMillimetersPerUnit();
		const widthMm = (bounds.maxX - bounds.minX) * drawingMillimetersPerUnit;
		const heightMm = (bounds.maxY - bounds.minY) * drawingMillimetersPerUnit;
		const unitSuffix = formatMeasurementUnitSuffix(displayUnit);
		const widthLabel = `${formatDistance(convertMillimetersToUnit(widthMm, displayUnit))} ${unitSuffix}`;
		const heightLabel = `${formatDistance(convertMillimetersToUnit(heightMm, displayUnit))} ${unitSuffix}`;
		return `${widthLabel} x ${heightLabel}, ${entityCount} ${entityCount === 1 ? "entity" : "entities"}`;
	}

	private formatMeasurementValue(distanceMm: number): string {
		const primaryUnit = this.getPrimaryMeasurementUnit();
		const primaryValue = `${formatDistance(convertMillimetersToUnit(distanceMm, primaryUnit))} ${formatMeasurementUnitSuffix(primaryUnit)}`;
		if (this.plugin.settings.measurementUnits !== "display-both") {
			return primaryValue;
		}

		const secondaryUnit = isMetricDrawingUnit(primaryUnit) ? "inch" : "mm";
		const secondaryValue = `${formatDistance(convertMillimetersToUnit(distanceMm, secondaryUnit))} ${formatMeasurementUnitSuffix(secondaryUnit)}`;
		return `${primaryValue} (${secondaryValue})`;
	}

	private getPrimaryMeasurementUnit(): DxfDrawingUnit {
		const effectiveDrawingUnit = this.getEffectiveDrawingUnit();
		switch (effectiveDrawingUnit) {
			case "inch":
			case "foot":
			case "mile":
			case "cm":
			case "m":
			case "mm":
				return effectiveDrawingUnit;
			case "unitless":
			case null:
			default:
				return "mm";
		}
	}

	private getEffectiveDrawingUnit(): DxfDrawingUnit | null {
		if (this.drawingUnitOverride === "mm" || this.drawingUnitOverride === "inch") {
			return this.drawingUnitOverride;
		}
		return this.parsedDocument?.drawingUnit ?? null;
	}

	private getCurrentMeasurementDisplay(): MeasurementDisplay | null {
		if (this.measureStart && this.measureEnd) {
			const deltaXMm = Math.abs(this.measureEnd.x - this.measureStart.x) * this.getDrawingMillimetersPerUnit();
			const deltaYMm = Math.abs(this.measureEnd.y - this.measureStart.y) * this.getDrawingMillimetersPerUnit();
			if (this.componentMeasureModeEnabled) {
				return {
					kind: "components",
					text: null,
					xText: `X ${this.formatMeasurementValue(deltaXMm)}`,
					yText: `Y ${this.formatMeasurementValue(deltaYMm)}`,
				};
			}

			const distanceMm = Math.hypot(deltaXMm, deltaYMm);
			return {
				kind: "distance",
				text: this.formatMeasurementValue(distanceMm),
				xText: null,
				yText: null,
			};
		}

		if (this.diameterMeasurement) {
			const diameterMm = this.diameterMeasurement.radius * 2 * this.getDrawingMillimetersPerUnit();
			return {
				kind: "diameter",
				text: `Dia ${this.formatMeasurementValue(diameterMm)}`,
				xText: null,
				yText: null,
			};
		}

		return null;
	}

	private renderHelpPopover(): void {
		if (!this.helpPopoverEl) {
			return;
		}

		this.helpPopoverEl.empty();
		this.helpPopoverEl.classList.toggle("is-visible", this.helpVisible);
		if (!this.helpVisible) {
			return;
		}

		const listEl = this.helpPopoverEl.createEl("ul", {cls: "dxf-viewer__help-list"});
		listEl.createEl("li", {text: "Select the in/mm button to change units."});
		listEl.createEl("li", {text: "Drag on trackpad or select and drag with mouse to pan."});
		listEl.createEl("li", {text: "Pinch on trackpad or Cmd/Ctrl + scroll wheel to zoom."});
		listEl.createEl("li", {text: "Select the maximize button to zoom all and fit the full drawing back into view."});
		const measureItem = listEl.createEl("li", {text: "Select the ruler to enter measure mode."});
		const measureSublist = measureItem.createEl("ul", {cls: "dxf-viewer__help-sublist"});
		measureSublist.createEl("li", {text: "Select the component measurement button above the ruler."});
		measureSublist.createEl("li", {text: "Measure between curves or vertices, and double-select to clear the current measurement."});
	}

	private stabilizeCanvasViewportIfNeeded(): void {
		if (!this.canvasEl || !this.parsedDocument) {
			return;
		}

		const nextWidth = Math.max(10, Math.round(this.canvasEl.clientWidth));
		const nextHeight = Math.max(10, Math.round(this.canvasEl.clientHeight));
		if (!this.lastCanvasWidth || !this.lastCanvasHeight) {
			this.lastCanvasWidth = nextWidth;
			this.lastCanvasHeight = nextHeight;
			return;
		}

		if (this.lastCanvasWidth === nextWidth && this.lastCanvasHeight === nextHeight) {
			return;
		}

		if (!this.viewportDirty) {
			this.lastCanvasWidth = nextWidth;
			this.lastCanvasHeight = nextHeight;
			return;
		}

		this.viewport = stabilizeViewportForResize(
			this.parsedDocument,
			this.createRenderOptions(),
			this.viewport,
			this.lastCanvasWidth,
			this.lastCanvasHeight,
			nextWidth,
			nextHeight,
		);
		this.lastCanvasWidth = nextWidth;
		this.lastCanvasHeight = nextHeight;
	}

	private recordCanvasSize(): void {
		if (!this.canvasEl) {
			return;
		}

		this.lastCanvasWidth = Math.max(10, Math.round(this.canvasEl.clientWidth));
		this.lastCanvasHeight = Math.max(10, Math.round(this.canvasEl.clientHeight));
	}
}

function createDefaultViewport(): DxfViewport {
	return {
		zoom: 1,
		panX: 0,
		panY: 0,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function formatDistance(value: number): string {
	if (value >= 100) {
		return value.toFixed(1);
	}
	if (value >= 10) {
		return value.toFixed(2);
	}
	return value.toFixed(3);
}

function samePoint(a: DxfPoint | null, b: DxfPoint | null): boolean {
	if (!a && !b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

function sameCurve(a: DxfCurveEntity | null, b: DxfCurveEntity | null): boolean {
	return a === b;
}

function getMillimetersPerDrawingUnit(unit: DxfDrawingUnit | null): number {
	switch (unit) {
		case "inch":
			return INCH_IN_MM;
		case "foot":
			return FOOT_IN_MM;
		case "mile":
			return MILE_IN_MM;
		case "cm":
			return 10;
		case "m":
			return 1_000;
		case "mm":
		case "unitless":
		case null:
		default:
			return 1;
	}
}

function formatDrawingUnitLabel(unit: DxfDrawingUnit): string {
	switch (unit) {
		case "inch":
			return "inch";
		case "foot":
			return "foot";
		case "mile":
			return "mile";
		case "cm":
			return "cm";
		case "m":
			return "m";
		case "mm":
			return "mm";
		case "unitless":
		default:
			return "unitless";
	}
}

function convertMillimetersToUnit(distanceMm: number, unit: DxfDrawingUnit): number {
	return distanceMm / getMillimetersPerDrawingUnit(unit);
}

function formatMeasurementUnitSuffix(unit: DxfDrawingUnit): string {
	switch (unit) {
		case "inch":
			return "in";
		case "foot":
			return "ft";
		case "mile":
			return "mi";
		case "cm":
			return "cm";
		case "m":
			return "m";
		case "mm":
		case "unitless":
		default:
			return "mm";
	}
}

function isMetricDrawingUnit(unit: DxfDrawingUnit): boolean {
	return unit === "mm" || unit === "cm" || unit === "m" || unit === "unitless";
}
