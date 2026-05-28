#!/usr/bin/env python3
"""Build data/airspaces.json from AIP ENR 5.1 + ENR 2.1 airport CTR/TMA tables."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENR51 = ROOT / "scripts" / "data" / "enr51_aip.txt"
if not ENR51.exists():
    ENR51 = Path("/Users/sintusingha/.cursor/projects/Volumes-ExtremeProApple-dev-2026-kuson-thailandairspace-sim/agent-tools/8e77f254-8420-4613-ad3b-eeb692644ffb.txt")
OUT = ROOT / "data" / "airspaces.json"

CAT_MAP = {"VTP": "Prohibited", "VTR": "Restricted", "VTD": "Danger"}

# Latitude in DD or DDMM or DDMMSS (with optional decimal seconds) — explicit
# lengths instead of \d{3,8} so the regex can't eat a token-ID prefix like
# "1164" and parse a vertex as "64°15'13"N" (which then fails Thailand bounds).
_LAT_DIGITS = r"(?:\d{6}(?:\.\d+)?|\d{4}(?:\.\d+)?|\d{2,3}(?:\.\d+)?)"
_LON_DIGITS = r"(?:\d{7}(?:\.\d+)?|\d{5}(?:\.\d+)?|\d{3,4}(?:\.\d+)?)"

COORD_PAIR_RE = re.compile(
    rf"(?<![0-9])({_LAT_DIGITS})([NS])"
    r"(?:TAIRSPACE[^0-9]*(?:\d+\s*)?|\s+)?"
    rf"({_LON_DIGITS})([EW])(?:TAIRSPACE|TNAVAID|[^\d]|$)",
    re.I,
)

# AIP HTML dump glues an internal numeric token-ID (e.g. ";1164") directly
# in front of the real lat value. Strip the prefix explicitly, and allow
# decimal seconds (151305.60N, not just 151305N).
ARC_VERTEX_RE = re.compile(
    r"TAIRSPACE_VERTEX;VAL_RADIUS_ARC;\d{3,5}"
    r"(\d{6}(?:\.\d+)?)([NS])\s+(\d{7}(?:\.\d+)?)([EW])",
    re.I,
)

TACAN_COORD_RE = re.compile(
    r"TACAN.*?\((\d{3,8}(?:\.\d+)?)([NS])"
    r"(?:TAIRSPACE[^0-9]*(?:\d+\s*)?|TNAVAID[^0-9]*(?:\d+\s*)?|\s+)?"
    r"(\d{4,9}(?:\.\d+)?)([EW])(?:TAIRSPACE|TNAVAID|[^\d]|$)",
    re.I | re.S,
)

PAREN_COORD_RE = re.compile(
    r"\((\d{3,8}(?:\.\d+)?)([NS])"
    r"(?:TAIRSPACE[^0-9]*(?:\d+\s*)?|TNAVAID[^0-9]*(?:\d+\s*)?|\s+)?"
    r"(\d{4,9}(?:\.\d+)?)([EW])(?:TAIRSPACE|TNAVAID|[^\d]|$)",
    re.I,
)


def parse_coord_value(raw, hemi):
    """Parse AIP lat/lon (DDMMSS.ss, DDMM.mm, or DDMM) to decimal degrees."""
    s = re.sub(r"[^0-9.]", "", str(raw))
    if not s:
        return None
    hemi = (hemi or "").upper()
    is_lon = hemi in "EW"

    if "." in s:
        intpart, frac = s.split(".", 1)
        sec_thresh = 7 if is_lon else 6
        if len(intpart) >= sec_thresh:
            if is_lon:
                d, m, sec = int(intpart[:3]), int(intpart[3:5]), float(intpart[5:] + "." + frac)
            else:
                d, m, sec = int(intpart[:2]), int(intpart[2:4]), float(intpart[4:] + "." + frac)
            v = d + m / 60.0 + sec / 3600.0
        else:
            if is_lon:
                if len(intpart) >= 5:
                    d = int(intpart[:3])
                    m = float(intpart[3:] + "." + frac)
                elif len(intpart) >= 3:
                    d = int(intpart[:3])
                    m = float(intpart[3:] + "." + frac) if len(intpart) > 3 else float(frac)
                else:
                    d, m = int(intpart), float(frac)
            else:
                if len(intpart) >= 4:
                    d = int(intpart[:2])
                    m = float(intpart[2:] + "." + frac)
                elif len(intpart) >= 2:
                    d = int(intpart[:2])
                    m = float(intpart[2:] + "." + frac) if len(intpart) > 2 else float(frac)
                else:
                    d, m = int(intpart), float(frac)
            v = d + m / 60.0
    else:
        if is_lon:
            if len(s) >= 7:
                d, m, sec = int(s[:3]), int(s[3:5]), float(s[5:])
            elif len(s) == 5:
                d, m, sec = int(s[:3]), int(s[3:5]), 0.0
            elif len(s) == 4:
                d, m, sec = int(s[:3]), int(s[3]), 0.0
            else:
                return None
        else:
            if len(s) >= 6:
                d, m, sec = int(s[:2]), int(s[2:4]), float(s[4:])
            elif len(s) == 4:
                d, m, sec = int(s[:2]), int(s[2:4]), 0.0
            else:
                return None
        v = d + m / 60.0 + sec / 3600.0

    if hemi in "SW":
        v = -v
    return round(v, 6)


def extract_coord_pairs(text):
    pts = []
    seen = set()
    # ARC first so token-prefixed vertices ("TAIRSPACE_VERTEX;VAL_RADIUS_ARC;1164151305.60N …")
    # are stripped of the token-ID and consumed before COORD_PAIR_RE can grab
    # the prefix into the digit run.
    for regex in (ARC_VERTEX_RE, COORD_PAIR_RE):
        for m in regex.finditer(text):
            lat = parse_coord_value(m.group(1), m.group(2))
            lon = parse_coord_value(m.group(3), m.group(4))
            if not thailand_ok(lat, lon):
                continue
            key = (round(lat, 5), round(lon, 5))
            if key in seen:
                continue
            seen.add(key)
            pts.append([lat, lon])
    return pts


def parse_vertices(block):
    pts = extract_coord_pairs(block)
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    return pts if len(pts) >= 3 else None


def parse_upper_lower(block):
    upper = 60000
    lower = 0
    if re.search(r"\bUNL\b", block, re.I):
        upper = 60000
    fl = re.search(r"\bFL\s*(\d+)\b", block, re.I)
    if fl:
        upper = int(fl.group(1)) * 100
    alt_u = re.search(r"ALT\s*([\d\s]+)\s*ft", block, re.I)
    if alt_u:
        upper = int(re.sub(r"\s", "", alt_u.group(1)))
    if re.search(r"/\s*GND|GND\s*/", block, re.I):
        lower = 0
    return lower, upper


def thailand_ok(lat, lon):
    return lat is not None and lon is not None and 5.0 <= lat <= 21.0 and 97.0 <= lon <= 106.0


def parse_circle(block):
    # Only treat the block as a circle if "Circle" / "semi-circle" appears.
    # Use a leading word-boundary only — the trailing side often runs straight
    # into a token-ID like "CircleTAIRSPACE_VERTEX;…", so a trailing \b would
    # miss every mangled block.
    if not re.search(r"\b(?:Circle|semi-circle)", block, re.I):
        return None

    # The AIP HTML dump produces strings like:
    #   "Circle of 50 NM radius centred on point KRT TACAN …"          (clean)
    #   "CircleTAIRSPACE_VERTEX;CODE_TYPE;461 of 3TAIRSPACE_VERTEX;VAL_RADIUS_ARC;461 NM …"
    #     ↑ real radius is 3, NOT 461 (which is an internal token-ID)
    #   "A semi-circle 14TAIRSPACE_VERTEX;VAL_RADIUS_ARC;308 NM …"
    #     ↑ real radius is 14
    #
    # In every form, the real radius sits right after "of " or "semi-circle ",
    # and is followed by either " NM" (clean) or "TAIRSPACE" (mangled).
    r_m = re.search(
        r"\bof\s+(\d+(?:\.\d+)?)(?=\s*(?:NM\b|TAIRSPACE))",
        block, re.I,
    )
    if not r_m:
        r_m = re.search(
            r"semi-circle\s+(\d+(?:\.\d+)?)(?=\s*(?:NM\b|TAIRSPACE))",
            block, re.I,
        )
    if not r_m:
        r_m = re.search(r"(\d+(?:\.\d+)?)\s*NM\s+radius", block, re.I)
    if not r_m:
        return None

    center_m = re.search(
        r"(?:centred on point|GEO_LAT_ARC)[^\n]*\n+\s*(\d{3,8}(?:\.\d+)?)([NS])"
        r"(?:TAIRSPACE[^0-9]*(?:\d+\s*)?|\s+)?"
        r"(\d{4,9}(?:\.\d+)?)([EW])(?:TAIRSPACE|TNAVAID|[^\d]|$)",
        block,
        re.I | re.S,
    )
    if not center_m:
        center_m = re.search(
            r"centred on point.*?(\d{3,8}(?:\.\d+)?)([NS])"
            r"(?:TAIRSPACE[^0-9]*(?:\d+\s*)?|\s+)?"
            r"(\d{4,9}(?:\.\d+)?)([EW])(?:TAIRSPACE|TNAVAID|[^\d]|$)",
            block,
            re.I | re.S,
        )
    if not center_m:
        center_m = TACAN_COORD_RE.search(block)
    if not center_m:
        center_m = PAREN_COORD_RE.search(block)
    if not center_m:
        center_m = re.search(
            r"VOR/DME.*?\((\d{3,8}(?:\.\d+)?)\s*([NS])"
            r"(?:TAIRSPACE[^0-9]*(?:\d+\s*)?|\s+)?"
            r"(\d{4,9}(?:\.\d+)?)\s*([EW])\)",
            block,
            re.I | re.S,
        )
    if not center_m:
        after = re.search(
            r"centred on point\s*\n?\s*(\d{3,8}(?:\.\d+)?)\s*([NS])\s+(\d{4,9}(?:\.\d+)?)\s*([EW])",
            block,
            re.I,
        )
        if after:
            center_m = after
    if not center_m:
        pairs = extract_coord_pairs(block)
        if pairs:
            return float(r_m.group(1)), pairs[0]
        return None

    lat = parse_coord_value(center_m.group(1), center_m.group(2))
    lon = parse_coord_value(center_m.group(3), center_m.group(4))
    if not thailand_ok(lat, lon):
        return None
    return float(r_m.group(1)), [lat, lon]


def parse_tacan_training_circle(block):
    m = re.search(
        r"(\d+(?:\.\d+)?)\s*NM\s+arc\s+from\s+\w+\s+TACAN",
        block,
        re.I,
    )
    tacan = TACAN_COORD_RE.search(block)
    if m and tacan:
        lat = parse_coord_value(tacan.group(1), tacan.group(2))
        lon = parse_coord_value(tacan.group(3), tacan.group(4))
        if thailand_ok(lat, lon):
            return float(m.group(1)), [lat, lon]

    m = re.search(
        r"(\d+(?:\.\d+)?)\s*NM.*?TACAN.*?\((\d{3,8}(?:\.\d+)?)\s*([NS])"
        r"(?:TAIRSPACE[^0-9]*(?:\d+\s*)?|\s+)?"
        r"(\d{4,9}(?:\.\d+)?)\s*([EW])\)",
        block,
        re.I | re.S,
    )
    if not m:
        m = re.search(
            r"arc\s+(\d+(?:\.\d+)?)\s*NM.*?(\d{3,8}(?:\.\d+)?)\s*([NS])"
            r"(?:TAIRSPACE[^0-9]*(?:\d+\s*)?|\s+)?"
            r"(\d{4,9}(?:\.\d+)?)\s*([EW])",
            block,
            re.I | re.S,
        )
    if not m:
        return None
    lat = parse_coord_value(m.group(2), m.group(3))
    lon = parse_coord_value(m.group(4), m.group(5))
    if not thailand_ok(lat, lon):
        return None
    return float(m.group(1)), [lat, lon]


def parse_name(chunk, prefix, code_num):
    m = re.search(
        rf"{prefix}{re.escape(code_num)}(?:TAIRSPACE[^A-Za-z]*)?(?:\d+\s+)?([A-Z0-9][A-Z0-9 ,\-/().]+?)(?:TAIRSPACE|Area\b|Circle|Type of restriction)",
        chunk,
        re.I | re.S,
    )
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()[:80]
    m2 = re.search(rf"{prefix}{re.escape(code_num)}\s+([A-Z][A-Z0-9 ,\-/().]+)", chunk)
    if m2:
        return re.sub(r"\s+", " ", m2.group(1)).strip()[:80]
    return f"{prefix}{code_num}"


def restriction_hint(block):
    m = re.search(r"Type of restriction\s*:\s*([^\n]+)", block, re.I)
    if m:
        return m.group(1).strip()
    return ""


def make_volume(vol_id, name, cat, lower, upper, shape, restriction, **extra):
    desc = f"{cat} area {name}."
    if restriction:
        desc += f" {restriction}."
    desc += " Verify against current AIP before flight."
    base = {
        "id": vol_id,
        "name": name,
        "shortName": vol_id,
        "category": cat,
        "class": cat[0],
        "lowerFt": lower,
        "upperFt": upper,
        "lowerRef": "GND",
        "upperRef": "AMSL",
        "shape": shape,
        "approximate": True,
        "source": "AIP ENR 5.1 (2025-08-07 AIRAC) — parsed",
        "description": desc,
    }
    base.update(extra)
    return base


def parse_area_block(vol_id, name, cat, block):
    lower, upper = parse_upper_lower(block)
    restriction = restriction_hint(block)

    circle = parse_circle(block)
    if circle:
        radius, center = circle
        note = ""
        if re.search(r"semi-circle", block, re.I):
            note = " Semi-circle approximated as full circle."
        return make_volume(
            vol_id,
            name,
            cat,
            lower,
            upper,
            "circle",
            restriction,
            center=center,
            radiusNM=radius,
            description=f"{cat} area {name}.{note} {restriction}. Verify against current AIP before flight.",
        )

    pts = parse_vertices(block)
    if pts:
        note = ""
        if re.search(r"follow.*arc|coast line", block, re.I):
            note = " Coast/arc segments omitted — polygon approximate."
        return make_volume(
            vol_id,
            name,
            cat,
            lower,
            upper,
            "polygon",
            restriction,
            points=pts,
            description=f"{cat} area {name}.{note} {restriction}. Verify against current AIP before flight.",
        )

    tacan = parse_tacan_training_circle(block)
    if tacan:
        radius, center = tacan
        return make_volume(
            vol_id,
            name,
            cat,
            lower,
            upper,
            "circle",
            restriction,
            center=center,
            radiusNM=radius,
            description=f"{cat} area {name}. TACAN arc approximated as circle. {restriction}. Verify against current AIP before flight.",
        )

    return None


def split_areas(chunk, base_id, base_name):
    parts = re.split(r"\bArea\s*(\d+)\b", chunk, flags=re.I)
    if len(parts) <= 1:
        return [(base_id, base_name, chunk)]

    out = []
    preamble = parts[0]
    for i in range(1, len(parts), 2):
        area_num = parts[i]
        area_body = parts[i + 1] if i + 1 < len(parts) else ""
        vol_id = f"{base_id}-{area_num}"
        name = f"{base_name} Area {area_num}"
        out.append((vol_id, name, preamble + f"Area {area_num}" + area_body))
    return out


def parse_enr51(text):
    items = []
    chunks = re.split(r"\n(?=(?:VTP|VTR|VTD)\d+)", text)
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue

        m = re.match(r"(VTP|VTR|VTD)(\d+)(?:TAIRSPACE|[\s(]|$)", chunk, re.I)
        if not m:
            continue

        prefix, num = m.group(1).upper(), m.group(2)
        base_id = f"{prefix}{num}"
        cat = CAT_MAP[prefix]
        base_name = parse_name(chunk, prefix, num)

        for vol_id, name, area_block in split_areas(chunk, base_id, base_name):
            vol = parse_area_block(vol_id, name, cat, area_block)
            if vol:
                items.append(vol)

        south = re.search(
            rf"{prefix}{num}\s+[^(]+\(South Area\)\s+Area bounded by lines joining successively the following points:(.*?)(?:\n\n|VTD|\Z)",
            chunk,
            re.I | re.S,
        )
        if south:
            vol_id = f"{base_id}-S"
            vol = parse_area_block(
                vol_id,
                f"{base_name} South Area",
                cat,
                south.group(0),
            )
            if vol and not any(x["id"] == vol_id for x in items):
                items.append(vol)

    orphan = re.findall(
        r"(VTR\d+)\s+([A-Z][A-Z0-9 ,\-]+)\n\nCircle of (\d+(?:\.\d+)?) NM radius centred on point\n\n(\d{3,8}(?:\.\d+)?)\s*([NS])\s+(\d{4,9}(?:\.\d+)?)\s*([EW])",
        text,
        re.I,
    )
    for code, name, radius, lat_raw, lat_h, lon_raw, lon_h in orphan:
        lat = parse_coord_value(lat_raw, lat_h)
        lon = parse_coord_value(lon_raw, lon_h)
        if lat is None or lon is None:
            continue
        vol_id = code.upper()
        if any(x["id"] == vol_id for x in items):
            continue
        lower, upper = 0, 6000
        items.append(
            make_volume(
                vol_id,
                name.strip(),
                "Restricted",
                lower,
                upper,
                "circle",
                "Royal Residence Area",
                center=[lat, lon],
                radiusNM=float(radius),
                approximate=False,
                source="AIP ENR 5.1 (2025-08-07 AIRAC)",
            )
        )

    return items


# Major airport CTR/TMA — AIP ENR 2.1 (2025-08-07), ARP/DME coords approximate where noted
AIRPORT_ZONES = [
    {"id": "VTBD-CTR", "shortName": "Bangkok CTR", "name": "Bangkok Control Zone (VTBD/VTBS)", "category": "CTR", "class": "C", "center": [13.91444, 100.60556], "radiusNM": 35, "lowerFt": 0, "upperFt": 11000, "approximate": False, "source": "AIP ENR 2.1", "description": "Don Mueang / Suvarnabhumi CTR. ATC clearance required."},
    {"id": "VTBD-TMA", "shortName": "Bangkok TMA", "name": "Bangkok Terminal Control Area", "category": "TMA", "class": "C", "center": [13.91444, 100.60556], "radiusNM": 50, "lowerFt": 3000, "upperFt": 16500, "approximate": False, "source": "AIP ENR 2.1", "description": "Bangkok terminal area FL160–3000 ft."},
    {"id": "VTSP-CTR", "shortName": "Phuket CTR", "name": "Phuket Control Zone", "category": "CTR", "class": "C", "center": [8.11306, 98.31694], "radiusNM": 15, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Phuket International (VTSP) CTR."},
    {"id": "VTSP-TMA", "shortName": "Phuket TMA", "name": "Phuket Terminal Control Area", "category": "TMA", "class": "C", "center": [8.11306, 98.31694], "radiusNM": 40, "lowerFt": 3000, "upperFt": 11000, "approximate": True, "source": "AIP ENR 2.1", "description": "Phuket terminal area."},
    {"id": "VTCC-CTR", "shortName": "Chiang Mai CTR", "name": "Chiang Mai Control Zone", "category": "CTR", "class": "C", "center": [18.76685, 98.96264], "radiusNM": 15, "lowerFt": 0, "upperFt": 9000, "approximate": True, "source": "AIP ENR 2.1", "description": "Chiang Mai International (VTCC) CTR."},
    {"id": "VTCC-TMA", "shortName": "Chiang Mai TMA", "name": "Chiang Mai Terminal Control Area", "category": "TMA", "class": "C", "center": [18.76685, 98.96264], "radiusNM": 40, "lowerFt": 3000, "upperFt": 11000, "approximate": True, "source": "AIP ENR 2.1", "description": "Chiang Mai terminal area."},
    {"id": "VTCT-CTR", "shortName": "Chiang Rai CTR", "name": "Chiang Rai Control Zone", "category": "CTR", "class": "D", "center": [19.95219, 99.88297], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Chiang Rai (VTCT) CTR."},
    {"id": "VTCT-TMA", "shortName": "Chiang Rai TMA", "name": "Chiang Rai Terminal Control Area", "category": "TMA", "class": "C", "center": [19.95219, 99.88297], "radiusNM": 30, "lowerFt": 3000, "upperFt": 11000, "approximate": True, "source": "AIP ENR 2.1", "description": "Chiang Rai terminal area."},
    {"id": "VTSS-CTR", "shortName": "Hat Yai CTR", "name": "Hat Yai Control Zone", "category": "CTR", "class": "C", "center": [6.93306, 100.39278], "radiusNM": 15, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Hat Yai International (VTSS) CTR."},
    {"id": "VTSS-TMA", "shortName": "Hat Yai TMA", "name": "Hat Yai Terminal Control Area", "category": "TMA", "class": "C", "center": [6.93306, 100.39278], "radiusNM": 40, "lowerFt": 3000, "upperFt": 11000, "approximate": True, "source": "AIP ENR 2.1", "description": "Hat Yai terminal area."},
    {"id": "VTUK-CTR", "shortName": "Khon Kaen CTR", "name": "Khon Kaen Control Zone", "category": "CTR", "class": "C", "center": [16.46667, 102.78389], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Khon Kaen (VTUK) CTR."},
    {"id": "VTUK-TMA", "shortName": "Khon Kaen TMA", "name": "Khon Kaen Terminal Control Area", "category": "TMA", "class": "C", "center": [16.46667, 102.78389], "radiusNM": 30, "lowerFt": 3000, "upperFt": 11000, "approximate": True, "source": "AIP ENR 2.1", "description": "Khon Kaen terminal area."},
    {"id": "VTUD-CTR", "shortName": "Udon Thani CTR", "name": "Udon Thani Control Zone", "category": "CTR", "class": "C", "center": [17.38639, 102.78833], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Udon Thani (VTUD) CTR."},
    {"id": "VTUD-TMA", "shortName": "Udon Thani TMA", "name": "Udon Thani Terminal Control Area", "category": "TMA", "class": "C", "center": [17.38639, 102.78833], "radiusNM": 30, "lowerFt": 3000, "upperFt": 11000, "approximate": True, "source": "AIP ENR 2.1", "description": "Udon Thani terminal area."},
    {"id": "VTUQ-CTR", "shortName": "Surat Thani CTR", "name": "Surat Thani Control Zone", "category": "CTR", "class": "C", "center": [9.13278, 99.13556], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Surat Thani (VTUQ) CTR."},
    {"id": "VTUQ-TMA", "shortName": "Surat Thani TMA", "name": "Surat Thani Terminal Control Area", "category": "TMA", "class": "C", "center": [9.13278, 99.13556], "radiusNM": 30, "lowerFt": 3000, "upperFt": 11000, "approximate": True, "source": "AIP ENR 2.1", "description": "Surat Thani terminal area."},
    {"id": "VTBU-CTR", "shortName": "U-Tapao CTR", "name": "U-Tapao Control Zone", "category": "CTR", "class": "C", "center": [12.6797, 101.0050], "radiusNM": 7, "lowerFt": 0, "upperFt": 3000, "approximate": True, "source": "AIP ENR 2.1", "description": "U-Tapao (VTBU) RTN/RTAF joint base CTR."},
    {"id": "VTBU-TMA", "shortName": "U-Tapao TMA", "name": "U-Tapao Terminal Control Area", "category": "TMA", "class": "C", "center": [12.6797, 101.0050], "radiusNM": 30, "lowerFt": 3000, "upperFt": 11000, "approximate": True, "source": "AIP ENR 2.1", "description": "U-Tapao terminal area."},
    {"id": "KPS-CTR", "shortName": "Kamphaeng Saen CTR", "name": "Kamphaeng Saen Control Zone", "category": "CTR", "class": "C", "center": [14.08944, 99.91556], "radiusNM": 25, "lowerFt": 0, "upperFt": 6000, "approximate": False, "source": "AIP ENR 2.1", "description": "RTAF Kamphaeng Saen training CTR."},
    {"id": "VTBP-CTR", "shortName": "Hua Hin CTR", "name": "Hua Hin Control Zone (VTBP)", "category": "Class D", "class": "D", "center": [12.63444, 99.95117], "radiusNM": 10, "lowerFt": 0, "upperFt": 2000, "approximate": False, "source": "AIP ENR 2.1", "description": "Hua Hin (VTBP) Class D CTR."},
    # VTBS-CTR removed 2026-05-21: Suvarnabhumi (VTBS) does not have its own
    # published CTR — it sits inside Bangkok's single 35 NM CTR (VTBD-CTR).
    # Keeping it created an overlapping 20 NM disc inside the Bangkok CTR,
    # contributing to visual crowding around Bangkok with no information gain.
    #
    # VTCI-CTR removed 2026-05-21: explicit "Alias overlay for VTCC" duplicate
    # of VTCC-CTR (same coords, same radius). Pure visual clutter; no info.
    {"id": "VTSE-CTR", "shortName": "Krabi CTR", "name": "Krabi Control Zone", "category": "CTR", "class": "C", "center": [8.09917, 98.98639], "radiusNM": 10, "lowerFt": 0, "upperFt": 6000, "approximate": True, "source": "AIP ENR 2.1", "description": "Krabi (VTSE) CTR."},
    {"id": "VTSE-TMA", "shortName": "Krabi TMA", "name": "Krabi Terminal Control Area", "category": "TMA", "class": "C", "center": [8.09917, 98.98639], "radiusNM": 30, "lowerFt": 3000, "upperFt": 11000, "approximate": True, "source": "AIP ENR 2.1", "description": "Krabi terminal area."},
    {"id": "VTCL-CTR", "shortName": "Lampang CTR", "name": "Lampang Control Zone", "category": "CTR", "class": "C", "center": [18.27417, 99.50417], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Lampang (VTCL) CTR."},
    {"id": "VTCL-TMA", "shortName": "Lampang TMA", "name": "Lampang Terminal Control Area", "category": "TMA", "class": "C", "center": [18.27417, 99.50417], "radiusNM": 25, "lowerFt": 3000, "upperFt": 11000, "approximate": True, "source": "AIP ENR 2.1", "description": "Lampang terminal area."},
    {"id": "VTPO-CTR", "shortName": "Phitsanulok CTR", "name": "Phitsanulok Control Zone", "category": "CTR", "class": "C", "center": [16.78278, 100.27917], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Phitsanulok (VTPO) CTR."},
    {"id": "VTPO-TMA", "shortName": "Phitsanulok TMA", "name": "Phitsanulok Terminal Control Area", "category": "TMA", "class": "C", "center": [16.78278, 100.27917], "radiusNM": 30, "lowerFt": 3000, "upperFt": 11000, "approximate": True, "source": "AIP ENR 2.1", "description": "Phitsanulok terminal area."},
    {"id": "VTUU-CTR", "shortName": "Ubon Ratchathani CTR", "name": "Ubon Ratchathani Control Zone", "category": "CTR", "class": "C", "center": [15.25139, 104.87028], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Ubon (VTUU) CTR."},
    {"id": "VTUU-TMA", "shortName": "Ubon TMA", "name": "Ubon Terminal Control Area", "category": "TMA", "class": "C", "center": [15.25139, 104.87028], "radiusNM": 30, "lowerFt": 3000, "upperFt": 11000, "approximate": True, "source": "AIP ENR 2.1", "description": "Ubon terminal area."},
    {"id": "VTUR-CTR", "shortName": "Roi Et CTR", "name": "Roi Et Control Zone", "category": "CTR", "class": "C", "center": [16.11667, 103.77389], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Roi Et (VTUR) CTR."},
    {"id": "VTUW-CTR", "shortName": "Mae Sot CTR", "name": "Mae Sot Control Zone", "category": "CTR", "class": "C", "center": [16.69972, 98.54528], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Mae Sot (VTUW) CTR."},
    {"id": "VTUN-CTR", "shortName": "Nan CTR", "name": "Nan Control Zone", "category": "CTR", "class": "C", "center": [18.80778, 100.78333], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Nan (VTUN) CTR."},
    {"id": "VTSN-CTR", "shortName": "Chumphon CTR", "name": "Chumphon Control Zone", "category": "CTR", "class": "C", "center": [10.71111, 99.36167], "radiusNM": 10, "lowerFt": 0, "upperFt": 6000, "approximate": True, "source": "AIP ENR 2.1", "description": "Chumphon (VTSN) CTR."},
    {"id": "VTSG-CTR", "shortName": "Nakhon Si Thammarat CTR", "name": "Nakhon Si Thammarat Control Zone", "category": "CTR", "class": "C", "center": [8.53917, 99.94472], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Nakhon Si Thammarat (VTSG) CTR."},
    {"id": "VTSC-CTR", "shortName": "Narathiwat CTR", "name": "Narathiwat Control Zone", "category": "CTR", "class": "C", "center": [6.51972, 101.74333], "radiusNM": 10, "lowerFt": 0, "upperFt": 6000, "approximate": True, "source": "AIP ENR 2.1", "description": "Narathiwat (VTSC) CTR."},
    {"id": "VTSF-CTR", "shortName": "Pattani CTR", "name": "Pattani Control Zone", "category": "CTR", "class": "C", "center": [6.78528, 101.15389], "radiusNM": 10, "lowerFt": 0, "upperFt": 6000, "approximate": True, "source": "AIP ENR 2.1", "description": "Pattani (VTSF) CTR."},
    {"id": "VTPT-CTR", "shortName": "Tak CTR", "name": "Tak Control Zone", "category": "CTR", "class": "C", "center": [16.89583, 99.25333], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Tak (VTPT) CTR."},
    {"id": "VTPP-CTR", "shortName": "Phetchabun CTR", "name": "Phetchabun Control Zone", "category": "CTR", "class": "C", "center": [16.67639, 101.19528], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Phetchabun (VTPP) CTR."},
    # VTPR-CTR removed 2026-05-21: bogus ICAO (VTPR is not the Hua Hin code —
    # VTBP is) with a category/ID mismatch (category=TMA, id-suffix=-CTR).
    # No published AIP TMA exists for Hua Hin in the 2025-08-07 AIRAC. The
    # entry was speculative and only contributed to crowding.
    # ID "VTUR-KKZ" is a synthetic disambiguator — real ICAO for Korat RTAF is
    # not separately published (Wing 1 shares the Nakhon Ratchasima airfield).
    # ID kept stable so tour route / flight history doesn't break. Description
    # corrected: previously misreferenced "VTUK area" — VTUK is Khon Kaen, this
    # entry is actually around the Nakhon Ratchasima / Korat airfield.
    {"id": "VTUR-KKZ", "shortName": "Korat CTR (RTAF Wing 1)", "name": "Korat (Nakhon Ratchasima) Control Zone", "category": "CTR", "class": "C", "center": [14.93556, 102.07861], "radiusNM": 15, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1 (synthetic ID — Korat RTAF Wing 1 not separately published)", "description": "RTAF Wing 1 Korat military CTR at Nakhon Ratchasima."},
    {"id": "VTPI-CTR", "shortName": "Takhli CTR", "name": "Takhli RTAF Control Zone", "category": "CTR", "class": "C", "center": [15.27722, 100.29583], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "RTAF Wing 4 Takhli (VTPI) military CTR."},
    {"id": "VTBC-CTR", "shortName": "Watthana Nakhon CTR", "name": "Watthana Nakhon RTAF Control Zone", "category": "CTR", "class": "C", "center": [13.76806, 102.31389], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "RTAF Watthana Nakhon (VTBC) military CTR."},
    {"id": "VTUC-CTR", "shortName": "Buri Ram CTR", "name": "Buri Ram Control Zone", "category": "CTR", "class": "C", "center": [15.22917, 103.25222], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Buri Ram (VTUC) CTR."},
    {"id": "VTUP-CTR", "shortName": "Nakhon Phanom CTR", "name": "Nakhon Phanom Control Zone", "category": "CTR", "class": "C", "center": [17.38389, 104.64306], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Nakhon Phanom (VTUP) CTR."},
    {"id": "VTSR-CTR", "shortName": "Ranong CTR", "name": "Ranong Control Zone", "category": "CTR", "class": "C", "center": [9.77778, 98.58556], "radiusNM": 10, "lowerFt": 0, "upperFt": 6000, "approximate": True, "source": "AIP ENR 2.1", "description": "Ranong (VTSR) CTR."},
    {"id": "VTUL-CTR", "shortName": "Loei CTR", "name": "Loei Control Zone", "category": "CTR", "class": "C", "center": [17.43917, 101.72194], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Loei (VTUL) CTR."},
    {"id": "VTCH-CTR", "shortName": "Mae Hong Son CTR", "name": "Mae Hong Son Control Zone", "category": "CTR", "class": "C", "center": [19.30139, 97.97583], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Mae Hong Son (VTCH) CTR."},
    {"id": "VTCP-CTR", "shortName": "Phrae CTR", "name": "Phrae Control Zone", "category": "CTR", "class": "C", "center": [18.13222, 100.16528], "radiusNM": 10, "lowerFt": 0, "upperFt": 8000, "approximate": True, "source": "AIP ENR 2.1", "description": "Phrae (VTCP) CTR."},
    {"id": "VTBW-CTR", "shortName": "Betong CTR", "name": "Betong Control Zone", "category": "CTR", "class": "C", "center": [5.79028, 101.15083], "radiusNM": 10, "lowerFt": 0, "upperFt": 6000, "approximate": True, "source": "AIP ENR 2.1", "description": "Betong (VTBW) CTR — southern border."},
]


def normalize_airport(a):
    base = {
        "lowerRef": "GND",
        "upperRef": "AMSL",
        "shape": "circle",
    }
    base.update(a)
    return base


def main():
    text = ENR51.read_text(encoding="utf-8", errors="replace") if ENR51.exists() else ""
    parsed = parse_enr51(text) if text else []

    curated_prd = ROOT / "scripts" / "data" / "curated_prd.json"
    curated = json.loads(curated_prd.read_text()) if curated_prd.exists() else []

    by_id = {}
    for a in [normalize_airport(x) for x in AIRPORT_ZONES]:
        by_id[a["id"]] = a
    for a in parsed:
        if a["id"] not in by_id:
            by_id[a["id"]] = a
    for a in curated:
        by_id[a["id"]] = a

    airspaces = sorted(by_id.values(), key=lambda x: (x["category"], x["shortName"]))

    doc = {
        "meta": {
            "centerLat": 13.7563,
            "centerLon": 100.5018,
            "radiusKm": 900,
            "sourceAIRAC": "AIP Thailand ENR 2.1 + ENR 5.1 (2025-08-07 AIRAC)",
            "sourceUrls": [
                "https://aip.caat.or.th/2025-08-07-AIRAC/html/eAIP/VT-ENR-2.1-en-GB.html",
                "https://aip.caat.or.th/2025-08-07-AIRAC/html/eAIP/VT-ENR-5.1-en-GB.html",
            ],
            "disclaimer": "Educational visualization only. Not for flight planning. Parsed/approximate volumes — verify against current CAAT AIP.",
            "volumeCount": len(airspaces),
        },
        "airspaces": airspaces,
    }
    OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(airspaces)} airspaces to {OUT}")

    cats = {}
    military = 0
    for a in airspaces:
        cats[a["category"]] = cats.get(a["category"], 0) + 1
        d = a.get("description", "").upper()
        if "RTAF" in d or "RTN" in d or "MILITARY" in d or "NAVAL" in d:
            military += 1
    print("By category:", cats)
    print("Military-related:", military)


if __name__ == "__main__":
    main()
