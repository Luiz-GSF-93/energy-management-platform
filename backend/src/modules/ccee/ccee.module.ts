import {Module} from '@nestjs/common';
import {CceeController} from './ccee.controller';
import {CceeService} from './ccee.service';
@Module({controllers:[CceeController],providers:[CceeService]})
export class CceeModule {}
