import {Injectable,NestMiddleware} from '@nestjs/common';
import {Request,Response,NextFunction} from 'express';
import {PlatformCostsWorker} from './platform-costs.worker';
@Injectable()
export class PerformanceMiddleware implements NestMiddleware {
 constructor(private metrics:PlatformCostsWorker){}
 use(_req:Request,res:Response,next:NextFunction){const started=process.hrtime.bigint();res.once('finish',()=>this.metrics.observe(Number(process.hrtime.bigint()-started)/1e6,res.statusCode));next();}
}
