import 'reflect-metadata';
import {
  PLATFORM_SCOPE_KEY,
  PlatformScope,
} from './platform-scope.decorator';

describe('PlatformScope decorator', () => {
  class TestController {
    @PlatformScope()
    platformHandler(): void {}

    organizationHandler(): void {}
  }

  it('marks an explicitly platform-scoped handler', () => {
    const metadata = Reflect.getMetadata(
      PLATFORM_SCOPE_KEY,
      TestController.prototype.platformHandler,
    );

    expect(metadata).toBe(true);
  });

  it('does not mark an ordinary handler', () => {
    const metadata = Reflect.getMetadata(
      PLATFORM_SCOPE_KEY,
      TestController.prototype.organizationHandler,
    );

    expect(metadata).toBeUndefined();
  });
});
