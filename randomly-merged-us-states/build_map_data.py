"""Build the contiguous-state quiz map from a Census cartographic shapefile.

Usage:
    python build_map_data.py path/to/cb_2025_us_state_5m.shp

Build dependencies: pyshp and shapely.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import shapefile
from shapely.geometry import GeometryCollection, LineString, MultiLineString, mapping, shape
from shapely.ops import unary_union


STATE_NAMES = {
    "AL": "Alabama", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida",
    "GA": "Georgia", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana",
    "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}

# Land-border adjacencies only. Corner-only contacts such as AZ-CO are excluded.
NEIGHBORS = {
    "AL": ["FL", "GA", "MS", "TN"],
    "AZ": ["CA", "NM", "NV", "UT"],
    "AR": ["LA", "MO", "MS", "OK", "TN", "TX"],
    "CA": ["AZ", "NV", "OR"],
    "CO": ["KS", "NE", "NM", "OK", "UT", "WY"],
    "CT": ["MA", "NY", "RI"],
    "DE": ["MD", "NJ", "PA"],
    "FL": ["AL", "GA"],
    "GA": ["AL", "FL", "NC", "SC", "TN"],
    "ID": ["MT", "NV", "OR", "UT", "WA", "WY"],
    "IL": ["IA", "IN", "KY", "MO", "WI"],
    "IN": ["IL", "KY", "MI", "OH"],
    "IA": ["IL", "MN", "MO", "NE", "SD", "WI"],
    "KS": ["CO", "MO", "NE", "OK"],
    "KY": ["IL", "IN", "MO", "OH", "TN", "VA", "WV"],
    "LA": ["AR", "MS", "TX"],
    "ME": ["NH"],
    "MD": ["DE", "PA", "VA", "WV"],
    "MA": ["CT", "NH", "NY", "RI", "VT"],
    "MI": ["IN", "OH", "WI"],
    "MN": ["IA", "ND", "SD", "WI"],
    "MS": ["AL", "AR", "LA", "TN"],
    "MO": ["AR", "IA", "IL", "KS", "KY", "NE", "OK", "TN"],
    "MT": ["ID", "ND", "SD", "WY"],
    "NE": ["CO", "IA", "KS", "MO", "SD", "WY"],
    "NV": ["AZ", "CA", "ID", "OR", "UT"],
    "NH": ["MA", "ME", "VT"],
    "NJ": ["DE", "NY", "PA"],
    "NM": ["AZ", "CO", "OK", "TX"],
    "NY": ["CT", "MA", "NJ", "PA", "VT"],
    "NC": ["GA", "SC", "TN", "VA"],
    "ND": ["MN", "MT", "SD"],
    "OH": ["IN", "KY", "MI", "PA", "WV"],
    "OK": ["AR", "CO", "KS", "MO", "NM", "TX"],
    "OR": ["CA", "ID", "NV", "WA"],
    "PA": ["DE", "MD", "NJ", "NY", "OH", "WV"],
    "RI": ["CT", "MA"],
    "SC": ["GA", "NC"],
    "SD": ["IA", "MN", "MT", "ND", "NE", "WY"],
    "TN": ["AL", "AR", "GA", "KY", "MO", "MS", "NC", "VA"],
    "TX": ["AR", "LA", "NM", "OK"],
    "UT": ["CO", "ID", "NV", "WY"],
    "VT": ["MA", "NH", "NY"],
    "VA": ["KY", "MD", "NC", "TN", "WV"],
    "WA": ["ID", "OR"],
    "WV": ["KY", "MD", "OH", "PA", "VA"],
    "WI": ["IA", "IL", "MI", "MN"],
    "WY": ["CO", "ID", "MT", "NE", "SD", "UT"],
}


def linework(geometry):
    """Keep only line components from an arbitrary intersection geometry."""
    if isinstance(geometry, LineString):
        return geometry
    if isinstance(geometry, MultiLineString):
        return geometry
    if isinstance(geometry, GeometryCollection):
        lines = []
        for part in geometry.geoms:
            extracted = linework(part)
            if isinstance(extracted, LineString):
                lines.append(extracted)
            elif isinstance(extracted, MultiLineString):
                lines.extend(extracted.geoms)
        if not lines:
            return MultiLineString([])
        return lines[0] if len(lines) == 1 else MultiLineString(lines)
    return MultiLineString([])


def feature(geometry, properties):
    return {"type": "Feature", "properties": properties, "geometry": mapping(geometry)}


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Pass the source .shp path as the only argument.")

    source = Path(sys.argv[1]).resolve()
    output = Path(__file__).resolve().parent / "assets" / "map_data.json"
    output.parent.mkdir(parents=True, exist_ok=True)

    reader = shapefile.Reader(str(source))
    field_names = [field[0] for field in reader.fields[1:]]
    state_geometries = {}

    for shape_record in reader.iterShapeRecords():
        record = dict(zip(field_names, shape_record.record))
        code = record.get("STUSPS")
        if code not in STATE_NAMES:
            continue
        geometry = shape(shape_record.shape.__geo_interface__)
        if not geometry.is_valid:
            geometry = geometry.buffer(0)
        state_geometries[code] = geometry

    missing = sorted(set(STATE_NAMES) - set(state_geometries))
    if missing:
        raise RuntimeError(f"Missing contiguous states: {', '.join(missing)}")

    adjacency_pairs = sorted({tuple(sorted((code, neighbor))) for code, neighbors in NEIGHBORS.items() for neighbor in neighbors})
    border_features = []
    for first, second in adjacency_pairs:
        shared = linework(state_geometries[first].boundary.intersection(state_geometries[second].boundary))
        if shared.is_empty or shared.length < 0.001:
            raise RuntimeError(f"No shared line found for {first}-{second}")
        border_features.append(feature(shared, {
            "id": f"{first}-{second}",
            "a": first,
            "b": second,
        }))

    states = [
        feature(state_geometries[code], {"code": code, "name": STATE_NAMES[code]})
        for code in sorted(STATE_NAMES)
    ]
    outline = unary_union(list(state_geometries.values())).boundary
    payload = {
        "source": "U.S. Census Bureau 2025 Cartographic Boundary Files, 1:20,000,000",
        "states": {"type": "FeatureCollection", "features": states},
        "borders": {"type": "FeatureCollection", "features": border_features},
        "outline": feature(outline, {}),
    }
    output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {output} ({output.stat().st_size:,} bytes, {len(states)} states, {len(border_features)} borders)")


if __name__ == "__main__":
    main()
