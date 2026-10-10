import {
  Body,
  Controller,
  Get,
  Header,
  Patch,
  Post,
  Req,
  ValidationPipe,
} from "@nestjs/common";
import { RequestWithAuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { RecoveryEndpoint } from "../../common/decorators/recovery-endpoint.decorator";
import { MfaHandshake } from "../../common/auth/mfa-policy";
import { AccountService } from "./account.service";
import { FactorDto, PreferencesDto, VerifyFactorDto } from "./account.dto";
const strict = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
type OwnRequest = RequestWithAuthenticatedUser;
const own = (r: OwnRequest) => r.authenticatedUser!.userId;
const token = (r: OwnRequest) => String(r.headers.authorization).slice(7);
// RecoveryEndpoint skips organization resolution only; JWT/profile and MFA remain enforced.
@Controller("auth/account")
export class AccountController {
  constructor(private account: AccountService) {}
  @Get("preferences")
  @RecoveryEndpoint()
  @Header("Cache-Control", "no-store")
  preferences(@Req() r: OwnRequest) {
    return this.account.preferences(own(r));
  }
  @Patch("preferences")
  @RecoveryEndpoint()
  @Header("Cache-Control", "no-store")
  save(@Req() r: OwnRequest, @Body(strict) data: PreferencesDto) {
    return this.account.save(own(r), data);
  }
  @Get("mfa")
  @RecoveryEndpoint()
  @MfaHandshake()
  @Header("Cache-Control", "no-store")
  status(@Req() r: OwnRequest) {
    return this.account.status(own(r), token(r));
  }
  @Post("mfa/enroll")
  @RecoveryEndpoint()
  @Header("Cache-Control", "no-store")
  enroll(@Req() r: OwnRequest) {
    return this.account.enroll(own(r), token(r));
  }
  @Post("mfa/challenge")
  @RecoveryEndpoint()
  @MfaHandshake()
  @Header("Cache-Control", "no-store")
  challenge(@Req() r: OwnRequest, @Body(strict) data: FactorDto) {
    return this.account.challenge(own(r), token(r), data.factor_id);
  }
  @Post("mfa/verify")
  @RecoveryEndpoint()
  @MfaHandshake()
  @Header("Cache-Control", "no-store")
  verify(@Req() r: OwnRequest, @Body(strict) data: VerifyFactorDto) {
    return this.account.verify(own(r), token(r), data);
  }
  @Post("mfa/remove")
  @RecoveryEndpoint()
  @Header("Cache-Control", "no-store")
  remove(@Req() r: OwnRequest, @Body(strict) data: FactorDto) {
    return this.account.remove(own(r), token(r), data.factor_id);
  }
}
