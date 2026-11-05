import {CorsOptionsDelegate} from '@nestjs/common/interfaces/external/cors-options.interface';
export const salesCors:CorsOptionsDelegate<any>=(req,callback)=>{
 const sales=/^\/api\/v1\/public\/sales\/(leads|journey\/(state|recommend|challenge|verify|accept))$/.test(req.url.split('?')[0]);
 callback(null,sales?{origin:process.env.SALES_INTAKE_ORIGIN||'https://www.expertenergy.com.br',credentials:false,methods:['POST','OPTIONS'],allowedHeaders:['Content-Type','X-Sales-Access'],maxAge:600}:{origin:process.env.CORS_ORIGIN||'http://localhost:3000',credentials:true});
};
