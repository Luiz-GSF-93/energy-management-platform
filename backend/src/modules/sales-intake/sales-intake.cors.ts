import {CorsOptionsDelegate} from '@nestjs/common/interfaces/external/cors-options.interface';
export const salesCors:CorsOptionsDelegate<any>=(req,callback)=>{
 const sales=req.url.split('?')[0]==='/api/v1/public/sales/leads';
 callback(null,sales?{origin:process.env.SALES_INTAKE_ORIGIN||'https://www.expertenergy.com.br',credentials:false,methods:['POST','OPTIONS'],allowedHeaders:['Content-Type'],maxAge:600}:{origin:process.env.CORS_ORIGIN||'http://localhost:3000',credentials:true});
};
