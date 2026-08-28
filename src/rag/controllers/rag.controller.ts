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
import multer from 'multer';
import * as fs from 'fs';
import { AskDto } from '../dto/ask.dto';
import { IndexBulkDto } from '../dto/index-bulk.dto';
import { IndexParcelDto } from '../dto/index-parcel.dto';
import { UploadPdfDto } from '../dto/upload-pdf.dto';
import { RagService } from '../services/rag.service';
import { RagAnswer } from '../types/rag.types';

const UPLOAD_DIR = '/tmp/uploads';

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  // ─── Upload & ingest PDF ──────────────────────────────────────────────────

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

  @Delete('pdf/:source')
  async deletePDF(@Param('source') source: string) {
    await this.ragService.deletePDF(source);
    return { message: `PDF "${source}" deleted from vector store` };
  }

  // ─── Ask a question ───────────────────────────────────────────────────────

  @Post('ask')
  ask(@Body() body: AskDto): Promise<RagAnswer> {
    if (!body.question) throw new BadRequestException('Question is required');
    return this.ragService.ask(body.question, body.filter ?? 'all');
  }

  // ─── Index single parcel ──────────────────────────────────────────────────

  @Post('index/parcel')
  async indexParcel(@Body() parcel: IndexParcelDto) {
    await this.ragService.indexParcel(parcel);
    return { message: `Parcel ${parcel.trackingCode} indexed successfully` };
  }

  // ─── Bulk index parcels ───────────────────────────────────────────────────

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

  @Delete('index/parcel/:id')
  async deleteParcel(@Param('id') id: string) {
    await this.ragService.deleteParcel(id);
    return { message: `Parcel ${id} deleted from vector store` };
  }
}
