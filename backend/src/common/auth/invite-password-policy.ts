import {ForbiddenException} from '@nestjs/common';
export function assertInvitePasswordSetup(user:{app_metadata?:Record<string,unknown>},path:string){
 if(user.app_metadata?.energyos_password_setup_required===true&&path.replace(/^\/api\/v1/,'')!=='/auth/accept-invite')throw new ForbiddenException('Defina sua senha pessoal pelo convite antes de acessar o EnergyOS.');
}
