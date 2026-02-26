import {Plugin, WorkspaceLeaf} from "obsidian";
import {DXF_VIEW_TYPE, DxfFileView} from "./dxf-view";
import {DEFAULT_SETTINGS, DxfViewerSettingTab, DxfViewerSettings} from "./settings";

export default class DxfViewerPlugin extends Plugin {
	settings: DxfViewerSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(DXF_VIEW_TYPE, (leaf: WorkspaceLeaf) => new DxfFileView(leaf, this));
		this.registerExtensions(["dxf"], DXF_VIEW_TYPE);
		this.addSettingTab(new DxfViewerSettingTab(this.app, this));

		this.addCommand({
			id: "open-current-dxf-in-viewer",
			name: "Open current dxf in viewer",
			checkCallback: (checking: boolean): boolean => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile || activeFile.extension.toLowerCase() !== "dxf") {
					return false;
				}

				if (!checking) {
					void this.openFileInDxfView(activeFile.path);
				}

				return true;
			},
		});
	}

	onunload(): void {
		this.app.workspace.getLeavesOfType(DXF_VIEW_TYPE).forEach((leaf) => leaf.detach());
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData() as Partial<DxfViewerSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async openFileInDxfView(path: string): Promise<void> {
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({
			type: DXF_VIEW_TYPE,
			state: {file: path},
			active: true,
		});
		void this.app.workspace.revealLeaf(leaf);
	}
}
