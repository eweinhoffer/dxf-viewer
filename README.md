# DXF Viewer

A lightweight Obsidian plugin for viewing and measuring `.dxf` drawings directly inside your vault.

## New features

### 1.0.0
- Added a dedicated DXF viewer tab for `.dxf` files.
- Added pan and zoom controls (drag to pan, pinch or `cmd/ctrl + wheel` to zoom).
- Added optional gridlines that follow the selected drawing units.
- Added measure mode with vertex snapping and hover highlighting.
- Added drawing-unit auto-detection with manual `mm` / `inch` override in the bottom toolbar.
- Added diameter measurement for circles and arcs.
- Added a measurement-units setting for showing drawing units only or both unit systems.

## Features

- Open `.dxf` files in a native Obsidian view.
- Render common DXF entities:
  - `LINE`
  - `LWPOLYLINE`
  - `POLYLINE` / `VERTEX`
  - `CIRCLE`
  - `ARC`
- Toggle gridlines with 1x1 cells in the selected drawing units.
- Measure distance between snapped vertices.
- Measure the diameter of circles and arcs.
- Auto-detect DXF drawing units from metadata, with a manual override when needed.
- Show measurements in millimeters or inches.

## Installation

### Community plugins (after publication)
1. Open **Settings → Community plugins**.
2. Select **Browse**, search for `DXF Viewer`, and install.
3. Enable **DXF Viewer**.

### Manual installation
1. Download `manifest.json`, `main.js`, and `styles.css` from the latest release.
2. Create this folder in your vault:
   - `<YourVault>/.obsidian/plugins/dxf-viewer/`
3. Copy the 3 files into that folder.
4. Restart Obsidian and enable **DXF Viewer** under **Settings → Community plugins**.

## Usage

1. Open any `.dxf` file in your vault.
2. Navigate the drawing:
   - Drag to pan.
   - Pinch or `cmd/ctrl + wheel` to zoom.
3. Use the bottom toolbar:
   - Click the measure button to turn measure mode on/off.
   - Hover vertices to preview valid snap targets before clicking.
   - Hover circles or arcs to preview diameter targets with a separate highlight color.
   - Click two vertices to measure distance.
   - Click a circle or arc to measure its diameter.
   - Use the `Drawing units` selector to keep measurements correct when a file was authored in inches instead of millimeters, or vice versa.
   - Use the plugin setting `Measurement units` to show either drawing units only or both drawing units and the alternate system.
   - Double-click to clear the current measurement.

## Author

[Eric Weinhoffer](https://www.ericweinhoffer.com)

## License

MIT
