import {App, PluginSettingTab, Setting} from "obsidian";
import DxfViewerPlugin from "./main";

export interface DxfViewerSettings {
	lineColor: string;
	backgroundColor: string;
	padding: number;
	showGridlines: boolean;
	gridSizeMm: number;
}

export const DEFAULT_SETTINGS: DxfViewerSettings = {
	lineColor: "#4c9aff",
	backgroundColor: "#10131a",
	padding: 24,
	showGridlines: true,
	gridSizeMm: 1,
};

export class DxfViewerSettingTab extends PluginSettingTab {
	plugin: DxfViewerPlugin;

	constructor(app: App, plugin: DxfViewerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Line color")
			.setDesc("Stroke color used when drawing dxf entities.")
			.addText((text) => text
				.setPlaceholder("#4c9aff")
				.setValue(this.plugin.settings.lineColor)
				.onChange(async (value: string) => {
					this.plugin.settings.lineColor = sanitizeColor(value, DEFAULT_SETTINGS.lineColor);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Background color")
			.setDesc("Canvas background color for the dxf viewer.")
			.addText((text) => text
				.setPlaceholder("#10131a")
				.setValue(this.plugin.settings.backgroundColor)
				.onChange(async (value: string) => {
					this.plugin.settings.backgroundColor = sanitizeColor(value, DEFAULT_SETTINGS.backgroundColor);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Viewport padding")
			.setDesc("Padding in pixels around the drawing.")
			.addText((text) => text
				.setPlaceholder("24")
				.setValue(String(this.plugin.settings.padding))
				.onChange(async (value: string) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.padding = Number.isFinite(parsed) ? clamp(parsed, 0, 200) : DEFAULT_SETTINGS.padding;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Show gridlines")
			.setDesc("Display gridlines in the dxf viewer.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.showGridlines)
				.onChange(async (value: boolean) => {
					this.plugin.settings.showGridlines = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Grid size (mm)")
			.setDesc("Grid spacing in millimeters. Uses dxf units as mm.")
			.addText((text) => text
				.setPlaceholder("1")
				.setValue(String(this.plugin.settings.gridSizeMm))
				.onChange(async (value: string) => {
					this.plugin.settings.gridSizeMm = parsePositiveNumber(value, DEFAULT_SETTINGS.gridSizeMm);
					await this.plugin.saveSettings();
				}));
	}
}

function sanitizeColor(value: string, fallback: string): string {
	const trimmed = value.trim();
	if (/^#(?:[0-9a-fA-F]{3}){1,2}$/.test(trimmed)) {
		return trimmed;
	}
	return fallback;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function parsePositiveNumber(value: string, fallback: number): number {
	const parsed = Number.parseFloat(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}
	return clamp(parsed, 0.0001, 1_000_000);
}
