import {readFileSync} from 'node:fs';
const icon=readFileSync(new URL('web/energyos-icon.svg',import.meta.url));
export const brandCss=readFileSync(new URL('web/brand.css',import.meta.url),'utf8');
const fonts=readFileSync(new URL('web/fonts.css',import.meta.url),'utf8');
export const embeddedFonts=fonts.replace(/url\(\/assets\/(font-[a-f0-9]{12}\.ttf)\)/g,(_,name)=>'url(data:font/ttf;base64,'+readFileSync(new URL('web/'+name,import.meta.url)).toString('base64')+')');
export function brandMarkup(){return '<span class="official-brand"><img class="energyos-mark" alt="EnergyOS" src="data:image/svg+xml;base64,'+icon.toString('base64')+'"><span class="energyos-wordmark">Energy<span>OS</span><small>PEE EXPERT ENERGY</small></span></span>';}
