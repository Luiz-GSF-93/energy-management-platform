import {EventEmitter} from 'node:events';
import {request} from 'node:https';
import {cceeRead} from './ccee-transport';
jest.mock('node:https',()=>({request:jest.fn()}));
const config={organizationId:'org',profile:'123',username:'1234',password:'never-log-me',pfx:Buffer.alloc(600),passphrase:'never-log-me-either'};
describe('CCEE HTTPS boundary',()=>{
 let req:EventEmitter & {end:jest.Mock;destroy:jest.Mock};let response:EventEmitter & {statusCode:number;headers:Record<string,string>;destroy:jest.Mock};let callback:(res:any)=>void;
 beforeEach(()=>{jest.useFakeTimers();req=Object.assign(new EventEmitter(),{end:jest.fn(),destroy:jest.fn()});response=Object.assign(new EventEmitter(),{statusCode:200,headers:{'content-type':'text/xml'},destroy:jest.fn()});(request as jest.Mock).mockImplementation((_options,cb)=>{callback=cb;return req;});});
 afterEach(()=>{jest.useRealTimers();jest.clearAllMocks();});
 it('uses a fixed host and TLS1.2, verifies certificates and sends passwords only in the body',async()=>{const pending=cceeRead(config,'profile');const options=(request as jest.Mock).mock.calls[0][0];expect(options).toMatchObject({hostname:'servicos.ccee.org.br',port:443,method:'POST',rejectUnauthorized:true,minVersion:'TLSv1.2',maxVersion:'TLSv1.2'});expect(JSON.stringify(options.headers)).not.toContain(config.password);callback(response);response.emit('data',Buffer.from('<xml/>'));response.emit('end');await expect(pending).resolves.toBe('<xml/>');});
 it('never follows redirects or retries requests',async()=>{const pending=cceeRead(config,'pld',1,'2026-08');response.statusCode=302;callback(response);await expect(pending).rejects.toThrow('CCEE_PROVIDER_REJECTED');expect(request).toHaveBeenCalledTimes(1);});
 it('bounds wall time even without a socket response',async()=>{const pending=cceeRead(config,'profile');jest.advanceTimersByTime(25000);await expect(pending).rejects.toThrow('CCEE_TIMEOUT');expect(req.destroy).toHaveBeenCalled();});
 it('does not leak provider transport exceptions',async()=>{const pending=cceeRead(config,'profile');req.emit('error',new Error('never-log-me'));await expect(pending).rejects.toThrow('CCEE_TRANSPORT_ERROR');});
 it('rejects oversized or truncated responses',async()=>{const pending=cceeRead(config,'profile');callback(response);response.emit('data',Buffer.alloc(2*1024*1024+1));await expect(pending).rejects.toThrow('CCEE_RESPONSE_LIMIT');expect(response.destroy).toHaveBeenCalled();});
});
