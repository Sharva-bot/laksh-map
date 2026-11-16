with open('src/components/map.tsx', 'r', encoding='utf-8') as f:
    text = f.read()
if 'setWorkerUrl' not in text:
    text = text.replace("try{const m=new maplibregl.Map({", "try{maplibregl.setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');const m=new maplibregl.Map({")
with open('src/components/map.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
print('map fixed')
