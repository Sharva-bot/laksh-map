# Credits & Attribution

## Original Creator
- **theadiram** — Original author of Hisaab, source-backed public development evidence atlas. GitHub: https://github.com/theadiram/Hisaab

## Modifications & Improvements
- **Sharva Gavalkar** — Security enhancement (`scripts/database-security.mjs`), faster funding card setup (`.env.local` configuration), deployment preparation, and Netlify deployment (`hissab-sharva.netlify.app`).

## Source & License
- Original source: MIT License (see `LICENSE`).
- All government records, datasets, and third-party materials retain their own terms and attribution requirements.
- This fork preserves the original copyright notice per MIT License terms.

## Map Data Sources
Government records are used under the Government Open Data License - India (GODL-India). HISAAB keeps the original `source_link` on every record as proof and does not claim ownership of the data or photos.

- **GeoMGNREGA / Bhuvan (NRSC)** — MGNREGA asset records and photographs. https://bhuvan-app1.nrsc.gov.in/nrega/
- **Meghalaya CD Dashboard GIS service** — public ArcGIS mirror of GeoMGNREGA points used for bulk import. https://meghalayacmdashboard.in/gisserver/rest/services/MBDA_Test/MGNREGA/FeatureServer/1
- **PMGSY GeoSadak open data** — rural road and facility records. https://geosadak-pmgsy.nic.in/opendata/
- **DataMeet PMGSY mirror** — per-state PMGSY open-data CSVs. https://github.com/pratapvardhan/rural-facilities-pmgsy
- **Esri World Dark Gray Canvas** — basemap tiles. https://www.esri.com/
- **Leaflet** — map rendering library. https://leafletjs.com/

Party and MLA attribution is shown as **Not known** until a source is added for that record. Citizen votes are stored as one vote per browser token per record; they are not government data.
