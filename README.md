# DXF Viewer

View and measure `.dxf` CAD drawings directly inside Obsidian.

Desktop-only for the initial community release.

## What it does

- Open `.dxf` files in a dedicated Obsidian view.
- Render DXF embeds inside notes in reading mode with `![[drawing.dxf]]`.
- Pan, zoom, and reset the view with a zoom-all control.
- Measure between vertices, curve centers, and diameters of circles and arcs.
- Show direct distance or X/Y component measurements.
- Auto-detect drawing units from DXF metadata, with manual override when needed.

## Supported entities

- `LINE`
- `LWPOLYLINE`
- `POLYLINE` / `VERTEX`
- `CIRCLE`
- `ARC`

## Privacy and security

- No account required.
- No telemetry.
- No network access is needed for normal use.
- Reads DXF files already stored in your vault.

## Installation

### Community plugins

1. Open **Settings -> Community plugins**.
2. Select **Browse**, search for `DXF Viewer`, and install it.
3. Enable **DXF Viewer**.

### Manual installation

1. Download `manifest.json`, `main.js`, and `styles.css` from the latest GitHub release.
2. Create `<your vault>/.obsidian/plugins/dxf-viewer/`.
3. Copy those 3 files into that folder.
4. Reload Obsidian and enable the plugin.

## Usage

1. Open a `.dxf` file from your vault, or embed one in a note with `![[file.dxf]]`.
2. Drag to pan.
3. Pinch or use `cmd/ctrl + scroll wheel` to zoom.
4. Use the ruler button to enter measurement mode.
5. Click two vertices, two curves, or a mix of both to measure distance.
6. Click a circle or arc to measure its diameter.
7. Double-click to clear the current measurement.
8. Use the units button if the drawing needs a manual inch/mm override.

## Notes

- The first public release is marked desktop-only.
- Embed rendering is currently intended for reading mode.
- Measurement display can follow the drawing units or show both metric and imperial values.
- Grid spacing follows the selected drawing units.

## Development

```bash
npm install
npm run build
npm run lint
```

Release builds should publish `manifest.json`, `main.js`, and `styles.css` as GitHub release assets.

## License

MIT
