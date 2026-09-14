import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto, ChangePasswordDto } from './dto/user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from './entities/user.entity';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List all users (admin)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.usersService.findAll(page ? +page : 1, limit ? +limit : 20);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@Request() req) { return this.usersService.findById(req.user.id); }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  findOne(@Param('id') id: string, @Request() req) {
    if (req.user.id !== id && req.user.role !== UserRole.ADMIN) throw new ForbiddenException();
    return this.usersService.findById(id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  updateMe(@Request() req, @Body() dto: UpdateUserDto) { return this.usersService.update(req.user.id, dto); }

  @Post('me/change-password')
  @ApiOperation({ summary: 'Change password' })
  changePassword(@Request() req, @Body() dto: ChangePasswordDto) { return this.usersService.changePassword(req.user.id, dto); }

  @Post('me/mfa/generate')
  @ApiOperation({ summary: 'Generate MFA secret and QR code' })
  generateMfa(@Request() req) { return this.usersService.generateMfaSecret(req.user.id); }

  @Post('me/mfa/enable')
  @ApiOperation({ summary: 'Enable MFA with TOTP token' })
  enableMfa(@Request() req, @Body('token') token: string) { return this.usersService.enableMfa(req.user.id, token); }

  @Post('me/mfa/disable')
  @ApiOperation({ summary: 'Disable MFA' })
  disableMfa(@Request() req) { return this.usersService.disableMfa(req.user.id); }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete user (admin)' })
  remove(@Param('id') id: string) { return this.usersService.remove(id); }
}
