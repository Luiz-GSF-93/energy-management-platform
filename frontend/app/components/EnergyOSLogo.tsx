import Image from 'next/image';

/** Official V1.1 assets: color institutional signature and compact product mark. */
export default function EnergyOSLogo({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return <Image src={compact ? '/brand/energyos-product-mark-micro.svg' : '/brand/energyos-logo-horizontal-color.svg'}
    alt="EnergyOS" width={compact ? 256 : 980} height={compact ? 256 : 230}
    className={className} priority />;
}
