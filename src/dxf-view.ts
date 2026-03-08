import {TextFileView, WorkspaceLeaf} from "obsidian";
import {DxfViewerPane} from "./dxf-viewer-pane";
import DxfViewerPlugin from "./main";

export const DXF_VIEW_TYPE = "dxf-viewer";

export class DxfFileView extends TextFileView {
	plugin: DxfViewerPlugin;
	private pane: DxfViewerPane | null = null;
	private rawData = "";

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

	refreshView(): void {
		this.pane?.refreshView();
	}

	getViewData(): string {
		return this.rawData;
	}

	setViewData(data: string): void {
		this.rawData = data;
		this.pane?.setRawData(data);
	}

	clear(): void {
		this.rawData = "";
		this.pane?.clear();
	}

	canAcceptExtension(extension: string): boolean {
		return extension.toLowerCase() === "dxf";
	}

	async onOpen(): Promise<void> {
		this.pane = new DxfViewerPane(this.contentEl, this.plugin);
		this.addChild(this.pane);
		this.pane.setRawData(this.rawData);
	}

	async onClose(): Promise<void> {
		this.pane = null;
	}
}
