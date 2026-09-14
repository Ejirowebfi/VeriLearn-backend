import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Credential } from './entities/credential.entity';
import { Enrollment } from '../courses/entities/course.entity';
import { BlockchainService } from './blockchain.service';
import { BlockchainController } from './blockchain.controller';
import { MonitoringModule } from '../monitoring/monitoring.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Credential, Enrollment]),
    MonitoringModule,
  ],
  providers: [BlockchainService],
  controllers: [BlockchainController],
  exports: [BlockchainService],
})
export class BlockchainModule {}
