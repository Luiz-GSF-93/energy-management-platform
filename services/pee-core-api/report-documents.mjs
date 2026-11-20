import {documentControl,economicFormulae}from'./document-control.mjs';
import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {readFile} from 'node:fs/promises';
import {renderReport,reportTypes} from './reports.mjs';
import {assessProject} from './evaluation.mjs';
import {resourceSummary} from './project-detail.mjs';
import {createProjectZip} from './zip.mjs';

const text=s=>String(s??'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|apos|#39);/g,(_,k)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#39':"'"}[k])).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).trim();
export function reportBlocks(html){
 const content=html.replace(/<(style|header)\b[^>]*>[\s\S]*?<\/\1>/gi,'');const blocks=[];
 for(const m of content.matchAll(/<(h[1-3]|p|li|table)\b[^>]*>([\s\S]*?)<\/\1>/gi)){
  if(m[1]!=='table'){if(text(m[2]))blocks.push({heading:m[1][0]==='h',text:text(m[2])});continue;}
  const rows=[...m[2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(r=>[...r[1].matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(c=>({header:c[1]==='th',value:text(c[2])})));
  const headers=rows[0]?.every(c=>c.header)?rows.shift().map(c=>c.value):null;
  for(const row of rows)blocks.push({text:headers?row.map((c,i)=>headers[i]+': '+(c.value||'—')).join('\n'):row.map(c=>c.value||'—').join(': '),table:true});
 }
 return blocks;
}
export async function renderProjectPdf(data,type='final'){
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);pdf.setCreator('EnergyOS – PEE · Expert Energy');pdf.setTitle(reportTypes[type]+' · '+data.project.name);const created=new Date(data.emitted_at??data.project.updated_at);if(!Number.isFinite(created.getTime()))throw Error('REPORT_DATE_INVALID');pdf.setCreationDate(created);pdf.setModificationDate(created);
 const [regular,strong,icon]=await Promise.all(['font-0569c822cab6.ttf','font-0dfc29fde7d9.ttf','favicon.png'].map(n=>readFile(new URL('web/'+n,import.meta.url))));
 const body=await pdf.embedFont(regular,{subset:true}),heading=await pdf.embedFont(strong,{subset:true}),logo=await pdf.embedPng(icon);let page,y=0;
 const ink=rgb(.09,.2,.17),muted=rgb(.38,.46,.44),width=493;
 function next(){page=pdf.addPage([595.28,841.89]);page.drawRectangle({x:40,y:736,width:515.28,height:66,color:rgb(.043,.067,.09)});page.drawImage(logo,{x:54,y:748,width:40,height:40});page.drawText('Energy',{x:108,y:768,size:23,font:heading,color:rgb(.93,.95,.96)});page.drawText('OS',{x:108+heading.widthOfTextAtSize('Energy',23),y:768,size:23,font:heading,color:rgb(.62,.85,.62)});page.drawText('P E E   E X P E R T   E N E R G Y',{x:109,y:751,size:6.8,font:body,color:rgb(.64,.72,.77)});page.drawRectangle({x:40,y:732,width:515,height:3,color:rgb(.72,.91,.53)});y=709;}
 function wrap(raw,font,size){const rows=[];for(const p of String(raw).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').split(/\r?\n/)){let row='';for(const word of p.split(/\s+/)){if(!word)continue;if(row&&font.widthOfTextAtSize(row+' '+word,size)>width){rows.push(row);row='';}if(font.widthOfTextAtSize(word,size)>width){for(const c of word){if(row&&font.widthOfTextAtSize(row+c,size)>width){rows.push(row);row='';}row+=c;}}else row+=(row?' ':'')+word;}rows.push(row);}return rows;}
 next();const blocks=reportBlocks(renderReport(data,type));
 for(const [i,b] of blocks.entries()){
  if(type==='final'&&b.heading&&['Glossário e identificação da plataforma','Conferência antes da apresentação'].includes(b.text))next();
  const font=b.heading?heading:body,size=b.heading?13:9.4,rows=wrap(b.text,font,size),line=b.heading?18:14.2;
  const needed=rows.length*line+8+(b.heading&&blocks[i+1]?Math.min(3,wrap(blocks[i+1].text,body,9.4).length)*14.2:0);
  if(needed<640&&y-needed<62)next();
  for(const row of rows){if(y<62)next();page.drawText(row,{x:51,y,font,size,color:b.heading?ink:b.table?muted:ink});y-=line;}y-=b.heading?8:9;
 }
 const control=documentControl(data);
 for(const[i,p]of pdf.getPages().entries()){
  p.drawLine({start:{x:40,y:44},end:{x:555,y:44},thickness:.5,color:rgb(.82,.87,.83)});
  p.drawText('by EnergyOS PEE · '+control.label,{x:42,y:32,size:6.6,font:body,color:muted});
  p.drawText('Snapshot: '+control.snapshot_sha256,{x:42,y:21,size:6.2,font:body,color:muted});
  p.drawText(`${i+1} / ${pdf.getPageCount()}`,{x:513,y:32,size:8,font:body,color:muted});
 }

 return Buffer.from(await pdf.save());
}

const xml=s=>String(s??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const column=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
export function projectWorkbookSheets(data){
 const p=data.project,a=assessProject(data),m=a.economy??{},r=resourceSummary(p.resources??[]);
 return [
  ['Projeto',[['Campo','Valor'],['Plataforma','EnergyOS – PEE · Expert Energy'],['Projeto',p.name],['Organização',data.workspace],['Responsável pela emissão',data.actor],['Beneficiário',data.company?.name],['CNPJ',data.company?.cnpj],['Unidade',data.unit?.name],['UC',data.unit?.uc],['Distribuidora',p.distributor],['Chamada',p.call_name],['Fonte do edital',p.call_url],['Versão',p.version],['Emissão',data.emission_reference??'Cópia de consulta'],['Situação','Planilha de conferência. Não substitui formulário oficial nem protocolo.'],['Probabilidade de aprovação','Não calculada: depende da banca e concorrência.']]],
  ['Medidas',[['Sigla','Medida','Fabricante','Modelo','Selecionada','MWh/ano','kW evitados','Investimento R$','Vida útil anos','Memória','Observações'],...data.simulations.filter(x=>x.project_id===p.id).map(x=>[x.type,x.name,x.maker,x.model,x.selected?'Sim':'Não',x.result?.energy,x.result?.demand,x.cost,x.life,x.result?.formula,x.result?.warning])]],
  ['Orçamento',[['Item','Categoria','Qtd','Unidade','Preço unitário R$','Total R$','PEE R$','Contrapartida R$','Outras fontes R$','Vida útil anos','O&M anual R$','O&M PEE anual R$','Cláusula','Orçamento fonte'],...(p.resources??[]).map(x=>[x.name,x.category,x.quantity,x.unit,x.unit_cents/100,x.total_cents/100,x.pee_cents/100,x.own_cents/100,x.other_cents/100,x.life,(x.annual_om_cents??0)/100,(x.annual_om_pee_cents??0)/100,x.eligibility_clause,x.quotation])]],
  ['RCB',[['Indicador','Valor'],['Economia MWh/ano',m.energy_mwh],['Demanda evitada kW',m.demand_kw],['Investimento R$',m.investment],['Custo anualizado R$/ano',m.annual_cost],['Benefício anual R$/ano',m.annual_benefit],['RCB total',m.rcb_total??m.rcb],['RCB PEE',m.rcb_pee],['Recursos PEE R$',r.pee_cents/100],['Contrapartida R$',r.own_cents/100],['Outras fontes R$',r.other_cents/100],['Base de custos do edital',data.rule?.rcb_basis],['Observação',m.warning],['Origem','Mesmo motor de cálculo do projeto. Valores numéricos; não são fórmulas editáveis.']]],
  ['Cronograma',[['Campo','Dados do marco'],...(p.schedule??[]).flatMap((x,i)=>Object.entries(x).map(([k,v])=>[String(i+1)+' · '+k,typeof v==='object'?JSON.stringify(v):v]))]],
  ['Medição e verificação',[['Campo','Preenchimento'],...Object.entries(p.mv_plan??{}).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):v])]],
  ['Checklist',[['Nível de qualificação',a.qualification?.level],['Preenchimento %',a.qualification?.readiness_percent],['Conferências atendidas %',a.qualification?.verified_percent],['Impedimentos',a.qualification?.blockers],['Pendência','Revisar antes de apresentar'],...a.issues.map(x=>[x,'Pendente'])]],
  ['Anexos',[['Arquivo','Categoria','SHA-256','Método assinatura','Conferência','Versão','Medida vinculada'],...data.documents.filter(x=>x.project_id===p.id).map(x=>[x.name,x.category,x.sha256,x.signature_method,x.signature_review,x.version,x.simulation_id])]],
  ['Fórmulas',[['Indicador','Fórmula aplicada','Unidades e premissas'],...economicFormulae]],
  ['Memorial',[['Seção','Conteúdo'],...Object.entries(p.sections??{}).map(([k,v])=>[k,v])]]
 ];
}
export function renderProjectWorkbook(data){
 const sheets=projectWorkbookSheets(data),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const entries=[{name:'[Content_Types].xml',bytes:Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)},
 {name:'_rels/.rels',bytes:Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')},
 {name:'xl/workbook.xml',bytes:Buffer.from(`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([n],i)=>`<sheet name="${xml(n)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="0"/></workbook>`)},
 {name:'xl/_rels/workbook.xml.rels',bytes:Buffer.from(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)},
 {name:'xl/styles.xml',bytes:Buffer.from(`<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/><color rgb="FF183E2D"/></font><font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173C35"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)}];
 for(const[i,[name,rows]]of sheets.entries()){
  const count=Math.max(...rows.map(x=>x.length));const cells=rows.map((row,r)=>`<row r="${r+1}"${r===0?' ht="30" customHeight="1"':''}>${row.map((v,c)=>{const ref=column(c)+(r+1),style=r===0?1:0;return typeof v==='number'&&Number.isFinite(v)?`<c r="${ref}" s="${style}"><v>${v}</v></c>`:`<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(v==null?'Pendente':v)}</t></is></c>`;}).join('')}</row>`).join('');
  entries.push({name:`xl/worksheets/sheet${i+1}.xml`,bytes:Buffer.from(`<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="${Math.max(2,count)}" width="30" customWidth="1"/></cols><sheetData>${cells}</sheetData><autoFilter ref="A1:${column(count-1)}${rows.length}"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`)});
 }
 return createProjectZip(entries);
}
