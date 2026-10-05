import {readFile,statfs} from 'node:fs/promises';
import {hostname} from 'node:os';
let previousCpu=process.cpuUsage(),previousAt=process.hrtime.bigint();
export async function runtimeMetrics(){
 const now=process.hrtime.bigint(),cpu=process.cpuUsage(),elapsed=Number(now-previousAt)/1000;
 const cpuPercent=elapsed>0?100*(cpu.user+cpu.system-previousCpu.user-previousCpu.system)/elapsed:null;
 previousCpu=cpu;previousAt=now;
 const memory=process.memoryUsage();let memoryLimitBytes:number|null=null,containerMemoryBytes:number|null=null,networkRxBytes:number|null=null,networkTxBytes:number|null=null,diskTotalBytes:number|null=null,diskUsedBytes:number|null=null;
 try{const n=Number((await readFile('/sys/fs/cgroup/memory.max','utf8')).trim());if(Number.isSafeInteger(n)&&n>0)memoryLimitBytes=n;containerMemoryBytes=Number((await readFile('/sys/fs/cgroup/memory.current','utf8')).trim());}catch{}
 try{const rows=(await readFile('/proc/net/dev','utf8')).split('\n').filter(r=>r.includes(':')&&!r.trim().startsWith('lo:'));networkRxBytes=0;networkTxBytes=0;for(const row of rows){const cells=row.split(':')[1].trim().split(/\s+/).map(Number);networkRxBytes+=cells[0];networkTxBytes+=cells[8];}}catch{}
 try{const f=await statfs('/app');diskTotalBytes=f.blocks*f.bsize;diskUsedBytes=(f.blocks-f.bfree)*f.bsize;}catch{}
 return {instance:hostname(),metrics:{cpuPercent,cpuBasis:'Processo API; 100% corresponde a um núcleo',rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,memoryLimitBytes,containerMemoryBytes,networkRxBytes,networkTxBytes,networkBasis:'Contadores cumulativos da interface; reiniciam com o container',diskTotalBytes,diskUsedBytes,diskBasis:'Filesystem do container; não é tamanho do storage Supabase'}};
}
