/** IOF is conditional: a configured operation or explicit embedded tax requires its treatment. */
export function requiredEnergyTaxes(rows:any[]){return ['ICMS','PIS','COFINS',...(rows.some(p=>(p.kind==='TAX'&&p.component_code==='IOF')||(Array.isArray(p.embedded_tax_codes)&&p.embedded_tax_codes.includes('IOF')))?['IOF']:[])];}
