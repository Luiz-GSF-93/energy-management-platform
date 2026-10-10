import {Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {SupabaseService} from '../../services/supabase.service';
import {SalesIntakeService} from './sales-intake.service';
import {advisePlan} from './sales-advisor.engine';
@Injectable()
export class SalesAdvisorService{
 constructor(private readonly intake:SalesIntakeService,private readonly db:SupabaseService){}
 async preview(actor:string,receipt:string,page:number,search:string){
  // Existing private RPC checks current Owner before any catalog access.
  const leads=await this.intake.list(actor,page,search);
  const lead=leads.rows?.find((row:any)=>row.receipt===receipt.toLowerCase());
  if(!lead)throw new NotFoundException('Solicitação não encontrada nesta seleção. Atualize a lista.');
  const {data,error}=await this.db.getClient().from('plan_catalog')
   .select('id,name,version,active,max_consumer_units,max_users,document_management,advanced_analytics,report_generation,free_market_management,bot_energy_rag,trading_hub')
   .eq('active',true);
  if(error||!Array.isArray(data))throw new ServiceUnavailableException('Catálogo indisponível. Tente atualizar.');
  try{return {receipt:lead.receipt,evaluatedAt:new Date().toISOString(),...advisePlan(lead.data,data)};}
  catch{throw new ServiceUnavailableException('Perfil ou catálogo incompatível. Solicite revisão.');}
 }
}
