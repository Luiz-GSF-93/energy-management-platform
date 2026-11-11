import {Module} from '@nestjs/common';
import {ConfigModule} from '@nestjs/config';
import {CommonModule} from './common/common.module';
import {OcrModule} from './modules/ocr/ocr.module';
import {AutomaticIntakeWorker} from './modules/portal-workspace/automatic-intake.worker';
import {AutomaticExplanationWorker} from './modules/portal-workspace/automatic-explanation.worker';
import {PortalAutomationWorker} from './modules/portal-workspace/portal-automation.worker';
/** Private processing dependencies only; no AuthModule, admin or portal controllers. */
@Module({imports:[ConfigModule.forRoot({isGlobal:true}),CommonModule,OcrModule],providers:[AutomaticIntakeWorker,AutomaticExplanationWorker,PortalAutomationWorker]})
export class EvaWorkerModule{}
