import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import {boundedRestReads} from '../common/services/read-deadline';
import {portalRequestScope,scopedPortalClient} from '../common/services/portal-customer-context';

@Injectable()
export class SupabaseService {
  private supabase: any;
  private readinessFlight?:Promise<{database:boolean;auth:boolean;checkedAt:string}>;
  private readinessCache?:{database:boolean;auth:boolean;checkedAt:string;expires:number};

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration unavailable');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey,{global:{fetch:boundedRestReads()}});
  }

  getClient() {
    const scope=portalRequestScope.getStore();
    return scope?scopedPortalClient(this.supabase,scope):this.supabase;
  }

  async readiness(){
    if(this.readinessCache&&this.readinessCache.expires>Date.now()){const {expires,...result}=this.readinessCache;return result;}
    if(this.readinessFlight)return this.readinessFlight;
    this.readinessFlight=(async()=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
      try{
        const [database,auth]=await Promise.all([
          (async()=>{try{const r=await this.supabase.rpc('energyos_dependency_health',{}).abortSignal(controller.signal);return !r.error&&r.data?.database===true;}catch{return false;}})(),
          (async()=>{try{const base=this.configService.get<string>('SUPABASE_URL')!.replace(/\/+$/,''),key=this.configService.get<string>('SUPABASE_SERVICE_KEY')!;const r=await fetch(base+'/auth/v1/health',{headers:{apikey:key,Authorization:'Bearer '+key},signal:controller.signal});await r.body?.cancel();return r.ok;}catch{return false;}})(),
        ]);
        const result={database,auth,checkedAt:new Date().toISOString()};this.readinessCache={...result,expires:Date.now()+(database&&auth?10000:3000)};return result;
      }finally{clearTimeout(timer);}
    })();
    try{return await this.readinessFlight;}finally{this.readinessFlight=undefined;}
  }

  createAuthClient() {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration unavailable');
    }

    return createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }
}
