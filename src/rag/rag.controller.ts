import {
  Controller,
  Post,
  Body,
  Delete,
  Param,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import multer, { diskStorage } from 'multer';
import { RagService } from './rag.service';
import * as fs from 'fs';

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  // ─── Upload & ingest PDF ──────────────────────────────────────────────────

  @Post('pdf/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      // storage: diskStorage({
      //   destination: './src/rag/uploads',
      //   filename: (_, file, cb) =>
      //     cb(null, `${Date.now()}-${file.originalname}`),
      // }),
       storage: multer.diskStorage({
        destination: (req, file, cb) => {
          const uploadDir = '/tmp/uploads';
          fs.mkdirSync(uploadDir, { recursive: true }); // recursive: true avoids ENOENT if /tmp/uploads doesn't exist
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          cb(null, `${Date.now()}-${file.originalname}`);
        },
      }),
      fileFilter: (_, file, cb) => {
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
  @Body() body: { category?: string },
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
  ask(@Body() body: { question: string; filter?: 'pdf' | 'parcel' | 'all' }) {
    if (!body.question) throw new BadRequestException('Question is required');
    return this.ragService.ask(body.question, body.filter ?? 'all');
  }

  // ─── Index single parcel ──────────────────────────────────────────────────

  @Post('index/parcel')
  async indexParcel(
    @Body()
    parcel: {
      id: string;
      trackingCode: string;
      status: string;
      origin: string;
      destination: string;
      recipientName: string;
      updatedAt: string;
      notes?: string;
    },
  ) {
    await this.ragService.indexParcel(parcel);
    return { message: `Parcel ${parcel.trackingCode} indexed successfully` };
  }

  // ─── Bulk index parcels ───────────────────────────────────────────────────

  @Post('index/bulk')
  async indexBulk(@Body() body: { parcels: any[] }) {
    if (!body.parcels?.length) throw new BadRequestException('No parcels provided');

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