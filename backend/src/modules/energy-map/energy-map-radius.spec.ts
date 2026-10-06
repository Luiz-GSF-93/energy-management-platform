import {mapQuery,mapRadius} from './energy-map.validation';
import {platformMapQuery} from './platform-energy-map.service';
describe('map radius query boundaries',()=>{
 const valid={radiusLatitude:'-21.1775',radiusLongitude:'-47.8103',radiusKm:'50'};
 it('normalizes a complete bounded radius consistently for org and platform queries',()=>{expect(mapQuery(valid)).toMatchObject({radiusLatitude:-21.1775,radiusLongitude:-47.8103,radiusKm:50});expect(platformMapQuery(valid)).toMatchObject({radiusKm:50});expect(mapRadius({})).toEqual({radiusLatitude:null,radiusLongitude:null,radiusKm:null});});
 it.each([{radiusKm:'50'},{...valid,radiusLatitude:'91'},{...valid,radiusLongitude:'181'},{...valid,radiusKm:'0'},{...valid,radiusKm:'501'},{...valid,radiusKm:'Infinity'},{...valid,radiusKm:'1e2'},{...valid,radiusLatitude:'NaN'},{...valid,radiusLatitude:1},{...valid,radiusKm:'1;DROP TABLE'},{...valid,radiusLongitude:''}])('rejects partial, unsafe or out-of-bounds radius %j',q=>{expect(()=>mapQuery(q)).toThrow();expect(()=>platformMapQuery(q)).toThrow();});
 it('does not add tenant or global override fields to organization queries',()=>{expect(()=>mapQuery({...valid,organizationId:'foreign'})).toThrow();expect(()=>platformMapQuery({...valid,actor:'foreign'})).toThrow();});
});
