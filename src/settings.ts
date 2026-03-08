import {App, PluginSettingTab, Setting} from "obsidian";
import DxfViewerPlugin from "./main";

export interface DxfViewerSettings {
	lineColor: string;
	backgroundColor: string;
	measurementColor: string;
	padding: number;
	showGridlines: boolean;
	measurementUnits: "same-as-drawing" | "display-both";
}

export const DEFAULT_SETTINGS: DxfViewerSettings = {
	lineColor: "#4c9aff",
	backgroundColor: "#10131a",
	measurementColor: "#ffd166",
	padding: 24,
	showGridlines: true,
	measurementUnits: "display-both",
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
			.addColorPicker((color) => color
				.setValue(sanitizeColor(this.plugin.settings.lineColor, DEFAULT_SETTINGS.lineColor))
				.onChange(async (value: string) => {
					this.plugin.settings.lineColor = sanitizeColor(value, DEFAULT_SETTINGS.lineColor);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Background color")
			.setDesc("Canvas background color for the dxf viewer.")
			.addColorPicker((color) => color
				.setValue(sanitizeColor(this.plugin.settings.backgroundColor, DEFAULT_SETTINGS.backgroundColor))
				.onChange(async (value: string) => {
					this.plugin.settings.backgroundColor = sanitizeColor(value, DEFAULT_SETTINGS.backgroundColor);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Measurement color")
			.setDesc("Color used for measurement handles, highlights, and dimension labels.")
			.addColorPicker((color) => color
				.setValue(sanitizeColor(this.plugin.settings.measurementColor, DEFAULT_SETTINGS.measurementColor))
				.onChange(async (value: string) => {
					this.plugin.settings.measurementColor = sanitizeColor(value, DEFAULT_SETTINGS.measurementColor);
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
			.setName("Measurement units")
			.setDesc("Choose whether measurements follow the drawing units or show both drawing units and the alternate system.")
			.addDropdown((dropdown) => dropdown
				.addOption("same-as-drawing", "Same as drawing units")
				.addOption("display-both", "Display both")
				.setValue(this.plugin.settings.measurementUnits)
				.onChange(async (value: "same-as-drawing" | "display-both") => {
					this.plugin.settings.measurementUnits = value;
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
