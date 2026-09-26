export function supplierToday(now=new Date()) {return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function lastClosedSupplierMonth(now=new Date()) {const day=supplierToday(now);return new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7))-1,0)).toISOString().slice(0,7);}
