// Deliberately separate process: no application imports, credentials or formula evaluation.
import * as XLSX from 'xlsx';
export function workbookGrid(bytes:Buffer){
 if(bytes.length<8||bytes.length>5242880)throw new Error('CALENDAR_FILE_LIMIT');
 const book=XLSX.read(bytes,{type:'buffer',cellDates:false,cellFormula:true,bookVBA:false,sheetRows:10001});
 if(book.Workbook?.WBProps?.date1904)throw new Error('CALENDAR_DATE_SYSTEM_NOT_SUPPORTED');
 if(book.SheetNames.length>24)throw new Error('CALENDAR_SHEET_LIMIT');
 const result=book.SheetNames.map(name=>{
  const sheet=book.Sheets[name],range=XLSX.utils.decode_range(sheet['!fullref']??sheet['!ref']??'A1');
  if(range.e.r>9999||range.e.c>99)throw new Error('CALENDAR_CELL_LIMIT');
  const rows=XLSX.utils.sheet_to_json<any[]>(sheet,{header:1,raw:true,defval:null,blankrows:true});
  return{name,rows};
 });
 if(Buffer.byteLength(JSON.stringify(result))>2097152)throw new Error('CALENDAR_OUTPUT_LIMIT');return result;
}
if(require.main===module)process.once('message',(value:any)=>{
 try{if(typeof value?.base64!=='string'||value.base64.length>6990520)throw new Error('LIMIT');const grid=workbookGrid(Buffer.from(value.base64,'base64'));process.send?.({grid},()=>process.exit(0));}
 catch{process.send?.({error:'CALENDAR_PARSE_REQUIRES_REVIEW'},()=>process.exit(1));}
});
