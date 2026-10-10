import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SupabaseService } from "../../services/supabase.service";
import { PreferencesDto, VerifyFactorDto } from "./account.dto";
import { validateAvatar } from "./avatar-png";
import {
  assertMfa,
  assertRecentMethod,
  MfaFactor,
} from "../../common/auth/mfa-policy";
@Injectable()
export class AccountService {
  constructor(
    private db: SupabaseService,
    private config: ConfigService,
  ) {}
  async preferences(userId: string) {
    const client = this.db.getClient();
    const [profile, prefs, members] = await Promise.all([
      client
        .from("user_profiles")
        .select("name,email")
        .eq("user_id", userId)
        .single(),
      client
        .from("user_environment_preferences")
        .select(
          "revision,theme,avatar_kind,emoji,photo,cep,personal_phone,updated_at",
        )
        .eq("user_id", userId)
        .maybeSingle(),
      client
        .from("organization_members")
        .select("affiliation_type,organizations(name),roles(name)")
        .eq("user_id", userId)
        .eq("status", "active"),
    ]);
    if (profile.error || prefs.error || members.error)
      throw new ServiceUnavailableException(
        "Não foi possível consultar suas configurações.",
      );
    return {
      identity: {
        name: profile.data.name || null,
        email: profile.data.email || null,
        memberships: members.data || [],
      },
      preferences: prefs.data || {
        revision: 0,
        theme: "blue",
        avatar_kind: "initials",
        emoji: "🙂",
        photo: "",
        cep: "",
        personal_phone: "",
      },
    };
  }
  async save(userId: string, input: PreferencesDto) {
    const photo =
      input.avatar_kind === "photo" ? validateAvatar(input.photo) : "";
    if (input.avatar_kind === "photo" && !photo)
      throw new BadRequestException("Selecione sua foto.");
    const { data, error } = await this.db
      .getClient()
      .rpc("save_user_environment_preferences", {
        p_user: userId,
        p_revision: input.revision,
        p_data: { ...input, photo },
      });
    if (error) {
      if (error.code === "40001")
        throw new ConflictException(
          "As configurações mudaram. Atualize a tela antes de salvar.",
        );
      throw new ServiceUnavailableException(
        "Não foi possível salvar suas configurações.",
      );
    }
    return data;
  }
  async factors(userId: string, token: string) {
    const { data, error } = await this.db.getClient().auth.getUser(token);
    if (error || data?.user?.id !== userId)
      throw new ForbiddenException("Identidade não confirmada.");
    return (data.user.factors || []) as MfaFactor[];
  }
  async status(userId: string, token: string) {
    return {
      factors: (await this.factors(userId, token))
        .filter((f) => f.factor_type === "totp")
        .map((f) => ({ id: f.id, status: f.status })),
    };
  }
  private async call(
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<any> {
    const url = this.config.get<string>("SUPABASE_URL"),
      key = this.config.get<string>("SUPABASE_SERVICE_KEY");
    if (!url || !key)
      throw new ServiceUnavailableException("Autenticador indisponível.");
    let response: Response;
    try {
      response = await fetch(url.replace(/\/$/, "") + "/auth/v1/" + path, {
        method,
        headers: {
          apikey: key,
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Serviço do autenticador indisponível. Tente novamente.",
      );
    }
    if (!response.ok) {
      if (response.status >= 500)
        throw new ServiceUnavailableException(
          "Serviço do autenticador indisponível. Tente novamente.",
        );
      if (response.status === 429)
        throw new BadRequestException(
          "Muitas tentativas. Aguarde antes de tentar novamente.",
        );
      throw new BadRequestException(
        "Não foi possível confirmar a operação. Confira o código ou entre novamente.",
      );
    }
    return response.status === 204 ? {} : response.json();
  }
  async enroll(userId: string, token: string) {
    const factors = await this.factors(userId, token);
    assertMfa(factors, token);
    assertRecentMethod(token, "password");
    if (factors.some((f) => f.factor_type === "totp"))
      throw new ConflictException(
        "Já existe um autenticador. Conclua ou cancele a configuração existente.",
      );
    const data = await this.call(token, "POST", "factors", {
      factor_type: "totp",
      friendly_name: "EnergyOS",
      issuer: "EnergyOS",
    });
    return { id: data.id, qr_code: data.totp?.qr_code }; // Never return/store/log the secret separately.
  }
  private async ownFactor(userId: string, token: string, id: string) {
    const factors = await this.factors(userId, token);
    const factor = factors.find((f) => f.id === id && f.factor_type === "totp");
    if (!factor)
      throw new ForbiddenException("Autenticador não pertence a esta conta.");
    return factor;
  }
  async challenge(userId: string, token: string, id: string) {
    await this.ownFactor(userId, token, id);
    const data = await this.call(
      token,
      "POST",
      "factors/" + id + "/challenge",
      {},
    );
    return { id: data.id };
  }
  async verify(userId: string, token: string, input: VerifyFactorDto) {
    await this.ownFactor(userId, token, input.factor_id);
    const data = await this.call(
      token,
      "POST",
      "factors/" + input.factor_id + "/verify",
      { challenge_id: input.challenge_id, code: input.code },
    );
    if (
      data.user?.id !== userId ||
      typeof data.access_token !== "string" ||
      typeof data.refresh_token !== "string"
    )
      throw new ServiceUnavailableException(
        "Resposta de autenticação inválida.",
      );
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    };
  }
  async remove(userId: string, token: string, id: string) {
    const factor = await this.ownFactor(userId, token, id);
    if (factor.status === "verified") assertRecentMethod(token, "totp");
    await this.call(token, "DELETE", "factors/" + id);
    return { removed: true };
  }
}
