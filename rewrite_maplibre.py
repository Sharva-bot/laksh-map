import os, re
base = 'src'
for root, dirs, files in os.walk(base):
    for f in files:
        if not f.endswith(('.tsx','.ts')): continue
        path = os.path.join(root, f)
        with open(path, 'r', encoding='utf-8') as file:
            text = file.read()
        # Import changes
        text = text.replace("import mapboxgl from 'mapbox-gl';", "import maplibregl from 'maplibre-gl';")
        text = text.replace('import type mapboxgl from \'mapbox-gl\';', 'import type maplibregl from \'maplibre-gl\';')
        # CSS import
        text = text.replace("import 'mapbox-gl/dist/mapbox-gl.css';", "import 'maplibre-gl/dist/maplibre-gl.css';")
        # Replace references to mapboxgl (not inside URLs)
        # We only replace identifiers, not URLs. URLs contain 'mapbox://', 'mapbox.' etc.
        # Replace 'mapboxgl.' with 'maplibregl.' globally (URLs don't contain 'mapboxgl.')
        text = text.replace('mapboxgl.', 'maplibregl.')
        # Replace standalone 'mapboxgl' in type annotations when followed by type keywords
        # But 'mapboxgl' in 'mapboxgl.Map' is already handled by '.' replacement.
        # Some variables might be named 'mapboxgl' (none in this codebase based on grep).
        # Replace 'mapboxgl' as standalone type reference not in URLs
        # Actually after '.' replacement, any remaining 'mapboxgl' without '.' might be variable names.
        # Let's just replace 'mapboxgl' with 'maplibregl' globally EXCEPT inside URLs containing 'mapbox://'
        # But URLs are separate and don't contain 'mapboxgl' string. So safe to replace globally.
        # Wait: there might be string literals like `mapbox://styles...` which contain 'mapbox' but not 'mapboxgl'.
        # Global replace of 'mapboxgl' -> 'maplibregl' won't affect URLs.
        text = text.replace('mapboxgl', 'maplibregl')
        # Fix double replacement of 'maplibregl' inside URLs that might have gotten changed accidentally?
        # URLs contain 'mapbox://', not 'mapboxgl', so unaffected.
        # Remove emissive paint props globally
        text = re.sub(r",'circle-emissive-strength':\s*[^,}]*", '', text)
        text = re.sub(r",'circle-emissive-strength':\s*[^,}]*", '', text)
        text = re.sub(r",'fill-emissive-strength':\s*[^,}]*", '', text)
        text = re.sub(r",'fill-emissive-strength':\s*[^,}]*", '', text)
        text = re.sub(r",'line-emissive-strength':\s*[^,}]*", '', text)
        text = re.sub(r",'line-emissive-strength':\s*[^,}]*", '', text)
        text = re.sub(r",'text-emissive-strength':\s*[^,}]*", '', text)
        text = re.sub(r",'text-emissive-strength':\s*[^,}]*", '', text)
        # Replace terrain source URL
        text = text.replace('mapbox://mapbox.mapbox-terrain-dem-v1', 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png')
        # Replace glyphs URL
        text = text.replace('mapbox://fonts/mapbox/{fontstack}/{range}.pbf', 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf')
        # Replace base style URLs in atlas-map and map
        text = text.replace('mapbox://styles/mapbox/standard-satellite', 'https://tiles.openfreemap.org/styles/liberty')
        text = text.replace('mapbox://styles/mapbox/standard', 'https://tiles.openfreemap.org/styles/liberty')
        # But for satellite, we actually want ESRI satellite for the satellite option; however we replaced both.
        # That's okay for now — both will be liberty. Later we'll adjust atlas-map/map to support satellite via ESRI style object.
        with open(path, 'w', encoding='utf-8') as file:
            file.write(text)
print('bulk rewrite done')
