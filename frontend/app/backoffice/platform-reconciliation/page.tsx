import RecurrencePreparation from '../platform-sales/RecurrencePreparation';
import Workspace from "../platform-workflows/Workspace";
import SalesFinance from "./SalesFinance";
import AdjustmentRequests from '../platform-sales/AdjustmentRequests';
export default function Page(){return <Workspace kind="finance"><details><summary>Financeiro comercial · sandbox</summary><SalesFinance/><AdjustmentRequests/></details><details><summary>Recorrencia e ciclos sandbox</summary><RecurrencePreparation/></details></Workspace>;}
