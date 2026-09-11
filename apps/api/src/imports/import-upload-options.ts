import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { MAX_IMPORT_BYTES } from './import-file';

// Upload metadata is one flat merchantId; no nested objects or arrays are needed.
// fieldArrayIndexLimit is a Multer 2.3 option not yet in Nest's bundled interface.
const limits = {
  files: 1,
  fileSize: MAX_IMPORT_BYTES,
  fields: 1,
  fieldNameSize: 64,
  fieldSize: 256,
  fieldNestingDepth: 0,
  fieldArrayIndexLimit: 0,
};

export const IMPORT_UPLOAD_OPTIONS: MulterOptions = { limits };
