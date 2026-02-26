import {setIcon, TextFileView, WorkspaceLeaf} from "obsidian";
import {parseDxf} from "./dxf/parser";
import {DxfRenderOptions, DxfViewport, findNearestVertex, renderDxf} from "./dxf/renderer";
import {DxfDocument, DxfPoint} from "./dxf/types";
import DxfViewerPlugin from "./main";

export const DXF_VIEW_TYPE = "dxf-viewer";

const INCH_IN_MM = 25.4;

export class DxfFileView extends TextFileView {
	plugin: DxfViewerPlugin;
	private canvasEl: HTMLCanvasElement | null = null;
	private infoEl: HTMLDivElement | null = null;
	private toolbarEl: HTMLDivElement | null = null;
	private measureButtonEl: HTMLButtonElement | null = null;
	private inchCheckboxEl: HTMLInputElement | null = null;
	private rawData = "";
	private parsedDocument: DxfDocument | null = null;
	private parseError: string | null = null;
	private viewport: DxfViewport = createDefaultViewport();
	private measureModeEnabled = false;
	private useInches = false;
	private measureStart: DxfPoint | null = null;
	private measureEnd: DxfPoint | null = null;
	private hoverVertex: DxfPoint | null = null;
	private isPanning = false;
	private pointerDragged = false;
	private activePointerId: number | null = null;
	private pointerDownButton: number | null = null;
	private pointerDownX = 0;
	private pointerDownY = 0;
	private lastPointerX = 0;
	private lastPointerY = 0;

	constructor(leaf: WorkspaceLeaf, plugin: DxfViewerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return DXF_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file?.name ?? "Dxf viewer";
	}

	getViewData(): string {
		return this.rawData;
	}

	setViewData(data: string): void {
		if (data !== this.rawData) {
			this.resetViewport();
			this.resetMeasurement();
		}

		this.rawData = data;
		this.reparseData();
		this.renderCurrentData();
	}

	clear(): void {
		this.rawData = "";
		this.parsedDocument = null;
		this.parseError = null;
		this.resetViewport();
		this.resetMeasurement();
		this.renderCurrentData();
	}

	canAcceptExtension(extension: string): boolean {
		return extension.toLowerCase() === "dxf";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("dxf-viewer");

		this.canvasEl = this.contentEl.createEl("canvas", {cls: "dxf-viewer__canvas"});
		this.toolbarEl = this.contentEl.createDiv({cls: "dxf-viewer__toolbar"});
		this.measureButtonEl = this.toolbarEl.createEl("button", {cls: "dxf-viewer__measure-button"});
		this.measureButtonEl.type = "button";

		const unitsLabel = this.toolbarEl.createEl("label", {cls: "dxf-viewer__units"});
		this.inchCheckboxEl = unitsLabel.createEl("input", {type: "checkbox"});
		unitsLabel.createSpan({text: "inch"});

		this.infoEl = this.toolbarEl.createDiv({cls: "dxf-viewer__info"});

		this.registerDomEvent(window, "resize", () => this.renderCurrentData());
		this.registerDomEvent(this.measureButtonEl, "click", this.toggleMeasureMode);
		this.registerDomEvent(this.inchCheckboxEl, "change", this.onUnitCheckboxChange);
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

	async onClose(): Promise<void> {
		this.contentEl.empty();
		this.canvasEl = null;
		this.toolbarEl = null;
		this.measureButtonEl = null;
		this.inchCheckboxEl = null;
		this.infoEl = null;
		this.stopPanning();
	}

	private readonly toggleMeasureMode = (): void => {
		this.measureModeEnabled = !this.measureModeEnabled;
		if (!this.measureModeEnabled) {
			this.resetMeasurement();
		}
		this.updateMeasureButtonUi();
		this.renderCurrentData();
	};

	private readonly onUnitCheckboxChange = (): void => {
		if (!this.inchCheckboxEl) {
			return;
		}
		this.useInches = this.inchCheckboxEl.checked;
		this.renderCurrentData();
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
		if (this.hoverVertex) {
			this.hoverVertex = null;
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
		this.renderCurrentData();
	};

	private readonly onDoubleClick = (): void => {
		this.resetViewport();
		this.renderCurrentData();
	};

	private handleMeasurementClick(clientX: number, clientY: number): void {
		if (!this.measureModeEnabled || !this.canvasEl || !this.parsedDocument) {
			return;
		}

		const nearest = this.findNearestVertexAtClient(clientX, clientY);
		if (!nearest) {
			this.renderCurrentData();
			return;
		}

		if (!this.measureStart || this.measureEnd) {
			this.measureStart = nearest;
			this.measureEnd = null;
		} else {
			this.measureEnd = nearest;
		}

		this.hoverVertex = nearest;
		this.renderCurrentData();
	}

	private findNearestVertexAtClient(clientX: number, clientY: number): DxfPoint | null {
		if (!this.canvasEl || !this.parsedDocument) {
			return null;
		}

		const {canvasX, canvasY} = this.clientToCanvasPoint(clientX, clientY);

		return findNearestVertex(
			this.canvasEl,
			this.parsedDocument,
			this.createRenderOptions(),
			canvasX,
			canvasY,
			14,
		);
	}

	private updateHoverVertex(clientX: number, clientY: number): void {
		if (!this.measureModeEnabled || !this.parsedDocument) {
			return;
		}
		const nextHover = this.findNearestVertexAtClient(clientX, clientY);
		if (samePoint(nextHover, this.hoverVertex)) {
			return;
		}
		this.hoverVertex = nextHover;
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
	}

	private resetMeasurement(): void {
		this.measureStart = null;
		this.measureEnd = null;
		this.hoverVertex = null;
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
		return {
			lineColor: this.plugin.settings.lineColor,
			backgroundColor: this.plugin.settings.backgroundColor,
			padding: this.plugin.settings.padding,
			showGridlines: this.plugin.settings.showGridlines,
			gridSizeMm: this.plugin.settings.gridSizeMm,
			viewport: this.viewport,
			measurement: {
				start: this.measureStart,
				end: this.measureEnd,
				hover: this.measureModeEnabled ? this.hoverVertex : null,
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

	private renderCurrentData(): void {
		if (!this.canvasEl || !this.infoEl) {
			return;
		}

		if (!this.rawData.trim()) {
			this.infoEl.setText("No dxf content loaded.");
			this.canvasEl.getContext("2d")?.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
			return;
		}

		if (this.parseError) {
			this.infoEl.setText(`Failed to parse dxf: ${this.parseError}`);
			this.canvasEl.getContext("2d")?.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
			return;
		}

		if (!this.parsedDocument) {
			this.infoEl.setText("No entities found.");
			this.canvasEl.getContext("2d")?.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
			return;
		}

		renderDxf(this.canvasEl, this.parsedDocument, this.createRenderOptions());

		const warningText = this.parsedDocument.warnings.join(" ");
		const entityLabel = this.parsedDocument.entities.length === 1 ? "entity" : "entities";
		const measureText = this.getMeasurementText();
		this.infoEl.setText(`${this.parsedDocument.entities.length} ${entityLabel} rendered. Drag to pan, pinch or cmd/ctrl + wheel to zoom.${measureText}${warningText ? ` ${warningText}` : ""}`);
	}

	private getMeasurementText(): string {
		if (!this.measureModeEnabled) {
			return " Measure mode is off.";
		}

		if (!this.measureStart) {
			return " Click a vertex to start measuring.";
		}

		if (!this.measureEnd) {
			return " Start selected. Click a second vertex.";
		}

		const distanceMm = Math.hypot(
			this.measureEnd.x - this.measureStart.x,
			this.measureEnd.y - this.measureStart.y,
		);

		if (this.useInches) {
			return ` Distance: ${formatDistance(distanceMm / INCH_IN_MM)} in.`;
		}
		return ` Distance: ${formatDistance(distanceMm)} mm.`;
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
