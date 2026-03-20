import {EmbedCache, MarkdownPostProcessorContext, MarkdownSectionInformation, Plugin, TFile, WorkspaceLeaf} from "obsidian";
import {DxfEmbedChild} from "./dxf-embed";
import {DXF_VIEW_TYPE, DxfFileView} from "./dxf-view";
import {DEFAULT_SETTINGS, DxfViewerSettingTab, DxfViewerSettings} from "./settings";

export default class DxfViewerPlugin extends Plugin {
	settings: DxfViewerSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(DXF_VIEW_TYPE, (leaf: WorkspaceLeaf) => new DxfFileView(leaf, this));
		this.registerExtensions(["dxf"], DXF_VIEW_TYPE);
		this.registerMarkdownPostProcessor((el, ctx) => this.renderDxfEmbeds(el, ctx), 1_000);
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
		// Intentionally empty — do not detach leaves here so the user's
		// workspace layout is preserved across plugin updates and disables.
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData() as Partial<DxfViewerSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.refreshOpenViews();
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

	private refreshOpenViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(DXF_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DxfFileView) {
				view.refreshView();
			}
		}
	}

	private renderDxfEmbeds(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		if (el.closest(".dxf-viewer")) {
			return;
		}

		const sectionEmbedFile = this.getSectionEmbedFile(el, ctx);
		if (sectionEmbedFile) {
			this.mountDxfEmbed(el, ctx, sectionEmbedFile);
			return;
		}

		const mountedTargets = new Set<HTMLElement>();
		let renderedAny = false;
		for (const candidate of getPotentialDxfEmbedElements(el)) {
			const source = getEmbedSource(candidate);
			if (!source) {
				continue;
			}

			const file = this.resolveDxfFile(source, ctx.sourcePath);
			if (!file) {
				continue;
			}

			const mountTarget = getEmbedMountTarget(candidate);
			if (mountedTargets.has(mountTarget)) {
				continue;
			}

			this.mountDxfEmbed(mountTarget, ctx, file);
			mountedTargets.add(mountTarget);
			renderedAny = true;
		}

		if (renderedAny) {
			return;
		}

		const sectionInfo = ctx.getSectionInfo(el);
		const inlineEmbedSource = getSectionDxfEmbedSource(sectionInfo?.text ?? "");
		if (!inlineEmbedSource) {
			return;
		}

		const file = this.resolveDxfFile(inlineEmbedSource, ctx.sourcePath);
		if (!file) {
			return;
		}

		this.mountDxfEmbed(el, ctx, file);
	}

	private resolveDxfFile(linkpath: string, sourcePath: string): TFile | null {
		const normalizedLinkPath = linkpath.split("#")[0];
		if (!normalizedLinkPath || !normalizedLinkPath.toLowerCase().endsWith(".dxf")) {
			return null;
		}

		const file = this.app.metadataCache.getFirstLinkpathDest(normalizedLinkPath, sourcePath);
		if (!(file instanceof TFile) || file.extension.toLowerCase() !== "dxf") {
			return null;
		}

		return file;
	}

	private getSectionEmbedFile(el: HTMLElement, ctx: MarkdownPostProcessorContext): TFile | null {
		const sourceFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!(sourceFile instanceof TFile)) {
			return null;
		}

		const sectionInfo = ctx.getSectionInfo(el);
		if (!sectionInfo) {
			return null;
		}

		const cache = this.app.metadataCache.getFileCache(sourceFile);
		const matchingEmbed = findMatchingDxfEmbed(cache?.embeds ?? [], sectionInfo);
		if (!matchingEmbed) {
			return null;
		}

		return this.resolveDxfFile(matchingEmbed.link, ctx.sourcePath);
	}

	private mountDxfEmbed(target: HTMLElement, ctx: MarkdownPostProcessorContext, file: TFile): void {
		target.empty();
		target.addClass("dxf-viewer__embed-host");
		ctx.addChild(new DxfEmbedChild(target, this, file));
	}
}

function getPotentialDxfEmbedElements(root: HTMLElement): HTMLElement[] {
	const matches: HTMLElement[] = [];
	if (root.matches(".file-embed, .internal-embed, .markdown-embed, .el-embed, .file-embed-link, a.internal-link")) {
		matches.push(root);
	}
	matches.push(...Array.from(root.querySelectorAll<HTMLElement>(".file-embed, .internal-embed, .markdown-embed, .el-embed, .file-embed-link, a.internal-link")));
	return matches;
}

function getEmbedSource(element: HTMLElement): string | null {
	const linkedElement = element.querySelector<HTMLElement>(".file-embed-link, .internal-link, .internal-embed");
	return element.getAttribute("src")
		?? element.getAttribute("data-href")
		?? element.getAttribute("dataHref")
		?? element.getAttribute("href")
		?? element.getAttribute("alt")
		?? element.getAttribute("data-path")
		?? linkedElement?.getAttribute("src")
		?? linkedElement?.getAttribute("data-href")
		?? linkedElement?.getAttribute("dataHref")
		?? linkedElement?.getAttribute("href")
		?? null;
}

function getEmbedMountTarget(element: HTMLElement): HTMLElement {
	return element.closest(".file-embed, .markdown-embed, .el-embed") as HTMLElement
		?? element;
}

function getSectionDxfEmbedSource(sectionText: string): string | null {
	const trimmed = sectionText.trim();
	const match = /^!\[\[([^\]]+\.dxf(?:#[^\]]+)?)\]\]$/i.exec(trimmed);
	return match?.[1] ?? null;
}

function findMatchingDxfEmbed(embeds: EmbedCache[], sectionInfo: MarkdownSectionInformation): EmbedCache | null {
	for (const embed of embeds) {
		if (!embed.link.toLowerCase().endsWith(".dxf")) {
			continue;
		}

		const startLine = embed.position.start.line;
		const endLine = embed.position.end.line;
		const overlapsSection = startLine <= sectionInfo.lineEnd && endLine >= sectionInfo.lineStart;
		if (overlapsSection) {
			return embed;
		}
	}

	return null;
}
