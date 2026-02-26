export interface DxfPoint {
	x: number;
	y: number;
}

export interface DxfLineEntity {
	type: "LINE";
	start: DxfPoint;
	end: DxfPoint;
}

export interface DxfCircleEntity {
	type: "CIRCLE";
	center: DxfPoint;
	radius: number;
}

export interface DxfArcEntity {
	type: "ARC";
	center: DxfPoint;
	radius: number;
	startAngleDeg: number;
	endAngleDeg: number;
}

export interface DxfPolylineEntity {
	type: "POLYLINE";
	points: DxfPoint[];
	closed: boolean;
}

export type DxfEntity = DxfLineEntity | DxfCircleEntity | DxfArcEntity | DxfPolylineEntity;

export interface DxfDocument {
	entities: DxfEntity[];
	warnings: string[];
}

export interface DxfBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}
