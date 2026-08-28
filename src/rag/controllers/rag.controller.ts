import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import multer from 'multer';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JWT_AUTH } from '../../config/swagger.config';
import { Role } from '../../user/types/user.types';
import * as fs from 'fs';
import { AskDto } from '../dto/ask.dto';
import { IndexBulkDto } from '../dto/index-bulk.dto';
import { IndexParcelDto } from '../dto/index-parcel.dto';
import {
  PdfIngestResponseDto,
  RagAnswerDto,
  RagMessageResponseDto,
} from '../dto/rag-response.dto';
import { UploadPdfDto, UploadPdfFormDto } from '../dto/upload-pdf.dto';
import { RagService } from '../services/rag.service';
import { RagAnswer } from '../types/rag.types';

const UPLOAD_DIR = '/tmp/uploads';

@ApiTags('RAG')
@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  // ─── Upload & ingest PDF ──────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Upload a PDF and index it',
    description: 'Admin only. PDF only, 10 MB maximum.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadPdfFormDto })
  @ApiResponse({ status: 201, type: PdfIngestResponseDto })
  @ApiResponse({ status: 400, description: 'Missing file or non-PDF upload' })
  @ApiBearerAuth(JWT_AUTH)
  @ApiResponse({ status: 403, description: 'Requester is not an admin' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('pdf/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
          // recursive: true avoids ENOENT when the temp dir is not there yet.
          fs.mkdirSync(UPLOAD_DIR, { recursive: true });
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          cb(null, `${Date.now()}-${file.originalname}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(new BadRequestException('Only PDF files allowed'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async uploadPDF(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadPdfDto,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    try {
      const result = await this.ragService.ingestPDF(file.path, {
        source: file.originalname,
        category: body.category ?? 'general',
      });

      return {
        message: 'PDF ingested successfully',
        filename: file.originalname,
        ...result,
      };
    } finally {
      // Clean up temp file regardless of success or failure
      fs.unlink(file.path, (err) => {
        if (err) console.warn(`Failed to delete temp file: ${file.path}`, err);
      });
    }
  }

  // ─── Delete PDF ───────────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Drop an indexed PDF from the vector store',
    description: 'Admin only.',
  })
  @ApiParam({ name: 'source', example: 'delivery-policy.pdf' })
  @ApiResponse({ status: 200, type: RagMessageResponseDto })
  @ApiBearerAuth(JWT_AUTH)
  @ApiResponse({ status: 403, description: 'Requester is not an admin' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Delete('pdf/:source')
  async deletePDF(@Param('source') source: string) {
    await this.ragService.deletePDF(source);
    return { message: `PDF "${source}" deleted from vector store` };
  }

  // ─── Ask a question ───────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Ask a question over the indexed documents',
    description:
      'Any signed-in user. Each call bills an embedding and a completion, so it is not public.',
  })
  @ApiResponse({ status: 201, type: RagAnswerDto })
  @ApiResponse({ status: 400, description: 'Question is required' })
  @ApiBearerAuth(JWT_AUTH)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth(JWT_AUTH)
  @ApiOperation({
    summary: 'Ask a question, streamed',
    description:
      'Server-sent events. Emits one `sources` event, then a run of `token` events, then exactly one `done` or `error`. Same auth and cost as `ask`.',
  })
  @ApiResponse({
    status: 200,
    description: 'text/event-stream of RagStreamChunk JSON payloads',
  })
  @Throttle({ ai: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Post('ask/stream')
  async askStream(@Body() body: AskDto, @Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Without this, a proxy that buffers responses defeats the whole point.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let clientGone = false;
    res.on('close', () => {
      clientGone = true;
    });

    for await (const chunk of this.ragService.askStream(
      body.question,
      body.filter ?? 'all',
    )) {
      // Stop pulling tokens from the model the moment nobody is listening —
      // every one of them costs money.
      if (clientGone) break;
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    res.end();
  }

  @Throttle({ ai: { limit: 20, ttl: 60_000 } })
  @Post('ask')
  ask(@Body() body: AskDto): Promise<RagAnswer> {
    if (!body.question) throw new BadRequestException('Question is required');
    return this.ragService.ask(body.question, body.filter ?? 'all');
  }

  // ─── Index single parcel ──────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Index a single parcel',
    description: 'Admin only.',
  })
  @ApiResponse({ status: 201, type: RagMessageResponseDto })
  @ApiBearerAuth(JWT_AUTH)
  @ApiResponse({ status: 403, description: 'Requester is not an admin' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('index/parcel')
  async indexParcel(@Body() parcel: IndexParcelDto) {
    await this.ragService.indexParcel(parcel);
    return { message: `Parcel ${parcel.trackingCode} indexed successfully` };
  }

  // ─── Bulk index parcels ───────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Index many parcels at once',
    description: 'Admin only.',
  })
  @ApiResponse({ status: 201, type: RagMessageResponseDto })
  @ApiResponse({ status: 400, description: 'No parcels provided' })
  @ApiBearerAuth(JWT_AUTH)
  @ApiResponse({ status: 403, description: 'Requester is not an admin' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Throttle({ ai: { limit: 20, ttl: 60_000 } })
  @Post('index/bulk')
  async indexBulk(@Body() body: IndexBulkDto) {
    if (!body.parcels?.length) {
      throw new BadRequestException('No parcels provided');
    }

    for (const parcel of body.parcels) {
      await this.ragService.indexParcel(parcel);
    }

    return { message: `${body.parcels.length} parcels indexed successfully` };
  }

  // ─── Delete parcel ────────────────────────────────────────────────────────

  @ApiOperation({
    summary: 'Drop an indexed parcel from the vector store',
    description: 'Admin only.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: RagMessageResponseDto })
  @ApiBearerAuth(JWT_AUTH)
  @ApiResponse({ status: 403, description: 'Requester is not an admin' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Delete('index/parcel/:id')
  async deleteParcel(@Param('id') id: string) {
    await this.ragService.deleteParcel(id);
    return { message: `Parcel ${id} deleted from vector store` };
  }
}
