import{isIP}from'node:net';
// Railway's public ingress supplies X-Real-IP. Do not trust arbitrary forwarded lists.
export function networkAddress(req,env=process.env){const remote=req.socket?.remoteAddress??null,value=req.headers?.['x-real-ip'];return env.RAILWAY_ENVIRONMENT_ID&&typeof value==='string'&&isIP(value)?value:remote;}
