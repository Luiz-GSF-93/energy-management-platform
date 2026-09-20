import { SetMetadata } from '@nestjs/common';

export const RECOVERY_ENDPOINT_KEY = 'isRecoveryEndpoint';

/**
 * Marca um endpoint como recovery.
 */
export const RecoveryEndpoint = () => SetMetadata(RECOVERY_ENDPOINT_KEY, true);
