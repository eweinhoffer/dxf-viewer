# DXF Viewer

A lightweight Obsidian plugin for viewing and measuring `.dxf` drawings directly inside your vault.

## New features

### 1.0.0
- Added a dedicated DXF viewer tab for `.dxf` files.
- Added pan and zoom controls (drag to pan, pinch or `cmd/ctrl + wheel` to zoom).
- Added optional gridlines with configurable grid spacing.
- Added measure mode with vertex snapping and hover highlighting.
- Added unit display toggle (`mm` / `inch`) in the bottom toolbar.

## Features

- Open `.dxf` files in a native Obsidian view.
- Render common DXF entities:
  - `LINE`
  - `LWPOLYLINE`
  - `POLYLINE` / `VERTEX`
  - `CIRCLE`
  - `ARC`
- Toggle gridlines and set grid size.
- Measure distance between snapped vertices.
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
   - Double-click to reset the viewport.
3. Use the bottom toolbar:
   - Click the measure button to turn measure mode on/off.
   - Hover vertices to preview valid snap targets.
   - Click two vertices to measure distance.
   - Toggle the `inch` checkbox to display distance in inches (unchecked = mm).

## Author

[Eric Weinhoffer](https://www.ericweinhoffer.com)

## License

MIT
