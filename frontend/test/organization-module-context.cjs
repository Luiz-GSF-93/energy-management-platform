/* Regression for legacy organization sessions. Isolated rendering, no network or writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
let context,permissions=true,checks=0;
const pass=({children})=>React.createElement(React.Fragment,null,children);
const marker=props=>React.createElement('span',{'data-org':props.organizationId},'AUTHORIZED ORGANIZATION');
function load(file){
 const input=ts.createSourceFile(file,fs.readFileSync(path.join(__dirname,'../app/backoffice',file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const transformed=ts.transform(input,[()=>node=>ts.factory.updateSourceFile(node,node.statements.filter(s=>!ts.isImportDeclaration(s)).map(s=>ts.isFunctionDeclaration(s)&&['EnergyMap','Hub'].includes(s.name?.text)?ts.createSourceFile('stub.tsx','function '+s.name.text+'(){return marker({organizationId:context.currentOrganization.id});}',ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX).statements[0]:s))]);
 const source=ts.createPrinter().printFile(transformed.transformed[0]);transformed.dispose();
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};const sandbox={exports,require,context,marker,dynamic:()=>marker,styles:{},...React,useAuth:()=>({context,hasPermission:()=>permissions}),ProtectedRoute:pass,BackofficeShell:pass,PlatformEnergyMap:()=>React.createElement('span',null,'PLATFORM MAP'),Button:pass,Card:pass,Alert:pass,Input:pass,LicenseFromPlan:pass,PortalLicenseManagement:p=>React.createElement('span',{'data-manage':String(p.manageCustomers),'data-platform':String(p.platform)},'PORTAL MANAGEMENT'),apiRequest:()=>{throw new Error('Network forbidden in rendering regression');}};
 vm.runInNewContext(code,sandbox,{filename:file});return exports.default;
}
function render(file){return renderToStaticMarkup(React.createElement(load(file)));}
function check(value,label){assert.ok(value,label);checks++;}
for(const scope of [undefined,'organization']){
 for(const role of ['admin_org','gestor']){
  context={...(scope?{scope}:{}),user:{id:'member'},currentOrganization:{id:'authorized-org',role,permissions:[]}};
  for(const file of ['energy-map/page.tsx','trading-hub/page.tsx'])check(render(file).includes('data-org="authorized-org"'),`${file}: ${role}/${scope} retains current organization`);
  check(render('licenses/page.tsx').includes('data-manage="true"'),`Portal management for ${role}/${scope}`);
 }
}
context={user:{id:'member'},currentOrganization:{id:'other-org',role:'admin_org',permissions:[]}};
check(render('energy-map/page.tsx').includes('data-org="other-org"'),'organization switch uses only new organization');
permissions=false;check(render('licenses/page.tsx').includes('Acesso à licença não autorizado'),'missing permission remains denied');permissions=true;
context={currentOrganization:{id:'org',role:'operador',permissions:[]}};check(render('licenses/page.tsx').includes('data-manage="false"'),'operator cannot manage Portal customers');
context={scope:'global',role:'admin_platform',user:{id:'platform'}};
check(render('energy-map/page.tsx').includes('PLATFORM MAP'),'global platform map preserved');
check(render('trading-hub/page.tsx').includes('Selecione uma organização'),'global Trading cannot assume organization');
check(!render('licenses/page.tsx').includes('PORTAL MANAGEMENT'),'global licensing requires selected organization');
context=null;
for(const file of ['energy-map/page.tsx','trading-hub/page.tsx','licenses/page.tsx'])check(render(file).includes('Selecione uma organização'),`${file}: absent context does not open module`);
console.log(`${checks} organization module context checks passed`);
