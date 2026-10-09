'use client';

import Link from 'next/link';
import EnergyOSLogo from '@/app/components/EnergyOSLogo';
import {
  BarChart3,
  Building2, LayoutGrid, ShieldCheck, UsersRound, FileSignature, Files, ContactRound, PanelLeftClose, PanelLeftOpen,
  LogOut, CalendarDays,ClipboardList,CalendarClock,TrendingUp,Bell,ChevronDown,ScanEye,MapPinned,
} from 'lucide-react';
import {
  ChangeEvent,
  useState,
} from 'react';
import { useRouter,usePathname } from 'next/navigation';

import {
  Alert,
  Button,
} from '@/app/components/ui';
import {
  backofficeNavigation,
  filterBackofficeNavigation,
} from '@/app/lib/navigation';
import { useAuth } from '@/app/providers';

const roleLabels: Record<string,string> = {admin_platform:'Administrador da plataforma',admin_org:'Administrador da organização',gestor:'Gestor',operacional:'Operador',consulta:'Consulta'};
const navigationIcons:Record<string,typeof BarChart3>={dashboard:BarChart3,organizations:Building2,plans:LayoutGrid,'energy-map':MapPinned,'trading-hub':TrendingUp,'platform-costs':TrendingUp,licenses:ShieldCheck,setup:ContactRound,'ccee-registrations':FileSignature,'acl-admissions':FileSignature,contracts:FileSignature,documents:Files,'ocr-audit':ScanEye,users:UsersRound,agenda:CalendarDays,requests:ClipboardList,events:CalendarClock,pld:TrendingUp,notifications:Bell};

export default function Sidebar({collapsed=false,onToggle}:{collapsed?:boolean;onToggle?:()=>void}={}) {
  const router = useRouter();
  const pathname=usePathname();

  const {
    context,
    logout,
    leaveOrganization,
    switchOrganization,
    hasPermission,
  } = useAuth();

  const [switching, setSwitching] =
    useState(false);
  const [switchError, setSwitchError] =
    useState('');

  const handleLogout = () => {
    logout();
    router.replace('/auth/login');
  };

  const handleOrganizationChange = async (
    event: ChangeEvent<HTMLSelectElement>,
  ) => {
    const organizationId =
      event.target.value;

    if (
      !context ||
      context.scope === 'global' ||
      organizationId ===
        context.currentOrganization.id
    ) {
      return;
    }

    setSwitching(true);
    setSwitchError('');

    try {
      await switchOrganization(
        organizationId,
      );
    } catch {
      setSwitchError(
        'Não foi possível trocar de organização.',
      );
    } finally {
      setSwitching(false);
    }
  };

  const organizationContext =
    context && context.scope !== 'global'
      ? context
      : null;

  const organizations =
    organizationContext?.organizations ?? [];

  const [operationOpen,setOperationOpen]=useState(true);
  const [reportsOpen,setReportsOpen]=useState(true);
  const allNavigationItems =
    filterBackofficeNavigation(
      backofficeNavigation,
      hasPermission,
      context
        ? context.scope === 'global'
          ? 'global'
          : 'organization'
        : undefined,
      context?.scope==='organization' && context.accessMode==='platform_operation',
    );
  const navigationItems=allNavigationItems.filter(item=>!item.group);
  const operationItems=allNavigationItems.filter(item=>item.group==='operation');
  const reportItems=allNavigationItems.filter(item=>item.group==='reports');
  const reportIndex=reportItems.findIndex(item=>pathname===item.href);
  const operationIndex=operationItems.findIndex(item=>pathname===item.href);
  const activeIndex=navigationItems.findIndex(item=>pathname===item.href||pathname.startsWith(item.href+'/'));

  return (
    <aside className="backoffice-sidebar" aria-label="Menu EnergyOS">
      <button className="backoffice-sidebar__toggle" type="button" onClick={onToggle} aria-label={collapsed?'Expandir menu':'Recolher menu'} aria-expanded={!collapsed} title={collapsed?'Expandir menu':'Recolher menu'}>{collapsed?<PanelLeftOpen size={20}/>:<PanelLeftClose size={20}/>}</button>
      <header className="backoffice-brand">
        <div className="backoffice-brand__symbol"><EnergyOSLogo compact className="backoffice-brand__icon" /></div>

        <div className="backoffice-brand__text">
          <h1 className="backoffice-brand__name"><EnergyOSLogo className="backoffice-brand__logo" /></h1>
          <p className="backoffice-brand__powered">Powered by Expert Energy</p>

          <p className="backoffice-brand__context">
            {context
              ? context.scope === 'global'
                ? `Perfil global: ${roleLabels[context.role] || context.role}`
                : `Perfil: ${roleLabels[context.currentOrganization.role] || context.currentOrganization.role}`
              : 'Backoffice'}
          </p>
        </div>
      </header>

      {organizationContext ? <div className="backoffice-context" title={organizationContext.currentOrganization.name||organizationContext.currentOrganization.id}>
        <p>Organização ativa</p><strong>{organizationContext.currentOrganization.name || organizationContext.currentOrganization.id}</strong>
        {organizationContext.accessMode === 'platform_operation' ? <>
          <p>Operação pelo administrador da plataforma</p>
          <Button variant="secondary" onClick={() => { void leaveOrganization().then(() => router.replace('/backoffice/organizations')); }}>Voltar à plataforma</Button>
        </> : null}
      </div> : null}
      {organizationContext &&
      organizations.length > 1 ? (
        <div className="backoffice-context">
          <label
            className="backoffice-context__label"
            htmlFor="organization-context"
          >
            Organização ativa
          </label>

          <select
            id="organization-context"
            className="backoffice-context__select"
            value={
              organizationContext.currentOrganization.id
            }
            onChange={
              handleOrganizationChange
            }
            disabled={switching}
          >
            {organizations.map(
              (organization) => (
                <option
                  key={organization.id}
                  value={organization.id}
                >
                  {`Organização ${organization.id.slice(0, 8)} — ${organization.role}`}
                </option>
              ),
            )}
          </select>

          {switchError ? (
            <Alert variant="error">
              {switchError}
            </Alert>
          ) : null}
        </div>
      ) : null}

      <nav
        className="backoffice-nav"
        aria-label="Administração"
      >
        {activeIndex>=0?<span className="backoffice-nav__indicator" aria-hidden="true" style={{transform:`translateY(${activeIndex*56}px)`}}/>:null}
        {navigationItems.map((item,index) => {const Icon=navigationIcons[item.href.split('/').pop()||'']||LayoutGrid;return (
          <Link
            key={item.href}
            href={item.href}
            className={`backoffice-nav__link${index===activeIndex?' backoffice-nav__link--active':''}`}
            aria-current={index===activeIndex?'page':undefined}
            aria-label={item.label}
            title={collapsed?item.label:undefined}
          >
            <Icon
              size={20}
              className="backoffice-nav__icon"
              aria-hidden="true"
            />

            <span className="backoffice-nav__label">{item.label}</span>
          </Link>
        );})}
      </nav>

      {operationItems.length?<section className="operation-menu"><button className="backoffice-nav__link operation-menu__toggle" type="button" onClick={()=>setOperationOpen(v=>!v)} aria-expanded={operationOpen} aria-controls="operation-submenu" aria-label="Operação" title={collapsed?'Operação':undefined}><CalendarDays size={20} className="backoffice-nav__icon"/><span className="backoffice-nav__label">Operação</span>{!collapsed?<ChevronDown size={16}/>:null}</button>{operationOpen?<nav id="operation-submenu" className="backoffice-nav operation-submenu" aria-label="Operação">{operationIndex>=0?<span className="backoffice-nav__indicator" aria-hidden="true" style={{transform:`translateY(${operationIndex*56}px)`}}/>:null}{operationItems.map((item,index)=>{const Icon=navigationIcons[item.href.split('/').pop()||'']||LayoutGrid;return <Link key={item.href} href={item.href} aria-label={item.label} aria-current={index===operationIndex?'page':undefined} title={collapsed?item.label:undefined} className={`backoffice-nav__link${index===operationIndex?' backoffice-nav__link--active':''}`}><Icon size={20} className="backoffice-nav__icon"/><span className="backoffice-nav__label">{item.label}</span></Link>;})}</nav>:null}</section>:null}

      {reportItems.length?<section className="operation-menu"><button className="backoffice-nav__link operation-menu__toggle" type="button" onClick={()=>setReportsOpen(v=>!v)} aria-expanded={reportsOpen} aria-controls="reports-submenu" aria-label="Relatórios" title={collapsed?'Relatórios':undefined}><Files size={20} className="backoffice-nav__icon"/><span className="backoffice-nav__label">Relatórios</span>{!collapsed?<ChevronDown size={16}/>:null}</button>{reportsOpen?<nav id="reports-submenu" className="backoffice-nav operation-submenu" aria-label="Relatórios">{reportIndex>=0?<span className="backoffice-nav__indicator" aria-hidden="true" style={{transform:`translateY(${reportIndex*56}px)`}}/>:null}{reportItems.map(item=><Link key={item.href} href={item.href} aria-label={item.label} aria-current={pathname===item.href?'page':undefined} title={collapsed?item.label:undefined} className={`backoffice-nav__link${pathname===item.href?' backoffice-nav__link--active':''}`}><BarChart3 size={20} className="backoffice-nav__icon"/><span className="backoffice-nav__label">{item.label}</span></Link>)}</nav>:null}</section>:null}

      <footer className="backoffice-sidebar__footer">
        <Button
          variant="danger"
          aria-label="Sair"
          title={collapsed?'Sair':undefined}
          onClick={handleLogout}
        >
          <LogOut
            size={20}
            aria-hidden="true"
          />

          <span className="backoffice-nav__label">Sair</span>
        </Button>
      </footer>
    </aside>
  );
}
