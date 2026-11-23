import {closingPreparationCommand} from './closing-preparation-command';
describe('bounded closing preparation acknowledgements',()=>{
 afterEach(()=>jest.useRealTimers());
 it('aborts a hung receipt once, never repeats or approves',async()=>{jest.useFakeTimers();let signal:AbortSignal|undefined;const rpc=jest.fn(()=>({abortSignal:(s:AbortSignal)=>{signal=s;return new Promise(()=>{});}}));const waiting=closingPreparationCommand({rpc},'eva_scoped_closing_action',{p_action:'reserve'},50);const result=expect(waiting).rejects.toMatchObject({response:{code:'EVA_CLOSING_COMMAND_UNCONFIRMED',stage:'reserve'}});await jest.advanceTimersByTimeAsync(51);await result;expect(signal?.aborted).toBe(true);expect(rpc).toHaveBeenCalledTimes(1);});
 it('returns a confirmed result and releases the timeout',async()=>{const response={data:{created:true}},rpc=jest.fn(async()=>response);expect(await closingPreparationCommand({rpc},'ensure_management_fee_default',{})).toBe(response);expect(rpc).toHaveBeenCalledTimes(1);});
 it.each(['decide','capture','history'])('cannot wrap financial decisions or unrelated reads: %s',async action=>{const rpc=jest.fn();await expect(closingPreparationCommand({rpc},'eva_scoped_closing_action',{p_action:action})).rejects.toThrow('NOT_ALLOWLISTED');expect(rpc).not.toHaveBeenCalled();});
});
