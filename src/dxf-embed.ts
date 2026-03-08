import {MarkdownRenderChild, TFile} from "obsidian";
import {DxfViewerPane} from "./dxf-viewer-pane";
import DxfViewerPlugin from "./main";

export class DxfEmbedChild extends MarkdownRenderChild {
	private readonly plugin: DxfViewerPlugin;
	private readonly file: TFile;
	private pane: DxfViewerPane | null = null;

	constructor(containerEl: HTMLElement, plugin: DxfViewerPlugin, file: TFile) {
		super(containerEl);
		this.plugin = plugin;
		this.file = file;
	}

	onload(): void {
		this.pane = new DxfViewerPane(this.containerEl, this.plugin, {embed: true});
		this.addChild(this.pane);
		void this.loadFileData();

		this.registerEvent(this.plugin.app.vault.on("modify", (modifiedFile) => {
			if (modifiedFile.path === this.file.path) {
				void this.loadFileData();
			}
		}));
	}

	private async loadFileData(): Promise<void> {
		try {
			const raw = await this.plugin.app.vault.cachedRead(this.file);
			this.pane?.setRawData(raw);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to read dxf embed";
			this.pane?.setRawData("");
			this.containerEl.empty();
			this.containerEl.createDiv({cls: "dxf-viewer__embed-error", text: `Failed to load ${this.file.name}: ${message}`});
		}
	}
}
