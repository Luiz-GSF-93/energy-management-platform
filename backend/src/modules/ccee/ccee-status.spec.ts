import * as configuration from './ccee-config';
import {CceeService} from './ccee.service';

describe('CCEE safe configuration diagnostics',()=>{
  const originalFlag=process.env.CCEE_READ_ENABLED;
  afterEach(()=>{jest.restoreAllMocks();if(originalFlag===undefined)delete process.env.CCEE_READ_ENABLED;else process.env.CCEE_READ_ENABLED=originalFlag;});
  it.each([
    ['CCEE_NOT_CONFIGURED','MISSING_VARIABLE'],
    ['CCEE_INVALID_CONFIG','INVALID_FORMAT'],
    ['CCEE_INVALID_CERTIFICATE','PFX_OPEN_FAILED'],
    ['provider error containing a private password','CONFIGURATION_FAILED'],
  ])('does not return raw configuration errors (%s)',(error,diagnostic)=>{
    process.env.CCEE_READ_ENABLED='true';
    jest.spyOn(configuration,'cceeConfig').mockImplementation(()=>{throw new Error(error);});
    const status=new CceeService().status();
    expect(status).toMatchObject({configured:false,enabled:true,automaticImport:false,diagnostic});
    expect(JSON.stringify(status)).not.toContain(error);
  });
  it('does not claim a password was tested while disabled',()=>{
    process.env.CCEE_READ_ENABLED='false';
    expect(new CceeService().status()).toMatchObject({configured:false,diagnostic:'DISABLED'});
  });
  it('reports ready only after successful PFX opening and clears its buffer',()=>{
    const pfx=Buffer.from('private material');
    jest.spyOn(configuration,'cceeConfig').mockReturnValue({organizationId:'test',profile:'1',username:'1',password:'secret',pfx,passphrase:'secret'});
    const status=new CceeService().status();
    expect(status).toMatchObject({configured:true,diagnostic:'READY',automaticImport:false});
    expect(pfx.every(byte=>byte===0)).toBe(true);
    expect(JSON.stringify(status)).not.toContain('secret');
  });
});
