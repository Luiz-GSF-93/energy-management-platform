import { Injectable } from '@nestjs/common';
import { Distributor } from '../enums/distributor.enum';

@Injectable()
export class DistributorDetectorService {
  private readonly patterns: Record<Distributor, RegExp[]> = {
    [Distributor.CPFL]: [
      /CPFL Energia/i,
      /Companhia Paulista de Força e Luz/i,
      /cpfl\.com\.br/i,
    ],
    [Distributor.ENERGISA]: [
      /Energisa/i,
      /energisa\.com\.br/i,
    ],
    [Distributor.ENEL]: [
      /ENEL/i,
      /Enel Distribuição/i,
      /enel\.com\.br/i,
    ],
    [Distributor.NEOENERGIA]: [
      /Neoenergia/i,
      /neoenergia\.com\.br/i,
    ],
    [Distributor.EQUATORIAL]: [
      /Equatorial/i,
      /equatorialenergia\.com\.br/i,
    ],
    [Distributor.GENERIC]: [/./], // Always matches as fallback
  };

  detectDistributor(text: string): Distributor {
    for (const [distributor, patterns] of Object.entries(this.patterns)) {
      if (distributor === Distributor.GENERIC) continue;
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          return distributor as Distributor;
        }
      }
    }
    return Distributor.GENERIC;
  }
}
