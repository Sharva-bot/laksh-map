import os
for root, dirs, files in os.walk('src'):
    for f in files:
        if not f.endswith(('.tsx','.ts')): continue
        path = os.path.join(root, f)
        with open(path, 'r', encoding='utf-8') as file:
            text = file.read()
        text = text.replace("import maplibregl from 'maplibre-gl';", "import * as maplibregl from 'maplibre-gl';")
        text = text.replace("import type maplibregl from 'maplibre-gl';", "import type * as maplibregl from 'maplibre-gl';")
        with open(path, 'w', encoding='utf-8') as file:
            file.write(text)
print('imports fixed')
