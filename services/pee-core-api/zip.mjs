import {ProjectError}from'./project-policy.mjs';
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=data=>{let n=0xffffffff;for(const byte of data)n=crcTable[(n^byte)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
export function createProjectZip(entries){
 if(entries.length>1000)throw new ProjectError('Divida o conjunto de documentos em pacotes menores.');
 const names=new Set(),parts=[],directory=[];let offset=0;
 for(const entry of entries){
  if(typeof entry.name!=='string'||entry.name.startsWith('/')||entry.name.split('/').some(p=>!p||p==='.'||p==='..')||entry.name.includes('\\')||/[\x00-\x1f]/.test(entry.name)||names.has(entry.name))throw Error('Invalid package entry');
  names.add(entry.name);const name=Buffer.from(entry.name),bytes=Buffer.from(entry.bytes),crc=crc32(bytes),local=Buffer.alloc(30),central=Buffer.alloc(46);
  if(name.length>1000||bytes.length>65000000||offset+bytes.length>70000000)throw new ProjectError('O pacote excede 60 MB. Organize a apresentação em conjuntos menores.');
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
  parts.push(local,name,bytes);directory.push(central,name);offset+=local.length+name.length+bytes.length;
 }
 const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...parts,central,end]);
}
