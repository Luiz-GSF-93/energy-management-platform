"""Download only explicitly selected public official PDFs; never authenticates or bypasses a challenge."""
import concurrent.futures, hashlib, json, urllib.request, urllib.parse
from pathlib import Path
ROOT=Path('/tmp/energy-legal-official-files-20261117')
ROOT.mkdir(parents=True,exist_ok=True)
PDFS={
 'codigo-civil':'https://www2.camara.leg.br/legin/fed/lei/2002/lei-10406-10-janeiro-2002-432893-normaatualizada-pl.pdf',
 'lei-seguros':'https://bibliotecadigital.mj.gov.br/bitstream/1/14027/2/LEI_PR_2024_15040.pdf',
 'lei9074':'https://www2.camara.leg.br/legin/fed/lei/1995/lei-9074-7-julho-1995-347472-normaatualizada-pl.pdf',
 'lei-comercializacao':'https://www2.camara.leg.br/legin/fed/lei/2004/lei-10848-15-marco-2004-531234-normaatualizada-pl.pdf',
 'lei9427':'https://www2.camara.leg.br/legin/fed/lei/1996/lei-9427-26-dezembro-1996-366792-normaatualizada-pl.pdf',
 'lei14300':'https://www2.camara.leg.br/legin/fed/lei/2022/lei-14300-6-janeiro-2022-792217-normaatualizada-pl.pdf',
 'lei15269':'https://www.gov.br/mme/pt-br/acesso-a-informacao/legislacao/leis/lei-n-15-269-2025.pdf',
 'mme50':'https://www.gov.br/mme/pt-br/acesso-a-informacao/legislacao/portarias/2022/portaria-normativa-n-50-gm-mme-2022.pdf',
 'ccee-contratos-2026':'https://www.ccee.org.br/documents/80415/31259220/05%20-%20Contratos_2026.5.1_MAI.pdf/e5d55e8a-f760-236f-b1e1-ee4eea31b9ef',
 'cnpe-resolucoes':'https://www.gov.br/mme/pt-br/assuntos/conselhos-e-comites/cnpe/resolucoes-do-cnpe/2026/Resoluo82026publicada.pdf',
 'ons-procedimentos':'https://proxyportais.ons.org.br/ons.portalempregado.proxy/garapi/api/processo/retornarpdf?url=/sites/soumaisons/portalgar/ecmpdf/Subm%C3%B3dulo%208.1-PR_2025.06.pdf',
 'ons-mpo':'https://www.ons.org.br/%2FMPO%2FDocumento%20Normativo%2F4.%20Rotinas%20Operacionais%20-%20SM%205.13%2F4.1.%20Rotinas%20Gerais%2F4.1.5.%20Padroniza%C3%A7%C3%A3o%20e%20Revis%C3%A3o%20do%20Manual%20de%20Procedimentos%20da%20Opera%C3%A7%C3%A3o%2FRO-MP.BR.02_Rev.37.pdf',
 'epe-pde2035-arquivo':'https://www.epe.gov.br/sites-pt/publicacoes-dados-abertos/publicacoes/Documents/PDE%202035_Relat%C3%B3rio%20Final_Envio%20MME_2026-11-05_rev4.pdf',
}
HOSTS={urllib.parse.urlsplit(u).hostname for u in PDFS.values()}
prior=json.loads((ROOT/'download-manifest.json').read_text()) if (ROOT/'download-manifest.json').exists() else []
def allowed(url):
 u=urllib.parse.urlsplit(url)
 return u.scheme=='https' and u.hostname in HOSTS and not u.username and not u.password and not u.port and (not u.query or url==PDFS['ons-procedimentos']) and not u.fragment
class OfficialRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  if not allowed(newurl):raise ValueError('REDIRECT_NOT_OFFICIAL')
  return super().redirect_request(req,fp,code,msg,headers,newurl)
opener=urllib.request.build_opener(OfficialRedirect())
def fetch(item):
 key,url=item;path=ROOT/(key+'.pdf')
 try:
  saved=next((r for r in prior if r.get('sourceId')==key and r.get('url')==url and r.get('state')=='DOWNLOADED_NOT_YET_REGISTERED'),None)
  cached=Path(saved['path']) if saved else None
  if cached and cached.resolve().parent==ROOT.resolve() and cached.exists() and hashlib.sha256(cached.read_bytes()).hexdigest()==saved['sha256']:
   return saved
  else:
   req=urllib.request.Request(url,headers={'User-Agent':'EnergyOS-Official-Library/0.1','Accept':'application/pdf'})
   with opener.open(req,timeout=30) as response:
    final=response.geturl()
    if not allowed(final):raise ValueError('ORIGIN_NOT_OFFICIAL')
    if int(response.headers.get('Content-Length','0'))>26214400:raise ValueError('FILE_LIMIT')
    data=response.read(26214401);etag=response.headers.get('ETag');modified=response.headers.get('Last-Modified')
   if len(data)>26214400:raise ValueError('FILE_LIMIT')
   if not data.startswith(b'%PDF-') or b'%%EOF' not in data[-2048:]:raise ValueError('NOT_A_PDF_OR_ACCESS_CHALLENGE')
   path=ROOT/(key+'-'+hashlib.sha256(data).hexdigest()[:16]+'.pdf');path.write_bytes(data)
  if not data.startswith(b'%PDF-') or b'%%EOF' not in data[-2048:]:raise ValueError('INVALID_CACHED_FILE')
  return dict(sourceId=key,url=url,finalUrl=final,state='DOWNLOADED_NOT_YET_REGISTERED',path=str(path),bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),etag=etag,lastModified=modified)
 except Exception as exc:
  return dict(sourceId=key,url=url,state='PENDING_OFFICIAL_FILE',error=getattr(exc,'code',None) or str(exc)[:100])
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:result=list(pool.map(fetch,PDFS.items()))
(ROOT/'download-manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{k:r.get(k) for k in ['sourceId','state','bytes','error']} for r in result],ensure_ascii=False))
