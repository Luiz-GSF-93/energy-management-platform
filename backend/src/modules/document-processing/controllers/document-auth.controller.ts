import { Controller, Post, Body, UseGuards, Get, Req } from '@nestjs/common';
import { DocumentAuthService } from '../services/document-auth.service';
import { DocumentAuthGuard } from '../guards/document-auth.guard';

@Controller('document-processing/auth')
export class DocumentAuthController {
  constructor(private authService: DocumentAuthService) {}

  @Post('token')
  generateToken(
    @Body() body: { organizationId: string; empresaId: string; userId?: string },
  ) {
    console.log(`🔐 Requisição de token para org: ${body.organizationId}`);
    
    return {
      success: true,
      data: this.authService.generateToken(
        body.organizationId,
        body.empresaId,
        body.userId,
      ),
    };
  }

  @Post('validate')
  validateToken(@Body() body: { token: string }) {
    console.log('🔍 Validando token...');
    
    const validation = this.authService.validateToken(body.token);
    
    return {
      success: validation.valid,
      data: validation,
    };
  }

  @Post('refresh')
  refreshToken(@Body() body: { token: string }) {
    console.log('🔄 Renovando token...');
    
    const result = this.authService.refreshToken(body.token);
    
    return {
      success: !result.error,
      data: result,
    };
  }

  @Get('me')
  @UseGuards(DocumentAuthGuard)
  getCurrentUser(@Req() req: any) {
    console.log('👤 Obtendo dados do usuário autenticado');
    
    return {
      success: true,
      user: req.auth,
    };
  }
}
