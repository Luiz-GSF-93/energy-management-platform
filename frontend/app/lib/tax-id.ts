export function normalizeTaxId(value:string):string{return value.replace(/[./\s-]/g,'').toUpperCase();}
export function validTaxId(value:string):boolean {
 const v=normalizeTaxId(value);if(/^(.)\1+$/.test(v))return false;
 if(/^\d{11}$/.test(v)) {let b=v.slice(0,9);for(let n=10;n<=11;n++){const sum=Array.from(b).reduce((s,c,i)=>s+Number(c)*(n-i),0);b+=String((sum*10%11)%10);}return b===v;}
 if(!/^[A-Z0-9]{12}\d{2}$/.test(v))return false;
 let b=v.slice(0,12);for(let n=0;n<2;n++){let w=2,sum=0;for(let i=b.length-1;i>=0;i--){sum+=(b.charCodeAt(i)-48)*w;w=w===9?2:w+1;}b+=String(sum%11<2?0:11-sum%11);}return b===v;
}
