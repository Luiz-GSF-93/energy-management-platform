import Image from 'next/image';

/** V1.1 signature adapted for dark surfaces, with original gradients and compact mark. */
export default function EnergyOSLogo({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return <Image src={compact ? '/brand/energyos-product-mark-micro.svg' : '/brand/energyos-logo-horizontal-color-dark.svg'}
    alt="EnergyOS" width={compact ? 256 : 980} height={compact ? 256 : 230}
    className={className} priority />;
}
