import { Injectable,Optional,ServiceUnavailableException } from '@nestjs/common';
import {SupabaseService} from './services/supabase.service';

@Injectable()
export class AppService {
  constructor(@Optional() private db?:SupabaseService){}
  async readiness(){
    const state=await this.db?.readiness();
    const result={status:state?.database&&state.auth?'ready':'degraded',dependencies:{database:state?.database?'up':'down',auth:state?.auth?'up':'down'},checkedAt:state?.checkedAt??new Date().toISOString()};
    if(result.status!=='ready')throw new ServiceUnavailableException(result);return result;
  }
  getHello(): string {
    return '⚡ Energy Management Platform Backend API v1.0.0';
  }
}
