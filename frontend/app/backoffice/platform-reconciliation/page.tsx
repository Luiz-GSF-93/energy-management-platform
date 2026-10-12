import AdministrativeSection from '../platform-workflows/AdministrativeSection';
import RecurrencePreparation from '../platform-sales/RecurrencePreparation';
import Workspace from "../platform-workflows/Workspace";
import SalesFinance from "./SalesFinance";
import AdjustmentRequests from '../platform-sales/AdjustmentRequests';
export default function Page(){return <Workspace kind="finance"><AdministrativeSection title="Financeiro comercial · sandbox"><SalesFinance/><AdjustmentRequests/></AdministrativeSection><AdministrativeSection title="Recorrência e ciclos · sandbox"><RecurrencePreparation/></AdministrativeSection></Workspace>;}
