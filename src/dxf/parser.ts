import {DxfArcEntity, DxfCircleEntity, DxfDocument, DxfEntity, DxfLineEntity, DxfPoint, DxfPolylineEntity} from "./types";

interface DxfGroup {
	code: number;
	value: string;
}

interface EntityParseResult {
	entity: DxfEntity | null;
	nextIndex: number;
}

export function parseDxf(raw: string): DxfDocument {
	const warnings: string[] = [];
	if (raw.includes("\u0000")) {
		warnings.push("This file appears to be binary DXF. Rendering may be incomplete.");
	}

	const groups = parseGroups(raw);
	const entities: DxfEntity[] = [];
	let inEntitiesSection = false;

	for (let i = 0; i < groups.length; ) {
		const group = groups[i];
		if (!group) {
			break;
		}

		if (group.code === 0 && group.value === "SECTION") {
			const sectionMarker = groups[i + 1];
			inEntitiesSection = sectionMarker?.code === 2 && sectionMarker.value === "ENTITIES";
			i += 2;
			continue;
		}

		if (group.code === 0 && group.value === "ENDSEC") {
			inEntitiesSection = false;
			i += 1;
			continue;
		}

		if (!inEntitiesSection || group.code !== 0) {
			i += 1;
			continue;
		}

		if (group.value === "POLYLINE") {
			const parsed = parsePolylineEntity(groups, i);
			if (parsed.entity) {
				entities.push(parsed.entity);
			}
			i = parsed.nextIndex;
			continue;
		}

		const parsed = parseSimpleEntity(groups, i);
		if (parsed.entity) {
			entities.push(parsed.entity);
		}
		i = parsed.nextIndex;
	}

	return {entities, warnings};
}

function parseGroups(raw: string): DxfGroup[] {
	const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
	const groups: DxfGroup[] = [];

	for (let i = 0; i + 1 < lines.length; i += 2) {
		const codeText = lines[i]?.trim();
		const valueText = lines[i + 1] ?? "";
		if (!codeText) {
			continue;
		}

		const code = Number.parseInt(codeText, 10);
		if (Number.isNaN(code)) {
			continue;
		}

		groups.push({code, value: valueText.trim()});
	}

	return groups;
}

function parseSimpleEntity(groups: DxfGroup[], startIndex: number): EntityParseResult {
	const startGroup = groups[startIndex];
	if (!startGroup) {
		return {entity: null, nextIndex: startIndex + 1};
	}

	let i = startIndex + 1;
	while (i < groups.length) {
		const current = groups[i];
		if (!current || current.code === 0) {
			break;
		}
		i += 1;
	}

	const entityType = startGroup.value;
	const body = groups.slice(startIndex + 1, i);

	switch (entityType) {
		case "LINE":
			return {entity: parseLine(body), nextIndex: i};
		case "LWPOLYLINE":
			return {entity: parseLwPolyline(body), nextIndex: i};
		case "CIRCLE":
			return {entity: parseCircle(body), nextIndex: i};
		case "ARC":
			return {entity: parseArc(body), nextIndex: i};
		default:
			return {entity: null, nextIndex: i};
	}
}

function parseLine(body: DxfGroup[]): DxfLineEntity | null {
	const start = readPoint(body, 10, 20);
	const end = readPoint(body, 11, 21);
	if (!start || !end) {
		return null;
	}

	return {
		type: "LINE",
		start,
		end,
	};
}

function parseCircle(body: DxfGroup[]): DxfCircleEntity | null {
	const center = readPoint(body, 10, 20);
	const radius = readNumber(body, 40);
	if (!center || radius === null || radius <= 0) {
		return null;
	}

	return {
		type: "CIRCLE",
		center,
		radius,
	};
}

function parseArc(body: DxfGroup[]): DxfArcEntity | null {
	const center = readPoint(body, 10, 20);
	const radius = readNumber(body, 40);
	const startAngle = readNumber(body, 50);
	const endAngle = readNumber(body, 51);

	if (!center || radius === null || radius <= 0 || startAngle === null || endAngle === null) {
		return null;
	}

	return {
		type: "ARC",
		center,
		radius,
		startAngleDeg: startAngle,
		endAngleDeg: endAngle,
	};
}

function parseLwPolyline(body: DxfGroup[]): DxfPolylineEntity | null {
	const vertices: DxfPoint[] = [];
	const flags = readNumber(body, 70) ?? 0;
	const closed = (Math.trunc(flags) & 1) === 1;

	let pendingX: number | null = null;
	for (const group of body) {
		if (group.code === 10) {
			pendingX = parseNumber(group.value);
			continue;
		}

		if (group.code === 20 && pendingX !== null) {
			const y = parseNumber(group.value);
			if (y !== null) {
				vertices.push({x: pendingX, y});
			}
			pendingX = null;
		}
	}

	if (vertices.length < 2) {
		return null;
	}

	return {
		type: "POLYLINE",
		points: vertices,
		closed,
	};
}

function parsePolylineEntity(groups: DxfGroup[], startIndex: number): EntityParseResult {
	let i = startIndex + 1;
	let flags = 0;

	while (i < groups.length) {
		const current = groups[i];
		if (!current || current.code === 0) {
			break;
		}
		if (current.code === 70) {
			flags = Math.trunc(parseNumber(current.value) ?? 0);
		}
		i += 1;
	}

	const points: DxfPoint[] = [];
	while (i < groups.length) {
		const group = groups[i];
		if (!group) {
			break;
		}
		if (group.code !== 0) {
			i += 1;
			continue;
		}

		if (group.value === "VERTEX") {
			const parsedVertex = parseVertex(groups, i);
			if (parsedVertex.point) {
				points.push(parsedVertex.point);
			}
			i = parsedVertex.nextIndex;
			continue;
		}

		if (group.value === "SEQEND") {
			i += 1;
			break;
		}

		break;
	}

	if (points.length < 2) {
		return {entity: null, nextIndex: i};
	}

	const entity: DxfPolylineEntity = {
		type: "POLYLINE",
		points,
		closed: (flags & 1) === 1,
	};
	return {entity, nextIndex: i};
}

function parseVertex(groups: DxfGroup[], startIndex: number): {point: DxfPoint | null; nextIndex: number} {
	let i = startIndex + 1;
	while (i < groups.length) {
		const current = groups[i];
		if (!current || current.code === 0) {
			break;
		}
		i += 1;
	}

	const body = groups.slice(startIndex + 1, i);
	const point = readPoint(body, 10, 20);
	return {point, nextIndex: i};
}

function readPoint(body: DxfGroup[], xCode: number, yCode: number): DxfPoint | null {
	const x = readNumber(body, xCode);
	const y = readNumber(body, yCode);
	if (x === null || y === null) {
		return null;
	}
	return {x, y};
}

function readNumber(body: DxfGroup[], code: number): number | null {
	for (const group of body) {
		if (group.code === code) {
			return parseNumber(group.value);
		}
	}
	return null;
}

function parseNumber(value: string): number | null {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}
