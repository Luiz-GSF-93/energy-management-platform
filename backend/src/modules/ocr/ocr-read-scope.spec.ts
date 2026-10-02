import {inspectOnce,ocrReadOnce} from './ocr-read-scope';
describe('inspection read sharing',()=>{
 it('shares only concurrent reads in the same inspection',async()=>{
  const read=jest.fn(async()=>({id:'source'}));
  await inspectOnce(()=>Promise.all([ocrReadOnce('org:doc',read),ocrReadOnce('org:doc',read)]));
  expect(read).toHaveBeenCalledTimes(1);
  await Promise.all([ocrReadOnce('org:doc',read),ocrReadOnce('org:doc',read)]);
  expect(read).toHaveBeenCalledTimes(3);
 });
 it('isolates simultaneous organizations and inspections even with identical keys',async()=>{
  const read=jest.fn(async()=>1);
  await Promise.all([inspectOnce(()=>ocrReadOnce('same',read)),inspectOnce(()=>ocrReadOnce('same',read))]);
  expect(read).toHaveBeenCalledTimes(2);
 });
});
