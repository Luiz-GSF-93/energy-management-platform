import {randomUUID} from 'crypto';
import {Injectable,NestMiddleware} from '@nestjs/common';
import {Response,NextFunction} from 'express';
import {RequestWithTenant} from '../../common/interfaces/tenant-context.interface';
import {AuditWorkspaceService} from './audit.service';
@Injectable()
export class AuditCaptureMiddleware implements NestMiddleware{
 constructor(private readonly audit:AuditWorkspaceService){}
 use(req:RequestWithTenant,res:Response,next:NextFunction){const start=Date.now();(req as any).auditCorrelation=randomUUID();res.setHeader('X-Audit-Reference',(req as any).auditCorrelation);res.once('finish',()=>{void this.audit.capture(req,res.statusCode,Date.now()-start);});next();}
}
