import {ForbiddenException} from '@nestjs/common';
// Null preserves legacy role inheritance. An empty list intentionally grants nothing.
export function memberPermissions(role:unknown,limit:unknown):string[]{
 if(!Array.isArray(role)||role.some(p=>typeof p!=='string'))throw new ForbiddenException('Permissões da função indisponíveis.');
 if(limit==null)return [...new Set(role)];
 if(!Array.isArray(limit)||limit.some(p=>typeof p!=='string'))throw new ForbiddenException('Permissões individuais indisponíveis.');
 return [...new Set(role.filter(p=>limit.includes(p)))];
}
