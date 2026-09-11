import { BadRequestException } from '@nestjs/common';
import { fromBuffer, type Entry } from 'yauzl';

// XLSX is a ZIP container. Validate actual expanded bytes before ExcelJS loads XML.
export async function validateXlsxArchive(buffer: Buffer): Promise<void> {
  const maxExpandedBytes = 10 * 1024 * 1024;
  await new Promise<void>((resolve, reject) => {
    fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip)
          return reject(
            new BadRequestException('Invalid or encrypted XLSX file.'),
          );
        let expanded = 0;
        let stopped = false;
        const names = new Set<string>();
        const fail = (message: string): void => {
          if (stopped) return;
          stopped = true;
          zip.close();
          reject(new BadRequestException(message));
        };
        zip.on('error', () => fail('Invalid XLSX archive.'));
        zip.on('end', () => {
          if (stopped) return;
          zip.close();
          if (!names.has('xl/workbook.xml'))
            return fail('The file is not an XLSX workbook.');
          resolve();
        });
        zip.on('entry', (entry: Entry) => {
          if (stopped) return;
          if (
            names.has(entry.fileName) ||
            names.size >= 100 ||
            entry.uncompressedSize > maxExpandedBytes
          ) {
            return fail(
              'XLSX archive is too large or contains duplicate entries.',
            );
          }
          names.add(entry.fileName);
          if (
            entry.isEncrypted() ||
            /vbaProject|externalLinks|embeddings|activeX/i.test(entry.fileName)
          ) {
            return fail(
              'Use an XLSX file without macros, embedded objects, or external workbook links.',
            );
          }
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) return fail('Invalid XLSX entry.');
            stream.on('error', () => fail('Invalid XLSX entry size.'));
            stream.on('data', (chunk: Buffer) => {
              expanded += chunk.length;
              if (expanded > maxExpandedBytes) {
                stream.destroy();
                fail('XLSX expanded content exceeds 10 MB.');
              }
            });
            stream.on('end', () => {
              if (!stopped) zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
