/** Infrastructure failure denies this request without declaring a valid session expired. */
export function transientBackendError(error:any){
 return !!error&&(error.status===429||error.status>=500||['TypeError','AbortError','TimeoutError','AuthRetryableFetchError'].includes(error.name)||['57014','ETIMEDOUT','ECONNRESET','PGRST000','PGRST001','PGRST002','PGRST003'].includes(error.code)||/fetch failed|network|connection.*(?:closed|timeout|reset)|signal is aborted|timed? out/i.test(error.message??''));
}
