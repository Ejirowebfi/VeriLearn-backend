import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BlockchainService } from './blockchain.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class IssueCredentialDto {
  @ApiProperty() @IsString() courseId: string;
  @ApiProperty() @IsString() stellarPublicKey: string;
}

@ApiTags('blockchain')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('blockchain')
export class BlockchainController {
  constructor(private readonly blockchainService: BlockchainService) {}

  @Post('credentials/issue')
  @ApiOperation({ summary: 'Issue a course completion credential on Stellar' })
  issue(@Body() dto: IssueCredentialDto, @Request() req) {
    return this.blockchainService.issueCredential(req.user.id, dto.courseId, dto.stellarPublicKey);
  }

  @Get('credentials/me')
  @ApiOperation({ summary: 'Get my credentials' })
  myCredentials(@Request() req) { return this.blockchainService.getCredentialsByUser(req.user.id); }

  @Get('credentials/verify/:txHash')
  @ApiOperation({ summary: 'Verify a credential by transaction hash' })
  verify(@Param('txHash') txHash: string) { return this.blockchainService.verifyCredential(txHash); }

  @Get('account/:publicKey/balance')
  @ApiOperation({ summary: 'Get Stellar account balance' })
  balance(@Param('publicKey') publicKey: string) { return this.blockchainService.getAccountBalance(publicKey); }

  @Post('keypair/generate')
  @ApiOperation({ summary: 'Generate a new Stellar keypair' })
  generateKeypair() { return this.blockchainService.createKeypair(); }
}
