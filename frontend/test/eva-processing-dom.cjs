// Browser presentation support for the real animated EVA component in DOM tests.
module.exports=()=>{
 require.extensions['.css']=m=>m.exports={};
 Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
 global.IntersectionObserver=class{
  constructor(callback){this.callback=callback;}
  observe(target){this.callback([{target,isIntersecting:true}]);}
  disconnect(){}
 };
};
