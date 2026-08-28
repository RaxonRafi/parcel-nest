import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import multer from 'multer';
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
    description: 'PDF only, 10 MB maximum.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadPdfFormDto })
  @ApiResponse({ status: 201, type: PdfIngestResponseDto })
  @ApiResponse({ status: 400, description: 'Missing file or non-PDF upload' })
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

  @ApiOperation({ summary: 'Drop an indexed PDF from the vector store' })
  @ApiParam({ name: 'source', example: 'delivery-policy.pdf' })
  @ApiResponse({ status: 200, type: RagMessageResponseDto })
  @Delete('pdf/:source')
  async deletePDF(@Param('source') source: string) {
    await this.ragService.deletePDF(source);
    return { message: `PDF "${source}" deleted from vector store` };
  }

  // ─── Ask a question ───────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Ask a question over the indexed documents' })
  @ApiResponse({ status: 201, type: RagAnswerDto })
  @ApiResponse({ status: 400, description: 'Question is required' })
  @Post('ask')
  ask(@Body() body: AskDto): Promise<RagAnswer> {
    if (!body.question) throw new BadRequestException('Question is required');
    return this.ragService.ask(body.question, body.filter ?? 'all');
  }

  // ─── Index single parcel ──────────────────────────────────────────────────

  @ApiOperation({ summary: 'Index a single parcel' })
  @ApiResponse({ status: 201, type: RagMessageResponseDto })
  @Post('index/parcel')
  async indexParcel(@Body() parcel: IndexParcelDto) {
    await this.ragService.indexParcel(parcel);
    return { message: `Parcel ${parcel.trackingCode} indexed successfully` };
  }

  // ─── Bulk index parcels ───────────────────────────────────────────────────

  @ApiOperation({ summary: 'Index many parcels at once' })
  @ApiResponse({ status: 201, type: RagMessageResponseDto })
  @ApiResponse({ status: 400, description: 'No parcels provided' })
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

  @ApiOperation({ summary: 'Drop an indexed parcel from the vector store' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: RagMessageResponseDto })
  @Delete('index/parcel/:id')
  async deleteParcel(@Param('id') id: string) {
    await this.ragService.deleteParcel(id);
    return { message: `Parcel ${id} deleted from vector store` };
  }
}
