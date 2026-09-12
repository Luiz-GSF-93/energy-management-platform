import { Injectable, Logger } from '@nestjs/common';
import { Distributor } from '../enums/distributor.enum';

@Injectable()
export class DistributorDetectorService {
  private readonly logger = new Logger(DistributorDetectorService.name);

  private readonly patterns = {
    [Distributor.CPFL]: [/cpfl/i, /companhia paulista/i],
    [Distributor.ENERGISA]: [/energisa/i],
    [Distributor.ENEL]: [/enel/i],
    [Distributor.NEOENERGIA]: [/neoenergia/i],
    [Distributor.EQUATORIAL]: [/equatorial/i],
    [Distributor.CEMIG]: [/cemig/i],
    [Distributor.LIGHT]: [/light/i],
    [Distributor.AES]: [/aes/i],
    [Distributor.COPEL]: [/copel/i],
  };

  detectDistributor(text: string): Distributor {
    for (const [distributor, patterns] of Object.entries(this.patterns)) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          this.logger.log(`✅ Distribuidora: ${distributor}`);
          return distributor as Distributor;
        }
      }
    }

    this.logger.warn('⚠️ Distributor não identificada');
    return Distributor.GENERIC;
  }
}
