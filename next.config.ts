import type { NextConfig } from 'next';
import {existsSync} from 'node:fs';
if(existsSync('.env.mapbox.local'))process.loadEnvFile('.env.mapbox.local');
const mapToken=process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN??'';
const config: NextConfig = {
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: true },
  outputFileTracingExcludes: {'/*':['./data/acquisition/**/*','./data/originals/**/*','./.hisaab/**/*','./tmp/**/*','./.env*']},
  env:{NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN:mapToken},
  async rewrites(){return [{source:'/state/:code',destination:'/'},{source:'/asset/:id',destination:'/'}];},
  async headers() { return [{source:'/geography/:path*',headers:[{key:'Cache-Control',value:'public, max-age=86400'}]}, { source: '/:path*', headers: [
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'Referrer-Policy',value:'no-referrer'},
    {key:'Permissions-Policy',value:'camera=(self), microphone=(), geolocation=(self)'},
    {key:'X-Frame-Options',value:'DENY'},
  ]}]; },
  experimental: { turbopack: false },
};
export default config;
