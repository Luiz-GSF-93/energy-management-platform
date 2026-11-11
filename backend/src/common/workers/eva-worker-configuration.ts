/** Intake completion depends on the same financial preparation as the API.
 * Fail before claiming jobs when the processing deployment lost that setting. */
export function assertEvaWorkerConfiguration(env:Record<string,string|undefined>){
 if(env.EVA_AUTOMATIC_INTAKE_ENABLED==='true'&&env.CALCULATION_AUTOFILL_ENABLED!=='true')throw Error('EVA_WORKER_REQUIRES_CALCULATION_AUTOFILL_ENABLED');
}
