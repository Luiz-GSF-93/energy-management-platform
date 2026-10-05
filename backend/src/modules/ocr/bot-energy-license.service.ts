import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';

// No cache: suspension, expiry and quota changes take effect before the next call.
@Injectable()
export class BotEnergyLicenseService {
 constructor(private db:SupabaseService){}
 async available(org:string){
  if(!org)return false;
  const {data,error}=await this.db.getClient().rpc('bot_energy_license_quota',{p_organization:org});
  if(error)throw new ServiceUnavailableException('Licença da IA indisponível.');
  return Number.isSafeInteger(Number(data))&&Number(data)>0;
 }
}
