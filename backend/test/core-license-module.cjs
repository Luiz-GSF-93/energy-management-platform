// Run after: tsc --outDir tmp/core-license-smoke --incremental false
// Native Node validates the real ESM JWT dependency instead of Jest's CJS VM.
require('reflect-metadata');
const deadline=setTimeout(()=>{console.error('MODULE_SMOKE_TIMEOUT');process.exit(1);},20000);deadline.unref();
const assert=require('node:assert/strict');
const {Module}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core'),{ConfigModule}=require('@nestjs/config');
const {CoreLicenseModule}=require('../tmp/core-license-smoke/modules/core-licensing/core-license.module.js');
const {CoreWelcomeService}=require('../tmp/core-license-smoke/modules/core-licensing/core-welcome.service.js');
class Bootstrap{}
Module({imports:[ConfigModule.forRoot({isGlobal:true,ignoreEnvFile:true,load:[()=>({SUPABASE_URL:'http://127.0.0.1:9',SUPABASE_SERVICE_KEY:'synthetic-service-key',SUPABASE_ANON_KEY:'synthetic-anon-key',JWT_SECRET:'synthetic-jwt-secret-for-isolated-module-test',SALES_CORE_LICENSES_ENABLED:'false'})]}),CoreLicenseModule]})(Bootstrap);
(async()=>{let network=0;const previous=global.fetch;global.fetch=async()=>{network++;throw Error('Network forbidden in startup smoke');};let app;try{app=await NestFactory.createApplicationContext(Bootstrap,{logger:['error','warn'],abortOnError:false});assert.ok(app.get(CoreWelcomeService));assert.equal(network,0);console.log('PASS Core licensing module starts with real Admin/Auth/JWT dependencies, without external calls');}finally{await app?.close();global.fetch=previous;clearTimeout(deadline);}})().catch(e=>{console.error('MODULE_SMOKE_FAILED',e.message);process.exitCode=1;});
