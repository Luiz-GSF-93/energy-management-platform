// Executes only in the isolated verifier container. Credentials never appear in CLI/stdout.
async function main(){
 const u=new URL(process.argv[2]);
 if(!['collector','prometheus','grafana'].includes(u.hostname)||u.protocol!=='http:'||u.username||u.password)throw Error('TEST_DESTINATION');
 let input='';for await(const part of process.stdin){input+=part;if(input.length>65536)throw Error('TEST_INPUT_LIMIT');}
 const headers={'content-type':'application/json'};
 if(process.argv.includes('--auth')){
  if(u.hostname!=='grafana')throw Error('TEST_AUTH_DESTINATION');
  headers.authorization='Basic '+Buffer.from('energyosowner:'+process.env.GRAFANA_ADMIN_PASSWORD).toString('base64');
 }
 const r=await fetch(u,{method:input?'POST':'GET',body:input||undefined,headers,redirect:'error',signal:AbortSignal.timeout(4000)});
 if(!r.ok)throw Error('TEST_HTTP_STATUS');
 const body=await r.text();if(body.length>65536)throw Error('TEST_OUTPUT_LIMIT');
 process.stdout.write(JSON.stringify(body?JSON.parse(body):{}));
}
main().catch(()=>{process.stderr.write('ISOLATED_HTTP_UNAVAILABLE\n');process.exitCode=1;});
