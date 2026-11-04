import {CallHandler,ExecutionContext,Injectable,NestInterceptor} from '@nestjs/common';
import {finalize} from 'rxjs/operators';
/** Bound the aggregate multipart stream before Multer buffers any individual file. */
@Injectable()
export class TradingUploadLimit implements NestInterceptor{
 intercept(context:ExecutionContext,next:CallHandler){const req=context.switchToHttp().getRequest();let bytes=0;const count=(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>20971520+262144)req.destroy();};req.on('data',count);return next.handle().pipe(finalize(()=>req.off('data',count)));}
}
