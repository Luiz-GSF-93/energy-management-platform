import RecurrencePreparation from '../platform-sales/RecurrencePreparation';
import Workspace from "../platform-workflows/Workspace";
import SalesFinance from "./SalesFinance";
export default function Page(){return <Workspace kind="finance"><details><summary>Financeiro comercial · sandbox</summary><SalesFinance/></details><details><summary>Recorrencia e ciclos sandbox</summary><RecurrencePreparation/></details></Workspace>;}
