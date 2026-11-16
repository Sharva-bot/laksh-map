// Fetch the openly licensed PMGSY rural facilities CSVs (GODL-India).
// Source: https://github.com/pratapvardhan/rural-facilities-pmgsy
// Files land in data/raw/ (gitignored) and are only inputs to the local builders.
import {mkdirSync,writeFileSync,existsSync,statSync} from 'node:fs';
import path from 'node:path';

const base='https://raw.githubusercontent.com/pratapvardhan/rural-facilities-pmgsy/master/';
const states=['andhra_pradesh','arunachal_pradesh','assam','bihar','chhattisgarh','gujarat','haryana','himachal_pradesh','jammu_and_kashmir','jharkhand','karnataka','kerala','ladakh','madhya_pradesh','maharashtra','manipur','meghalaya','mizoram','nagaland','odisha','pondicherry','punjab','rajasthan','sikkim','tamilnadu','telangana','tripura','uttar_pradesh','uttarakhand','west_bengal'];
const dir=path.join(process.cwd(),'data/raw/pmgsy');
mkdirSync(dir,{recursive:true});
let done=0,failed=[];
const queue=[...states];
async function worker(){
 while(queue.length){
  const state=queue.shift();
  const file=path.join(dir,state+'.csv');
  if(existsSync(file)&&statSync(file).size>1000){done++;continue;}
  try{
   const response=await fetch(base+`pmgsy_facilities_${state}.csv`);
   if(!response.ok)throw new Error(`HTTP ${response.status}`);
   writeFileSync(file,Buffer.from(await response.arrayBuffer()));
   done++;
  }catch(error){failed.push(state+': '+error.message);}
 }
}
await Promise.all(Array.from({length:4},worker));
console.log(`PMGSY facility files ready: ${done}/${states.length}`);
if(failed.length){console.error('Failed:\n'+failed.join('\n'));process.exitCode=1;}
