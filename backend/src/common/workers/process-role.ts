/** Scheduling placement only. Never replaces job-level tenant, license or lease checks. */
export function processRole(){
 const role=process.env.ENERGYOS_PROCESS_ROLE??'COMBINED';
 if(!['COMBINED','API','EVA_WORKER'].includes(role))throw Error('Invalid ENERGYOS_PROCESS_ROLE');
 return role;
}
export function scheduledWorkEnabled(group:'EVA'|'API'){
 const role=processRole();return role==='COMBINED'||(group==='EVA'?role==='EVA_WORKER':role==='API');
}
