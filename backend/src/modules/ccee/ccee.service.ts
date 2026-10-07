import {BadRequestException,ConflictException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {cceeConfig} from './ccee-config';
import {cceeRead} from './ccee-transport';
import {monthlyPld,parseCcee,pldHours,profilePresent,PldHour} from './ccee-response';

@Injectable()
export class CceeService {
  private running=false;
  status(){
    try{const config=cceeConfig(process.env);config.pfx.fill(0);return {configured:true,enabled:true,mode:'READ_ONLY',automaticImport:false,diagnostic:'READY'};}
    catch(error){
      const enabled=process.env.CCEE_READ_ENABLED==='true';
      const code=error instanceof Error?error.message:'';
      const diagnostic=!enabled?'DISABLED':code==='CCEE_NOT_CONFIGURED'?'MISSING_VARIABLE':code==='CCEE_INVALID_CONFIG'?'INVALID_FORMAT':code==='CCEE_INVALID_CERTIFICATE'?'PFX_OPEN_FAILED':'CONFIGURATION_FAILED';
      return {configured:false,enabled,mode:'READ_ONLY',automaticImport:false,diagnostic};
    }
  }
  private async run<T>(operation:(config:ReturnType<typeof cceeConfig>)=>Promise<T>):Promise<T>{
    if(this.running)throw new ConflictException('Uma consulta CCEE já está em andamento.');
    let config:ReturnType<typeof cceeConfig>;
    try{config=cceeConfig(process.env);}catch{throw new ServiceUnavailableException('Configure as credenciais e o certificado CCEE no backend.');}
    this.running=true;
    try{return await operation(config);}catch{throw new ServiceUnavailableException('Consulta CCEE não confirmada. Nenhum dado foi importado.');}finally{config.pfx.fill(0);this.running=false;}
  }
  async probe(){return this.run(async config=>{
    const response=parseCcee(await cceeRead(config,'profile'),'profile',1);
    if(!profilePresent(response.body,config.profile))throw new Error('CCEE_PROFILE_NOT_CONFIRMED');
    return {authenticated:true,organizationId:config.organizationId,profileConfirmed:true,checkedAt:new Date().toISOString(),imported:false};
  });}
  async preview(input:unknown){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!('month' in input)||typeof input.month!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(input.month)||input.month<'2021-01'||input.month>=new Date().toISOString().slice(0,7))throw new BadRequestException('Informe um mês encerrado a partir de janeiro de 2021.');
    const month=input.month;
    return this.run(async config=>{
      const proof=parseCcee(await cceeRead(config,'profile'),'profile',1);
      if(!profilePresent(proof.body,config.profile))throw new Error('CCEE_PROFILE_NOT_CONFIRMED');
      const rows:PldHour[]=[],hashes:string[]=[];let pages=1,total=-1;
      const deadline=Date.now()+90000;
      for(let page=1;page<=pages;page++){
        if(Date.now()>deadline)throw new Error('CCEE_TIMEOUT');
        const response=parseCcee(await cceeRead(config,'pld',page,month),'pld',page);
        if(page>1&&(response.pages!==pages||response.total!==total))throw new Error('CCEE_CHANGED_PAGINATION');
        pages=response.pages;total=response.total;
        rows.push(...pldHours(response.body,month));hashes.push(response.hash);
      }
      if(rows.length!==total*4)throw new Error('CCEE_INCOMPLETE_MONTH');
      return {organizationId:config.organizationId,state:'DRAFT',provider:'CCEE',source:'https://servicos.ccee.org.br/ws/prec/PLDBSv1',method:'HOURLY_ARITHMETIC_MEAN',taxesIncluded:false,months:monthlyPld(rows,month),sourceHashes:hashes,imported:false};
    });
  }
}
